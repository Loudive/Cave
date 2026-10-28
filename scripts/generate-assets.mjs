/**
 * generate-assets.mjs — шаг 2.
 * Детерминированная генерация PNG-текстур в assets/ без внешних зависимостей
 * (чистый Node: zlib + собственный PNG-энкодер).
 *
 * Запуск: npm run assets
 * Правило гайда: код не содержит магических констант баланса, а палитра
 * зафиксирована в design/DECISIONS.md — цвета дублируются сюда намеренно,
 * чтобы генерация была самодостаточной.
 *
 * 0x72 DungeonTileset II подключается с шага 3–4 (см. design/ASSETS.md);
 * эти текстуры — «программные ассеты» для загрузчика и фолбэк-стиль проекта.
 */
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'assets')

// ── Палитра проекта (design/DECISIONS.md) ──────────────────────────────────
const PAL = {
  bg: [0x0b, 0x0b, 0x10],
  rockDark: [0x1a, 0x1a, 0x26],
  rockMid: [0x2a, 0x2a, 0x3a],
  rockLight: [0x3a, 0x3a, 0x4e],
  cyan: [0x58, 0xe6, 0xc8],
  blood: [0xe2, 0x3a, 0x4e],
  spore: [0xb3, 0x6b, 0xff],
  acid: [0xa8, 0xe3, 0x4f],
  ink: [0x04, 0x04, 0x08],
}

// ── Детерминированный RNG (mulberry32) — билды воспроизводимы ─────────────
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── Минимальный PNG-энкодер ────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** RGBA-буфер → PNG-файл (фильтр 0 на каждой строке). */
function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── Крошечный растровый холст ──────────────────────────────────────────────
class Canvas {
  constructor(w, h) {
    this.w = w
    this.h = h
    this.data = Buffer.alloc(w * h * 4)
  }

  px(x, y, [r, g, b], a = 255) {
    // Шаг 14 (фикс «зелёных квадратов»): дробные координаты давали дробный
    // индекс (y * w + x) * 4 — при x = *.5 индекс ЦЕЛЫЙ, но сдвинутый на 2
    // байта: запись RGBA попадала в СИНИЕ/АЛЬФА одного пикселя и КРАСНЫЙ/
    // ЗЕЛЁНЫЙ соседнего — альфа 235 навсегда оставалась в зелёном канале
    // (#0DFF11-хромакей в силуэтах-задниках). Округляем — целочисленный
    // пиксель-арт и так не допускает дробей.
    x = Math.floor(x)
    y = Math.floor(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = (y * this.w + x) * 4
    const sa = a / 255
    const da = this.data[i + 3] / 255
    const oa = sa + da * (1 - sa)
    if (oa <= 0) return
    this.data[i] = Math.round((r * sa + this.data[i] * da * (1 - sa)) / oa)
    this.data[i + 1] = Math.round((g * sa + this.data[i + 1] * da * (1 - sa)) / oa)
    this.data[i + 2] = Math.round((b * sa + this.data[i + 2] * da * (1 - sa)) / oa)
    this.data[i + 3] = Math.round(oa * 255)
  }

  rect(x0, y0, x1, y1, color, a = 255) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.px(x, y, color, a)
  }

  fill(color, a = 255) { this.rect(0, 0, this.w - 1, this.h - 1, color, a) }

  roundRect(x0, y0, x1, y1, rad, color, a = 255) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = Math.max(x0 + rad - x, x - (x1 - rad), 0)
        const dy = Math.max(y0 + rad - y, y - (y1 - rad), 0)
        if (Math.hypot(dx, dy) <= rad + 0.5) this.px(x, y, color, a)
      }
    }
  }

  /** Радиальный градиент: stops = [[t0, a0], [t1, a1], …], a ∈ 0..1. */
  radial(cx, cy, radius, color, stops) {
    const r2 = radius * radius
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy)
        if (d2 > r2) continue
        const t = Math.sqrt(d2) / radius
        let a = 0
        for (let s = 0; s < stops.length - 1; s++) {
          const [ta, aa] = stops[s]
          const [tb, ab] = stops[s + 1]
          if (t >= ta && t <= tb) {
            const k = (t - ta) / (tb - ta || 1)
            a = aa + (ab - aa) * k
            break
          }
        }
        if (t <= stops[0][0]) a = stops[0][1]
        this.px(x, y, color, Math.round(a * 255))
      }
    }
  }

  noise(seed, colors, density, alphaMin, alphaMax) {
    const rnd = mulberry32(seed)
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (rnd() < density) {
          const c = colors[Math.floor(rnd() * colors.length)]
          this.px(x, y, c, Math.round((alphaMin + rnd() * (alphaMax - alphaMin)) * 255))
        }
      }
    }
  }

  /** Шаг 16: стирание альфы — «окна» в средних слоях фона, сквозь которые
   *  видны глубокие слои (арки/череп левиафана/бездна). a=1 — прозрачно. */
  erase(x, y, a) {
    x = Math.floor(x)
    y = Math.floor(y)
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = (y * this.w + x) * 4
    this.data[i + 3] = Math.round(this.data[i + 3] * (1 - Math.max(0, Math.min(1, a))))
  }

  /** Стирание эллипса с мягкой кромкой (арочное окно / расщелина). */
  eraseEllipse(cx, cy, rx, ry, power) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const d2 = ((x - cx) * (x - cx)) / (rx * rx) + ((y - cy) * (y - cy)) / (ry * ry)
        if (d2 >= 1) continue
        const t = Math.sqrt(d2)
        // центр — насквозь, кромка — мягкий фейд
        const a = power * (t < 0.72 ? 1 : (1 - t) / 0.28)
        this.erase(x, y, a)
      }
    }
  }

  save(name) {
    // Шаг 14: хромакей-аудит — ни один ассет не имеет права содержать
    // неоновые цвета (зелёный/пурпурный хромакей). Если генератор снова
    // начнёт «сдвигать каналы», сборка упадёт здесь с точными координатами,
    // а не молча уедет в релиз (нулевая толерантность, как assertNumbers).
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4
        const r = this.data[i], g = this.data[i + 1], b = this.data[i + 2], a = this.data[i + 3]
        if (a > 60) {
          const neonGreen = g > 200 && r < 60 && b < 60
          const neonMagenta = r > 200 && b > 200 && g < 60
          if (neonGreen || neonMagenta) {
            throw new Error(
              `ХРОМАКЕЙ В АССЕТЕ ${name} @(${x},${y}) rgba(${r},${g},${b},${a}) — ` +
              `сдвиг каналов или мусорный цвет; генератор сломан, см. px()`,
            )
          }
        }
      }
    }
    writeFileSync(join(OUT, name), encodePNG(this.w, this.h, this.data))
    console.log(`  ${name}  (${this.w}×${this.h})`)
  }
}

// ── Генерация текстур ──────────────────────────────────────────────────────
console.log('Cave Devourer — генерация программных ассетов:')
mkdirSync(OUT, { recursive: true })

/** Мягкое световое пятно биолюминесценции (128×128). */
function makeGlow(name, color) {
  const c = new Canvas(128, 128)
  c.radial(64, 64, 64, color, [[0, 1], [0.25, 0.55], [0.6, 0.14], [1, 0]])
  c.save(name)
}
makeGlow('glow-cyan.png', PAL.cyan)
makeGlow('glow-purple.png', PAL.spore)
makeGlow('glow-red.png', PAL.blood)
makeGlow('glow-acid.png', PAL.acid)

/** Игрок-плейсхолдер: светящийся блок 28×28 с тёмным ядром (геймпад-фил). */
{
  const c = new Canvas(28, 28)
  c.roundRect(1, 1, 26, 26, 6, PAL.cyan, 255)
  c.roundRect(9, 9, 18, 18, 3, PAL.bg, 255)
  c.save('player.png')
}

/** Камень-декор пола 96×64: слоистый шум, тёмный низ. */
{
  const c = new Canvas(96, 64)
  c.roundRect(0, 6, 95, 63, 12, PAL.rockDark, 255)
  c.roundRect(10, 14, 85, 53, 9, PAL.rockMid, 255)
  const rnd = mulberry32(20261027)
  for (let i = 0; i < 130; i++) {
    const x = 12 + Math.floor(rnd() * 72)
    const y = 16 + Math.floor(rnd() * 36)
    const w = 1 + Math.floor(rnd() * 4)
    const h = 1 + Math.floor(rnd() * 2)
    c.rect(x, y, x + w, y + h, PAL.rockLight, Math.round((0.25 + rnd() * 0.5) * 255))
  }
  c.save('rock.png')
}

/** Виньетка 512×512: тёмные края кадра — ощущение тоннеля. */
{
  const c = new Canvas(512, 512)
  c.radial(256, 256, 256, PAL.ink, [[0.22, 0], [0.7, 0.45], [1, 0.92]])
  c.save('vignette.png')
}

/** Пиксель-гриб 16×24: шляпка-биолюм на ножке (спрайт светильника пещеры). */
{
  const c = new Canvas(16, 24)
  c.roundRect(6, 14, 9, 22, 2, PAL.rockLight, 255)
  // Шляпка полукругом.
  for (let y = 4; y <= 13; y++) {
    const half = Math.round(Math.sqrt(Math.max(0, 1 - ((y - 13) / 9) ** 2)) * 7)
    c.rect(8 - half, y, 8 + half, y, PAL.cyan, 230)
  }
  c.rect(5, 13, 10, 13, PAL.cyan, 255)
  // Точки спор на шляпке.
  c.px(6, 9, PAL.bg, 200)
  c.px(10, 8, PAL.bg, 200)
  c.px(8, 11, PAL.bg, 160)
  c.save('mushroom.png')
}

