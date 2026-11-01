"""Shared helpers for the marionette pipeline: config, image IO, optical flow, measurements.

Every coordinate in rig.json is in SOURCE canvas px (the size the generator produced). Stages that
work on the assembled (trimmed) canvas convert with `Ctx.to_build`.
"""

import copy
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

DEFAULTS = {
    "anchor": None,  # pose every other pose is measured against (required)
    "poses": {},  # id -> {"blink", "morph", "slow", "probe", "chain", "hides", "holds", "align_to", "free", "fit_cut", ...}
    "sequences": {},  # name -> {"frames": [...], "step_ms", "hold_ms", "back"}: keyframe chains
    "source": None,  # folder of raw generated PNGs (required)
    "source_pattern": "{pose}-{eye}.png",  # eye is "open" / "closed"
    "source_single": "{pose}.png",  # fallback for poses without a blink frame
    "build": None,  # intermediate folder, never shipped (required)
    "runtime": None,  # shipped folder (required for export)
    "url_base": "",  # prefix the runtime fetches files under
    "grid": 24,  # canvas px between mesh vertices
    "canvas": {
        "size": None,  # [w, h] every source file must have; None = take the anchor's
        "crop": None,  # [x0, y0, x1, y1] the shared canvas, fixed once a runtime depends on its coordinates
        "probes_x": [],  # x columns where the shoulder line is measured against the anchor
        "cut_y": None,  # expected torso cut line (seated characters); None = not measured
        "cut_probe_x": [],  # x columns where the cut line is measured; poses.<id>.cut_probe_x overrides
        "cut_window": 80,  # the cut edge is looked for within cut_y +/- this
        "cut_plate_y": None,  # the table's far edge measured on the plate; assemble checks cut_y against it
    },
    "face": {"mode": "skin", "boxes": {}},  # boxes: pose -> [x0, y0, x1, y1] overrides detection
    "eyes": {"boxes": {}},  # pose -> [x0, y0, x1, y1]; default derived from the face box
    "hair": {"mode": "dark", "lum_max": 0.3, "lum_min": 0.7, "rgb": None, "tol": 0.12, "masks": {}, "by_pose": {}},
    "hold": {"skin_below_chin": True, "bright_low_sat": True, "masks": {}},
    "breath": {"anchor_y": None, "masks": {}},  # anchor_y: weight 0 at/below this line (default cut_y + 60)
    "plate": None,  # optional {"path": scene frame PNG} to register the anchor pose onto
    "placement": None,  # {"offset": [x, y], "scale": s}: a known seat (source canvas px -> scene px) instead of registering
    "parts": {},  # name -> RGBA image in the scene frame: a scene part a pose can pick up (poses.<id>.holds)
    "thresholds": {
        "probe_warn_px": 3,
        "probe_fail_px": 8,
        "cut_fail_px": 8,
        "blink_reject": 0.15,  # raw closed frame: share of pixels outside the eyes that changed at all
        "blink_solid_max": 0.01,  # ...in blobs 5px or thicker: redrawn or missing, the align stage cannot move it back
        "blink_after_max": 0.02,  # after alignment; twice this when none of it is solid (scattered speckle only)
        "blink_solid_after_max": 0.001,  # solid share after alignment that still counts as "none"
        "morph_err": 0.12,  # mean abs colour error after warping (0..1)
        "morph_sil": 0.05,  # share of the target silhouette the warp misses
        "alpha_empty": 8,  # alpha below this is empty when trimming
        "fit_cut_max_px": 16,  # poses with "fit_cut": a torso cut this close is fitted by the align stage
        "rigid_min_matches": 6,  # a rigid part the flow missed needs this many matches that agree
        "rigid_missed_px": 20,  # ...each this far from where the flow put it
        "hold_search_px": 200,  # a held part is looked for this far from its own place
        "hold_match_min": 0.5,  # edge correlation of the drawn part with the scene's: below it, a different object
        "hold_rms_max": 0.14,  # colour RMS (0..1) between them there: above it, the swap shows
        "hold_rest_px": 10,  # a pose that holds a part without hiding it may move it this far off its place
    },
}


def merge(base, over):
    out = copy.deepcopy(base)
    for k, v in (over or {}).items():
        out[k] = merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


