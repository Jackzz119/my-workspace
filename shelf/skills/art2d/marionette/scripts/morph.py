"""Stage 4 — morph: fields that let the runtime compute in-between frames for a pose change.

For every pair of morphable poses, the dense flow in both directions, smoothed and sampled at the
mesh vertices. At runtime the outgoing pose bends along a->b while the incoming one relaxes out of
b->a, and the pictures swap in the middle: frame interpolation computed from two frames, instead of
a dissolve whose silhouettes disagree (a strand of the old hair left showing, an arm popping).

A flow pair ships only when BOTH directions pass two checks, because the runtime needs both:
  err  mean colour error of a warped onto b (0..1)
  sil  share of b's silhouette the warped a misses; this is what catches a hand that leaves its
       place (the flow cannot follow it and drags whatever was there instead)

Guided pairs, for a rigid part that moves too far for the flow (the head going down onto the arms):
when a pair fails the flow checks and both poses mark the same named region in rig.json, that region
moves as a whole from its box in one pose to its box in the other (scale + translation), feathered
out, and everything else keeps the measured flow. "regions": {"head": {"doze-2": "auto", "asleep":
"auto"}} asks for the head box derived from the face box; any other region is a box in source px.
Only for rigid moves: a hand travelling from the book to the cup is a keyframe chain, not a guide.
Nothing measures whether a guided pair looks right, so its review sheet MUST be looked at; a pair
with no shared region keeps the runtime's cover-and-fade.

A rigid part that moves far inside the figure (the mug carried up in front of the chest) is where the
flow fails without the silhouette showing it: the flow keeps the mug in place and the transition shows
two mugs. So every pair is also matched by features (SIFT, mutual, ratio test); a compact group of
matches the flow missed by more than rigid_missed_px, that one similarity transform explains, is moved
as a whole along that transform inside its (grown, feathered) box, both ways, and the flow keeps the
rest. It is kept only where it lowers the colour error inside that box. The entry records it as "rigid".

A scene part a pose holds (rig.json "parts", poses.<id>.holds) is drawn in front of the figure while the
step runs (rig-core partFrame): where it lies, along its hold from one pose to the other, the two
silhouettes need not agree, so those pixels are left out of both checks (the grip frame draws the mug
under the scene's own one).

Review: review/morph-<a>-<b>.jpg for every pair: the transition simulated offline at t = 0, .25,
.5, .75, 1 with the runtime's timing. Look at t = .5 for smeared props, ghost limbs and a head that
floats where nothing covers it.
"""

import itertools

import cv2
import numpy as np
from PIL import Image

from align import part_on_canvas
from common import (
    caption,
    ease_in_out,
    face_box,
    flow,
    grey,
    grid_sample,
    label,
    load_rgba,
    on_backdrop,
    pack_flow,
    remap,
    save_rgb,
    shrink,
    smoothstep,
    tile,
)


SWAP = {"wide": (0.25, 0.75), "narrow": (0.35, 0.65), "step": (0.42, 0.58)}  # rig-core morphSwap


def simulate(a, b, fab, fba, t, window="wide"):
    """One frame of the runtime morph at progress t (see references/runtime.md, rig-core morphSwap)."""
    e = ease_in_out(t)
    # a mesh vertex at p shows a's pixel p at p + e*fab(p); inverting with the field at the target is
    # close enough for fields this smooth
    fa = remap(a, -e * fab)
    fb = remap(b, -(1 - e) * fba)
    swap_in, swap_out = SWAP[window]
    from_alpha = 1 - float(smoothstep(swap_out + 0.05, 1, t))
    to_alpha = float(smoothstep(swap_in, swap_out, t))
    out = on_backdrop(np.zeros_like(a))
    for img, k in ((fa, from_alpha), (fb, to_alpha)):
        al = img[..., 3:4] / 255 * k
        out = out * (1 - al) + img[..., :3] * al
    return out