/** Спора 8×8 — частица для эмиттеров (шаг 6+). */
{
  const c = new Canvas(8, 8)
  c.radial(4, 4, 4, PAL.spore, [[0, 1], [0.5, 0.5], [1, 0]])
  c.save('spore.png')
}

// ── Шаг 4: тайлы для процедурного тайлмапа ─────────────────────────────────
// Три слоя: камень (ядро стен), земля (край стены у воздуха), декор
// (мох/кристалл/кость — прозрачный фон, лежат на полу пещеры).

// ── Шаг 14: атлас пещерных тайлов «tiles-cave.png» ────────────────────────
// 8×4 слота по 16px (128×64). Многослойные стены по референсам Hollow Knight
// / Blasphemous: светлая тёплая кромка пола (rim-light сверху), вертикальный
// градиент стен (свет падает сверху), тёмный потолок со сталактитиками,
// и страты глубины — камень темнеет с дистанцией от воздуха (BFS в
// TileBuilder): стена читается толстой 3D-массой, уходящей в бездну.
//
// Слоты: 0..3 — камень глубины (ближе к воздуху → темнее → почти-бездна);
// 4..19 — край стены к воздуху, битмаска воздушных соседей N=1 E=2 S=4 W=8
// (автотайлинг: 16 контекстов вместо 4, углы и «губы» рисуются сами);
// 20..23 — резерв (заполнены камнем-1).
{
  const T = 16
  const COLS = 8
  const ROWS = 4
  const c = new Canvas(T * COLS, T * ROWS)
  const stonePal = {
    near: { base: [0x26, 0x26, 0x33], grain: PAL.rockMid, grainN: 12, grainA: [0.3, 0.65] },
    mid: { base: [0x1d, 0x1d, 0x29], grain: PAL.rockDark, grainN: 9, grainA: [0.25, 0.55] },
    deep: { base: [0x15, 0x15, 0x1f], grain: PAL.rockDark, grainN: 6, grainA: [0.2, 0.45] },
    void: { base: [0x0f, 0x0f, 0x16], grain: [0x12, 0x12, 0x1b], grainN: 3, grainA: [0.2, 0.4] },
  }

  /** Зерно камня в слот (ox, oy) — база + мягкие пятна. */
  function stoneSlot(ox, oy, pal, seed, strataLine) {
    c.rect(ox, oy, ox + T - 1, oy + T - 1, pal.base, 255)
    const rnd = mulberry32(seed)
    for (let i = 0; i < pal.grainN; i++) {
      const x = ox + Math.floor(rnd() * (T - 3))
      const y = oy + Math.floor(rnd() * (T - 3))
      const w = 1 + Math.floor(rnd() * 3)
      const h = 1 + Math.floor(rnd() * 2)
      c.rect(x, y, x + w, y + h, pal.grain,
        Math.round((pal.grainA[0] + rnd() * (pal.grainA[1] - pal.grainA[0])) * 255))
    }
    if (strataLine) {
      // Бездна: едва заметная стратификация — порода слоями.
      c.rect(ox, oy + 6, ox + T - 1, oy + 6, [0x11, 0x11, 0x19], 140)
      c.rect(ox + 2, oy + 11, ox + T - 3, oy + 11, [0x11, 0x11, 0x19], 100)
    }
  }

  // Слоты 0..3 — страты глубины.
  const depthPals = [stonePal.near, stonePal.mid, stonePal.deep, stonePal.void]
  for (let d = 0; d < 4; d++) {
    stoneSlot((d % COLS) * T, Math.floor(d / COLS) * T, depthPals[d], 71 + d, d === 3)
  }

  // Слоты 4..19 — край стены к воздуху (автотайл по битмаске).
  const N = 1, E = 2, S = 4, W = 8
  for (let m = 0; m < 16; m++) {
    const slot = 4 + m
    const ox = (slot % COLS) * T
    const oy = Math.floor(slot / COLS) * T
    stoneSlot(ox, oy, stonePal.near, 81 + m, false)
    const rnd = mulberry32(121 + m)

    // Пол (воздух сверху): тёплая земля со светлой кромкой — rim-light,
    // свет падает сверху (референс: «тонкий подсвет по верхним граням»).
    if (m & N) {
      c.rect(ox, oy, ox + T - 1, oy, [0x7d, 0x6a, 0x50], 255)
      c.rect(ox, oy + 1, ox + T - 1, oy + 1, [0x5f, 0x51, 0x40], 255)
      c.rect(ox, oy + 2, ox + T - 1, oy + 2, [0x46, 0x3c, 0x31], 220)
      // Дизер-переход к камню — не резкая граница.
      for (let x = 0; x < T; x += 2) c.px(ox + x + (Math.floor(rnd() * 2)), oy + 3, [0x46, 0x3c, 0x31], 170)
      // Камешки в земле.
      c.px(ox + 4, oy + 2, [0x57, 0x49, 0x3a], 200)
      c.px(ox + 11, oy + 2, [0x57, 0x49, 0x3a], 190)
      // Редкий биолюм-мох на кромке — пещера живая.
      if (rnd() > 0.45) c.px(ox + 7, oy + 1, [0x3d, 0x7a, 0x6c], 150)
    }

    // Потолок (воздух снизу): тёмная кромка + сталактитики-борозды.
    if (m & S) {
      c.rect(ox, oy + T - 1, ox + T - 1, oy + T - 1, [0x0e, 0x0e, 0x15], 255)
      c.rect(ox, oy + T - 2, ox + T - 1, oy + T - 2, [0x16, 0x16, 0x20], 230)
      c.rect(ox, oy + T - 3, ox + T - 1, oy + T - 3, [0x1b, 0x1b, 0x26], 160)
      // Борозды-сталактиты, врезанные в тайл снизу.
      for (const dx of [3, 9, 13]) {
        const len = 2 + Math.floor(rnd() * 2)
        c.rect(ox + dx, oy + T - 1 - len, ox + dx, oy + T - 2, [0x0d, 0x0d, 0x13], 235)
      }
    }

    // Стена (воздух сбоку): вертикальный градиент — верх ловит свет,
    // низ уходит в тень (свет сверху, референс Blasphemous).
    const gradTop = [0x43, 0x43, 0x5a]
    const gradBot = [0x18, 0x18, 0x24]
    for (const [bit, gx] of [[E, T - 1], [W, 0]]) {
      if (!(m & bit)) continue
      for (let y = 0; y < T; y++) {
        const t = y / (T - 1)
        const col = [
          Math.round(gradTop[0] + (gradBot[0] - gradTop[0]) * t),
          Math.round(gradTop[1] + (gradBot[1] - gradTop[1]) * t),
          Math.round(gradTop[2] + (gradBot[2] - gradTop[2]) * t),
        ]
        c.px(ox + gx, oy + y, col, 255)
        const inner = [
          Math.round(col[0] * 0.8), Math.round(col[1] * 0.8), Math.round(col[2] * 0.8),
        ]
        c.px(ox + (bit === E ? gx - 1 : gx + 1), oy + y, inner, 170)
      }
    }

    // Скругление внешних углов (смежные воздухи): угол «срезается» базой —
    // контур кромки не сходится в острый машинный угол.
    if (m & N && m & E) c.px(ox + T - 1, oy, stonePal.near.base, 255)
    if (m & N && m & W) c.px(ox, oy, stonePal.near.base, 255)
    if (m & S && m & E) c.px(ox + T - 1, oy + T - 1, [0x0b, 0x0b, 0x12], 255)
    if (m & S && m & W) c.px(ox, oy + T - 1, [0x0b, 0x0b, 0x12], 255)
  }

  // Слоты 20..23 — резерв: камень-1 (не используется, но валиден).
  for (let s = 20; s < 24; s++) {
    stoneSlot((s % COLS) * T, Math.floor(s / COLS) * T, stonePal.near, 141 + s, false)
  }

  c.save('tiles-cave.png')
}

/** Декор «мох» 16×16: биолюм-крап у пола (прозрачный фон). */
{
  const c = new Canvas(16, 16)
  const rnd = mulberry32(33)
  for (let i = 0; i < 26; i++) {
    const x = 1 + Math.floor(rnd() * 14)
    const y = 8 + Math.floor(rnd() * 7)
    const col = rnd() > 0.4 ? PAL.cyan : PAL.acid
    c.rect(x, y, x + 1, y + 1, col, Math.round((0.5 + rnd() * 0.5) * 255))
  }
  c.save('decor-moss.png')
}

/** Декор «кристалл» 16×16: осколок спор-кварца, растёт из пола. */
{
  const c = new Canvas(16, 16)
  const core = [0xd6, 0xb0, 0xff]
  for (let y = 3; y <= 14; y++) {
    const t = (y - 3) / 11
    const half = Math.round(1 + t * 3)
    c.rect(8 - half, y, 8 + half, y, PAL.spore, 235)
  }
  c.rect(7, 5, 9, 13, core, 200)
  c.px(8, 3, core, 255)
  c.px(8, 4, core, 230)
  c.save('decor-crystal.png')
}

