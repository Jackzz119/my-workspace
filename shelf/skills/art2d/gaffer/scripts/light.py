"""Gaffer: measure a painted scene's light and carry it onto pieces painted for it.

A painted scene ships as a set of plates, one per lighting state (hour x weather x lamp), all of the same
place from the same camera. Their ratio, pixel by pixel, is the light changing: the paint (albedo) cancels.
This script reads that ratio from the plates and uses it to:

  cut       take a piece out of an image painted for the scene, by its difference from the image it was
            painted over (a window seat, a chair, a cat), with clean edges and its shadow kept; in front of
            glass the edge is read off the picture or traced, and the window light painted on its rim held back
            (references/edges.md)
  finer     a corner the camera closes in on, drawn again at a whole multiple of the plate's resolution,
            relit like any piece with the light ratio enlarged to its size
  relight   carry each cut piece from the reference state it was painted in to every other state
  tint      measure the light at an actor's spot as one RGB multiplier per state (for things that move)
  check     relight a piece that already exists in every plate and compare with how it was really painted
  preview   lay the pieces over each plate, side by side, for review

Everything is driven by one JSON config in the project (see references/method.md, "Config"):

    python light.py all --config <scene.json> [--review <dir>]
    python light.py check --config <scene.json> --piece <id>
    python light.py tint --config <scene.json>

Dependencies: numpy, Pillow.
"""

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

# ---------------------------------------------------------------------------------------------- colour


def to_linear(srgb):
    """sRGB 0-255 to linear light 0-1."""
    x = np.clip(srgb / 255.0, 0, 1)
    return np.where(x <= 0.04045, x / 12.92, ((x + 0.055) / 1.055) ** 2.4)


def to_srgb(linear):
    """Linear light 0-1 to sRGB 0-255 (float)."""
    x = np.clip(linear, 0, 1)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055) * 255.0


def luminance(linear):
    return linear[..., 0] * 0.2126 + linear[..., 1] * 0.7152 + linear[..., 2] * 0.0722


# ---------------------------------------------------------------------------------------------- filters


def _box(a, r, axis):
    """Box mean of radius r along one axis, edges clamped."""
    if r < 1:
        return a
    pad = [(0, 0)] * a.ndim
    pad[axis] = (r + 1, r)
    p = np.pad(a, pad, mode='edge')
    c = np.cumsum(p, axis=axis, dtype=np.float64)
    n = a.shape[axis]
    hi = np.take(c, np.arange(2 * r + 1, 2 * r + 1 + n), axis=axis)
    lo = np.take(c, np.arange(0, n), axis=axis)
    return ((hi - lo) / (2 * r + 1)).astype(np.float32)


def blur(a, sigma):
    """Gaussian blur, approximated by three box passes per axis (works on HxW or HxWxC floats)."""
    if sigma <= 0:
        return a.astype(np.float32)
    # three boxes of this radius have about the variance of the Gaussian
    r = max(1, int(round(math.sqrt(12 * sigma * sigma / 3 + 1) / 2 - 0.5)))
    out = a.astype(np.float32)
    for axis in (0, 1):
        for _ in range(3):
            out = _box(out, r, axis)
    return out


def smoothstep(lo, hi, x):
    t = np.clip((x - lo) / max(hi - lo, 1e-6), 0, 1)
    return t * t * (3 - 2 * t)


def polygon_mask(size, polygons, feather=0.0):
    """1 inside any of the polygons ([[x, y], ...]) or rects ([x, y, w, h]), softened by `feather` px."""
    m = Image.new('L', size, 0)
    d = ImageDraw.Draw(m)
    for shape in polygons or []:
        if len(shape) == 4 and not isinstance(shape[0], (list, tuple)):
            x, y, w, h = shape
            d.rectangle((x, y, x + w - 1, y + h - 1), fill=255)
        else:
            d.polygon([tuple(p) for p in shape], fill=255)
    if feather > 0:
        m = m.filter(ImageFilter.GaussianBlur(feather))
    return np.asarray(m, dtype=np.float32) / 255.0