class Ctx:
    """Loaded rig.json plus the stage outputs written so far."""

    def __init__(self, path):
        self.path = Path(path)
        cfg = merge(DEFAULTS, json.loads(self.path.read_text(encoding="utf-8")))
        for key in ("anchor", "source", "build"):
            if not cfg[key]:
                raise SystemExit(f"rig.json: '{key}' is required")
        if cfg["anchor"] not in cfg["poses"]:
            raise SystemExit("rig.json: 'anchor' must be one of 'poses'")
        for pid, p in cfg["poses"].items():
            cfg["poses"][pid] = merge({"blink": False, "morph": True, "slow": False, "probe": True, "chain": False, "hides": [], "holds": []}, p)
            unknown = [n for n in cfg["poses"][pid]["holds"] if n not in cfg["parts"]]
            if unknown:
                raise SystemExit(f"rig.json: poses.{pid}.holds {unknown} are not in 'parts'")
        for name, sq in cfg["sequences"].items():
            missing = [f for f in sq.get("frames", []) if f not in cfg["poses"]]
            if len(sq.get("frames", [])) < 2 or missing:
                raise SystemExit(f"rig.json: sequence '{name}' needs two or more frames that are poses (unknown: {missing})")
        self.cfg = cfg
        self.source = Path(cfg["source"])
        self.build = Path(cfg["build"])
        self.raw = self.build / "raw"  # assembled, trimmed, untouched pixels
        self.final = self.build / "final"  # aligned frames and data maps, what export ships
        self.review = self.build / "review"  # evidence images, look at them before moving on
        self.grid = int(cfg["grid"])
        self.th = cfg["thresholds"]

    # ---- stage records -------------------------------------------------------------------------
    def record(self, stage):
        p = self.build / f"{stage}.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    def write_record(self, stage, data):
        self.build.mkdir(parents=True, exist_ok=True)
        # bytes, not write_text: Windows would turn \n into \r\n
        (self.build / f"{stage}.json").write_bytes((json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))

    # ---- files ---------------------------------------------------------------------------------
    def source_file(self, pose, eye):
        p = self.source / self.cfg["source_pattern"].format(pose=pose, eye=eye)
        if p.exists():
            return p
        if eye == "open":
            single = self.source / self.cfg["source_single"].format(pose=pose)
            if single.exists():
                return single
        return None

    def crop(self):
        rec = self.record("assemble")
        if not rec:
            raise SystemExit("run the assemble stage first")
        return rec["crop"]

    def probe_columns(self, pose):
        """Columns where this pose's shoulder line is measured: its own list wins over the canvas default
        (an arm reaching for something lifts that shoulder on purpose, so only the other one is measured)."""
        own = self.cfg["poses"][pose].get("probes_x")
        return self.cfg["canvas"]["probes_x"] if own is None else own

    def cut_columns(self, pose):
        """Columns where this pose's torso cut is measured (its own list wins over the canvas default)."""
        own = self.cfg["poses"][pose].get("cut_probe_x")
        return self.cfg["canvas"]["cut_probe_x"] if own is None else own

    def to_build(self, box):
        """Source-canvas box/point -> assembled-canvas coordinates."""
        x0, y0 = self.crop()
        if len(box) == 2:
            return [box[0] - x0, box[1] - y0]
        return [box[0] - x0, box[1] - y0, box[2] - x0, box[3] - y0]


# ---- image IO --------------------------------------------------------------------------------
def load_rgba(path):
    return np.asarray(Image.open(path).convert("RGBA")).astype(np.float32)


