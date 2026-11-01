"""Stage 1 — check: acceptance of the raw generated pose set, before anything is built from it.

Per file: canvas size, genuine transparency, shoulder-line drift against the anchor pose, torso cut
line; per blink pair: how much changed outside the eyes. FAIL means regenerate that file; a blink
over the limit is rejected (the pose ships eyes-open) rather than failing the set. A pose with
"accept": "<reason>" in rig.json turns its FAIL into a WARN that names the reason on every run: for a
known defect that was decided on, never for a new one.

Review: review/check-contact.jpg (every file on a checkerboard, so fake transparency shows) and
review/check-overlay.jpg (every file at 50% over the anchor, so drift shows as double lines).
"""

from common import cut_probe, eye_box, first_solid_y, label, load_rgba, on_backdrop, on_checker, outside_change, save_rgb, shrink, solid_change, tile


def run(ctx, args):
    cfg, th = ctx.cfg, ctx.th
    anchor_path = ctx.source_file(cfg["anchor"], "open")
    if not anchor_path:
        raise SystemExit(f"anchor pose '{cfg['anchor']}' has no open frame in {ctx.source}")
    anchor = load_rgba(anchor_path)
    size = tuple(cfg["canvas"]["size"] or (anchor.shape[1], anchor.shape[0]))
    probes_x = cfg["canvas"]["probes_x"]
    cut_y = cfg["canvas"]["cut_y"]
    base_probe = {x: first_solid_y(anchor, x) for x in {x for p in cfg["poses"] for x in ctx.probe_columns(p)} | set(probes_x)}

    files, blinks, contact, overlay = [], {}, [], []
    worst = "pass"

    def grade(level):
        nonlocal worst
        order = ["pass", "warn", "fail"]
        worst = max(worst, level, key=order.index)
        return level

    for pose, p in cfg["poses"].items():
        eyes = ["open", "closed"] if p["blink"] else ["open"]
        loaded = {}
        for eye in eyes:
            path = ctx.source_file(pose, eye)
            entry = {"pose": pose, "eye": eye, "file": str(path) if path else None, "issues": []}
            files.append(entry)
            if not path:
                # a missing blink frame only loses the blink; a missing pose is a hole in the set
                entry["status"] = grade("fail" if eye == "open" else "warn")
                entry["issues"].append("missing")
                continue
            img = load_rgba(path)
            loaded[eye] = img
            a = img[..., 3]
            entry["size"] = [img.shape[1], img.shape[0]]
            entry["transparent_share"] = round(float((a == 0).mean()), 3)
            solid = a >= 128
            entry["body_alpha_mean"] = round(float(a[solid].mean()), 1) if solid.any() else 0
            status = "pass"
            fits = (img.shape[1], img.shape[0]) == size
            if not fits:
                status = "fail"
                entry["issues"].append(f"canvas {entry['size']} != {list(size)}")
            if entry["transparent_share"] < 0.05:
                status = "fail"
                entry["issues"].append("no genuine transparency (painted background?)")
            elif entry["body_alpha_mean"] < 245:
                status = max(status, "warn", key=["pass", "warn", "fail"].index)
                entry["issues"].append(f"body alpha only {entry['body_alpha_mean']}: the figure lets the scene through")
            if p["probe"] and ctx.probe_columns(pose) and fits:
                d = {}
                for x in ctx.probe_columns(pose):
                    y, y0 = first_solid_y(img, x), base_probe[x]
                    d[x] = None if y is None or y0 is None else y - y0
                entry["shoulder_dy"] = d
                worst_dy = max((abs(v) for v in d.values() if v is not None), default=0)
                if worst_dy > th["probe_fail_px"]:
                    status = "fail"
                    entry["issues"].append(f"shoulder line drifts {worst_dy}px from the anchor")
                elif worst_dy > th["probe_warn_px"]:
                    status = max(status, "warn", key=["pass", "warn", "fail"].index)
                    entry["issues"].append(f"shoulder line drifts {worst_dy}px")
            if p["probe"] and cut_y is not None and ctx.cut_columns(pose) and fits:
                cut = {x: cut_probe(img, x, cut_y, cfg["canvas"]["cut_window"]) for x in ctx.cut_columns(pose)}
                entry["cut_y"] = cut
                seen = [v - cut_y for v in cut.values() if v is not None]
                if seen and max(abs(v) for v in seen) > th["cut_fail_px"]:
                    off = max(seen, key=abs)
                    if p.get("fit_cut") and abs(off) <= th["fit_cut_max_px"]:
                        status = max(status, "warn", key=["pass", "warn", "fail"].index)
                        entry["issues"].append(f"torso cut line off by {off}px: the align stage fits it onto y={cut_y}")
                    else:
                        status = "fail"
                        entry["issues"].append(f"torso cut line off by {off}px (expected y={cut_y})")
            if status == "fail" and fits and p.get("accept"):
                # a known defect someone decided to ship with: still printed on every run
                status = "warn"
                entry["issues"].append(f"accepted: {p['accept']}")
            entry["status"] = grade(status)
            tag = f"{pose}-{eye} {entry['status'].upper()}"
            contact.append(label(shrink(on_checker(img), 384), tag))
            mix = on_backdrop(anchor) * 0.5 + on_backdrop(img) * 0.5
            overlay.append(label(shrink(mix, 384), f"{pose}-{eye} vs anchor"))

        if "open" in loaded and "closed" in loaded:
            box = eye_box(ctx, pose, loaded["open"], build=False)
            change = outside_change(loaded["open"], loaded["closed"], box)
            solid = solid_change(loaded["open"], loaded["closed"], box)
            rejected = solid > th["blink_solid_max"] or change > th["blink_reject"]
            blinks[pose] = {"eye_box": box, "outside_change": round(change, 4), "solid_change": round(solid, 4), "rejected": rejected}
            if rejected:
                grade("warn")

    ctx.write_record("check", {"size": list(size), "files": files, "blinks": blinks, "status": worst})
    if contact:
        save_rgb(tile(contact, 4), ctx.review / "check-contact.jpg", quality=85)
        save_rgb(tile(overlay, 4), ctx.review / "check-overlay.jpg", quality=85)

    for e in files:
        if e["status"] != "pass":
            print(f"  {e['status'].upper():4} {e['pose']}-{e['eye']}: {'; '.join(e['issues'])}")
    for pose, b in blinks.items():
        verdict = "REJECTED, ships eyes-open" if b["rejected"] else "ok"
        print(f"  blink {pose}: {b['outside_change'] * 100:.1f}% changed outside the eyes, {b['solid_change'] * 100:.2f}% of it in solid blobs ({verdict})")
    return worst