def morph(alpha, close_px=0, open_px=0, grow_px=0):
    """Close small holes, then open away small specks, then grow by `grow_px`, on a 0-1 alpha."""
    img = Image.fromarray((np.clip(alpha, 0, 1) * 255).astype(np.uint8), 'L')
    k = lambda r: 2 * r + 1
    if close_px:
        img = img.filter(ImageFilter.MaxFilter(k(close_px))).filter(ImageFilter.MinFilter(k(close_px)))
    if open_px:
        img = img.filter(ImageFilter.MinFilter(k(open_px))).filter(ImageFilter.MaxFilter(k(open_px)))
    if grow_px:
        img = img.filter(ImageFilter.MaxFilter(k(grow_px)))
    return np.asarray(img, dtype=np.float32) / 255.0


def erode(alpha, px):
    """Shrink a 0-1 alpha by `px`."""
    if px < 1:
        return alpha
    img = Image.fromarray((np.clip(alpha, 0, 1) * 255).astype(np.uint8), 'L')
    return np.asarray(img.filter(ImageFilter.MinFilter(2 * int(px) + 1)), dtype=np.float32) / 255.0


def local_mean(img, weight, sigma):
    """`img` (HxWx3) averaged near every pixel over where `weight` is, and how much weight was near."""
    den = blur(weight, sigma)
    return blur(img * weight[..., None], sigma) / np.maximum(den, 1e-6)[..., None], den


# ---------------------------------------------------------------------------------------------- scene


class Scene:
    """The config, its plates and the light ratio of every state against the reference."""

    def __init__(self, config_path):
        self.path = Path(config_path).resolve()
        self.cfg = json.loads(self.path.read_text(encoding='utf-8'))
        self.root = (self.path.parent / self.cfg.get('root', '.')).resolve()
        self.states = self.cfg['states']
        self.ref = self.cfg['reference']
        if self.ref not in self.states:
            raise SystemExit(f'reference state {self.ref!r} is not among the states')
        self._img = {}
        self._ratio = {}
        first = self.image(self.states[self.ref]['plate'])
        self.h, self.w = first.shape[:2]
        light = self.cfg.get('light', {})
        self.sigma = float(light.get('sigma', 24))
        self.wide = float(light.get('wide', self.sigma * 5))
        self.clamp = light.get('clamp', [0.02, 4.0])
        # receivers: surfaces whose change between plates is light, not paint (not glass, not glowing things)
        self.receive = 1.0 - polygon_mask((self.w, self.h), light.get('exclude', []))
        if light.get('mask'):
            self.receive *= self.gray(light['mask'])

    def file(self, rel):
        return (self.root / rel).resolve()

    def image(self, rel):
        """An RGB image as float 0-255, cached."""
        if rel not in self._img:
            im = Image.open(self.file(rel)).convert('RGB')
            self._img[rel] = np.asarray(im, dtype=np.float32)
        return self._img[rel]

    def gray(self, rel):
        return np.asarray(Image.open(self.file(rel)).convert('L'), dtype=np.float32) / 255.0

    def plate(self, state, behind=False):
        s = self.states[state]
        return self.image(s['behind'] if behind and s.get('behind') else s['plate'])

    def ratio(self, state):
        """Linear light of `state` over the reference, per pixel and channel, smooth (normalised convolution in
        log space over the receivers; where none are near, a wider estimate fills in)."""
        if state in self._ratio:
            return self._ratio[state]
        if state == self.ref:
            r = np.ones((self.h, self.w, 3), np.float32)
        else:
            ref = to_linear(self.plate(self.ref))
            cur = to_linear(self.plate(state))
            eps = 2e-3
            logr = np.log((cur + eps) / (ref + eps))
            # very dark reference pixels say little about the light
            weight = self.receive * np.clip(luminance(ref) / 0.02, 0, 1)
            near_den = blur(weight, self.sigma)
            near = blur(logr * weight[..., None], self.sigma) / np.maximum(near_den, 1e-6)[..., None]
            wide_den = blur(weight, self.wide)
            wide = blur(logr * weight[..., None], self.wide) / np.maximum(wide_den, 1e-6)[..., None]
            confidence = np.clip(near_den / 0.3, 0, 1)[..., None]
            r = np.exp(confidence * near + (1 - confidence) * wide)
            r = np.clip(r, self.clamp[0], self.clamp[1]).astype(np.float32)
        self._ratio[state] = r
        return r


# ---------------------------------------------------------------------------------------------- cutting