def save_rgba(arr, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGBA").save(path, optimize=True)


def save_rgb(arr, path, quality=None):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    img.save(path, quality=quality) if quality else img.save(path, optimize=True)


def on_backdrop(rgba, colour=(40, 44, 70)):
    """Composite over a flat colour for review images."""
    a = rgba[..., 3:4] / 255
    return rgba[..., :3] * a + np.array(colour, np.float32) * (1 - a)


def checker(h, w, size=16):
    yy, xx = np.mgrid[0:h, 0:w]
    c = (((yy // size) + (xx // size)) % 2).astype(np.float32)
    v = 150 + 60 * c
    return np.stack([v, v, v], axis=-1)


def on_checker(rgba):
    a = rgba[..., 3:4] / 255
    return rgba[..., :3] * a + checker(*rgba.shape[:2]) * (1 - a)


def alpha_box(rgba, empty=8, pad=2):
    ys, xs = np.nonzero(rgba[..., 3] >= empty)
    if not len(xs):
        return None
    h, w = rgba.shape[:2]
    return [int(max(0, xs.min() - pad)), int(max(0, ys.min() - pad)), int(min(w, xs.max() + 1 + pad)), int(min(h, ys.max() + 1 + pad))]


def tile(images, cols, pad=6, bg=(20, 20, 28)):
    """RGB float arrays of any size -> one contact sheet."""
    cw = max(i.shape[1] for i in images)
    ch = max(i.shape[0] for i in images)
    rows = (len(images) + cols - 1) // cols
    sheet = np.zeros((rows * (ch + pad) + pad, cols * (cw + pad) + pad, 3), np.float32) + np.array(bg, np.float32)
    for k, im in enumerate(images):
        y, x = pad + (k // cols) * (ch + pad), pad + (k % cols) * (cw + pad)
        sheet[y : y + im.shape[0], x : x + im.shape[1]] = im
    return sheet


def shrink(rgb, width):
    h, w = rgb.shape[:2]
    return cv2.resize(rgb, (width, round(h * width / w)), interpolation=cv2.INTER_AREA)


# ---- flow ------------------------------------------------------------------------------------
def grey(rgba):
    """Luminance over a neutral backdrop, so the silhouette counts as much as the drawing."""
    a = rgba[..., 3:4] / 255
    rgb = rgba[..., :3] * a + 128 * (1 - a)
    return cv2.cvtColor(rgb.astype(np.uint8), cv2.COLOR_RGB2GRAY)


def flow(a, b):
    """Dense flow a -> b: a's pixel p is found at p + flow(p) in b."""
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    return dis.calc(grey(a), grey(b), None)


def remap(img, f):
    """img sampled at p + f(p): moves img's content onto the geometry f was measured from."""
    h, w = f.shape[:2]
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(img, gx + f[..., 0], gy + f[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)


def grid_axes(h, w, grid):
    """Vertex positions of the runtime mesh: evenly spaced across the canvas, w // grid + 1 columns."""
    xs = np.linspace(0, w - 1, w // grid + 1).round().astype(int)
    ys = np.linspace(0, h - 1, h // grid + 1).round().astype(int)
    return xs, ys


def grid_sample(field, h, w, grid):
    xs, ys = grid_axes(h, w, grid)
    return field[np.ix_(ys, xs)]


# ---- measurements ----------------------------------------------------------------------------
def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def as_boxes(box_or_boxes):
    """One [x0, y0, x1, y1] box or a list of them -> a list of boxes."""
    if len(box_or_boxes) == 4 and all(isinstance(v, (int, float, np.integer, np.floating)) for v in box_or_boxes):
        return [list(box_or_boxes)]
    return [list(b) for b in box_or_boxes]


def outside_change(a, b, box):
    """Share of solid pixels outside `box` (one box or a list) whose premultiplied colour differs by more than 24/255."""
    pa = a[..., :3] * (a[..., 3:4] / 255)
    pb = b[..., :3] * (b[..., 3:4] / 255)
    d = np.abs(pa - pb).max(axis=2)
    mask = np.maximum(a[..., 3], b[..., 3]) > 128
    for x0, y0, x1, y1 in ([int(v) for v in bx] for bx in as_boxes(box)):
        mask[max(0, y0) : max(0, y1), max(0, x0) : max(0, x1)] = False
    return float((d[mask] > 24).mean()) if mask.any() else 0.0


def solid_change(a, b, box, width=5):
    """Like outside_change, counting only changes at least `width` px thick: a redrawn or missing piece
    (the T-shirt under a book gone) counts, the 1-2 px lines a generator's drift leaves along every edge
    do not (the align stage moves those back)."""
    pa = a[..., :3] * (a[..., 3:4] / 255)
    pb = b[..., :3] * (b[..., 3:4] / 255)
    mask = np.maximum(a[..., 3], b[..., 3]) > 128
    for x0, y0, x1, y1 in ([int(v) for v in bx] for bx in as_boxes(box)):
        mask[max(0, y0) : max(0, y1), max(0, x0) : max(0, x1)] = False
    changed = ((np.abs(pa - pb).max(axis=2) > 24) & mask).astype(np.uint8)
    thick = cv2.morphologyEx(changed, cv2.MORPH_OPEN, np.ones((width, width), np.uint8)) > 0
    return float(thick[mask].mean()) if mask.any() else 0.0


def skin_mask(rgba):
    rgb = rgba[..., :3] / 255
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    mx, mn = rgb.max(axis=2), rgb.min(axis=2)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
    return (rgba[..., 3] > 128) & (r > g) & (g > b) & (r > 0.55) & (lum > 0.42) & (sat > 0.12) & (sat < 0.55)


def face_box(ctx, pose, rgba, build=True):
    """[x, y, w, h] of the face. Config box wins; else the largest warm-skin blob in the upper 70%.

    The skin heuristic suits human characters painted with warm skin. For anything else (animals,
    robots, very pale or stylised skin) put the box in rig.json; the review overlays show what was used.
    """
    boxes = ctx.cfg["face"]["boxes"]
    if pose in boxes:
        x0, y0, x1, y1 = ctx.to_build(boxes[pose]) if build else boxes[pose]
        return [x0, y0, x1 - x0, y1 - y0]
    if ctx.cfg["face"]["mode"] != "skin":
        raise SystemExit(f"face box for '{pose}' missing in rig.json (face.mode is not 'skin')")
    upper = skin_mask(rgba)
    upper[int(rgba.shape[0] * 0.7) :] = False
    n, _, stats, _ = cv2.connectedComponentsWithStats(upper.astype(np.uint8), 8)
    if n < 2:
        raise SystemExit(f"no face found in '{pose}': add face.boxes.{pose} to rig.json")
    k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return [int(v) for v in stats[k, :4]]


def eye_box(ctx, pose, rgba, build=True):
    """[x0, y0, x1, y1] of the band where a blink really changes the picture (assembled canvas when
    `build`, else source canvas)."""
    boxes = ctx.cfg["eyes"]["boxes"]
    if pose in boxes:
        return ctx.to_build(boxes[pose]) if build else list(boxes[pose])
    fx, fy, fw, fh = face_box(ctx, pose, rgba, build)
    return [fx - 10, fy + int(fh * 0.12), fx + fw + 10, fy + int(fh * 0.55)]


def first_solid_y(rgba, x):
    idx = np.nonzero(rgba[:, int(x), 3] >= 128)[0]
    return int(idx[0]) if len(idx) else None


def cut_probe(rgba, x, cut_y, window=80):
    """y where column x goes from solid to empty within cut_y +/- window, i.e. the torso cut line.
    None when the column has no clean edge there. Measure only where the torso itself shows: a prop or
    a hand in the column ends somewhere below the cut and reads as a torso running under the table, so
    poses that cover the middle with a book set their own (empty) poses.<id>.cut_probe_x."""
    col = rgba[:, int(x), 3] >= 128
    for y in range(max(0, int(cut_y) - window), min(len(col) - 1, int(cut_y) + window)):
        if col[y] and not col[y + 1]:
            return y + 1
    return None


def label(rgb, text, scale=0.6):
    """Burn a caption into the top-left corner of a review image (RGB float, modified copy)."""
    img = np.ascontiguousarray(np.clip(rgb, 0, 255).astype(np.uint8))
    cv2.rectangle(img, (0, 0), (min(img.shape[1], 12 + int(len(text) * 11 * scale / 0.6)), int(30 * scale / 0.6)), (20, 20, 28), -1)
    cv2.putText(img, text, (6, int(21 * scale / 0.6)), cv2.FONT_HERSHEY_SIMPLEX, scale, (235, 235, 235), 1, cv2.LINE_AA)
    return img.astype(np.float32)


def caption(rgb, text, scale=0.7):
    """A title strip above a review image."""
    strip = np.zeros((int(34 * scale / 0.6), rgb.shape[1], 3), np.float32) + 20
    return np.vstack([label(strip, text, scale), rgb])


def ease_in_out(t):
    """Cubic ease, the same curve the runtime uses for a morph."""
    return 4 * t**3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


# ---- flow field packing (runtime format v2) --------------------------------------------------
# dx, dy each as 12 bits: value = round(d * 8) + 2048, i.e. +/-256 px at 1/8 px. Packed into RGB
# (alpha stays 255 so no browser premultiplication touches it):
#   R = dx >> 4,  G = (dx & 15) << 4 | dy >> 8,  B = dy & 255
FLOW_SCALE = 8
FLOW_BIAS = 2048


def pack_flow(g):
    dx = np.clip(np.round(g[..., 0] * FLOW_SCALE) + FLOW_BIAS, 0, 4095).astype(np.int32)
    dy = np.clip(np.round(g[..., 1] * FLOW_SCALE) + FLOW_BIAS, 0, 4095).astype(np.int32)
    out = np.zeros(g.shape[:2] + (3,), np.uint8)
    out[..., 0] = dx >> 4
    out[..., 1] = ((dx & 15) << 4) | (dy >> 8)
    out[..., 2] = dy & 255
    return out


def unpack_flow(png):
    p = png.astype(np.int32)
    dx = (p[..., 0] << 4) | (p[..., 1] >> 4)
    dy = ((p[..., 1] & 15) << 8) | p[..., 2]
    return np.stack([(dx - FLOW_BIAS) / FLOW_SCALE, (dy - FLOW_BIAS) / FLOW_SCALE], axis=-1).astype(np.float32)
