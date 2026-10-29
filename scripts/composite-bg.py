#!/usr/bin/env python3
# composite-bg.py — превью: складывает 5 параллакс-слоёв как в игре
# (void ← megavault ← midwall ← formations ← silhouette-near) и режет
# два репрезентативных вертикальных окна (верх/середина).
import sys
from PIL import Image

A = '/home/z/cave-repo/assets/'
BGW, BGH = 1024, 1400
out_base = sys.argv[1] if len(sys.argv) > 1 else '/home/z/my-project/scripts/shots17/composite'

layers = ['bg-void', 'bg-megavault', 'bg-midwall', 'bg-formations', 'silhouette-near']
canvas = Image.new('RGBA', (BGW, BGH), (0, 0, 0, 255))
for name in layers:
    img = Image.open(A + name + '.png').convert('RGBA')
    canvas = Image.alpha_composite(canvas, img)

# тёмная вуаль 0.62 как в игре (поверх, кроме окон бездны — упрощённо: вся картинка)
veil = Image.new('RGBA', (BGW, BGH), (11, 11, 16, int(255 * 0.62)))
canvas = Image.alpha_composite(canvas, veil)

# два окна 960×540: y=200 (верх) и y=700 (середина) — как типичный кадр камеры
for tag, y0 in [('top', 180), ('mid', 640), ('deep', 1000)]:
    crop = canvas.crop((32, y0, 32 + 960, y0 + 540))
    crop.save(f'{out_base}-{tag}.png')
    print(f'{out_base}-{tag}.png')
canvas.resize((512, 700)).save(f'{out_base}-full.png')
print(f'{out_base}-full.png')
