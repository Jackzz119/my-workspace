"""Stage 6 — export: encode the final frames for the runtime and write its manifest.

Pose frames go out as WebP (lossy colour, lossless alpha), the data maps as PNG (they are numbers,
never re-encode them lossy). rig.json in the runtime folder lists exactly what shipped, so the
runtime never keeps its own list of which poses blink or which pairs morph.

Only files this stage produces are touched in the runtime folder: stale ones of the same kinds
(<pose>-open/closed.webp, idle-*.png, morph-*.png) are removed and reported.
"""

import json
import re
import shutil
from pathlib import Path

from PIL import Image

MANIFEST_VERSION = 2
OWNED = re.compile(r"^(.+-(open|closed)\.webp|idle-.+\.png|morph-.+\.png|rig\.json)$")


def run(ctx, args):
    cfg = ctx.cfg
    if not cfg["runtime"]:
        raise SystemExit("rig.json: 'runtime' (the shipped folder) is required for export")
    rec = ctx.record("assemble")
    if not rec or not ctx.final.exists():
        raise SystemExit("run the earlier stages first")
    out = Path(cfg["runtime"])
    out.mkdir(parents=True, exist_ok=True)
    base = cfg["url_base"].rstrip("/")
    url = lambda name: f"{base}/{name}" if base else name  # noqa: E731

    written = set()
    poses = {}
    for pose, p in cfg["poses"].items():
        src = ctx.final / f"{pose}-open.png"
        if not src.exists():
            continue
        entry = {"slow": p["slow"]}
        if p["hides"]:
            entry["hides"] = list(p["hides"])
        held = ((ctx.record("align") or {}).get("holds") or {}).get(pose)
        if held:
            entry["holds"] = {name: v["at"] for name, v in held.items()}
        for eye in ("open", "closed"):
            f = ctx.final / f"{pose}-{eye}.png"
            if f.exists():
                name = f"{pose}-{eye}.webp"
                Image.open(f).save(out / name, "WEBP", quality=90, alpha_quality=100, method=6)
                written.add(name)
                entry[eye] = url(name)
        idle = ctx.final / f"idle-{pose}.png"
        if idle.exists():
            shutil.copy2(idle, out / idle.name)
            written.add(idle.name)
            entry["idle"] = url(idle.name)
        poses[pose] = entry

    morphs = {}
    for f in sorted(ctx.final.glob("morph-*.png")):
        shutil.copy2(f, out / f.name)
        written.add(f.name)
        morphs[f.stem[len("morph-") :]] = url(f.name)

    # guided pairs only roughly agree on their shapes: the runtime swaps them in the narrow window
    rec_morph = ctx.record("morph") or {}
    guided = sorted(k2 for k, v in rec_morph.items() if v.get("kind") == "guided" for k2 in (k, "-".join(reversed(k.split("-")))))

    manifest = {
        "version": MANIFEST_VERSION,
        "canvas": rec["canvas"],
        "grid": ctx.grid,
        "flowFormat": "rgb12",  # dx, dy as 12 bits each at 1/8 px, see scripts/common.py pack_flow
        "anchor": cfg["anchor"],
        "poses": poses,
        "morphs": morphs,
        "guided": [k for k in guided if k in morphs],
        "sequences": {
            name: {k: v for k, v in (("frames", sq["frames"]), ("stepMs", sq.get("step_ms", 380)), ("holdMs", sq.get("hold_ms")), ("back", sq.get("back")), ("swap", sq.get("swap"))) if v is not None}
            for name, sq in cfg["sequences"].items()
        },
    }
    if "registration" in rec:
        reg = rec["registration"]
        manifest["placement"] = {"origin": reg["origin"], "scale": reg["scale"]}
    (out / "rig.json").write_bytes((json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    written.add("rig.json")

    stale = [f.name for f in out.iterdir() if f.is_file() and OWNED.match(f.name) and f.name not in written]
    for name in stale:
        (out / name).unlink()
    blinking = [p for p, e in poses.items() if "closed" in e]
    print(f"  {out}: {len(poses)} poses ({len(blinking)} blink), {len(morphs)} morph fields, manifest rig.json")
    if stale:
        print(f"  removed stale: {', '.join(sorted(stale))}")
    return "pass"