/** Декор «кость» 16×16: чья-то ребровая кость на полу пещеры. */
{
  const c = new Canvas(16, 16)
  const bone = [0xd8, 0xd2, 0xc4]
  c.roundRect(3, 11, 12, 13, 2, bone, 235)
  c.roundRect(2, 10, 4, 13, 1, bone, 245)
  c.roundRect(11, 10, 13, 13, 1, bone, 245)
  c.rect(5, 12, 10, 12, [0x9a, 0x94, 0x86], 160)
  c.save('decor-bone.png')
}

// ── Шаг 5: свет и атмосфера ────────────────────────────────────────────────
// Световая маска вырезает дыры радиальной «дырой»-текстурой: плато в центре
// (мир вокруг игрока читается целиком) и мягкий спад к краям.

/** Световая дыра 256×256: плоское плато, плавный спад — для erase в маске тьмы. */
{
  const c = new Canvas(256, 256)
  c.radial(128, 128, 128, [255, 255, 255], [[0, 1], [0.45, 0.82], [1, 0]])
  c.save('light-hole.png')
}

/** Мошка 12×12: мягкая точка — спрайт силуэтной фауны тьмы. */
{
  const c = new Canvas(12, 12)
  c.radial(6, 6, 6, [255, 255, 255], [[0, 1], [0.6, 0.9], [1, 0]])
  c.save('mote.png')
}

// ── Шаг 16: ФОН-СИСТЕМА ГЛУБИНЫ (5 слоёв параллакса) ──────────────────────
// Жалоба игрока: «фоны просто полоски — убогое говно; на референсах глубина
// пещеры, ощущение что она огромная, множество разных деталей».
// Архитектура (урок VLM-итераций): ОДИН непрозрачный задник + 4 силуэтных
// слоя. Первая итерация сделала средние слои глухими — средняя стена
// закрывала собой арки и череп левиафана, глубины не было вовсе. Теперь:
//   bg-void        (непрозрачный) — бездна ЗА пещерой: градиент воздуха,
//                    гигантские светящиеся проёмы в соседние залы,
//                    светлячки-звёзды;
//   bg-megavault   (прозрачный)   — соборный масштаб в дымке: арки, череп
//                    и рёбра левиафана (Carrion), обломанные мосты-плиты
//                    (Dead Cells), колоссальные сталактитовые поля, шпили;
//   bg-midwall     (стена+окна)   — средняя стена: ОРГАНИЧЕСКИЕ волнистые
//                    страты (не полосы!), трещины, тоннельные проёмы,
//                    корни, грибные поляны, озеро — и БОЛЬШИЕ арочные
//                    ОКНА (eraseEllipse), сквозь которые видны бездна и
//                    мегаволт: глубина читается вглубь, а не вширь;
//   bg-formations  (прозрачный)   — ближние формации: двухтоновые
//                    сталактиты, кристальные веера, костища, споры;
//   silhouette-near(прозрачный)   — почти чёрные валуны-рамки у камеры.
// Приёмы против «слишком гладко» (VLM): зерно породы (noise), трещины-
// зигзаги, рваные кромки (позиционный хеш-джиттер), rim-light кромки.
// Горизонтальная бесшовность: дублирование фигур на ±W, волновые частоты —
// целое число периодов на ширину. Яркости — под вуаль тьмы 0.70.

const BGW = 1024
const BGH = 1400
const TAU = Math.PI * 2
/** Бесшовная частота: n периодов на ширину текстуры. */
const fPeriod = (n) => (TAU * n) / BGW
/** Позиционный хеш-джиттер: одна и та же величина во всех ±W копиях. */
const hashJit = (a, b, m) => (((a * 73856093) ^ (b * 19349663)) >>> 0) % m

/** Органическая страта: волнистая полоса с пинч-аутами и дизерингом краёв. */
function organicBand(c, y0, h, amp, color, alpha, phase) {
  const f1 = fPeriod(2), f2 = fPeriod(5), f3 = fPeriod(1), fh = fPeriod(3)
  for (let x = 0; x < BGW; x++) {
    const edge = y0
      + Math.sin(x * f1 + phase) * amp
      + Math.sin(x * f2 + phase * 2.7) * amp * 0.35
      + Math.sin(x * f3 + phase * 0.7) * amp * 0.85
    const hh = h * (0.82 + 0.36 * (0.5 + 0.5 * Math.sin(x * fh + phase * 1.3)))
    for (let y = Math.round(edge); y < Math.round(edge + hh); y++) {
      const dEdge = Math.min(y - edge, edge + hh - y)
      if (dEdge < 2.2 && (x * 7 + y * 13) % 5 < 2) continue
      c.px(x, y, color, alpha)
    }
  }
}

/** Свисающий корень: волнистая нить (чистые синусы — бесшовно). */
function hangRoot(c, x, y, len, sway, color, alpha, width) {
  for (let i = 0; i <= len; i++) {
    const xx = x
      + Math.sin(i * 0.055 + x * 0.13) * sway
      + Math.sin(i * 0.021 + x * 0.31) * sway * 0.6
    for (let w = 0; w < width; w++) c.px(xx + w, y + i, color, alpha)
  }
}

/** Сталактит: рваный сужающийся конус вниз (джиттер — позиционный хеш). */
function coneDown(c, x, topY, w, len, color, alpha) {
  for (let i = 0; i <= len; i++) {
    const t = i / len
    let half = Math.max(1, Math.round((w / 2) * (1 - t * t)))
    if (i > 3 && i % 4 < 2) half = Math.max(1, half - 1 - hashJit(x, topY + i, 2))
    c.rect(x - half, topY + i, x + half, topY + i, color, alpha)
  }
}

/** Массив-гора сталагмита вверх. */
function moundUp(c, x, baseY, w, h, color, alpha) {
  for (let i = 0; i <= h; i++) {
    const t = 1 - i / h
    let half = Math.max(1, Math.round((w / 2) * Math.sqrt(t)))
    if (i < h - 4 && i % 7 < 2) half = Math.max(1, half - hashJit(x, baseY - i, 2))
    c.rect(x - half, baseY - i, x + half, baseY - i, color, alpha)
  }
}

/** Костяная дуга (ребро левиафана / обломок арки): эллипс-стержень. */
function boneArc(c, cx, cy, rx, ry, thick, color, alpha) {
  for (let a = 0; a <= 90; a++) {
    const th = Math.PI + (a / 90) * Math.PI
    const x = Math.round(cx + rx * Math.cos(th))
    const y = Math.round(cy + ry * Math.sin(th))
    c.roundRect(x - thick, y - thick, x + thick, y + thick, Math.max(2, thick), color, alpha)
  }
}

/** Залитый эллипс (глазница, проём). */
function fillEllipse(c, cx, cy, rx, ry, color, alpha) {
  for (let y = -ry; y <= ry; y++) {
    const half = rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry)))
    c.rect(Math.round(cx - half), Math.round(cy + y), Math.round(cx + half), Math.round(cy + y), color, alpha)
  }
}

/** Череп левиафана: якорь масштаба «эта пещера огромная» (референс Carrion). */
function leviathanSkull(c, x, y, s, bone, dark, boneA) {
  // свод черепа
  c.roundRect(x - s, y - s * 0.9, x + s, y + s * 0.3, Math.round(s * 0.5), bone, boneA)
  // скулы по бокам
  c.roundRect(x - s * 1.15, y - s * 0.2, x - s * 0.7, y + s * 0.3, 4, bone, Math.round(boneA * 0.8))
  c.roundRect(x + s * 0.7, y - s * 0.2, x + s * 1.15, y + s * 0.3, 4, bone, Math.round(boneA * 0.8))
  // глазницы — пустая тьма
  for (const side of [-1, 1]) {
    fillEllipse(c, x + side * s * 0.45, y - s * 0.25, Math.round(s * 0.22), Math.round(s * 0.17), dark, Math.round(Math.min(255, boneA * 2.4)))
  }
  // зубы-клыки вниз
  for (let t = 0; t < 7; t++) {
    const tx = Math.round(x - s * 0.72 + (t / 6) * s * 1.44)
    coneDown(c, tx, Math.round(y + s * 0.28), Math.max(3, Math.round(s * 0.14)), Math.round(s * (t % 2 === 0 ? 0.34 : 0.22)), bone, Math.round(boneA * 0.9))
  }
}

/** Соборная арка: колонны + пологая дуга поверх (ландмарка масштаба). */
function cathedralArch(c, cx, groundY, span, height, thick, color, alpha, rim, rimA) {
  const half = span / 2
  const arcY = groundY - height
  c.roundRect(cx - half - thick, arcY + half * 0.5, cx - half, groundY, 5, color, alpha)
  c.roundRect(cx + half, arcY + half * 0.5, cx + half + thick, groundY, 5, color, alpha)
  for (let a = 0; a <= 72; a++) {
    const th = Math.PI + (a / 72) * Math.PI
    const x = Math.round(cx + (half + thick) * Math.cos(th))
    const y = Math.round(arcY + half * 0.62 * Math.sin(th))
    c.roundRect(x - thick, y - thick, x + thick, y + thick, Math.max(2, thick), color, alpha)
    if (a % 2 === 0) c.px(x - thick - 1, y, rim, rimA)
  }
}

