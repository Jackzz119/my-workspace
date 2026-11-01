"""Stage 5 — weights: per-pose motion masks for the idle mesh, derived from the pose's own pixels.

Wallpaper Engine animates flat character art by painting masks that say how much each area moves
(its Shake and Puppet Warp tools). This derives the same kind of mask per pose, so no art is cut or
repainted. Output per pose: a small RGB PNG at the mesh's vertex grid:

  R  breath  0 = anchored (hands, held props, anything resting on the table), 1 = rides the chest
             (shoulders, neck, head)
  G  hair    0 = roots and face, 1 = the loosest tips

How areas are found (all overridable in rig.json, and a mask PNG always wins over a heuristic):
  face   face.boxes, else the largest warm-skin blob in the upper canvas
  hair   hair.mode: "dark" (lum < lum_max) / "light" (lum > lum_min) / "color" (within tol of rgb) /
         "mask" (hair.masks) / "none"; in every mode only pixels around the face and connected to the
         crown count, because clothes are often as dark as hair. hair.by_pose.<pose> overrides any of
         these for one pose (a head resting on dark sleeves: {"mode": "none"} or a mask)
  hold   skin below the chin (hands) and bright unsaturated pixels below the chin (paper, books),
         plus hold.masks
  breath 0 at breath.anchor_y (default cut_y + 60, else the canvas bottom), 1 from the shoulders up

Review: review/weights-<pose>.jpg, red = breath, green = hair over the dimmed pose. The book or
the hands must be dark, the shoulders red, only hair green (not the hood, not the collar).
"""

import cv2
import numpy as np
from PIL import Image

from common import face_box, grid_axes, label, load_rgba, save_rgb, smoothstep


def mask_png(ctx, path, shape):
    """A hand-made or generated mask in SOURCE canvas px, cropped to the assembled canvas."""
    x0, y0 = ctx.crop()
    m = np.asarray(Image.open(path).convert("L")).astype(np.float32) / 255
    return m[y0 : y0 + shape[0], x0 : x0 + shape[1]]


