"""pick — choose the best of several generated candidates for one pose, by measurement, not by eye.

Image models drift a little differently every time, so the stable way to get a frame that matches
the anchor is to ask for several candidates and keep the one that measures closest. Each candidate
gets the check stage's acceptance (canvas, genuine alpha, shoulder line, torso cut), and then its
consistency with the anchor: the head is fitted onto the anchor's by the face boxes (--fit head, for
poses whose head moves on purpose), the geometry is aligned like the align stage (only the face may
differ), and what still disagrees in the hair outline around the head is counted. That residual is
content the generator drew differently (an extra lock, a restyled outline), the thing alignment
cannot fix. Blink candidates (--open <open frame>) are scored on how much changed outside the eyes.

    python rig.py pick --config rig.json --pose poked --files c1.png c2.png c3.png [--fit head]
    python rig.py pick --config rig.json --pose sip --open sip-open.png --files closed-c1.png ...

Prints the ranking (lowest score first, any FAIL last) and writes review/pick-<pose>.jpg: each
candidate's head with the residual painted on (red = only the candidate, blue = only the anchor).
Nothing is copied anywhere: adopting the winner into the source folder is the caller's decision.

A keyframe chain is picked as a whole: a frame that looks right on its own can still jump from its
neighbour. With --sequence, every frame of that sequence given as a --slot gets its candidates, the
frames not given use their current source file, and the path through the candidates whose WORST
step (silhouette miss after warping, both directions, like the morph stage) is smallest wins; among
paths with the same worst step, the one whose steps add up to less:

    python rig.py pick --config rig.json --sequence sip --slot sip-1 a.png b.png --slot sip-2 c.png d.png

Each neighbouring pair is measured once, and the best path is found by dynamic programming, so a
long chain with three candidates per frame stays cheap. Candidates that FAIL acceptance are skipped.
"""

import cv2
import numpy as np

from align import region_free
from common import (
    caption,
    cut_probe,
    eye_box,
    face_box,
    first_solid_y,
    flow,
    label,
    load_rgba,
    on_backdrop,
    outside_change,
    remap,
    save_rgb,
    solid_change,
    tile,
)


