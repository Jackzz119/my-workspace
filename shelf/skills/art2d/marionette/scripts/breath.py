"""Breath masks for an animal lying down (a cat in a loaf, a dog on its side), for the weights stage
(rig.json breath.masks).

The default breath weight is made for a seated person: 0 at the torso cut, 1 from the shoulders up, so a
lying animal would rise as one block, no different from scaling the whole picture. A resting animal
breathes with its flank and back: nothing moves where it touches the ground, the back rises most, the
head rides along only a little, and a tail lying on the ground stays put (references/creatures.md).

    python breath.py <spec.json>

spec.json (source canvas px):
    { "rig": "<rig.json>",
      "poses": { "<pose>": { "contact_y": 876, "top_y": 330, "head": [x0, y0, x1, y1],
                             "still": [[[x, y], ...], ...] } },
      "head_weight": 0.45 }
Writes <rig source>/masks/breath-<pose>.png (grey = weight) and prints the breath.masks block to paste
into rig.json. `still` polygons (the tail on the table, a paw in front) get weight 0.
"""

import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def main():
    spec = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    rig = json.loads(Path(spec["rig"]).read_text(encoding="utf-8"))
    w, h = rig["canvas"]["crop"][2], rig["canvas"]["crop"][3]
    out = Path(rig["source"]) / "masks"
    out.mkdir(parents=True, exist_ok=True)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    block = {}
    for pose, p in spec["poses"].items():
        # 0 where it lies on the table, 1 along the top of the back
        weight = smoothstep(p["contact_y"] - 10, p["top_y"], yy)
        x0, y0, x1, y1 = p["head"]
        head = np.zeros((h, w), np.float32)
        head[y0:y1, x0:x1] = 1
        head = cv2.GaussianBlur(head, (0, 0), max(4, (x1 - x0) / 8))
        weight = weight * (1 - head * (1 - spec.get("head_weight", 0.45)))
        still = np.zeros((h, w), np.uint8)
        for poly in p.get("still", []):
            cv2.fillPoly(still, [np.array(poly, np.int32)], 1)
        weight = weight * (1 - cv2.GaussianBlur(still.astype(np.float32), (0, 0), 10))
        path = out / f"breath-{pose}.png"
        Image.fromarray(np.round(np.clip(weight, 0, 1) * 255).astype(np.uint8), "L").save(path)
        block[pose] = str(path).replace("\\", "/")
        print(f"  {pose}: {path}")
    print(json.dumps({"breath": {"masks": block}}, indent=4))


if __name__ == "__main__":
    main()
