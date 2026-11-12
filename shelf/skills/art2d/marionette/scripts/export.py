"""Stage 6 — export: encode the final frames for the runtime and write its manifest.

Pose frames go out as WebP (lossy colour, lossless alpha), the data maps as PNG (they are numbers,
never re-encode them lossy). With "shade" in rig.json every pose frame is shaded on the way out (shade.py:
the clefts between fur clumps; the flows and weights were measured on the unshaded frames, which is fine:
shading moves nothing). Every URL in the manifest carries its file's content hash (`?v=`): a CDN or a browser
that keeps files for hours (Cloudflare's default is 4 h) then fetches exactly the pictures that changed, as long
as the runtime fetches the manifest itself without a cache (`fetch(url, { cache: "no-cache" })`). rig.json in the runtime folder lists exactly what shipped, so the
runtime never keeps its own list of which poses blink or which pairs morph.

Only files this stage produces are touched in the runtime folder: stale ones of the same kinds
(<pose>-open/closed.webp, idle-*.png, morph-*.png) are removed and reported.
"""

import hashlib
import json
import re
import shutil
from pathlib import Path

from PIL import Image

import shade

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
    # the shipped file's URL, versioned by its content
    def url(name):
        v = hashlib.sha1((out / name).read_bytes()).hexdigest()[:10]
        return f"{base}/{name}?v={v}" if base else f"{name}?v={v}"

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
                frame = Image.open(f)
                if cfg.get("shade"):
                    frame = shade.bake(frame, cfg["shade"])
                frame.save(out / name, "WEBP", quality=90, alpha_quality=100, method=6)
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