def weights(ctx, pose, rgba):
    cfg = ctx.cfg
    h, w = rgba.shape[:2]
    rgb = rgba[..., :3] / 255
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    solid = rgba[..., 3] > 128
    skin = solid & (r > g) & (g > b) & (r > 0.55) & (lum > 0.42) & (sat > 0.12) & (sat < 0.55)

    fx, fy, fw, fh = face_box(ctx, pose, rgba)
    cx, cy = fx + fw / 2, fy + fh / 2
    chin = fy + fh
    radius = max(fw, fh) / 2
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    dist = np.hypot((xx - cx) / (fw / 2), (yy - cy) / (fh / 2))  # 1 = the face oval

    # hair: candidate pixels in a band around the face (wider above the forehead, where hair spreads),
    # no lower than the chin, outside the face oval, connected to the hair above the forehead
    hc = {**cfg["hair"], **cfg["hair"].get("by_pose", {}).get(pose, {})}
    masks = hc["masks"]
    if pose in masks:
        hair = mask_png(ctx, masks[pose], (h, w)) > 0.5
    elif hc["mode"] == "none":
        hair = np.zeros((h, w), bool)
    else:
        if hc["mode"] == "dark":
            colour = lum < hc["lum_max"]
        elif hc["mode"] == "light":
            colour = lum > hc["lum_min"]
        elif hc["mode"] == "color":
            colour = np.abs(rgb - np.array(hc["rgb"], np.float32) / 255).max(axis=2) < hc["tol"]
        else:
            raise SystemExit(f"hair.mode '{hc['mode']}' needs hair.masks.{pose}")
        eyes = fy + fh * 0.45
        pad = np.where(yy < fy, fw * 0.6, np.where(yy < eyes, fw * 0.38, fw * 0.22))
        band = (xx > fx - pad) & (xx < fx + fw + pad) & (yy < chin)
        cand = cv2.morphologyEx((solid & colour & band & (dist > 1.02)).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
        n, lab, st, _ = cv2.connectedComponentsWithStats(cand, 8)
        crown = [i for i in range(1, n) if st[i, cv2.CC_STAT_TOP] < fy + fh * 0.15]
        hair = np.isin(lab, crown)
    # tips move, roots stay: grows with distance from the face centre
    tip = smoothstep(1.0, 2.6, np.hypot((xx - cx) / radius, (yy - cy) / radius))
    hair_w = np.where(hair, 0.25 + 0.75 * tip, 0).astype(np.float32)

    # breath: 0 at the anchor line, 1 from the shoulders up
    bc = cfg["breath"]
    if pose in bc["masks"]:
        breath = mask_png(ctx, bc["masks"][pose], (h, w))
    else:
        cut = cfg["canvas"]["cut_y"]
        anchor = bc["anchor_y"] if bc["anchor_y"] is not None else (cut + 60 if cut is not None else None)
        anchor_y = h - 1 if anchor is None else anchor - ctx.crop()[1]
        breath = smoothstep(anchor_y, chin + fh * 0.35, yy).astype(np.float32)
    # held things stay put: hands and props below the chin
    ho = cfg["hold"]
    below = yy > chin
    held = np.zeros((h, w), bool)
    if ho["skin_below_chin"]:
        held |= skin & below
    if ho["bright_low_sat"]:
        held |= solid & below & (lum > 0.62) & (sat < 0.18)
    if pose in ho["masks"]:
        held |= mask_png(ctx, ho["masks"][pose], (h, w)) > 0.5
    held = cv2.dilate(held.astype(np.uint8), np.ones((9, 9), np.uint8)).astype(np.float32)

    # smoothed so neighbouring vertices never pull apart; the hold goes on AFTER the blur, otherwise
    # the chest's motion bleeds onto the book and the book breathes
    breath = cv2.GaussianBlur(breath, (0, 0), ctx.grid * 1.2)
    held = np.clip(cv2.GaussianBlur(held, (0, 0), ctx.grid * 0.5) * 1.6, 0, 1)
    breath = breath * (1 - 0.92 * held)
    hair_w = cv2.GaussianBlur(hair_w, (0, 0), ctx.grid * 0.8)
    hair_w = hair_w / max(float(hair_w.max()), 1e-6)
    return breath, hair_w, [fx, fy, fw, fh]


def run(ctx, args):
    rec = ctx.record("assemble")
    if not rec or not ctx.final.exists():
        raise SystemExit("run assemble and align first")
    for old in ctx.final.glob("idle-*.png"):
        old.unlink()
    result = {}
    for pose in rec["poses"]:
        img = load_rgba(ctx.final / f"{pose}-open.png")
        h, w = img.shape[:2]
        breath, hair_w, face = weights(ctx, pose, img)
        xs, ys = grid_axes(h, w, ctx.grid)
        out = np.zeros((len(ys), len(xs), 3), np.uint8)
        out[..., 0] = np.round(breath[np.ix_(ys, xs)] * 255)
        out[..., 1] = np.round(hair_w[np.ix_(ys, xs)] * 255)
        Image.fromarray(out, "RGB").save(ctx.final / f"idle-{pose}.png", optimize=True)
        result[pose] = {"grid": [len(xs), len(ys)], "face": face, "hair_share": round(float((hair_w > 0.05).mean()), 4)}
        print(f"  {pose}: grid {len(xs)}x{len(ys)}, face {face}")

        # tint only the figure: the transparent canvas moves too, but nobody sees it
        a = img[..., 3] / 255
        over = img[..., :3] * 0.45
        over[..., 0] += breath * 140 * a
        over[..., 1] += hair_w * 200 * a
        save_rgb(label(cv2.resize(over, (w // 2, h // 2), interpolation=cv2.INTER_AREA), f"{pose}: red breath, green hair"), ctx.review / f"weights-{pose}.jpg", quality=85)
    ctx.write_record("weights", result)
    return "pass"