/** Обломанный мост-плита: два пролёта с провалом (Dead Cells set piece). */
function brokenBridge(c, x, y, totalLen, thick, gap, color, alpha, rim, rimA) {
  const segLen = Math.round((totalLen - gap) / 2)
  for (const [x0, x1] of [[x - totalLen / 2, x - totalLen / 2 + segLen], [x + totalLen / 2 - segLen, x + totalLen / 2]]) {
    for (let i = 0; i <= segLen; i++) {
      const xx = x0 + i
      if (xx < x0 || xx > x1) continue
      const yy = y + Math.sin((xx) * fPeriod(4) + x) * 5
      c.rect(xx, Math.round(yy), xx, Math.round(yy + thick), color, alpha)
      if (i % 5 === 0) c.px(xx, Math.round(yy) - 1, rim, rimA)
      // поддерживающие сталактиты-свисы снизу плиты
      if (i % 24 === 12) coneDown(c, xx, Math.round(yy + thick), 7, 18 + hashJit(xx, y, 26), color, Math.round(alpha * 0.9))
    }
  }
}

/** Кристальный осколок (клин вверх от основания). */
function shard(c, x, baseY, w, h, color, alpha, lean) {
  for (let i = 0; i <= h; i++) {
    const t = i / h
    const half = Math.max(1, Math.round((w / 2) * (1 - t)))
    const xx = Math.round(x + lean * t)
    c.rect(xx - half, baseY - i, xx + half, baseY - i, color, alpha)
  }
}

/** Тоннельный проём: тёмный овал + ободок дальнего света + огонёк в глубине. */
function tunnelMouth(c, cx, cy, rx, ry, dark, alpha, rim, rimA, glow) {
  fillEllipse(c, cx, cy, rx, ry, dark, alpha)
  for (let a = 0; a <= 48; a++) {
    const th = Math.PI + (a / 48) * Math.PI
    c.px(Math.round(cx + rx * Math.cos(th)), Math.round(cy + ry * Math.sin(th)), rim, rimA)
  }
  c.radial(cx, Math.round(cy + ry * 0.15), Math.max(8, Math.round(rx * 0.55)), glow, [[0, 0.26], [0.6, 0.10], [1, 0]])
}

/** Дальнее озеро: полоса воды с волнистой кромкой + вертикальные блики. */
function farLake(c, y, h, reflections) {
  for (let x = 0; x < BGW; x++) {
    const edge = y + Math.sin(x * fPeriod(3) + 2.1) * 4 + Math.sin(x * fPeriod(7)) * 2
    for (let yy = Math.round(edge); yy < Math.round(edge + h); yy++) c.px(x, yy, [0x10, 0x13, 0x20], 235)
  }
  for (const r of reflections) {
    for (const dx of [-BGW, 0, BGW]) {
      c.rect(r.x + dx, y + 3, r.x + dx + r.w, y + 3 + r.len, [0x2e, 0x38, 0x50], r.a)
    }
  }
}

/** Вертикальная трещина: тонкий тёмный зигзаг. */
function crack(c, x, y, len, color, alpha) {
  for (let i = 0; i < len; i++) {
    if (i % 11 === 0) x += hashJit(x, y + i, 2) > 1 ? 1 : -1
    c.px(x, y + i, color, alpha)
    if (hashJit(x, y + i, 4) === 0) c.px(x + 1, y + i, color, Math.round(alpha * 0.6))
  }
}

/** Вертикальный градиент-заливка слоя. */
function gradientFill(c, top, bottom) {
  for (let y = 0; y < BGH; y++) {
    const t = y / BGH
    const col = [
      Math.round(top[0] + (bottom[0] - top[0]) * t),
      Math.round(top[1] + (bottom[1] - top[1]) * t),
      Math.round(top[2] + (bottom[2] - top[2]) * t),
    ]
    for (let x = 0; x < BGW; x++) c.px(x, y, col, 255)
  }
}

// ── Слой 0: bg-void — бездна за пещерой (единственный непрозрачный) ────────
{
  const c = new Canvas(BGW, BGH)
  const rnd = mulberry32(1601)
  gradientFill(c, [0x34, 0x3a, 0x5c], [0x1a, 0x1e, 0x34])
  // Гигантские проёмы в соседние залы: недостижимые полости со свечением.
  for (let k = 0; k < 6; k++) {
    const gx = Math.floor(rnd() * BGW)
    const gy = 150 + Math.floor(rnd() * (BGH - 420))
    const gr = 210 + Math.floor(rnd() * 130)
    for (const dx of [-BGW, 0, BGW]) {
      c.radial(gx + dx, gy, gr, [0x4c, 0x5c, 0x88], [[0, 0.24], [0.45, 0.11], [1, 0]])
      c.radial(gx + dx, gy, Math.round(gr * 0.45), [0x5a, 0x6e, 0xa0], [[0, 0.18], [1, 0]])
    }
  }
  // Тёплые карманы в глубине (VLM: палитра монохромна) — далёкие лавовые
  // жилы: холодная пещера с редкими тёплыми огнями читается живой.
  for (let k = 0; k < 4; k++) {
    const gx = Math.floor(rnd() * BGW)
    const gy = 300 + Math.floor(rnd() * (BGH - 500))
    for (const dx of [-BGW, 0, BGW]) {
      c.radial(gx + dx, gy, 90 + Math.floor(rnd() * 70), [0xaa, 0x56, 0x36], [[0, 0.18], [0.5, 0.06], [1, 0]])
    }
  }
  // Светлячки бездны: звёздная пыль далёких колоний.
  for (let k = 0; k < 200; k++) {
    const x = Math.floor(rnd() * BGW)
    const y = Math.floor(rnd() * BGH)
    const col = rnd() > 0.5 ? [0x58, 0xe6, 0xc8] : [0x8e, 0x9e, 0xd4]
    const a = Math.round(14 + rnd() * 40)
    for (const dx of [-BGW, 0, BGW]) {
      c.px(x + dx, y, col, a)
      if (a > 30) c.px(x + dx + 1, y + 1, col, Math.round(a * 0.5))
    }
  }
  c.save('bg-void.png')
}

// ── Слой 1: bg-megavault — соборный масштаб в дымке (прозрачный) ───────────
// Все фигуры — полупрозрачные силуэты поверх светящейся бездны: дальние
// формы темнее воздуха, но не такие плотные, как ближняя стена.
{
  const c = new Canvas(BGW, BGH)
  const rnd = mulberry32(1602)
  const INK = [0x12, 0x15, 0x24]
  const INK_SOFT = [0x16, 0x1a, 0x2c]
  const RIM = [0x4c, 0x56, 0x7c]
  // Соборные арки — главные ландмарки «эта пещера огромная».
  for (let a = 0; a < 3; a++) {
    const x = 160 + Math.floor(rnd() * (BGW - 320))
    const ground = Math.floor(BGH * (0.55 + rnd() * 0.3))
    const span = 250 + Math.floor(rnd() * 210)
    const height = 330 + Math.floor(rnd() * 260)
    const thick = 18 + Math.floor(rnd() * 9)
    for (const dx of [-BGW, 0, BGW]) {
      cathedralArch(c, x + dx, ground, span, height, thick, INK, 235, RIM, 110)
    }
  }
  // Обломанные мосты-плиты между арками (set piece Dead Cells).
  for (let b = 0; b < 2; b++) {
    const x = 220 + Math.floor(rnd() * (BGW - 440))
    const y = 380 + Math.floor(rnd() * 620)
    const len = 230 + Math.floor(rnd() * 140)
    for (const dx of [-BGW, 0, BGW]) {
      brokenBridge(c, x + dx, y, len, 13, 44, INK, 210, RIM, 75)
    }
  }
  // Скелет левиафана: череп + рёбра по хребту (якорь масштаба, Carrion).
  {
    const skullX = 260 + Math.floor(rnd() * (BGW - 520))
    const skullY = 480 + Math.floor(rnd() * 400)
    const s = 90 + Math.floor(rnd() * 50)
    for (const dx of [-BGW, 0, BGW]) {
      leviathanSkull(c, skullX + dx, skullY, s, [0x66, 0x63, 0x7e], [0x0c, 0x0e, 0x18], 105)
    }
    const spineX = skullX + s * 1.6
    const spineY = skullY + s * 0.3
    for (let r = 0; r < 7; r++) {
      const rx = 60 + r * 13
      const cx = spineX + r * 46
      const cy = spineY + Math.floor(rnd() * 16)
      for (const dx of [-BGW, 0, BGW]) {
        boneArc(c, cx + dx, cy, rx, rx * 0.8, 5, [0x66, 0x63, 0x7e], 120)
      }
    }
  }
  // Колоссальное сталактитовое поле с потолка (двухтоновое, рваное).
  for (let k = 0; k < 14; k++) {
    const x = Math.floor(rnd() * BGW)
    const w = 70 + Math.floor(rnd() * 110)
    const len = 300 + Math.floor(rnd() * 320)
    for (const dx of [-BGW, 0, BGW]) {
      coneDown(c, x + dx + 10, 0, w, len, INK_SOFT, 175)
      coneDown(c, x + dx, 0, w, len, INK, 240)
    }
  }
  // Шпили-башни со дна.
  for (let k = 0; k < 5; k++) {
    const x = Math.floor(rnd() * BGW)
    const w = 36 + Math.floor(rnd() * 24)
    const h = 300 + Math.floor(rnd() * 220)
    for (const dx of [-BGW, 0, BGW]) {
      moundUp(c, x + dx, BGH - 1, w, h, INK, 205)
    }
  }
  // Массивы-холмы со дна (с кромкой света слева — VLM: rim-lighting).
  for (let k = 0; k < 7; k++) {
    const x = Math.floor(rnd() * BGW)
    const w = 160 + Math.floor(rnd() * 170)
    const h = 110 + Math.floor(rnd() * 150)
    for (const dx of [-BGW, 0, BGW]) {
      moundUp(c, x + dx, BGH - 1, w, h, INK, 195)
      for (let i = 0; i <= h; i += 4) {
        const t = 1 - i / h
        const hw = Math.round((w / 2) * Math.sqrt(t))
        c.px(x + dx - hw - 1, BGH - 1 - i, RIM, 55)
      }
    }
  }
  // Короткие кристальные жилы в породе — редкие бирюзовые нити.
  for (let k = 0; k < 4; k++) {
    const x0 = Math.floor(rnd() * BGW)
    const y0 = 200 + Math.floor(rnd() * 900)
    const len = 120 + Math.floor(rnd() * 110)
    for (const dx of [-BGW, 0, BGW]) {
      let x = x0 + dx
      for (let i = 0; i < len; i++) {
        x += 0.45 + Math.sin(i * 0.07 + k) * 0.35
        c.px(x, y0 + i, [0x58, 0xe6, 0xc8], 40)
      }
    }
  }
  c.save('bg-megavault.png')
}

