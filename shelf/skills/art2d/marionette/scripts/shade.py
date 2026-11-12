"""Shading a finished drawing: the part that does not depend on the light, baked per drawing (references/shading.md).

A generated drawing is often lit right but flat inside: fur reads as one sheet, with no clefts between its clumps.
This deepens the clefts the paint already has (cavity), in the drawing's own pixels, so it rides the mesh with
everything else and costs nothing at run time. What depends on the light and the pose (a part's shadow on
another, the light a part keeps off where it meets the body) is the run time's, per frame (shading.md).

    python shade.py <in.png> <out.png> [--strength 1.0] [--floor 0.84] [--fine 2.5] [--coarse 9]
                    [--skip x0,y0,x1,y1 ...] [--sheet <sheet.jpg> --crop x0,y0,x1,y1]
    rig.json "shade": {"strength": .., "floor": .., "fine": .., "coarse": .., "skip": [[x0, y0, x1, y1], ...]}
        → the export stage bakes every pose picture with it

How: on log luminance (so a cleft in white fur and one in grey fur count alike), a band-pass (`fine` minus
`coarse` px Gaussian, each normalised by the alpha so the outline never reads as a cleft) finds what is darker
than its clump; that much darker again × `strength`, never below `floor`. Not across a patch's edge (white to
grey is paint, not a cleft: the step is found on the coarse blur and left alone) and not in the `skip` boxes
(eyes, nose, mouth: their dark lines are drawing, not depth). The colour is scaled in linear light, the alpha
kept.

Needs numpy, opencv-python, Pillow.
"""

import argparse

import cv2
import numpy as np
from PIL import Image

DEFAULTS = {"strength": 1.0, "floor": 0.84, "fine": 2.5, "coarse": 9.0, "skip": []}
# the coarse blur's log-luminance gradient (per px) where a patch's edge starts and where it is surely one
EDGE = (0.012, 0.04)


def to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def cavity(rgba, opts=None):
    """The multiplier per pixel (1 = untouched) for an RGBA uint8 array."""
    o = {**DEFAULTS, **(opts or {})}
    a = rgba[..., 3].astype(np.float32) / 255
    lin = to_linear(rgba[..., :3].astype(np.float32) / 255)
    lum = np.log(lin @ np.float32([0.2126, 0.7152, 0.0722]) + 0.01)

    def blur(x, s):
        return cv2.GaussianBlur(x * a, (0, 0), s) / np.maximum(cv2.GaussianBlur(a, (0, 0), s), 1e-4)

    coarse = blur(lum, o["coarse"])
    band = blur(lum, o["fine"]) - coarse
    gy, gx = np.gradient(coarse)
    inside_patch = 1 - smoothstep(*EDGE, np.hypot(gx, gy))
    mult = np.clip(1 - o["strength"] * np.maximum(-band, 0) * inside_patch, o["floor"], 1)
    if o["skip"]:
        keep = np.zeros(a.shape, np.float32)
        for x0, y0, x1, y1 in o["skip"]:
            keep[y0:y1, x0:x1] = 1
        keep = cv2.GaussianBlur(keep, (0, 0), 6)
        mult = mult + (1 - mult) * keep
    return np.where(a > 0, mult, 1).astype(np.float32)


def bake(image, opts=None):
    """The drawing (a PIL image) with its clefts deepened; the alpha untouched."""
    rgba = np.asarray(image.convert("RGBA"))
    mult = cavity(rgba, opts)
    lin = to_linear(rgba[..., :3].astype(np.float32) / 255) * mult[..., None]
    out = rgba.copy()
    out[..., :3] = np.round(to_srgb(lin) * 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("src")
    ap.add_argument("out")
    for k in ("strength", "floor", "fine", "coarse"):
        ap.add_argument(f"--{k}", type=float, default=DEFAULTS[k])
    ap.add_argument("--skip", nargs="*", default=[], help="x0,y0,x1,y1 boxes left untouched")
    ap.add_argument("--sheet", help="before | multiplier | after, side by side")
    ap.add_argument("--crop", help="x0,y0,x1,y1 of the sheet")
    args = ap.parse_args()
    opts = {k: getattr(args, k) for k in ("strength", "floor", "fine", "coarse")}
    opts["skip"] = [[int(v) for v in s.split(",")] for s in args.skip]
    src = Image.open(args.src).convert("RGBA")
    out = bake(src, opts)
    out.save(args.out)
    if args.sheet:
        mult = cavity(np.asarray(src), opts)
        box = [int(v) for v in args.crop.split(",")] if args.crop else [0, 0, src.width, src.height]
        flat = lambda im: Image.alpha_composite(Image.new("RGBA", im.size, (40, 40, 44, 255)), im).convert("RGB")  # noqa: E731
        lo = opts["floor"]
        m = Image.fromarray(np.uint8(np.clip((mult - lo) / (1 - lo), 0, 1) * 255)).convert("RGB")
        tiles = [flat(src).crop(box), m.crop(box), flat(out).crop(box)]
        w, h = tiles[0].size
        sheet = Image.new("RGB", (3 * w + 16, h), (20, 20, 20))
        for i, t in enumerate(tiles):
            sheet.paste(t, (i * (w + 8), 0))
        sheet.save(args.sheet, quality=90)


if __name__ == "__main__":
    main()