class GlassEdge:
    """A piece's edge in front of glass, read off the picture alone (`glass` in the config).

    The image tool redraws what is outside a window on every pass, so beside the piece the glass differs from the
    base as much as the piece does, and a difference matte keeps a band of window with it: a blue rim at night, a
    line that does not change when the hour does. In front of the glass only the solid shapes are trusted as piece
    (drawn a couple of px inside its outline, they must cover all of it there). Near every edge pixel, the piece's
    own colour is averaged from that core and the window's from glass well clear of it, both in the same picture. A
    pixel's alpha is how far its colour lies from the window's toward the piece's; its colour is the piece's with
    that window taken out (blur-fusion foreground estimation, Forte 2021, with the local window as the known
    background). Where piece and window are about the same colour the reading says little, and the difference
    matte stands. Behind a soft edge against a busy window (fur against city lights) even that reading fails;
    `glass_edge: "trace"` then takes the solid shapes as the outline itself, traced by hand on the edge: inside it
    is piece, outside it is glass, softened by `glass_soft` px. The tool also paints the window's light onto the piece's rim (a
    blue rim light at night that every other hour would wear too): between the core and the outline, blue is held
    to the core's own share of it next to red and green (never more than neutral), and brightness to a little over
    the core's (despill with an adaptive limit).
    """

    def __init__(self, size, piece, src, alpha, solid):
        reach = piece.get('glass_reach', 4)
        self.behind = polygon_mask(size, piece['glass'])
        self.reach = reach
        if piece.get('glass_edge') == 'trace':
            outline = blur(polygon_mask(size, piece.get('solid')), piece.get('glass_soft', 0.8))
            self.core = erode(outline, reach)
            self.band = outline
            self.clear = self.behind * (1 - morph(outline, grow_px=reach + 2))
            self.alpha = alpha * (1 - self.behind) + outline * self.behind
            return
        # sure piece: the solid shapes in front of the glass, the difference matte's opaque part elsewhere
        sure = erode((alpha > 0.9).astype(np.float32), reach)
        self.core = np.maximum(solid, sure * (1 - self.behind))
        # the true edge lies within `reach` of the core, soft fur as far again
        self.band = morph(self.core, grow_px=2 * reach)
        self.clear = self.behind * (1 - morph(self.core, grow_px=2 * reach + 2))
        self.alpha = self._alpha(src, alpha)

    def _means(self, src):
        f, fden = local_mean(src, erode(self.core, 1), 3)
        b, bden = local_mean(src, self.clear, max(self.reach, 4))
        return f, b, (fden > 1e-3) & (bden > 1e-3)

    def _alpha(self, src, alpha):
        f, b, seen = self._means(src)
        d = f - b
        dd = (d * d).sum(-1)
        along = np.clip(((src - b) * d).sum(-1) / np.maximum(dd, 1.0), 0, 1)
        confident = np.clip(np.sqrt(dd) / 40, 0, 1) * seen
        edge = confident * along + (1 - confident) * alpha
        inside = np.maximum(self.core, edge * self.band)
        return alpha * (1 - self.behind) + inside * self.behind

    def colour(self, src, colour):
        """`colour` with the glass part re-estimated from `src` (any state's picture, the same alpha)."""
        f, b, _ = self._means(src)
        a = self.alpha[..., None]
        fused = np.clip(f + a * (src - a * f - (1 - a) * b), 0, 255)
        # the rim: blue no bluer than the core's, next to red and green
        top = np.maximum(f[..., 0], f[..., 1])
        share = np.minimum(f[..., 2] / np.maximum(top, 1.0), 1.0) * 1.05
        rim = fused.copy()
        rim[..., 2] = np.minimum(fused[..., 2], share * np.maximum(fused[..., 0], fused[..., 1]) + 2)
        # and no brighter than a little over the core
        lf = luminance(to_linear(f))[..., None]
        lr = luminance(to_linear(rim))[..., None]
        rim = to_srgb(to_linear(rim) * np.minimum(1.0, lf * 1.15 / np.maximum(lr, 1e-4)))
        glass = (self.behind * (1 - self.core))[..., None]
        return colour * (1 - glass) + rim * glass