// ── Слой 2: bg-midwall — средняя стена с ОКНАМИ вглубь ─────────────────────
{
  const c = new Canvas(BGW, BGH)
  const rnd = mulberry32(1603)
  gradientFill(c, [0x28, 0x2d, 0x48], [0x1a, 0x1d, 0x30])
  // ОРГАНИЧЕСКИЕ страты: волнистые, с пинч-аутами — геология, не полосы.
  for (let b = 0; b < 9; b++) {
    const y0 = 60 + b * 148 + Math.floor(rnd() * 56)
    const h = 62 + Math.floor(rnd() * 70)
    const amp = 9 + rnd() * 12
    const phase = rnd() * TAU
    const col = b % 2 === 0 ? [0x44, 0x4a, 0x6e] : [0x13, 0x16, 0x26]
    organicBand(c, y0, h, amp, col, 255, phase)
  }
  // Зерно и трещины: фактура старой породы.
  c.noise(1613, [[0x30, 0x35, 0x4e], [0x14, 0x17, 0x26]], 0.22, 0.08, 0.18)
  for (let k = 0; k < 18; k++) {
    const x = Math.floor(rnd() * BGW)
    const y = 80 + Math.floor(rnd() * 900)
    const len = 90 + Math.floor(rnd() * 240)
    for (const dx of [-BGW, 0, BGW]) {
      crack(c, x + dx, y, len, [0x0d, 0x0f, 0x18], 150)
    }
  }
  // Тоннельные проёмы: тёмные ниши со огоньком в глубине.
  for (let k = 0; k < 5; k++) {
    const x = 90 + Math.floor(rnd() * (BGW - 180))
    const y = 220 + Math.floor(rnd() * 950)
    const rx = 50 + Math.floor(rnd() * 40)
    const ry = 32 + Math.floor(rnd() * 26)
    for (const dx of [-BGW, 0, BGW]) {
      tunnelMouth(c, x + dx, y, rx, ry, [0x0e, 0x10, 0x1a], 240, [0x33, 0x3d, 0x5c], 80, PAL.cyan)
    }
  }
  // Корни-занавеси: пучки свисающих нитей.
  for (let k = 0; k < 12; k++) {
    const x = Math.floor(rnd() * BGW)
    const y = 90 + Math.floor(rnd() * 820)
    const n = 3 + Math.floor(rnd() * 4)
    const roots = []
    for (let r = 0; r < n; r++) {
      roots.push({
        dx: (r - n / 2) * 5 + Math.floor(rnd() * 3),
        len: 70 + Math.floor(rnd() * 140),
        sway: 5 + rnd() * 7,
      })
    }
    for (const dx of [-BGW, 0, BGW]) {
      for (const r of roots) {
        hangRoot(c, x + dx + r.dx, y, r.len, r.sway, [0x13, 0x15, 0x22], 190, 1)
      }
    }
  }
  // Грибные поляны: россыпи биолюма (цвет — рандом cyan/purple).
  for (let k = 0; k < 7; k++) {
    const x = Math.floor(rnd() * BGW)
    const y = 260 + Math.floor(rnd() * 1000)
    const col = rnd() > 0.45 ? PAL.cyan : PAL.spore
    const dots = []
    const n = 4 + Math.floor(rnd() * 5)
    for (let d = 0; d < n; d++) {
      dots.push({ dx: (rnd() - 0.5) * 26, dy: rnd() * 7, a: Math.round(55 + rnd() * 50) })
    }
    for (const dx of [-BGW, 0, BGW]) {
      c.radial(x + dx, y, 18 + (k % 4) * 5, col, [[0, 0.16], [1, 0]])
      for (const d of dots) c.px(x + dx + d.dx, y - d.dy, col, d.a)
    }
  }
  // Дальнее озеро: тёмная вода с бликами-отражениями.
  {
    const reflections = []
    for (let r = 0; r < 26; r++) {
      reflections.push({
        x: Math.floor(rnd() * BGW),
        w: 1 + Math.floor(rnd() * 2),
        len: 4 + Math.floor(rnd() * 26),
        a: Math.round(24 + rnd() * 36),
      })
    }
    farLake(c, 1050, 34, reflections)
  }
  // Россыпи валунов у подножия.
  for (let k = 0; k < 5; k++) {
    const x = Math.floor(rnd() * BGW)
    const y = 300 + Math.floor(rnd() * 1000)
    const rocks = []
    const n = 3 + Math.floor(rnd() * 3)
    for (let r = 0; r < n; r++) {
      rocks.push({
        dx: (r - n / 2) * 16 + Math.floor(rnd() * 8),
        dy: Math.floor(rnd() * 8),
        w: 10 + Math.floor(rnd() * 16),
        h: 7 + Math.floor(rnd() * 9),
      })
    }
    for (const dx of [-BGW, 0, BGW]) {
      for (const r of rocks) {
        c.roundRect(x + dx + r.dx - r.w, y + r.dy - r.h, x + dx + r.dx + r.w, y + r.dy, 3, [0x26, 0x2a, 0x40], 230)
      }
    }
  }
  // ГЛАВНОЕ (шаг 16): арочные ОКНА — стена прорезана насквозь, сквозь
  // проёмы видны бездна и мегаволт (арки/череп/рёбра). Прорези идут
  // ПОСЛЕ всех деталей: вычищаются и страты, и трещины, и корни.
  // Параметры окон считаются ОДИН раз: прорезь и обводка обязаны совпадать.
  const windows = []
  for (let k = 0; k < 6; k++) {
    windows.push({
      x: 150 + Math.floor(rnd() * (BGW - 300)),
      y: 360 + Math.floor(rnd() * 700),
      rx: 95 + Math.floor(rnd() * 70),
      ry: 130 + Math.floor(rnd() * 90),
    })
  }
  for (const win of windows) {
    for (const dx of [-BGW, 0, BGW]) {
      c.eraseEllipse(win.x + dx, win.y, win.rx, win.ry, 1.0)
    }
  }
  // Обводка кромок окон: срез камня ловит дальний свет (читается проём).
  for (const win of windows) {
    for (const dx of [-BGW, 0, BGW]) {
      for (let a = 0; a <= 72; a += 1) {
        const th = Math.PI + (a / 72) * Math.PI
        c.px(win.x + dx + win.rx * Math.cos(th), win.y + win.ry * Math.sin(th), [0x3a, 0x42, 0x60], 70)
      }
    }
  }
  c.save('bg-midwall.png')
}

