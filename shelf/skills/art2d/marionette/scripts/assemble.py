"""Stage 2 — assemble: one shared trimmed canvas for every pose, and optionally where it sits in the scene.

The pixels are never touched: every frame is cropped by the same union box (so the poses keep their
registration) into build/raw/. With canvas.crop set, that box is fixed instead, and a frame reaching
outside it stops the build rather than being cut. Blink frames rejected by `check` are left out. With `plate` set, the
anchor pose is registered onto that scene frame (SIFT, uniform scale + translation, the model a 2D
runtime places a sprite with) and the result is written with its residuals.

Review: review/register.png (the anchor at 60% over the dimmed plate) when a plate is given.
"""

import shutil

import cv2
import numpy as np
from PIL import Image

from common import alpha_box, load_rgba, save_rgba


def register(sprite, master):
    """Uniform scale + translation mapping sprite px onto master px, from SIFT matches on form, not light."""
    s_grey = cv2.cvtColor(sprite[..., :3].astype(np.uint8), cv2.COLOR_RGB2GRAY)
    s_mask = cv2.erode(((sprite[..., 3] > 200) * 255).astype(np.uint8), np.ones((9, 9), np.uint8))
    m_grey = cv2.cvtColor(master[..., :3].astype(np.uint8), cv2.COLOR_RGB2GRAY)
    # contrast-normalise both so an evenly lit sprite and a moodily lit scene still match
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    s_grey, m_grey = clahe.apply(s_grey), clahe.apply(m_grey)
    sift = cv2.SIFT_create(nfeatures=6000)
    ks, ds = sift.detectAndCompute(s_grey, s_mask)
    km, dm = sift.detectAndCompute(m_grey, None)
    if ds is None or dm is None:
        raise SystemExit("registration: no features found")
    good = [m for m, n in cv2.BFMatcher(cv2.NORM_L2).knnMatch(ds, dm, k=2) if m.distance < 0.75 * n.distance]
    if len(good) < 12:
        raise SystemExit(f"registration: only {len(good)} matches; is the plate the same character and framing?")
    src = np.float32([ks[m.queryIdx].pt for m in good])
    dst = np.float32([km[m.trainIdx].pt for m in good])
    affine, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=4.0)
    scale = float(np.hypot(affine[0, 0], affine[1, 0]))
    rotation = float(np.degrees(np.arctan2(affine[1, 0], affine[0, 0])))
    keep = inliers.ravel().astype(bool)
    # translation re-solved for the rotation-free model the runtime uses
    offset = (dst[keep] - scale * src[keep]).mean(axis=0)
    residual = np.linalg.norm(dst[keep] - (scale * src[keep] + offset), axis=1)
    return {
        "matches": len(good),
        "inliers": int(keep.sum()),
        "scale": round(scale, 5),
        "rotation_deg": round(rotation, 3),
        "offset": [round(float(offset[0]), 2), round(float(offset[1]), 2)],
        "residual_px_median": round(float(np.median(residual)), 2),
        "residual_px_p90": round(float(np.percentile(residual, 90)), 2),
    }