def region_boxes(ctx, pose, img):
    """Named regions of a pose, assembled-canvas boxes: the head from the face box, the rest from rig.json."""
    fx, fy, fw, fh = face_box(ctx, pose, img)
    # the head with its hair: the face box grown to the crown and the sides of the hair
    boxes = {"head": [fx - fw * 0.55, fy - fh * 0.7, fx + fw * 1.55, fy + fh * 1.05]}
    for name, per_pose in ctx.cfg.get("regions", {}).items():
        # "auto" asks for the box this function derives itself (the head from the face box)
        if pose in per_pose and per_pose[pose] != "auto":
            boxes[name] = ctx.to_build(per_pose[pose])
    return boxes


def soft_box(shape, box):
    """1 inside the box, fading to 0 over a margin of a third of its smaller side."""
    h, w = shape
    x0, y0, x1, y1 = box
    feather = max(8.0, min(x1 - x0, y1 - y0) / 3)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = np.maximum(np.maximum(x0 - xx, xx - x1), 0)
    dy = np.maximum(np.maximum(y0 - yy, yy - y1), 0)
    return (1 - smoothstep(0, feather, np.hypot(dx, dy))).astype(np.float32)


def guided_field(shape, src_boxes, dst_boxes, names=None):
    """Displacement mapping each shared region's box in the source onto its box in the destination, and how
    much each pixel belongs to a region (0 outside, 1 inside, feathered between)."""
    total = np.zeros(shape + (2,), np.float32)
    weight = np.zeros(shape, np.float32)
    yy, xx = np.mgrid[0:shape[0], 0:shape[1]].astype(np.float32)
    shared = src_boxes.keys() & dst_boxes.keys() & (set(names) if names is not None else src_boxes.keys())
    for name in shared:
        a, b = src_boxes[name], dst_boxes[name]
        s = (b[2] - b[0]) / (a[2] - a[0])
        ca = ((a[0] + a[2]) / 2, (a[1] + a[3]) / 2)
        cb = ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)
        m = soft_box(shape, a)
        total[..., 0] += (cb[0] + s * (xx - ca[0]) - xx) * m
        total[..., 1] += (cb[1] + s * (yy - ca[1]) - yy) * m
        weight += m
    # where regions overlap, average them instead of adding their moves
    return total / np.maximum(weight, 1)[..., None], np.minimum(weight, 1), sorted(shared)


def feature_matches(a, b):
    """Mutual SIFT matches between two frames' opaque pixels: (points in a, points in b)."""
    ga, gb = grey(a).astype(np.uint8), grey(b).astype(np.uint8)
    sift = cv2.SIFT_create(nfeatures=8000)
    ka, da = sift.detectAndCompute(ga, (a[..., 3] > 128).astype(np.uint8))
    kb, db = sift.detectAndCompute(gb, (b[..., 3] > 128).astype(np.uint8))
    if da is None or db is None or len(ka) < 2 or len(kb) < 2:
        return np.zeros((0, 2), np.float32), np.zeros((0, 2), np.float32)
    bf = cv2.BFMatcher()
    back = {m.queryIdx: m.trainIdx for m, n in bf.knnMatch(db, da, k=2) if m.distance < 0.8 * n.distance}
    good = [m for m, n in bf.knnMatch(da, db, k=2) if m.distance < 0.75 * n.distance and back.get(m.trainIdx) == m.queryIdx]
    return np.float32([ka[m.queryIdx].pt for m in good]), np.float32([kb[m.trainIdx].pt for m in good])


