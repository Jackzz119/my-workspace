"""How smooth is an animation, frame by frame: a reel rendered densely (reel.mjs at 120 fps) in, a curve out.

    python smooth.py <frames dir> --fps 120 [--box x,y,w,h] [--from ms] [--to ms] [--ref <dir>] [--out chart.png]

For every pair of neighbouring frames inside the box it measures how much the picture changed (mean absolute
difference of the light, 0-255) and how far things moved (median and 95th percentile of the optical flow, px).
A smooth motion changes a little every frame and its curve rises and falls gently; a pop is one frame that
changes far more than the frames around it (`--spike` times their median, and at least `--floor`, which by
default scales with the frame rate: the same jump spread over fewer frames changes each of them more).
At 30 fps a one-frame tick hides between the frames; render at 120.

Start and end: an act that comes back to where it began (a yawn, a blink, a pet) must end on exactly the
picture it started from. Its first and last frames differ anyway by everything else that kept moving (the
breath), so compare instead with `--ref`: the same script rendered without that act (same fps, same --from).
The breath and the light run on their own clocks there, so at the same moment the two reels may differ only
by the act itself: `end_vs_ref` is the last frame against its twin and should be 0 (max ≤ 1 for rounding).

Writes the chart (change and motion over time, pops circled) with --out and prints a JSON summary.
Needs numpy, opencv-python (DIS optical flow) and Pillow, like the pipeline.
"""

import argparse
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ap = argparse.ArgumentParser()
ap.add_argument("frames")
ap.add_argument("--fps", type=float, required=True)
ap.add_argument("--box", help="x,y,w,h in frame px (default: whole frame)")
ap.add_argument("--from", dest="start", type=float, default=0, help="ms of the reel's first frame to use")
ap.add_argument("--to", type=float, help="ms to stop at (default: the end)")
ap.add_argument("--offset", type=float, default=0, help="ms the reel itself started at (reel.mjs --from)")
ap.add_argument("--spike", type=float, default=3.0)
ap.add_argument("--floor", type=float, help="a pop changes the light at least this much (default 36 / fps)")
ap.add_argument("--ref", help="frames of the same script without the act (reel.mjs, same --fps and --from)")
ap.add_argument("--out")
args = ap.parse_args()
floor = args.floor if args.floor is not None else 36 / args.fps

files = sorted(Path(args.frames).glob("f*.png"))
step = 1000 / args.fps
times = [args.offset + i * step for i in range(len(files))]
picked = [(t, f) for t, f in zip(times, files) if t >= args.start - 1e-6 and (args.to is None or t <= args.to + 1e-6)]
if len(picked) < 3:
    raise SystemExit("fewer than three frames in that range")


def load(path):
    im = np.array(Image.open(path).convert("L"), dtype=np.float32)
    if args.box:
        x, y, w, h = (int(v) for v in args.box.split(","))
        im = im[y:y + h, x:x + w]
    return im


dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
prev = load(picked[0][1])
first = prev
rows = []
for t, f in picked[1:]:
    cur = load(f)
    change = float(np.abs(cur - prev).mean())
    flow = dis.calc(prev.astype(np.uint8), cur.astype(np.uint8), None)
    mag = np.hypot(flow[..., 0], flow[..., 1])
    rows.append({"ms": round(t, 1), "change": round(change, 3), "flow_med": round(float(np.median(mag)), 3),
                 "flow_p95": round(float(np.percentile(mag, 95)), 3)})
    prev = cur

change = np.array([r["change"] for r in rows])
# a pop: far above the frames around it (a fifth of a second each side)
half = max(2, int(round(args.fps * 0.2)))
pops = []
for i, c in enumerate(change):
    around = np.concatenate([change[max(0, i - half):i], change[i + 1:i + 1 + half]])
    base = float(np.median(around)) if around.size else 0.0
    if c >= floor and c > args.spike * max(base, 0.05):
        pops.append({"ms": rows[i]["ms"], "change": rows[i]["change"], "around": round(base, 3)})
