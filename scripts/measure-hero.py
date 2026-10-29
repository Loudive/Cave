#!/usr/bin/env python3
# measure-hero.py — замер alpha-bbox каждого кадра всех листов героя
# и расчёт фактического видимого размера с учётом per-anim scale из anims.json.
import json
from PIL import Image

ANIMS = ['idle', 'run', 'glide', 'bite', 'eat', 'hurt', 'death']
FW, FH = 68, 46

def unwrap(o):
    if isinstance(o, dict) and '_doc' in o and 'value' in o:
        return unwrap(o['value'])
    return o

cfg = json.load(open('/home/z/cave-repo/src/config/anims.json'))

def bbox(img, c, r):
    px = img.load()
    minx = miny = 10**9; maxx = maxy = -1; mass = 0
    for y in range(r*FH, (r+1)*FH):
        for x in range(c*FW, (c+1)*FW):
            a = px[x, y][3] if img.mode == 'RGBA' else 255
            if a > 24:
                mass += 1
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    if maxx < 0: return None
    return (maxx-minx+1, maxy-miny+1, mass)

print(f"{'anim':7} {'frm':>3} {'bbox':>8} {'mass':>6} {'scale':>6}  effective")
per = {}
for name in ANIMS:
    img = Image.open(f'/home/z/cave-repo/assets/hero-{name}.png').convert('RGBA')
    cols = img.width // FW; rowsN = img.height // FH
    spec = cfg[name]
    frames = unwrap(spec['frames'])
    scale = unwrap(spec.get('scale', {'value': 1.0}))
    order = unwrap(spec.get('order')) if 'order' in spec else None
    for r in range(rowsN):
        for c in range(cols):
            idx = r*cols + c
            if idx >= frames: continue
            b = bbox(img, c, r)
            if not b: continue
            w, h, mass = b
            used = (order is None) or (idx in order)
            mark = '' if used else ' (unused)'
            print(f"{name:7} {idx:3}  {w:3}x{h:<3}  {mass:6}  {scale:6.2f}  {(w*scale):5.1f}x{(h*scale):4.1f}{mark}")
            if used:
                per.setdefault(name, []).append((w*scale, h*scale, mass*scale*scale))
    print(f"  -> {name}: order={order} scale={scale}")

print('\n=== средний видимый размер по анимации (после scale) ===')
for name, arr in per.items():
    aw = sum(o[0] for o in arr)/len(arr); ah = sum(o[1] for o in arr)/len(arr)
    am = sum(o[2] for o in arr)/len(arr)
    ws = [o[0] for o in arr]; hs = [o[1] for o in arr]
    print(f"{name:7} avgW={aw:5.1f} avgH={ah:5.1f} avgMass={am:6.0f}  minW={min(ws):.0f} maxW={max(ws):.0f} minH={min(hs):.0f} maxH={max(hs):.0f}")