def rigid_parts(a, b, fab, th):
    """Compact groups of matches the flow a -> b missed, each explained by one similarity transform:
    [(2x3 transform a -> b, its box in a)]."""
    pa, pb = feature_matches(a, b)
    if len(pa) < th["rigid_min_matches"]:
        return []
    xi, yi = pa[:, 0].astype(int), pa[:, 1].astype(int)
    missed = np.hypot(*(pb - pa - fab[yi, xi]).T) > th["rigid_missed_px"]
    pa, pb = pa[missed], pb[missed]
    parts = []
    while len(pa) >= th["rigid_min_matches"]:
        m, inl = cv2.estimateAffinePartial2D(pa, pb, method=cv2.RANSAC, ransacReprojThreshold=6, maxIters=4000)
        if m is None:
            break
        inl = inl.ravel().astype(bool)
        near = inl & (np.hypot(*(pa - np.median(pa[inl], 0)).T) < 220)
        if near.sum() < th["rigid_min_matches"]:
            break
        m, _ = cv2.estimateAffinePartial2D(pa[near], pb[near], method=cv2.LMEDS)
        scale, turn = float(np.hypot(*m[:, 0])), float(np.degrees(np.arctan2(m[1, 0], m[0, 0])))
        if m is not None and 0.85 < scale < 1.18 and abs(turn) < 25:
            x0, y0 = pa[near].min(0)
            x1, y1 = pa[near].max(0)
            gx, gy = (x1 - x0) * 0.45 + 20, (y1 - y0) * 0.45 + 20
            parts.append((m, [float(x0 - gx), float(y0 - gy), float(x1 + gx), float(y1 + gy)]))
        pa, pb = pa[~near], pb[~near]
    return parts


def with_parts(f, parts, shape):
    """f, with each part moved as a whole by its transform inside its feathered box."""
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    total = np.zeros((h, w, 2), np.float32)
    weight = np.zeros((h, w), np.float32)
    for m, box in parts:
        k = soft_box((h, w), box)
        total[..., 0] += (m[0, 0] * xx + m[0, 1] * yy + m[0, 2] - xx) * k
        total[..., 1] += (m[1, 0] * xx + m[1, 1] * yy + m[1, 2] - yy) * k
        weight += k
    k = np.minimum(weight, 1)[..., None]
    return f * (1 - k) + total / np.maximum(weight, 1)[..., None] * k


def seen_colour(img):
    """The colour a viewer sees, 0..1: the picture over mid grey by its own alpha. Under transparent pixels the
    stored RGB is anything (an image API leaves halos there), and comparing it would charge a clean morph for
    colour nobody sees; over grey, transparent-in-both is the same grey and costs nothing."""
    a = img[..., 3:4] / 255
    return img[..., :3] / 255 * a + 0.5 * (1 - a)


def box_error(src, dst, back, box):
    """Mean colour error of src warped onto dst, inside box, as seen."""
    x0, y0, x1, y1 = (int(max(0, v)) for v in box)
    warped = remap(src, back)[y0:y1, x0:x1]
    return float(np.abs(seen_colour(warped) - seen_colour(dst[y0:y1, x0:x1])).mean()) if warped.size else 0.0


def covered(ctx, a, b, shape):
    """Pixels a scene part covers while a -> b runs: the part stays drawn in front when neither pose hides
    it, or rides along a hold when the one that hides it also holds it; mapped from its place along the
    holds (the grip nudges it, the lift carries it). None when nothing covers anything."""
    parts = ctx.cfg["parts"]
    if not parts:
        return None
    rec = ctx.record("assemble")
    held = (ctx.record("align") or {}).get("holds", {})
    poses = ctx.cfg["poses"]
    out = np.zeros(shape, bool)
    for name in parts:
        hide_a, hide_b = name in poses[a]["hides"], name in poses[b]["hides"]
        at_a, at_b = held.get(a, {}).get(name, {}).get("at"), held.get(b, {}).get(name, {}).get("at")
        if hide_a and hide_b:
            continue
        if (hide_a and at_a is None) or (hide_b and at_b is None):
            continue  # a plain cross-fade: the part is half gone, it covers nothing for sure
        mask = part_on_canvas(ctx, name, rec["registration"], rec["crop"], 0, shape)[..., 3] > 128
        (ax, ay), (bx, by) = at_a or (0, 0), at_b or (0, 0)
        for k in np.linspace(0, 1, 9):
            dx, dy = ax + (bx - ax) * k, ay + (by - ay) * k
            out |= cv2.warpAffine(mask.astype(np.uint8), np.float32([[1, 0, dx], [0, 1, dy]]), (shape[1], shape[0])) > 0
    return out if out.any() else None