// ── Слой 3: bg-formations — ближние формации (прозрачный фон) ──────────────
{
  const c = new Canvas(BGW, BGH)
  const rnd = mulberry32(1604)
  // Большие двухтоновые сталактиты с кромкой света.
  for (let k = 0; k < 8; k++) {
    const x = Math.floor(rnd() * BGW)
    const w = 80 + Math.floor(rnd() * 90)
    const len = 280 + Math.floor(rnd() * 240)
    for (const dx of [-BGW, 0, BGW]) {
      coneDown(c, x + dx + 9, 0, w, len, [0x10, 0x13, 0x20], 210)
      coneDown(c, x + dx, 0, w, len, [0x1e, 0x22, 0x34], 245)
      // левая кромка ловит дальний свет
      for (let i = 0; i <= len; i += 4) {
        const t = i / len
        const half = Math.max(1, Math.round((w / 2) * (1 - t * t)))
        c.px(x + dx - half - 1, i, [0x36, 0x3e, 0x5a], 70)
      }
    }
  }
  // Сталагмитовые горы.
  for (let k = 0; k < 5; k++) {
    const x = Math.floor(rnd() * BGW)
    const w = 90 + Math.floor(rnd() * 110)
    const h = 140 + Math.floor(rnd() * 160)
    for (const dx of [-BGW, 0, BGW]) {
      moundUp(c, x + dx, BGH - 1, w, h, [0x1a, 0x1e, 0x2e], 240)
    }
  }
  // Кристальные веера — ярчайшие акценты фона.
  for (let k = 0; k < 12; k++) {
    const x = Math.floor(rnd() * BGW)
    const y = 300 + Math.floor(rnd() * 950)
    const col = rnd() > 0.5 ? PAL.cyan : PAL.spore
    const scale = 1.0 + rnd() * 1.0
    const shards = []
    const n = 4 + Math.floor(rnd() * 4)
    for (let s = 0; s < n; s++) {
      shards.push({
        dx: (s - n / 2) * 4 * scale,
        h: Math.round((12 + rnd() * 18) * scale),
        w: Math.max(2, Math.round(3 * scale + rnd() * 3)),
        a: Math.round(190 + rnd() * 65),
        lean: (rnd() - 0.5) * 8,
      })
    }
    for (const dx of [-BGW, 0, BGW]) {
      c.radial(x + dx, y - Math.round(10 * scale), Math.round(34 * scale), col, [[0, 0.30], [0.5, 0.13], [1, 0]])
      for (const s of shards) shard(c, x + dx + s.dx, y, s.w, s.h, col, s.a, s.lean)
    }
  }
  // Костища: череп + рёбра мелких тварей.
  for (let k = 0; k < 5; k++) {
    const x = Math.floor(rnd() * BGW)
    const y = 320 + Math.floor(rnd() * 940)
    for (const dx of [-BGW, 0, BGW]) {
      c.roundRect(x + dx - 7, y - 10, x + dx + 7, y + 1, 3, [0x55, 0x53, 0x68], 80)
      boneArc(c, x + dx + 13, y, 7, 10, 1, [0x55, 0x53, 0x68], 66)
      boneArc(c, x + dx + 24, y + 2, 6, 9, 1, [0x55, 0x53, 0x68], 56)
    }
  }
  // Споровые облака: мягкие фиолетовые дымки.
  for (let k = 0; k < 6; k++) {
    const x = Math.floor(rnd() * BGW)
    const y = 200 + Math.floor(rnd() * 1000)
    const r = 20 + Math.floor(rnd() * 28)
    for (const dx of [-BGW, 0, BGW]) {
      c.radial(x + dx, y, r, [0x6a, 0x4a, 0x9a], [[0, 0.16], [0.6, 0.07], [1, 0]])
    }
  }
  // Нити светлячков: свисающая нить с огоньками.
  for (let k = 0; k < 4; k++) {
    const x = Math.floor(rnd() * BGW)
    const y = 100 + Math.floor(rnd() * 500)
    const len = 90 + Math.floor(rnd() * 120)
    const dots = []
    const n = 3 + Math.floor(rnd() * 3)
    for (let d = 0; d < n; d++) dots.push({ t: 0.25 + (d / n) * 0.7 })
    for (const dx of [-BGW, 0, BGW]) {
      hangRoot(c, x + dx, y, len, 6, [0x2a, 0x3e, 0x38], 110, 1)
      for (const d of dots) {
        const i = Math.round(len * d.t)
        const xx = x + dx + Math.sin(i * 0.055 + (x + dx) * 0.13) * 6 + Math.sin(i * 0.021 + (x + dx) * 0.31) * 3.6
        c.px(xx, y + i, PAL.cyan, 64)
      }
    }
  }
  c.save('bg-formations.png')
}

// ── Слой 4: silhouette-near — чёрные валуны-рамки у камеры ─────────────────
{
  const c = new Canvas(BGW, BGH)
  const rnd = mulberry32(1605)
  // Валуны снизу: частично в кадре, тёмные массы перед средним планом.
  for (let k = 0; k < 7; k++) {
    const x = Math.floor(rnd() * BGW)
    const w = 240 + Math.floor(rnd() * 180)
    const h = 120 + Math.floor(rnd() * 100)
    for (const dx of [-BGW, 0, BGW]) {
      moundUp(c, x + dx, BGH - 1, w, h, [0x0c, 0x0e, 0x18], 246)
      // валун-компаньон сверху массы — гнездо, а не один холм
      moundUp(c, x + dx + Math.round(w * 0.3), BGH - 1, Math.round(w * 0.4), Math.round(h * 1.3), [0x0b, 0x0d, 0x16], 244)
      // верхняя кромка ловит свет
      const half = Math.round(w / 2)
      for (let i = 0; i <= h; i += 3) {
        const t = 1 - i / h
        const hw = Math.round(half * Math.sqrt(t))
        c.px(x + dx - hw, BGH - 1 - i, [0x24, 0x2a, 0x40], 80)
      }
    }
  }
  // Потолочные рёбра сверху.
  for (let k = 0; k < 5; k++) {
    const x = Math.floor(rnd() * BGW)
    const w = 130 + Math.floor(rnd() * 130)
    const len = 200 + Math.floor(rnd() * 160)
    for (const dx of [-BGW, 0, BGW]) {
      coneDown(c, x + dx, 0, w, len, [0x0c, 0x0e, 0x18], 246)
    }
  }
  // Толстые свисающие корни.
  for (let k = 0; k < 4; k++) {
    const x = Math.floor(rnd() * BGW)
    const len = 120 + Math.floor(rnd() * 160)
    for (const dx of [-BGW, 0, BGW]) {
      hangRoot(c, x + dx, 0, len, 9, [0x0d, 0x0f, 0x1a], 235, 3)
    }
  }
  c.save('silhouette-near.png')
}

/** Пять видов скал (шаг 12 — «сами скалы разных видов»):
 *  a — округлый валун с rim-light сверху и AO снизу;
 *  b — угловатая глыба со сколотым краем;
 *  c — россыпь мелких камней;
 *  d — высокий сталагмит-шпиль;
 *  e — треснувшая плита со светящейся жилой (редкая, ставит свечение). */
function rockBase(c, seed, opts) {
  const rnd = mulberry32(seed)
  // Rim-light: верхняя кромка ловит свет (2px полоса по верхнему краю).
  c.rect(opts.x0 + 2, opts.y0, opts.x1 - 2, opts.y0 + 1, [0x4a, 0x4a, 0x62], 190)
  // AO: нижние углы темнее — камень «сидит» в тени.
  c.rect(opts.x0, opts.y1 - 3, opts.x1, opts.y1, PAL.ink, 120)
  // Слоистое зерно.
  for (let i = 0; i < opts.grain; i++) {
    const x = opts.x0 + 2 + Math.floor(rnd() * (opts.x1 - opts.x0 - 4))
    const yy = opts.y0 + 2 + Math.floor(rnd() * (opts.y1 - opts.y0 - 4))
    const w = 1 + Math.floor(rnd() * 4)
    c.rect(x, yy, x + w, yy + 1, rnd() > 0.5 ? PAL.rockLight : PAL.rockDark, Math.round((0.2 + rnd() * 0.4) * 255))
  }
}
// a — валун.
{
  const c = new Canvas(96, 64)
  c.roundRect(2, 8, 93, 63, 14, PAL.rockDark, 255)
  c.roundRect(10, 14, 85, 56, 10, PAL.rockMid, 255)
  rockBase(c, 121, { x0: 10, y0: 14, x1: 85, y1: 56, grain: 90 })
  c.save('rock-a.png')
}
// b — угловатая глыба: стопка прямоугольников со сколами.
{
  const c = new Canvas(88, 72)
  const rnd = mulberry32(122)
  c.rect(6, 18, 78, 70, PAL.rockDark, 255)
  c.rect(14, 10, 70, 62, PAL.rockMid, 255)
  c.rect(24, 4, 58, 54, PAL.rockMid, 255)
  // Сколотые зубцы по левой кромке.
  for (let yy = 12; yy < 66; yy += 7) {
    const jx = 12 + Math.floor(rnd() * 5)
    c.rect(jx, yy, 14, yy + 3 + Math.floor(rnd() * 4), PAL.rockDark, 255)
  }
  rockBase(c, 123, { x0: 14, y0: 10, x1: 70, y1: 62, grain: 70 })
  c.save('rock-b.png')
}
// c — россыпь камней: 4 мелких валуна разного размера.
{
  const c = new Canvas(80, 40)
  const rnd = mulberry32(124)
  const blobs = [
    { x0: 4, y0: 16, x1: 30, y1: 38, r: 8 },
    { x0: 26, y0: 8, x1: 56, y1: 36, r: 9 },
    { x0: 50, y0: 20, x1: 76, y1: 38, r: 7 },
    { x0: 14, y0: 26, x1: 34, y1: 39, r: 5 },
  ]
  for (const b of blobs) {
    c.roundRect(b.x0, b.y0, b.x1, b.y1, b.r, rnd() > 0.5 ? PAL.rockDark : PAL.rockMid, 255)
    c.rect(b.x0 + 1, b.y0, b.x1 - 1, b.y0 + 1, [0x4a, 0x4a, 0x62], 170)
  }
  c.save('rock-c.png')
}
// d — сталагмит-шпиль: высокий конус с зубчатым краем.
{
  const c = new Canvas(48, 104)
  const rnd = mulberry32(125)
  const cx = 24
  for (let yy = 0; yy <= 100; yy++) {
    const t = yy / 100
    let half = Math.max(1, Math.round(20 * t + 1))
    if (yy % 8 < 2) half = Math.max(1, half - 1 - Math.floor(rnd() * 2))
    c.rect(cx - half, yy, cx + half, yy, yy % 3 ? PAL.rockDark : [0x18, 0x18, 0x24], 255)
  }
  c.rect(cx - 4, 2, cx + 4, 4, [0x4a, 0x4a, 0x62], 170)
  c.save('rock-d.png')
}
// e — плита со светящейся жилой (редкая: ~7% скал, ставит glow-близнец).
{
  const c = new Canvas(96, 64)
  c.roundRect(2, 10, 93, 63, 10, PAL.rockDark, 255)
  c.roundRect(8, 16, 88, 58, 8, [0x1e, 0x1e, 0x2e], 255)
  const rnd = mulberry32(126)
  for (let i = 0; i < 60; i++) {
    const x = 10 + Math.floor(rnd() * 78)
    const yy = 18 + Math.floor(rnd() * 36)
    c.rect(x, yy, x + 3, yy + 1, PAL.rockMid, Math.round((0.2 + rnd() * 0.35) * 255))
  }
  // Жила: ломаная линия биолюм-циана с ядром посветлее.
  let vx = 20
  let vy = 56
  for (let s = 0; s < 26; s++) {
    vx += 2 + Math.floor(rnd() * 3)
    vy -= 1 + Math.floor(rnd() * 2)
    c.px(vx, vy, PAL.cyan, 235)
    c.px(vx, vy + 1, [0x2a, 0x6e, 0x62], 190)
    if (rnd() > 0.6) c.px(vx + 1, vy, PAL.cyan, 140)
  }
  c.save('rock-e.png')
}

