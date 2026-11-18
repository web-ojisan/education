"""Cut a 2x2 character sheet on a magenta background into 4 transparent square PNGs.

usage: python3 -I cut-enemy-sheet.py SHEET OUT_DIR [SIZE] [--keep-thin]

--keep-thin  keep thin parts that are attached to the character (claws, antennae, whiskers).
             Use it for sheets whose background has no speed lines; without it, thin things are
             treated as speed lines and removed.
Small sheets (under 1600px) are enlarged first so the cut edge stays smooth.
Writes idle/hit/ko/attack as .webp (transparent).
"""
import sys, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

args = [x for x in sys.argv[1:] if not x.startswith('--')]
KEEP_THIN = '--keep-thin' in sys.argv
src, out = args[0], args[1]
SIZE = int(args[2]) if len(args) > 2 else 640
NAMES = ['idle', 'hit', 'ko', 'attack']          # top-left, top-right, bottom-left, bottom-right
os.makedirs(out, exist_ok=True)

im = Image.open(src).convert('RGB')
if im.size[0] < 1600:
    k = -(-1600 // im.size[0])
    im = im.resize((im.size[0] * k, im.size[1] * k), Image.LANCZOS)
W, H = im.size
a = np.asarray(im).astype(np.float32) / 255
r, g, b = a[..., 0], a[..., 1], a[..., 2]
mx, mn = a.max(-1), a.min(-1)
sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0)
# hue in degrees
hue = np.zeros_like(mx)
d = np.maximum(mx - mn, 1e-6)
hue = np.where(mx == r, ((g - b) / d) % 6, hue)
hue = np.where(mx == g, (b - r) / d + 2, hue)
hue = np.where(mx == b, (r - g) / d + 4, hue)
hue *= 60
# background: magenta-ish hue, saturated, not dark (covers the halftone dots and gradients too)
magenta = (hue > 280) & (hue < 335) & (sat > 0.45) & (mx > 0.35)
white = (mn > 0.93)                                # gutters between panels

def panel(i):
    x0, y0 = (i % 2) * W // 2, (i // 2) * H // 2
    return slice(y0, y0 + H // 2), slice(x0, x0 + W // 2)

cut = []
for i, name in enumerate(NAMES):
    ys, xs = panel(i)
    rgb = (a[ys, xs] * 255).astype(np.uint8)
    bg = magenta[ys, xs]
    # panel area = bounding box of magenta; outside it is the white gutter
    yy, xx = np.where(bg)
    py0, py1, px0, px1 = yy.min(), yy.max() + 1, xx.min(), xx.max() + 1
    rgb, bg = rgb[py0:py1, px0:px1], bg[py0:py1, px0:px1]
    fg = ~bg
    # drop speed lines / stars / sweat marks: thin or detached things.
    # 1) erode so thin lines vanish, 2) keep the biggest blob (the character), 3) grow it back and intersect.
    R = max(4, rgb.shape[0] // 110)
    st = ndi.generate_binary_structure(2, 2)
    core = ndi.binary_erosion(fg, st, iterations=R)
    lab, n = ndi.label(core)
    if n == 0: raise SystemExit('no character found in panel ' + name)
    sizes = ndi.sum(core, lab, range(1, n + 1))
    body = lab == (1 + int(np.argmax(sizes)))
    if KEEP_THIN:                                  # everything connected to the character stays
        lab2, _ = ndi.label(fg, st)
        body = np.isin(lab2, np.unique(lab2[body])) & fg
    else:
        body = ndi.binary_dilation(body, st, iterations=R + 2) & fg
    body = body | (ndi.binary_fill_holes(body) & ~bg)     # fill pinholes inside the character, but keep real gaps (e.g. between arm and body) open
    # soften the edge a little and remove magenta fringe
    alpha = ndi.gaussian_filter(body.astype(np.float32), 0.8)
    alpha = np.clip((alpha - 0.35) / 0.4, 0, 1)
    out_rgb = rgb.copy()
    fringe = (alpha > 0) & bg                      # leftover magenta pixels at the edge -> paint dark so no pink halo
    out_rgb[fringe] = (20, 17, 15)
    rgba = np.dstack([out_rgb, (alpha * 255).astype(np.uint8)])
    cut.append((name, rgba, body))

# Same scale for all poses: trim the empty band above the tallest pose (shared by all four),
# then put each on a square canvas, bottom-centered.
top = min(int(np.where(b.any(1))[0].min()) for _, _, b in cut)
top = max(0, top - 8)
for name, rgba, body in cut:
    rgba = rgba[top:]
    ph, pw = rgba.shape[:2]
    xs_ = np.where(body.any(0))[0]
    cx = (int(xs_.min()) + int(xs_.max())) // 2            # center the character horizontally
    side = max(ph, 2 * max(cx - int(xs_.min()), int(xs_.max()) - cx) + 16)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(Image.fromarray(rgba, 'RGBA'), (side // 2 - cx, side - ph))
    canvas = canvas.resize((SIZE, SIZE), Image.LANCZOS)
    path = os.path.join(out, name + '.webp')
    canvas.save(path, 'WEBP', quality=88, method=6)
    print(name, 'trim top', top, 'canvas', side, '->', os.path.getsize(path) // 1024, 'KB')