def cut_piece(scene, piece):
    """The piece's alpha over the whole canvas and its colour with the background taken out of the edges."""
    size = (scene.w, scene.h)
    region = polygon_mask(size, piece.get('region'), piece.get('feather', 1.5))
    mode = piece.get('alpha', 'diff')
    glass = None
    if mode == 'cut':
        # a piece every plate already has (the chair as painted): plate against the same plate without it
        src = scene.plate(scene.ref)
        base = scene.plate(scene.ref, behind=True)
    else:
        src = scene.image(piece['source'])
        base = scene.image(piece['base'])
    if mode == 'patch':
        alpha = region
    else:
        diff = np.abs(blur(src, 0.8) - blur(base, 0.8)).max(axis=2)
        lo, hi = piece.get('threshold', [10, 34])
        alpha = smoothstep(lo, hi, diff)
        alpha = morph(alpha, piece.get('close', 2), piece.get('open', 1))
        solid = polygon_mask(size, piece.get('solid'), 1.0)
        alpha = np.maximum(alpha, solid)
        glass = GlassEdge(size, piece, src, alpha * region, solid) if piece.get('glass') else None
        if glass:
            alpha = glass.alpha
        alpha *= region
        if piece.get('soften', 0.6):
            alpha = blur(alpha, piece.get('soften', 0.6))
        if glass:
            glass.alpha = alpha
    # where it is partly see-through, what showed through is the base: take it out (C = aF + (1-a)B)
    a = alpha[..., None]
    colour = np.where(a > 0.05, (src - (1 - a) * base) / np.maximum(a, 1e-3), src)
    colour = np.clip(colour, 0, 255)
    if glass:
        colour = glass.colour(src, colour)
    # a cut piece takes its colour from each plate in turn, and needs the glass edge again for each
    return alpha, colour, glass if mode == 'cut' else None


def cut_colour(scene, alpha, glass, state):
    """A cut piece exactly as `state`'s plate painted it: no relight, its own background taken out."""
    a = alpha[..., None]
    src = scene.plate(state)
    base = scene.plate(state, behind=True)
    rgb = np.clip(np.where(a > 0.05, (src - (1 - a) * base) / np.maximum(a, 1e-3), src), 0, 255)
    return glass.colour(src, rgb) if glass else rgb


def scaled_shapes(shapes, at, k):
    """Plate-px polygons and rects moved into a piece drawn `k` times larger over the plate rect `at`."""
    x, y = at[0], at[1]
    out = []
    for shape in shapes or []:
        if len(shape) == 4 and not isinstance(shape[0], (list, tuple)):
            sx, sy, w, h = shape
            out.append([(sx - x) * k, (sy - y) * k, w * k, h * k])
        else:
            out.append([[(px - x) * k, (py - y) * k] for px, py in shape])
    return out


def build_finer(scene, piece, out_dir, name, quality):
    """A finer copy of what is painted over the plate rect `at` (x, y, w, h), drawn `scale` times larger (a
    detail pass of a corner the camera closes in on): its alpha is `region` (plate px), its colour the source as
    drawn, relit to every state by the light ratio enlarged to its size. The box it covers stays in plate px; the
    texture is simply larger."""
    k = int(piece['scale'])
    x, y, w, h = piece['at']
    src = scene.image(piece['source'])
    if src.shape[:2] != (h * k, w * k):
        raise SystemExit(f"{piece['id']}: the source is {src.shape[1]}x{src.shape[0]}, `at` x scale is {w * k}x{h * k}")
    size = (w * k, h * k)
    alpha = polygon_mask(size, scaled_shapes(piece.get('region'), piece['at'], k), piece.get('feather', 1.5) * k)
    emissive = None
    if piece.get('emissive'):
        emissive = polygon_mask(size, scaled_shapes(piece['emissive'], piece['at'], k), 3.0 * k)
    lin = to_linear(src)
    for state in scene.states:
        ratio = scene.ratio(state)[y:y + h, x:x + w]
        big = np.dstack([
            np.asarray(Image.fromarray(ratio[..., c].astype(np.float32), 'F').resize(size, Image.BILINEAR))
            for c in range(3)
        ])
        relit = lin * big
        if emissive is not None:
            e = emissive[..., None]
            relit = relit * (1 - e) + lin * e
        rgba = np.dstack([to_srgb(relit), alpha * 255])
        Image.fromarray(np.round(np.clip(rgba, 0, 255)).astype(np.uint8), 'RGBA').save(
            out_dir / piece.get('name', name).format(piece=piece['id'], state=state), quality=quality, method=6)
    return {'x': int(x), 'y': int(y), 'w': int(w), 'h': int(h)}