/** Лоза/корни с потолка 16×44: 2–3 нити с завитками и семенными
 *  коробочками — дышат (sway-твин в сцене). */
{
  const c = new Canvas(16, 44)
  const rnd = mulberry32(61)
  const strandCol = [0x24, 0x36, 0x32]
  const brightCol = [0x35, 0x5a, 0x4e]
  for (let s = 0; s < 3; s++) {
    let x = 4 + s * 4 + Math.floor(rnd() * 2)
    const len = 26 + Math.floor(rnd() * 16)
    for (let yy = 0; yy < len; yy++) {
      if (yy % 8 === 0) x += rnd() > 0.5 ? 1 : -1
      c.rect(x, yy, x, yy, strandCol, 235)
      if (yy % 5 === 2) c.rect(x + 1, yy, x + 1, yy, brightCol, 150)
    }
    // Семенная коробочка на конце — тускло светится.
    c.rect(x - 1, len - 3, x + 1, len, PAL.cyan, 90)
    c.px(x, len - 1, PAL.cyan, 160)
  }
  c.save('decor-vine.png')
}

// ── Шаг 6: боёвка, кровь, добыча ───────────────────────────────────────────
// Кровь трёхслойная: частицы (blood-drop), декали (blood-decal), съедобные
// сгустки (clot). Добыча: округлый слизень (безопасный силуэт) и угловатый
// нетопырь (опасный силуэт) — гайд, читаемость в темноте.

/** Частица крови 5×7: слеза, летит с гравитацией. */
{
  const c = new Canvas(5, 7)
  for (let y = 0; y <= 6; y++) {
    const half = y < 2 ? Math.round(y * 0.9) : Math.max(1, Math.round(2.2 - (y - 2) * 0.3))
    c.rect(2 - half, y, 2 + half, y, PAL.blood, 255)
  }
  c.rect(2, 3, 2, 5, [0xff, 0x6a, 0x78], 210)
  c.save('blood-drop.png')
}

/** Круглая декаль-клякса 16×16 (белая — красится tint'ом): неровный край. */
{
  const c = new Canvas(16, 16)
  const rnd = mulberry32(61)
  const blobs = []
  for (let i = 0; i < 5; i++) {
    blobs.push({ x: 4 + rnd() * 8, y: 4 + rnd() * 8, r: 2.2 + rnd() * 3 })
  }
  blobs.push({ x: 8, y: 8, r: 4.6 })
  for (const b of blobs) {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const d = Math.hypot(x - b.x, y - b.y)
        if (d <= b.r) {
          const a = d > b.r - 1.4 ? Math.round((1 - (d - (b.r - 1.4)) / 1.4) * 235) : 235
          c.px(x, y, [255, 255, 255], a)
        }
      }
    }
  }
  c.save('blood-decal.png')
}

/** Сгусток крови 6×6: яркая капля — подбирается как еда. */
{
  const c = new Canvas(6, 6)
  c.radial(3, 3, 3, PAL.blood, [[0, 1], [0.55, 0.9], [1, 0]])
  c.px(2, 2, [0xff, 0x8b, 0x96], 255)
  c.save('clot.png')
}

/** Мышевидный слизень 22×14: округлое тельце (безопасный силуэт), пыльный окрас. */
{
  const c = new Canvas(22, 14)
  const body = [0xb5, 0xa3, 0x9b]
  const dark = [0x77, 0x67, 0x60]
  const pale = [0xd3, 0xc4, 0xba]
  // Тело — овал с более тёмной спинкой и светлым брюхом.
  for (let y = 0; y <= 13; y++) {
    const t = (y - 6.5) / 6.5
    const half = Math.round(Math.sqrt(Math.max(0, 1 - t * t)) * 9.4)
    if (half <= 0) continue
    c.rect(11 - half, y, 11 + half, y, body, 255)
  }
  for (let x = 2; x <= 19; x++) {
    for (let y = 0; y <= 4; y++) {
      const t = Math.abs(x - 11) / 9.4
      if (1 - t * t > 0.25 + (4 - y) * 0.18) c.px(x, y, dark, 255)
    }
  }
  c.rect(4, 10, 18, 12, pale, 170)
  // Складка-морщинка (сегменты слизня).
  for (const x of [7, 12, 17]) c.rect(x, 6, x, 12, dark, 120)
  // Глазки-бусины.
  c.rect(17, 4, 18, 5, PAL.ink, 255)
  c.rect(14, 4, 15, 5, PAL.ink, 255)
  c.save('mob-slug.png')
}

/** Пещерный нетопырь 24×14: угловатые крылья-лезвия (опасный силуэт). */
{
  const c = new Canvas(24, 14)
  const wing = [0x4a, 0x46, 0x52]
  const membrane = [0x33, 0x2f, 0x3a]
  const bodyC = [0x5a, 0x54, 0x64]
  // Крылья: ломаные треугольники в обе стороны.
  for (const dir of [-1, 1]) {
    for (let i = 0; i <= 8; i++) {
      const x = 11 + dir * i
      const yTop = 6 - Math.round(Math.sin((i / 8) * Math.PI * 0.9) * 3.4)
      const yBot = 8 + Math.round(Math.sin((i / 8) * Math.PI) * 4.2)
      c.rect(x, yTop, x, yBot, i % 2 === 0 ? wing : membrane, 255)
    }
  }
  // Тело-веретено.
  for (let y = 4; y <= 9; y++) {
    const half = Math.round(2.6 * Math.sqrt(1 - ((y - 6.5) / 2.9) ** 2))
    c.rect(11 - half, y, 11 + half, y, bodyC, 255)
  }
  // Ушки-иглы.
  c.rect(10, 2, 10, 3, bodyC, 255)
  c.rect(12, 2, 12, 3, bodyC, 255)
  // Красные глазки — «угловатые опаснее».
  c.rect(12, 5, 12, 5, PAL.blood, 255)
  c.rect(10, 5, 10, 5, PAL.blood, 255)
  c.save('mob-bat.png')
}

/** Кусок мяса 8×8 — летит при чавканье. */
{
  const c = new Canvas(8, 8)
  c.roundRect(1, 2, 6, 6, 2, [0xc4, 0x6a, 0x5a], 255)
  c.rect(2, 3, 5, 4, [0x8e, 0x3b, 0x44], 220)
  c.px(3, 5, [0xe8, 0xb0, 0xa0], 200)
  c.save('meat-chunk.png')
}

/** Мутаген-кристалл 12×16 (белый — редкость красится tint'ом): растёт из пола. */
{
  const c = new Canvas(12, 16)
  const core = [255, 255, 255]
  const edge = [210, 210, 220]
  for (let y = 2; y <= 14; y++) {
    const t = Math.abs(y - 7) / 5
    const half = Math.max(1, Math.round((1 - t) * 4.6))
    c.rect(6 - half, y, 6 + half, y, edge, 235)
  }
  c.rect(5, 4, 7, 12, core, 255)
  c.px(6, 2, core, 255)
  c.px(6, 3, core, 240)
  // Основание — у пола.
  c.rect(3, 14, 8, 14, edge, 200)
  c.save('mutation-gem.png')
}

// ── Шаг 7: мобы живой экосистемы ───────────────────────────────────────────
// Читаемость силуэтов (гайд §7): «округлые безопаснее, угловатые опаснее».
// Жнец — округлая мантия + угловатая бахрома; кровосос — тощий, острая пасть;
// панцирь — купол с ржавыми кромками; ползун — низкий, зазубренная спина.

/** Споровый жнец 20×26: худой гриб-сторож в мантии из спор (опасный). */
{
  const c = new Canvas(20, 26)
  const mantle = [0x6a, 0x4a, 0x8a]
  const mantleDark = [0x46, 0x2e, 0x60]
  const stem = [0x8a, 0x76, 0x9a]
  // Шляпка-капюшон (округлая верхушка).
  for (let y = 0; y <= 7; y++) {
    const half = Math.round(Math.sqrt(Math.max(0, 1 - ((y - 7) / 7) ** 2)) * 8.6)
    c.rect(10 - half, y, 10 + half, y, mantle, 255)
  }
  // Бахрома-лезвия по краю шляпки (угловатость = опасность).
  for (let i = 0; i < 5; i++) {
    const x = 2 + i * 4
    c.rect(x, 7, x, 11 + (i % 2) * 2, mantleDark, 255)
  }
  // Тело-стебель.
  for (let y = 10; y <= 24; y++) {
    const half = Math.max(2, Math.round(4.4 * (1 - (y - 10) / 18)))
    c.rect(10 - half, y, 10 + half, y, stem, 255)
  }
  // Споровые точки на мантии.
  const rnd = mulberry32(71)
  for (let i = 0; i < 10; i++) {
    c.px(4 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 6), PAL.spore, 230)
  }
  // Глазки — две щели в тени капюшона.
  c.rect(7, 9, 8, 10, PAL.ink, 255)
  c.rect(11, 9, 12, 10, PAL.ink, 255)
  c.save('mob-reaper.png')
}