def run(ctx, args):
    rec = ctx.record("assemble")
    if not rec or not ctx.final.exists():
        raise SystemExit("run assemble and align first")
    th = ctx.th
    sigma = ctx.grid * 0.6
    present = [p for p in ctx.cfg["poses"] if (ctx.final / f"{p}-open.png").exists()]
    imgs = {p: load_rgba(ctx.final / f"{p}-open.png") for p in present}
    h, w = next(iter(imgs.values())).shape[:2]
    # every pair of plain morphable poses, plus the neighbours of every keyframe chain (always tried:
    # a chain is only as smooth as its worst step)
    base = [p for p in present if ctx.cfg["poses"][p]["morph"] and not ctx.cfg["poses"][p]["chain"]]
    todo = list(itertools.combinations(base, 2))
    for sq in ctx.cfg["sequences"].values():
        for a, b in zip(sq["frames"], sq["frames"][1:]):
            if a in imgs and b in imgs and (a, b) not in todo and (b, a) not in todo:
                todo.append((a, b))
    for old in ctx.final.glob("morph-*.png"):
        old.unlink()

    def write(name, f):
        Image.fromarray(pack_flow(grid_sample(f, h, w, ctx.grid)), "RGB").save(ctx.final / f"morph-{name}.png", optimize=True)

    # every keyframe step, with the window its chain swaps in (a chain's `swap`, else quick)
    steps = {frozenset(p): sq.get("swap") or "step" for sq in ctx.cfg["sequences"].values() for p in zip(sq["frames"], sq["frames"][1:])}

    def review(a, b, fab, fba, verdict, guided=False):
        # the window the runtime swaps this pair in (rig-core morphSwap): slow poses and guided pairs
        # narrow, keyframe steps as their chain says (quick unless `swap`), anything else wide
        slow = ctx.cfg["poses"][a]["slow"] or ctx.cfg["poses"][b]["slow"] or guided
        window = "narrow" if slow else steps.get(frozenset((a, b)), "wide")
        frames = [label(shrink(simulate(imgs[a], imgs[b], fab, fba, t, window), 320), f"t={t:g}") for t in (0, 0.25, 0.4, 0.5, 0.6, 0.75, 1)]
        save_rgb(caption(tile(frames, 7), f"{a} -> {b}  {verdict}"), ctx.review / f"morph-{a}-{b}.jpg", quality=85)

    pairs = {}
    for a, b in todo:
        entry = {"kind": "none"}
        fab = cv2.GaussianBlur(flow(imgs[a], imgs[b]), (0, 0), sigma)
        fba = cv2.GaussianBlur(flow(imgs[b], imgs[a]), (0, 0), sigma)
        # a rigid part the flow missed moves as a whole, both ways, where it really lowers the error there
        kept = []
        for m, box in rigid_parts(imgs[a], imgs[b], fab, th):
            inv = cv2.invertAffineTransform(m)
            corners = np.float32([[box[0], box[1]], [box[2], box[1]], [box[0], box[3]], [box[2], box[3]]])
            moved = corners @ m[:, :2].T + m[:, 2]
            box_b = [float(moved[:, 0].min()), float(moved[:, 1].min()), float(moved[:, 0].max()), float(moved[:, 1].max())]
            gab, gba = with_parts(fab, [(m, box)], (h, w)), with_parts(fba, [(inv, box_b)], (h, w))
            before = box_error(imgs[a], imgs[b], fba, box_b) + box_error(imgs[b], imgs[a], fab, box)
            after = box_error(imgs[a], imgs[b], gba, box_b) + box_error(imgs[b], imgs[a], gab, box)
            if after < before:
                fab, fba = gab, gba
                centre = np.float32([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2])
                kept.append({"move": [round(float(v), 1) for v in centre @ m[:, :2].T + m[:, 2] - centre], "error": [round(before / 2, 4), round(after / 2, 4)]})
        if kept:
            entry["rigid"] = kept
        dirs = {}
        hidden = covered(ctx, a, b, (h, w))
        seen = ~hidden if hidden is not None else np.ones((h, w), bool)
        for src, dst, back in ((a, b, fba), (b, a, fab)):
            # to show src in dst's geometry, sample src along dst -> src
            warped = remap(imgs[src], back)
            # only visible colour counts (seen_colour): before 2026-11-01 the RGB under transparent pixels did too
            err = float((np.abs(seen_colour(warped) - seen_colour(imgs[dst])).mean(axis=2)[seen]).mean())
            solid = (imgs[dst][..., 3] > 128) & seen
            sil = float((((warped[..., 3] > 128) & seen) ^ solid).sum() / max(solid.sum(), 1))
            dirs[f"{src}-{dst}"] = {"err": round(err, 4), "sil": round(sil, 4)}
        entry.update(dirs)
        if hidden is not None:
            entry["covered_px"] = int(hidden.sum())
        if all(d["err"] <= th["morph_err"] and d["sil"] <= th["morph_sil"] for d in dirs.values()):
            entry["kind"] = "flow"
        # a guide only where a region was configured for both poses: an unasked-for guide bends the
        # figure like rubber. Region boxes (and the face box they start from) are only looked up then.
        configured = [n for n, per in ctx.cfg.get("regions", {}).items() if a in per and b in per]
        if entry["kind"] == "none" and configured:
            ra, rb = region_boxes(ctx, a, imgs[a]), region_boxes(ctx, b, imgs[b])
            gab, mab, shared = guided_field((h, w), ra, rb, configured)
            gba, mba, _ = guided_field((h, w), rb, ra, configured)
            if shared:
                # the regions move as wholes; everything else keeps the measured flow
                fab = fab * (1 - mab[..., None]) + gab * mab[..., None]
                fba = fba * (1 - mba[..., None]) + gba * mba[..., None]
                for src, dst, back in ((a, b, fba), (b, a, fab)):
                    warped = remap(imgs[src], back)
                    solid = imgs[dst][..., 3] > 128
                    entry[f"{src}-{dst}"]["guided_sil"] = round(float(((warped[..., 3] > 128) ^ solid).sum() / max(solid.sum(), 1)), 4)
                entry.update(kind="guided", regions=shared)
        if entry["kind"] != "none":
            write(f"{a}-{b}", fab)
            write(f"{b}-{a}", fba)
            entry["max_shift_px"] = round(float(np.abs(fab).max()), 1)
        pairs[f"{a}-{b}"] = entry
        worst = max((v for k, v in entry.items() if isinstance(v, dict)), key=lambda d: d["sil"], default=None)
        measured = f"err {worst['err']:.3f}  silhouette miss {worst['sil']:.3f}" if worst else "no flow tried"
        if kept:
            measured += f"  rigid part moved {', '.join(str(k['move']) for k in kept)}"
        verdict = {"flow": "morph", "guided": f"guided ({', '.join(entry.get('regions', []))}): LOOK AT IT", "none": "cover-and-fade"}[entry["kind"]]
        print(f"  {a:>10} <-> {b:<10} {measured}  {verdict}")
        if entry["kind"] == "none":
            review(a, b, np.zeros((h, w, 2), np.float32), np.zeros((h, w, 2), np.float32), "cover-and-fade (no field)")
        else:
            review(a, b, fab, fba, verdict.upper(), entry["kind"] == "guided")

    ctx.write_record("morph", pairs)
    return "pass"