def bbox(alpha, pad=2, floor=1 / 255):
    ys, xs = np.nonzero(alpha > floor)
    if len(xs) == 0:
        raise SystemExit('a piece came out empty: check its region and threshold')
    h, w = alpha.shape
    return (max(0, xs.min() - pad), max(0, ys.min() - pad), min(w, xs.max() + 1 + pad), min(h, ys.max() + 1 + pad))


def lit_colour(scene, piece, colour, state, emissive):
    """The piece's colour under `state`: its reference colour times the light ratio, glowing parts kept."""
    lin = to_linear(colour)
    relit = lin * scene.ratio(state)
    if emissive is not None:
        e = emissive[..., None]
        relit = relit * (1 - e) + lin * e
    return to_srgb(relit)


def build(scene, ids=None, review=None):
    out_dir = scene.file(scene.cfg.get('out', '.'))
    out_dir.mkdir(parents=True, exist_ok=True)
    name = scene.cfg.get('name', 'set-{piece}-{state}.webp')
    quality = scene.cfg.get('quality', 88)
    boxes = {}
    cut = {}
    for piece in scene.cfg.get('pieces', []):
        pid = piece['id']
        if ids and pid not in ids:
            continue
        if piece.get('scale'):
            boxes[pid] = build_finer(scene, piece, out_dir, name, quality)
            print(pid, 'box', json.dumps(boxes[pid]), f"texture x{piece['scale']}")
            continue
        alpha, colour, glass = cut_piece(scene, piece)
        x0, y0, x1, y1 = bbox(alpha)
        emissive = polygon_mask((scene.w, scene.h), piece.get('emissive'), 3.0) if piece.get('emissive') else None
        if piece.get('file'):
            # an actor's drawing: one picture in the reference light, lit at run time by its measured tint
            rgba = np.dstack([colour, alpha * 255])[y0:y1, x0:x1]
            Image.fromarray(np.round(rgba).astype(np.uint8), 'RGBA').save(out_dir / piece['file'], quality=quality, method=6)
            boxes[pid] = {'x': int(x0), 'y': int(y0), 'w': int(x1 - x0), 'h': int(y1 - y0)}
            cut[pid] = (alpha, colour, emissive, glass)
            print(pid, 'box', json.dumps(boxes[pid]))
            continue
        for state in scene.states:
            if piece.get('alpha') == 'cut':
                rgb = cut_colour(scene, alpha, glass, state)
            else:
                rgb = lit_colour(scene, piece, colour, state, emissive)
            rgba = np.dstack([np.clip(rgb, 0, 255), alpha * 255])[y0:y1, x0:x1]
            Image.fromarray(np.round(rgba).astype(np.uint8), 'RGBA').save(
                out_dir / piece.get('name', name).format(piece=pid, state=state), quality=quality, method=6)
        boxes[pid] = {'x': int(x0), 'y': int(y0), 'w': int(x1 - x0), 'h': int(y1 - y0)}
        cut[pid] = (alpha, colour, emissive, glass)
        print(pid, 'box', json.dumps(boxes[pid]))
    if review:
        preview(scene, cut, Path(review))
    return boxes


# ---------------------------------------------------------------------------------------------- review


def compose(scene, state, cut, which):
    """The plate for `state` with the pieces shown in `which` ('here' or 'away') laid over it in order."""
    away = which == 'away'
    canvas = scene.plate(state, behind=away and scene.cfg.get('away_behind', True)).copy()
    for piece in scene.cfg.get('pieces', []):
        when = piece.get('when', 'always')
        if piece['id'] not in cut or (when == 'here' and away) or (when == 'away' and not away):
            continue
        alpha, colour, emissive, glass = cut[piece['id']]
        if piece.get('alpha') == 'cut':
            rgb = cut_colour(scene, alpha, glass, state)
        else:
            rgb = lit_colour(scene, piece, colour, state, emissive)
        a = alpha[..., None]
        canvas = canvas * (1 - a) + np.clip(rgb, 0, 255) * a
    return canvas


