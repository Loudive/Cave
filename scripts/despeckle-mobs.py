#!/usr/bin/env python3
"""despeckle-mobs.py — шаг 23: хирургическая чистка листов мобов.

Жалоба игрока: «вот у моба со скрина есть дефект спрайта. Ты когда нарезал
картинки видимо зацепил часть другой. Когда он поворачивается, то видна
белая неопознанная часть».

Корень: в некоторых кадрах нейро-листов есть ОТСОЕДИНЁННЫЕ от тела мусорные
островки (кадр 3 кровососа: два обломка 37 и 29 px в верхнем левом углу —
тот самый «белый неопознанный кусок»; кадр 0: обломок 32 px справа; мелкие
крапинки у жнеца и нетопыря). Они остались от нарезки (шаг 20/21): слайсер
брал компоненты с дилатацией r=4 — обломки прилипали к телу и попадали в
кадр, а при flipX (поворот моба) переезжали на другую сторону — игрок
видел «часть другой картинки».

Правило чистки (одинаковое для всех кадров, ноль ручных координат):
в каждом кадре 68×46 ищем связные (4-связность) альфа-островки (alpha>40);
главный = максимальная площадь; островки < 12% площади главного — мусор,
обнуляются (alpha=0). Порог 12% на порядок выше самого крупного замеченного
обломка (37 px = 6%) и на порядок ниже любой реальной части тела (лапы
кровососа — непрерывные продолжения тела, крылья нетопыря — слились с
телом в один островок).

Режимы:
  python3 scripts/despeckle-mobs.py           — чистка assets/mob-*.png на месте
  python3 scripts/despeckle-mobs.py --check   — только отчёт, без записи
"""
from PIL import Image
import sys
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'assets')
FW, FH = 68, 46
KEEP_SHARE = 0.12  # островки < 12% главного — мусор
ALPHA_MIN = 40

def islands(px, x0):
    """Связные альфа-островки в кадре [x0, x0+FW). Возврат [(area, [(x,y)..])]."""
    seen = [[False] * FH for _ in range(FW)]
    out = []
    for sy in range(FH):
        for sx in range(FW):
            if seen[sx][sy] or px[x0 + sx, sy][3] <= ALPHA_MIN:
                continue
            stack = [(sx, sy)]
            seen[sx][sy] = True
            cells = []
            while stack:
                cx, cy = stack.pop()
                cells.append((cx, cy))
                for nx, ny in ((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)):
                    if 0 <= nx < FW and 0 <= ny < FH and not seen[nx][ny] and px[x0 + nx, ny][3] > ALPHA_MIN:
                        seen[nx][ny] = True
                        stack.append((nx, ny))
            out.append(cells)
    out.sort(key=len, reverse=True)
    return out

def main():
    check_only = '--check' in sys.argv
    mobs = ['bloodsucker', 'slug', 'bat', 'reaper', 'shell', 'lava']
    total_killed = 0
    for m in mobs:
        path = os.path.join(ASSETS, f'mob-{m}.png')
        im = Image.open(path).convert('RGBA')
        px = im.load()
        killed_report = []
        for f in range(4):
            isl = islands(px, f * FW)
            if not isl:
                continue
            main_area = len(isl[0])
            for cells in isl[1:]:
                if len(cells) < main_area * KEEP_SHARE:
                    for (cx, cy) in cells:
                        px[f * FW + cx, cy] = (0, 0, 0, 0)
                    killed_report.append(f'f{f}: убран островок {len(cells)}px (<{int(main_area*KEEP_SHARE)}px)')
                    total_killed += len(cells)
        if killed_report:
            print(f'{m}:')
            for r in killed_report:
                print(f'  {r}')
            if not check_only:
                im.save(path)
                print(f'  -> записано {path}')
        else:
            print(f'{m}: чисто')
    mode = 'ПРОВЕРКА' if check_only else 'ЧИСТКА'
    print(f'{mode} завершена: убрано {total_killed} px мусора')

if __name__ == '__main__':
    main()