def run(ctx, args):
    cfg = ctx.cfg
    check = ctx.record("check") or {"blinks": {}}
    rejected = {p for p, b in check["blinks"].items() if b["rejected"]}

    frames = {}
    for pose, p in cfg["poses"].items():
        for eye in ["open", "closed"] if p["blink"] else ["open"]:
            path = ctx.source_file(pose, eye)
            if path:
                frames[(pose, eye)] = load_rgba(path)
    if (cfg["anchor"], "open") not in frames:
        raise SystemExit("anchor pose missing")
    sizes = {(f.shape[1], f.shape[0]) for f in frames.values()}
    if len(sizes) != 1:
        raise SystemExit(f"pose canvases differ: {sorted(sizes)}; every pose must share one canvas")

    # one union crop so every pose keeps the shared alignment
    boxes = {k: alpha_box(f, ctx.th["alpha_empty"]) for k, f in frames.items()}
    x0, y0 = min(b[0] for b in boxes.values()), min(b[1] for b in boxes.values())
    x1, y1 = max(b[2] for b in boxes.values()), max(b[3] for b in boxes.values())
    fixed = cfg["canvas"]["crop"]
    if fixed:
        # a runtime places touch zones and anchors in canvas px: a canvas that moves with every new
        # frame would silently shift them all, so once fixed it stays, and nothing is ever cut to fit
        over = {f"{p}-{e}": [max(0, fixed[0] - b[0]), max(0, fixed[1] - b[1]), max(0, b[2] - fixed[2]), max(0, b[3] - fixed[3])] for (p, e), b in boxes.items()}
        over = {k: v for k, v in over.items() if any(v)}
        if over:
            detail = "; ".join(f"{k} by {v} (left, top, right, bottom)" for k, v in over.items())
            raise SystemExit(f"canvas.crop {fixed} would cut: {detail}. Regenerate those frames, or enlarge the crop and update the runtime's canvas coordinates")
        x0, y0, x1, y1 = fixed

    if ctx.raw.exists():
        shutil.rmtree(ctx.raw)  # a stage owns its folder: nothing stale survives a re-run
    poses = {}
    for (pose, eye), f in frames.items():
        if eye == "closed" and pose in rejected:
            continue
        save_rgba(f[y0:y1, x0:x1], ctx.raw / f"{pose}-{eye}.png")
        poses.setdefault(pose, []).append(eye)

    record = {
        "source_size": list(next(iter(sizes))),
        "crop": [x0, y0],
        "canvas": {"w": x1 - x0, "h": y1 - y0},
        "poses": poses,
        "blink_rejected": sorted(rejected),
    }

    if cfg["placement"] and not cfg["plate"]:
        # a character built for an existing seat (the second person on the same chair): no scene frame
        # shows them yet, so the seat is given instead of measured
        pl = cfg["placement"]
        reg = {"offset": list(pl["offset"]), "scale": pl["scale"], "source": "rig.json placement"}
        reg["origin"] = [round(pl["offset"][0] + x0 * pl["scale"], 2), round(pl["offset"][1] + y0 * pl["scale"], 2)]
        record["registration"] = reg
        edge = cfg["canvas"]["cut_plate_y"]
        if edge is not None and cfg["canvas"]["cut_y"] is not None:
            want = (edge - reg["offset"][1]) / reg["scale"]
            record["cut_y_from_plate"] = round(want, 1)
            if abs(want - cfg["canvas"]["cut_y"]) > ctx.th["cut_fail_px"]:
                print(f"  FAIL canvas.cut_y is {cfg['canvas']['cut_y']} but the table's far edge (plate y {edge}) lands at y {want:.0f}: fix cut_y and the brief")
                ctx.write_record("assemble", record)
                return "fail"
        print(f"  placed by rig.json: scale {pl['scale']}, origin {reg['origin']}")

    if cfg["plate"]:
        master = load_rgba(cfg["plate"]["path"])
        anchor = frames[(cfg["anchor"], "open")]
        reg = register(anchor, master)
        # the crop moves the canvas origin; fold it into the placement
        reg["origin"] = [round(reg["offset"][0] + x0 * reg["scale"], 2), round(reg["offset"][1] + y0 * reg["scale"], 2)]
        record["registration"] = reg
        m = np.float32([[reg["scale"], 0, reg["offset"][0]], [0, reg["scale"], reg["offset"][1]]])
        warped = cv2.warpAffine(anchor, m, (master.shape[1], master.shape[0]), flags=cv2.INTER_LINEAR, borderValue=(0, 0, 0, 0))
        a = warped[..., 3:4] / 255 * 0.6
        over = master[..., :3] * 0.55 * (1 - a) + warped[..., :3] * a
        ctx.review.mkdir(parents=True, exist_ok=True)
        Image.fromarray(np.clip(over, 0, 255).astype(np.uint8)).save(ctx.review / "register.png")
        print(f"  registered: scale {reg['scale']}, rotation {reg['rotation_deg']} deg, residual median {reg['residual_px_median']}px")
        edge = cfg["canvas"]["cut_plate_y"]
        if edge is not None and cfg["canvas"]["cut_y"] is not None:
            # where the table's far edge lands on the pose canvas: the torso cut must be there, or
            # the scene behind the table shows between the torso and the tabletop (or the torso covers it)
            want = (edge - reg["offset"][1]) / reg["scale"]
            record["cut_y_from_plate"] = round(want, 1)
            if abs(want - cfg["canvas"]["cut_y"]) > ctx.th["cut_fail_px"]:
                print(f"  FAIL canvas.cut_y is {cfg['canvas']['cut_y']} but the table's far edge (plate y {edge}) lands at y {want:.0f}: fix cut_y and the brief")
                ctx.write_record("assemble", record)
                return "fail"
        if abs(reg["rotation_deg"]) > 1 or reg["residual_px_median"] > 3:
            print("  WARN registration is loose: look at review/register.png before trusting it")
            ctx.write_record("assemble", record)
            return "warn"

    ctx.write_record("assemble", record)
    print(f"  canvas {x1 - x0}x{y1 - y0} (crop at {x0},{y0}); {len(frames)} frames, blink rejected: {sorted(rejected) or 'none'}")
    return "pass"