ends = float(np.abs(load(picked[-1][1]) - first).mean())
ref_end = None
if args.ref:
    twin = Path(args.ref) / picked[-1][1].name
    if not twin.exists():
        raise SystemExit(f"{twin} is missing: render the reference with the same --fps and --from")
    diff = np.abs(load(picked[-1][1]) - load(twin))
    ref_end = {"mean": round(float(diff.mean()), 3), "max": round(float(diff.max()), 1), "over_8": int((diff > 8).sum())}
summary = {
    "frames": len(picked), "fps": args.fps, "range_ms": [round(picked[0][0], 1), round(picked[-1][0], 1)],
    "max_change": round(float(change.max()), 3), "median_change": round(float(np.median(change)), 3),
    "max_flow_p95": round(max(r["flow_p95"] for r in rows), 3), "floor": round(floor, 3), "pops": pops,
    "start_end_change": round(ends, 3), "end_vs_ref": ref_end,
}


def chart_font(size):
    """A font that has CJK where the system has one (the labels are Chinese), else Pillow's own."""
    for path in (r"C:\Windows\Fonts\msyh.ttc", "/System/Library/Fonts/PingFang.ttc",
                 "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"):
        if Path(path).exists():
            return ImageFont.truetype(path, size), True
    return ImageFont.load_default(), False


if args.out:
    W, H, pad = 1400, 420, 50
    img = Image.new("RGB", (W, H), (22, 22, 26))
    d = ImageDraw.Draw(img)
    font, cjk = chart_font(15)
    t0, t1 = rows[0]["ms"], rows[-1]["ms"]
    top = max(float(change.max()), floor * 2) * 1.1
    ftop = max(r["flow_p95"] for r in rows) * 1.1 or 1
    X = lambda t: pad + (t - t0) / max(t1 - t0, 1) * (W - 2 * pad)  # noqa: E731
    Y = lambda v, m: H - pad - v / m * (H - 2 * pad)  # noqa: E731
    for k in range(0, 6):
        v = top * k / 5
        d.line([(pad, Y(v, top)), (W - pad, Y(v, top))], fill=(45, 45, 52))
        d.text((6, Y(v, top) - 8), f"{v:.1f}", fill=(150, 150, 160), font=font)
    for ms in range(int(t0 // 500 + 1) * 500, int(t1) + 1, 500):
        d.line([(X(ms), pad), (X(ms), H - pad)], fill=(40, 40, 46))
        d.text((X(ms) - 18, H - pad + 6), f"{ms / 1000:.1f}s", fill=(150, 150, 160), font=font)
    d.line([(X(r["ms"]), Y(r["flow_p95"], ftop)) for r in rows], fill=(90, 160, 255), width=2)
    d.line([(X(r["ms"]), Y(r["change"], top)) for r in rows], fill=(255, 200, 90), width=2)
    for p in pops:
        d.ellipse([X(p["ms"]) - 6, Y(p["change"], top) - 6, X(p["ms"]) + 6, Y(p["change"], top) + 6],
                  outline=(255, 70, 70), width=3)
    ref = "" if ref_end is None else (f"  末帧与参照差 {ref_end['mean']:.2f}" if cjk else f"  end vs ref {ref_end['mean']:.2f}")
    title = (f"黄：相邻帧画面变化（0–{top:.1f}）  蓝：移动距离 p95（0–{ftop:.1f} px）  红圈：突跳 {len(pops)} 处" if cjk
             else f"yellow: change per frame (0-{top:.1f})  blue: flow p95 (0-{ftop:.1f} px)  red: {len(pops)} pops")
    d.text((pad, 10), title + ref, fill=(235, 225, 205), font=font)
    img.save(args.out)
print(json.dumps(summary, ensure_ascii=False))
