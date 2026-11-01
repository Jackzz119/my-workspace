"""Turn a folder of captured frames into a contact sheet and a GIF, for looking at a transition.

    python sheet.py <frames dir> [--cols 7] [--width 320] [--gif] [--ms 110]
    python sheet.py <frames dir> --gif --fps 20          (a reel.mjs reel: real timing, loops)

Writes <dir>.jpg (the sheet, frames in order, left to right) and with --gif <dir>.gif (the burst at
roughly real speed, holding the last frame). Also prints a brightness trace of every frame: a
see-through moment during a pose change shows up as a dip there even when the eye misses it.

With --fps the frames are a reel rendered on a virtual clock (reel.mjs): every frame lasts exactly
1000 / fps ms, nothing is held, the GIF loops, all frames share one palette and a pixel that did not
change keeps its colour index, so the still parts neither shimmer nor cost bytes. A long reel's sheet
shows at most --sheet frames, evenly spread.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image


def shared_palette(ims, samples=12):
    """One adaptive palette for the whole reel, from frames spread over it. 255 colours: the GIF writer
    takes the last index as transparent and fills it into whatever a frame left unchanged, which is
    what keeps a long reel small (a breathing cat changes about a tenth of the picture per frame)."""
    pick = [ims[round(k * (len(ims) - 1) / max(1, samples - 1))] for k in range(min(samples, len(ims)))]
    w, h = pick[0].size
    strip = Image.new("RGB", (w, h * len(pick)))
    for k, im in enumerate(pick):
        strip.paste(im, (0, k * h))
    return strip.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)


def steady_frames(ims, pal):
    """Quantize every frame with dithering, but give each pixel whose colour did not change since the
    previous frame the colour index it had there. Dithering spreads each pixel's error to the right and
    down, so a cat breathing in one corner would otherwise re-dither, and shimmer, everything after it;
    kept indices also let the GIF writer store only the box that really changed."""
    out = []
    prev_rgb = prev_idx = None
    for im in ims:
        idx = np.asarray(im.quantize(palette=pal, dither=Image.Dither.FLOYDSTEINBERG)).copy()
        rgb = np.asarray(im)
        if prev_rgb is not None:
            still = (rgb == prev_rgb).all(axis=2)
            idx[still] = prev_idx[still]
        frame = Image.fromarray(idx, "P")
        frame.putpalette(pal.getpalette())
        out.append(frame)
        prev_rgb, prev_idx = rgb, idx
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("frames", type=Path)
    ap.add_argument("--cols", type=int, default=7)
    ap.add_argument("--width", type=int, default=320)
    ap.add_argument("--gif", action="store_true")
    ap.add_argument("--ms", type=int, default=110, help="GIF frame duration")
    ap.add_argument("--fps", type=float, default=None, help="a reel: exact timing, no holds, one palette, loops")
    ap.add_argument("--sheet", type=int, default=28, help="with --fps: at most this many frames on the sheet")
    args = ap.parse_args()
    files = sorted(args.frames.glob("*.png"))
    if not files:
        raise SystemExit(f"no PNG frames in {args.frames}")
    ims = [Image.open(f).convert("RGB") for f in files]
    w, h = ims[0].size
    shown = ims
    if args.fps and len(ims) > args.sheet:
        shown = [ims[round(k * (len(ims) - 1) / (args.sheet - 1))] for k in range(args.sheet)]
    tw, th = args.width, round(h * args.width / w)
    rows = (len(shown) + args.cols - 1) // args.cols
    sheet = Image.new("RGB", (tw * min(args.cols, len(shown)), th * rows), (20, 20, 28))
    for k, im in enumerate(shown):
        sheet.paste(im.resize((tw, th), Image.LANCZOS), ((k % args.cols) * tw, (k // args.cols) * th))
    out = args.frames.with_suffix(".jpg")
    sheet.save(out, quality=88)
    lum = [float(np.asarray(im.convert("L")).mean()) for im in ims]
    print(f"{out}  ({len(ims)} frames)")
    if not args.fps:
        print("brightness:", " ".join(f"{v:.1f}" for v in lum))
    dip = min(lum) - min(lum[0], lum[-1])
    if not args.fps and dip < -3:
        print(f"  a dip of {-dip:.1f} below both ends: something went see-through mid-change")
    if args.gif:
        g = args.frames.with_suffix(".gif")
        if args.fps:
            frames = steady_frames(ims, shared_palette(ims))
            ms = round(1000 / args.fps)
            frames[0].save(g, save_all=True, append_images=frames[1:], duration=ms, loop=0, optimize=True, disposal=1)
            print(f"{g}  ({len(frames)} frames at {ms} ms, {g.stat().st_size / 1e6:.1f} MB)")
        else:
            ims[0].save(g, save_all=True, append_images=ims[1:] + [ims[-1]] * 6, duration=[500] + [args.ms] * (len(ims) + 5), loop=0)
            print(g)


if __name__ == "__main__":
    main()