def score(ctx, pose, anchor, img, fit):
    th = ctx.th
    out = {"issues": [], "fail": False}
    a = img[..., 3]
    if img.shape != anchor.shape:
        out.update(fail=True, issues=[f"canvas {img.shape[1]}x{img.shape[0]} != anchor"])
        return out, None
    if (a == 0).mean() < 0.05:
        out["fail"] = True
        out["issues"].append("no genuine transparency")
    solid = a >= 128
    out["body_alpha"] = round(float(a[solid].mean()), 1)
    p = ctx.cfg["poses"][pose]
    if p["probe"] and ctx.probe_columns(pose):
        d = [first_solid_y(img, x) - first_solid_y(anchor, x) for x in ctx.probe_columns(pose)]
        out["shoulder_dy"] = d
        if max(abs(v) for v in d) > th["probe_fail_px"]:
            out["fail"] = True
            out["issues"].append(f"shoulders off by {max(d, key=abs)}px")
    cut_y = ctx.cfg["canvas"]["cut_y"]
    if p["probe"] and cut_y is not None and ctx.cut_columns(pose):
        window = ctx.cfg["canvas"]["cut_window"]
        seen = [v - cut_y for v in (cut_probe(img, x, cut_y, window) for x in ctx.cut_columns(pose)) if v is not None]
        out["cut_dy"] = seen
        if seen and max(abs(v) for v in seen) > th["cut_fail_px"]:
            out["fail"] = True
            out["issues"].append(f"torso cut off by {max(seen, key=abs)}px")

    # consistency with the anchor around the head
    afx, afy, afw, afh = face_box(ctx, ctx.cfg["anchor"], anchor, build=False)
    moved = img
    if fit:
        fx, fy, fw, fh = face_box(ctx, pose, img, build=False)
        s = afw / fw
        m = np.float32([[s, 0, afx - fx * s], [0, s, afy - fy * s]])
        moved = cv2.warpAffine(img, m, (img.shape[1], img.shape[0]), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
        out["head_fit"] = {"scale": round(float(s), 3), "shift": [round(float(afx - fx * s)), round(float(afy - fy * s))]}
    free = [afx - afw * 0.1, afy + afh * 0.05, afx + afw * 1.1, afy + afh * 1.08]
    head = np.zeros(anchor.shape[:2], bool)
    head[max(0, int(afy - afh * 0.9)) : int(afy + afh * 1.1), max(0, int(afx - afw * 0.8)) : int(afx + afw * 1.8)] = True
    head[int(free[1]) : int(free[3]), int(free[0]) : int(free[2])] = False
    aligned = remap(moved, region_free(cv2.GaussianBlur(flow(anchor, moved), (0, 0), 3), free))
    sa, sc = anchor[..., 3] > 128, aligned[..., 3] > 128
    extra, missing = (sc & ~sa) & head, (sa & ~sc) & head
    out["hair_extra_px"], out["hair_missing_px"] = int(extra.sum()), int(missing.sum())
    out["score"] = out["hair_extra_px"] + out["hair_missing_px"]
    if "shoulder_dy" in out:
        out["score"] += 200 * max(abs(v) for v in out["shoulder_dy"])

    y0, y1 = max(0, int(afy - afh * 0.9)), int(afy + afh * 1.1)
    x0, x1 = max(0, int(afx - afw * 0.8)), int(afx + afw * 1.8)
    view = on_backdrop(aligned) * 0.55
    view[extra] = (255, 70, 70)
    view[missing] = (70, 190, 255)
    return out, np.concatenate([on_backdrop(img)[y0:y1, x0:x1], view[y0:y1, x0:x1]], axis=1)


def step_miss(a, b, sigma):
    """The worst silhouette miss of a morph a <-> b, both directions (the morph stage's `sil`)."""
    fab = cv2.GaussianBlur(flow(a, b), (0, 0), sigma)
    fba = cv2.GaussianBlur(flow(b, a), (0, 0), sigma)
    worst = 0.0
    for src, dst, back in ((a, b, fba), (b, a, fab)):
        warped = remap(src, back)
        solid = dst[..., 3] > 128
        worst = max(worst, float(((warped[..., 3] > 128) ^ solid).sum() / max(solid.sum(), 1)))
    return worst


def run_sequence(ctx, args):
    seq = ctx.cfg["sequences"].get(args.sequence)
    if not seq:
        raise SystemExit(f"no sequence '{args.sequence}' in rig.json")
    slots = {name: files for name, *files in (args.slot or [])}
    unknown = [n for n in slots if n not in seq["frames"]]
    if unknown:
        raise SystemExit(f"--slot {unknown} not frames of '{args.sequence}': {seq['frames']}")
    anchor = load_rgba(ctx.source_file(ctx.cfg["anchor"], "open"))
    options = []  # per frame: [(label, image)]
    for frame in seq["frames"]:
        if frame in slots:
            keep = []
            for f in slots[frame]:
                img = load_rgba(f)
                r, _ = score(ctx, frame, anchor, img, False) if ctx.cfg["poses"][frame]["probe"] else ({"fail": False}, None)
                if r["fail"]:
                    print(f"  skip {f}: {'; '.join(r['issues'])}")
                    continue
                keep.append((str(f), img))
            if not keep:
                raise SystemExit(f"every candidate for {frame} FAILs: regenerate")
            options.append(keep)
        else:
            src = ctx.source_file(frame, "open")
            if not src:
                raise SystemExit(f"{frame} has no source file and no --slot")
            options.append([(str(src), load_rgba(src))])
    sigma = ctx.grid * 0.6
    # best[i][k] = (worst step so far, sum of steps, path, steps) ending at candidate k of frame i
    best = [[(0.0, 0.0, [k], []) for k in range(len(options[0]))]]
    for i in range(1, len(options)):
        row = []
        for k, (_, img) in enumerate(options[i]):
            cands = []
            for j, (_, prev) in enumerate(options[i - 1]):
                miss = step_miss(prev, img, sigma)
                worst, total, path, steps = best[i - 1][j]
                cands.append((max(worst, miss), total + miss, path + [k], steps + [miss]))
            row.append(min(cands, key=lambda c: (c[0], c[1])))
        best.append(row)
    worst, _, path, steps = min(best[-1], key=lambda c: (c[0], c[1]))
    chosen = [options[i][k][0] for i, k in enumerate(path)]
    for i, frame in enumerate(seq["frames"]):
        note = f"  (step in {steps[i - 1]:.3f})" if i else ""
        print(f"  {frame}: {chosen[i]}{note}")
    verdict = "every step morphs" if worst <= ctx.th["morph_sil"] else "a step is over morph_sil: that pair will cover-and-fade; regenerate it"
    print(f"  worst step {worst:.3f}: {verdict}")
    ctx.write_record(f"pick-{args.sequence}", {"frames": seq["frames"], "chosen": chosen, "steps": [round(s, 4) for s in steps]})
    return "pass" if worst <= ctx.th["morph_sil"] else "warn"


def run(ctx, args):
    if getattr(args, "sequence", None):
        return run_sequence(ctx, args)
    if not args.pose or not args.files:
        raise SystemExit("pick needs --pose and --files")
    if args.pose not in ctx.cfg["poses"]:
        raise SystemExit(f"'{args.pose}' is not a pose in rig.json")
    anchor = load_rgba(ctx.source_file(ctx.cfg["anchor"], "open"))
    rows, results = [], []
    for path in args.files:
        img = load_rgba(path)
        if args.open:
            # a blink candidate: only the eyes may differ from its open frame
            o = load_rgba(args.open)
            box = eye_box(ctx, args.pose, o, build=False)
            change, solid = outside_change(o, img, box), solid_change(o, img, box)
            fail = solid > ctx.th["blink_solid_max"] or change > ctx.th["blink_reject"]
            # what the align stage cannot move back ranks first, the drift it can second
            r = {"issues": [], "fail": fail, "outside_eye_change": round(change, 4), "solid_change": round(solid, 4), "score": round(solid * 1e6 + change * 1e4)}
            if r["fail"]:
                r["issues"].append(f"{change * 100:.1f}% changed outside the eyes, {solid * 100:.2f}% in solid blobs")
            view = None
        else:
            r, view = score(ctx, args.pose, anchor, img, args.fit == "head")
        r["file"] = str(path)
        results.append(r)
        if view is not None:
            rows.append(label(view, f"{path.name}  score {r['score']}{'  FAIL' if r['fail'] else ''}", 0.8))
    results.sort(key=lambda r: (r["fail"], r["score"]))
    for i, r in enumerate(results):
        keys = ("shoulder_dy", "cut_dy", "hair_extra_px", "hair_missing_px", "outside_eye_change", "solid_change", "head_fit", "body_alpha")
        detail = ", ".join(f"{k} {r[k]}" for k in keys if k in r)
        print(f"  {i + 1}. {'FAIL ' if r['fail'] else ''}{r['file']}: {detail}{'; ' + '; '.join(r['issues']) if r['issues'] else ''}")
    if rows:
        save_rgb(caption(tile(rows, 1), f"{args.pose}: red = only the candidate, blue = only the anchor"), ctx.review / f"pick-{args.pose}.jpg", quality=86)
    ctx.write_record(f"pick-{args.pose}", results)
    best = results[0]
    print(f"  best: {best['file']}{' (every candidate FAILs: regenerate)' if best['fail'] else ''}")
    return "fail" if best["fail"] else "pass"