def preview(scene, cut, out):
    out.mkdir(parents=True, exist_ok=True)
    crop = scene.cfg.get('review_crop', [0, 0, scene.w, scene.h])
    x, y, w, h = crop
    for which in ('here', 'away'):
        tiles = []
        for state in scene.states:
            img = compose(scene, state, cut, which)[y:y + h, x:x + w]
            tiles.append(Image.fromarray(np.round(img).astype(np.uint8), 'RGB'))
        cols = 2
        rows = math.ceil(len(tiles) / cols)
        sheet = Image.new('RGB', (cols * w + (cols - 1) * 8, rows * h + (rows - 1) * 8), (18, 18, 18))
        for i, t in enumerate(tiles):
            sheet.paste(t, ((i % cols) * (w + 8), (i // cols) * (h + 8)))
        sheet.save(out / f'{which}.jpg', quality=86)
        for state, t in zip(scene.states, tiles):
            t.save(out / f'{which}-{state}.jpg', quality=88)
    print('review', out)


# ---------------------------------------------------------------------------------------------- tint / check


def tint(scene):
    """The light at each actor's spot, per state: the log-mean light ratio over the spot's receivers, as sRGB
    gains (what to multiply the actor's colours by; above 1 brightens) and as a tint (the gains clipped to 1)."""
    result = {}
    for actor in scene.cfg.get('actors', []):
        x, y, w, h = actor['spot']
        weight = scene.receive[y:y + h, x:x + w]
        if weight.sum() < 1:
            raise SystemExit(f"{actor['id']}: its spot has no receivers (move it onto a wall, a sofa, a table)")
        gains = {}
        hexes = {}
        for state in scene.states:
            r = scene.ratio(state)[y:y + h, x:x + w]
            m = np.exp((np.log(r) * weight[..., None]).sum((0, 1)) / weight.sum())
            # linear light ratio m is about an sRGB gain of m^(1/2.2)
            g = m ** (1 / 2.2)
            gains[state] = [round(float(v), 3) for v in g]
            hexes[state] = '0x' + ''.join(f'{int(round(min(v, 1) * 255)):02x}' for v in g)
        result[actor['id']] = {'gain': gains, 'tint': hexes}
        print(actor['id'], 'gain', json.dumps(gains))
        print(actor['id'], 'tint', json.dumps(hexes))
        peak = max(max(g) for g in gains.values())
        if peak > 1.001:
            print(f'  note: some states light it {peak:.2f}x brighter than the reference; a tint clips at 1, so '
                  'use the gains (a colour matrix) or paint it in the brightest state')
    return result


def check(scene, pid):
    """Relight a piece that every plate already has from the reference, and compare with the real thing."""
    piece = next((p for p in scene.cfg['pieces'] if p['id'] == pid), None)
    if piece is None or piece.get('alpha') != 'cut':
        raise SystemExit('check needs a piece with "alpha": "cut" (one every plate already shows)')
    alpha, _, _ = cut_piece(scene, piece)
    solid = alpha > 0.9
    ref = scene.plate(scene.ref)
    print(f'{pid}: mean |error| over {int(solid.sum())} px, sRGB levels (relit / left at the reference)')
    for state in scene.states:
        real = scene.plate(state)
        relit = to_srgb(to_linear(ref) * scene.ratio(state))
        e_relit = np.abs(relit - real)[solid].mean()
        e_flat = np.abs(ref - real)[solid].mean()
        bias = (relit - real)[solid].mean(axis=0)
        print(f'  {state:16s} {e_relit:6.1f} / {e_flat:6.1f}   bias r{bias[0]:+.1f} g{bias[1]:+.1f} b{bias[2]:+.1f}')


def main():
    p = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    p.add_argument('command', choices=['all', 'relight', 'tint', 'check'])
    p.add_argument('--config', required=True)
    p.add_argument('--piece', action='append', help='only these pieces (relight) / the piece to check')
    p.add_argument('--review', help='folder for the here / away review sheets')
    a = p.parse_args()
    scene = Scene(a.config)
    if a.command in ('all', 'relight'):
        build(scene, a.piece, a.review)
    if a.command in ('all', 'tint'):
        tint(scene)
    if a.command == 'check':
        for pid in a.piece or []:
            check(scene, pid)


if __name__ == '__main__':
    main()