/** Кровосос 22×14: тощий полупрозрачный пиявщик с пастью (опасный). */
{
  const c = new Canvas(22, 14)
  const flesh = [0x8a, 0x3a, 0x46]
  const fleshDark = [0x5e, 0x22, 0x30]
  const pale = [0xc4, 0x74, 0x7e]
  // Тело — вытянутая капля.
  for (let y = 2; y <= 11; y++) {
    const t = (y - 6.5) / 4.5
    const half = Math.round(Math.sqrt(Math.max(0, 1 - t * t)) * 8.2)
    if (half <= 0) continue
    c.rect(9 - half, y, 9 + half, y, flesh, 255)
  }
  // Хвостовой плавник (угловатый).
  c.rect(1, 6, 4, 7, fleshDark, 255)
  c.rect(2, 4, 3, 5, fleshDark, 220)
  // Спинные шипы.
  for (const x of [6, 10, 14]) c.rect(x, 1, x, 3, fleshDark, 255)
  // Брюхо-просвет (полупрозрачность сытости).
  c.rect(5, 8, 14, 10, pale, 140)
  // Пасть на треть тела: раскрытые створки с зубами.
  c.rect(15, 5, 21, 8, fleshDark, 255)
  c.rect(17, 6, 21, 7, PAL.ink, 255)
  for (const x of [17, 19, 21]) c.rect(x, 6, x, 6, [0xe8, 0xd0, 0xc8], 255)
  // Глаз-бусина на бугре.
  c.rect(12, 4, 12, 4, [0xff, 0xd9, 0xdc], 255)
  c.save('mob-bloodsucker.png')
}

/** Бронепанцирь 26×18: купол окаменевшей брони (танк; ржавые кромки). */
{
  const c = new Canvas(26, 18)
  const shell = [0x6e, 0x6a, 0x5c]
  const shellDark = [0x4a, 0x46, 0x3c]
  const rust = [0x8a, 0x5a, 0x3a]
  // Купол.
  for (let y = 2; y <= 15; y++) {
    const t = (y - 2) / 13
    const half = Math.round(Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t))) * 11.6)
    if (half <= 0) continue
    c.rect(13 - half, y, 13 + half, y, shell, 255)
  }
  // Верхняя дуга темнее (объём).
  for (let x = 4; x <= 21; x++) {
    for (let y = 2; y <= 6; y++) {
      const t = Math.abs(x - 13) / 9.6
      if (1 - t * t > 0.3 + (6 - y) * 0.14) c.px(x, y, shellDark, 255)
    }
  }
  // Ржавые кромки-пластины (вертикальные швы).
  for (const x of [6, 10, 13, 16, 20]) {
    c.rect(x, 4, x, 15 - Math.abs(x - 13) / 3, rust, 210)
  }
  // Плоское основание-юбка.
  c.rect(2, 14, 23, 16, shellDark, 255)
  c.rect(3, 16, 22, 16, PAL.ink, 160)
  // Щель-глаз спереди (единственный признак жизни).
  c.rect(20, 9, 22, 10, PAL.acid, 255)
  c.save('mob-shell.png')
}

/** Лавовый ползун 24×14: низкий, зазубренная спина, янтарные щели (опасный). */
{
  const c = new Canvas(24, 14)
  const hide = [0x4a, 0x3a, 0x34]
  const hideDark = [0x30, 0x24, 0x20]
  const ember = [0xe2, 0x76, 0x3a]
  const emberHot = [0xff, 0xc4, 0x8a]
  // Низкое широкое тело.
  for (let y = 4; y <= 12; y++) {
    const t = (y - 4) / 8
    const half = Math.round((0.55 + t * 0.45) * 10.4)
    c.rect(11 - half, y, 11 + half, y, hide, 255)
  }
  // Зазубренная спина (угловатость = опасность).
  for (let i = 0; i < 6; i++) {
    const x = 3 + i * 4
    const h = i % 2 === 0 ? 3 : 2
    c.rect(x, 4 - h, x + 1, 4, hideDark, 255)
  }
  // Янтарные щели между пластинами.
  for (const x of [5, 9, 13, 17]) {
    c.rect(x, 6, x, 11, ember, 255)
    c.px(x, 7, emberHot, 255)
    c.px(x, 9, emberHot, 220)
  }
  // Брюхо темнее.
  c.rect(4, 11, 20, 12, hideDark, 220)
  // Глаз-угольки.
  c.rect(18, 7, 19, 7, emberHot, 255)
  c.rect(15, 7, 16, 7, emberHot, 255)
  c.save('mob-lava.png')
}

/** Споровый снаряд 10×10: светящийся шарик с ореолом (жнец). */
{
  const c = new Canvas(10, 10)
  c.radial(5, 5, 5, PAL.spore, [[0, 1], [0.4, 0.85], [1, 0]])
  c.px(4, 4, [0xf0, 0xdc, 0xff], 255)
  c.px(5, 5, [0xf0, 0xdc, 0xff], 220)
  c.save('spore-bolt.png')
}

/** Лужа огня 16×12: рваное пламя (лавовый след; красится в коде). */
{
  const c = new Canvas(16, 12)
  const base = [0xff, 0x8a, 0x3a]
  const hot = [0xff, 0xd4, 0x8a]
  const rnd = mulberry32(72)
  // Рваное основание лужи.
  for (let x = 1; x <= 14; x++) {
    const h = 4 + Math.round(rnd() * 4)
    c.rect(x, 12 - h, x, 11, base, 235)
  }
  // Языки пламени.
  for (const x of [4, 7, 10, 12]) {
    const h = 5 + Math.round(rnd() * 4)
    c.rect(x, 11 - h, x, 8, base, 255)
    c.rect(x, 10, x, 11, hot, 255)
  }
  // Горячее ядро.
  c.rect(6, 9, 9, 11, hot, 245)
  c.save('fire-patch.png')
}

/** Кольцо шума 64×64 (белый контур — красится tint'ом вида): «звук» в темноте. */
{
  const c = new Canvas(64, 64)
  const r = 30
  const cx = 32
  const cy = 32
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d <= r && d >= r - 2.2) {
        const a = Math.round(255 * Math.min(1, (d - (r - 2.2)) / 1.4))
        c.px(x, y, [255, 255, 255], a)
      }
    }
  }
  c.save('ring.png')
}

/** Искра 6×6: яркий ромбик для juice-бёрстов (шаг 9; красится tint'ом). */
{
  const c = new Canvas(6, 6)
  c.px(2, 0, [255, 255, 255], 255)
  c.px(1, 1, [255, 255, 255], 240)
  c.px(2, 1, [255, 255, 255], 255)
  c.px(3, 1, [255, 255, 255], 240)
  c.px(0, 2, [255, 255, 255], 210)
  c.px(1, 2, [255, 255, 255], 255)
  c.px(2, 2, [255, 255, 255], 255)
  c.px(3, 2, [255, 255, 255], 255)
  c.px(4, 2, [255, 255, 255], 210)
  c.px(1, 3, [255, 255, 255], 240)
  c.px(2, 3, [255, 255, 255], 255)
  c.px(3, 3, [255, 255, 255], 240)
  c.px(2, 4, [255, 255, 255], 200)
  c.save('spark.png')
}

console.log('Готово: assets/ обновлён (детерминированно, seed=20261027).')

// ── Шаг 13: пыль приземления и столб света ─────────────────────────────────

/** Пыль 18×18: мягкий серый клуб — частицы жёсткого приземления (Carrion-джус). */
{
  const c = new Canvas(18, 18)
  c.radial(9, 9, 9, [0x8a, 0x88, 0x94], [[0, 0.9], [0.5, 0.5], [1, 0]])
  const rnd = mulberry32(1313)
  for (let i = 0; i < 14; i++) {
    const x = 2 + Math.floor(rnd() * 14)
    const y = 2 + Math.floor(rnd() * 14)
    c.px(x, y, [0x6a, 0x68, 0x74], 140)
  }
  c.save('dust.png')
}

/**
 * Столб света 96×320 (Dead Cells/Hidden Deep): вертикальный луч из трещины
 * в потолке — у верха узкий и плотный, внизу шире и тает. Горизонтальный
 * профиль — колокол (яркая ось, мягкие края), вертикальный — затухание к полу.
 * Тонируется цветом биома; рисуется ADD поверх маски тьмы.
 */
{
  const W = 96
  const H = 320
  const c = new Canvas(W, H)
  for (let y = 0; y < H; y++) {
    // Расширение к низу (трапеция) + общий спад силы к полу.
    const spread = 0.34 + 0.66 * (y / H)
    const vFade = 1 - 0.55 * (y / H)
    for (let x = 0; x < W; x++) {
      const nx = (x / W - 0.5) / spread
      const bell = Math.exp(-nx * nx * 7)
      const a = Math.round(255 * bell * vFade)
      if (a > 6) c.px(x, y, [255, 255, 255], a)
    }
  }
  c.save('light-shaft.png')
}
