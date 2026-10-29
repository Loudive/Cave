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
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
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

  /** Шаг 22: органичная клякса — эллипс с шумовым смещением кромки
   *  (никаких roundRect-валунов: «неизвестные тёмные фигуры»). */
  organicBlob(cx, cy, rx, ry, color, a, seed, opts = {}) {
    const harm = blobHarmonics(seed, opts.amp ?? 0.1, opts.harmN ?? 4)
    const maxX = Math.ceil(rx * 1.4)
    const maxY = Math.ceil(ry * 1.4)
    for (let y = cy - maxY; y <= cy + maxY; y++) {
      for (let x = cx - maxX; x <= cx + maxX; x++) {
        const r = Math.hypot(x - cx, y - cy)
        if (r > Math.max(rx, ry) * 1.3) continue
        const th = Math.atan2(y - cy, x - cx)
        if (r <= blobRe(th, rx, ry) * blobR(th, harm)) this.px(x, y, color, a)
      }
    }
  }

  /** Полоса ВДОЛЬ силуэта (rim-light сверху / AO снизу): от кромки внутрь
   *  по радиусу; гармонии по тому же сиду, что у кляксы — кромка совпадает. */
  edgeBand(cx, cy, rx, ry, seed, opts) {
    const { color, a, from, to, depth = 2, amp = 0.1, harmN = 4 } = opts
    const harm = blobHarmonics(seed, amp, harmN)
    for (let d = 0; d < 720; d++) {
      const th = (d / 720) * Math.PI * 2
      if (th < from || th > to) continue
      const R = blobRe(th, rx, ry) * blobR(th, harm)
      for (let k = 0; k < depth; k++) {
        const rr = R - k - 1
        this.px(Math.round(cx + rr * Math.cos(th)), Math.round(cy + rr * Math.sin(th)), color, a)
      }
    }
  }

  /** Настоящий скол: прямое обнуление альфы внутри круга у кромки. */
  cut(cx, cy, r) {
    for (let y = Math.floor(cy - r); y <= cy + r; y++) {
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue
        if (Math.hypot(x - cx, y - cy) <= r) this.data[(y * this.w + x) * 4 + 3] = 0
      }
    }
  }

  /** Зерно ТОЛЬКО внутри силуэта (клип по альфе — никакой крошки вокруг). */
  grainClipped(seed, n, cols) {
    const rnd = mulberry32(seed)
    for (let i = 0; i < n; i++) {
      const x = 2 + Math.floor(rnd() * (this.w - 4))
      const y = 2 + Math.floor(rnd() * (this.h - 4))
      if (this.data[(y * this.w + x) * 4 + 3] < 200) continue
      const col = cols[Math.floor(rnd() * cols.length)]
      const w = 1 + Math.floor(rnd() * 4)
      for (let dx = 0; dx < w; dx++) {
        const xx = Math.min(this.w - 1, x + dx)
        if (this.data[(y * this.w + xx) * 4 + 3] < 200) continue
        this.px(xx, y, col, Math.round((0.2 + rnd() * 0.4) * 255))
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

// ── Шаг 16-17: ФОН-СИСТЕМА ГЛУБИНЫ (5 слоёв параллакса) ────────────────────
// Жалоба игрока: «фоны просто полоски — убогое говно; на референсах глубина
// пещеры, ощущение что она огромная, множество разных деталей». Шаг 17:
// «полоски на фоне» — волнистые страты средней стены читались горизонталь-
// ными ЛЕНТАМИ; стена перестроена под ВЕРТИКАЛЬНУЮ геометрию.
// Архитектура (урок VLM-итераций): ОДИН непрозрачный задник + 4 силуэтных
// слоя. Первая итерация сделала средние слои глухими — средняя стена
// закрывала собой арки и череп левиафана, глубины не было вовсе. Теперь:
//   bg-void        (непрозрачный) — бездна ЗА пещерой: градиент воздуха,
//                    гигантские светящиеся проёмы в соседние залы,
//                    светлячки-звёзды;
//   bg-megavault   (прозрачный)   — соборный масштаб в дымке: арки, череп
//                    и рёбра левиафана (Carrion), обломанные мосты-плиты
//                    (Dead Cells), колоссальные сталактитовые поля, шпили;
//   bg-midwall     (силуэт+окна) — ШАГ 17: задняя стена зала БЕЗ лент —
//                    потолочный свод с ГУСТЫМ полем сталактитов, пол со
//                    сталагмитами и озером, 5 колонн (вертикальный ритм
//                    собора), 10 выступов-обломков на своих высотах;
//                    воздух между структурами ПРОЗРАЧЕН — бездна и
//                    мегаволт видны везде, 8 арочных окон режут стену
//                    насквозь: глубина читается ВГЛУБЬ, а не вширь;
//   bg-formations  (прозрачный)   — ближние формации: двухтоновые
//                    сталактиты, кристальные веера, костища, споры;
//   silhouette-near(прозрачный)   — почти чёрные валуны-рамки у камеры.
// Приёмы против «слишком гладко» (VLM): зерно породы (noise), трещины-
// зигзаги, рваные кромки (позиционный хеш-джиттер), rim-light кромки.
// Горизонтальная бесшовность: дублирование фигур на ±W, волновые частоты —
// целое число периодов на ширину. Яркости — под вуаль тьмы 0.62.

const BGW = 1024
// Шаг 17: 1400 → 1600 — вертикальный wrap тайла убит расчётом: максимум
// tilePositionY (scrollY 6884 × фактор 0.14) + высота кадра 540 = 1504 < 1600,
// иначе «потолок» текстуры вылезал снизу кадра на максимальной глубине.
const BGH = 1600
const TAU = Math.PI * 2
/** Бесшовная частота: n периодов на ширину текстуры. */
const fPeriod = (n) => (TAU * n) / BGW
/** Позиционный хеш-джиттер: одна и та же величина во всех ±W копиях.
 *  Шаг 17.2: первый аргумент сворачивается в [0, BGW) — рваные края/пунктиры
 *  фигур, ПЕРЕСЕКАЮЩИХ шов тайла, теперь пиксельно совпадают с копиями
 *  (раньше совпадали только позиции фигур, но не их внутренний джиттер). */
const hashJit = (a, b, m) => ((((((a % BGW) + BGW) % BGW) * 73856093) ^ (b * 19349663)) >>> 0) % m

/** Шаг 17: СВЕТОВОЙ ЛУЧ — вертикальный мягкий столб (бог-рей из далёкого
 *  провала в бездне): верх ярче, кромки горизонтальным затуханием. */
function lightBeam(c, x, y, w, len, color, aTop) {
  for (let yy = 0; yy < len; yy++) {
    const t = yy / len
    const a = aTop * (1 - t) * (1 - t)
    const hw = Math.round((w / 2) * (1 - t * 0.4))
    for (let xx = -hw; xx <= hw; xx++) {
      const fx = 1 - Math.abs(xx) / (hw + 1)
      c.px(x + xx, y + yy, color, Math.round(a * fx))
    }
  }
}

/** Шаг 17: ЛИНЗА-СТРАТА — короткое линзовидное наслоение ВНУТРИ формы
 *  (толще к центру, заплывает на нет у краёв). Геология читается, но
 *  макро-полос на весь экран больше НЕТ: каждая линза ограничена шириной
 *  своего выступа/колонны. */
function lensStrata(c, x, y0, y1, maxHalf, color, alpha, seed) {
  const n = 2 + hashJit(seed, 3, 3)
  for (let i = 0; i < n; i++) {
    const ly = y0 + ((i + 0.5) / n) * (y1 - y0)
    const lh = 6 + hashJit(seed, i, 12)
    const f = fPeriod(2 + hashJit(seed, i, 3))
    for (let xx = -maxHalf; xx <= maxHalf; xx++) {
      const t = 1 - Math.abs(xx) / (maxHalf + 1)
      const hh = lh * t
      const off = Math.sin(xx * f + i * 2.1) * 4
      for (let yy = -hh; yy <= hh; yy++) {
        c.px(x + xx, Math.round(ly + yy + off), color, Math.round(alpha * (0.45 + 0.55 * t)))
      }
    }
  }
}

/** Шаг 17: КОЛОННА — вертикальный простенок свода (главный ритм стены):
 *  рваные края (позиционный хеш), органическое перехватывание, вертикальные
 *  желоба-натёки, линз-страты внутри, кромка дальнего света сбоку. */
function rockColumn(c, x, topY, botY, w, core, face, rim) {
  const half0 = w / 2
  for (let y = Math.round(topY); y <= botY; y++) {
    const t = (y - topY) / (botY - topY || 1)
    const pinch = 1 - 0.16 * Math.sin(t * Math.PI)
    const half = Math.max(4, Math.round(half0 * pinch + hashJit(x, y, 7) - 3))
    c.rect(x - half, y, x + half, y, core, 250)
    // освещённая грань слева (дальний свет бездны)
    c.px(x - half, y, face, 150)
    c.px(x - half - 1, y, rim, 60)
  }
  // натёки-желоба: вертикальные тёмные нити по телу колонны
  for (let f = 0; f < 3; f++) {
    const fx = x - half0 * 0.4 + (f / 2) * half0 * 0.8
    for (let y = Math.round(topY + 20); y < botY - 12; y += 1) {
      if ((y + f * 5) % 17 < 3) continue
      const xx = Math.round(fx + Math.sin(y * 0.02 + f) * 3)
      c.px(xx, y, [0x0c, 0x0e, 0x18], 120)
    }
  }
  lensStrata(c, x, topY + (botY - topY) * 0.18, topY + (botY - topY) * 0.82, half0 * 0.8, [0x0e, 0x11, 0x1e], 130, x)
}

/** Шаг 17: ВЫСТУП-ОБЛОМОК — неровная масса породы: кластер наложенных
 *  скруглённых блоков с позиционным джиттером (НЕ полоса: ширина 140-320,
 *  живёт сама по себе на своей высоте). Сверху — кромка света, внутри —
 *  линз-страты, снизу — свисы. */
function rockOutcrop(c, cx, cy, w, h, core, face, rim, seed) {
  const lumps = 4 + hashJit(seed, 1, 4)
  for (let l = 0; l < lumps; l++) {
    const lw = Math.round((w * (0.42 + hashJit(seed, l * 3 + 2, 30) / 100)) / 2)
    const lh = Math.round(h * (0.36 + hashJit(seed, l * 3 + 3, 34) / 100))
    const ox = cx + (hashJit(seed, l * 3 + 4, Math.max(9, w)) - w / 2) * 0.7
    const oy = cy + (hashJit(seed, l * 3 + 5, Math.max(9, h)) - h / 2) * 0.6
    c.roundRect(ox - lw, oy - lh, ox + lw, oy + lh, Math.max(6, Math.round(lw * 0.7)), core, 246)
  }
  // кромка света поверх верхней грани — ПУНКТИРНАЯ (шаг 17.2: сплошная
  // линия читалась горизонтальной «полкой»-лентой): точки с хеш-пропусками
  // и волной, плюс бахрома мелких зубцов под кромкой
  for (let x = Math.round(cx - w / 2); x <= cx + w / 2; x += 2) {
    if (hashJit(x, seed, 4) === 0) continue
    const ry = Math.round(cy - h * 0.42 + Math.sin(x * fPeriod(3) + seed) * 5)
    c.px(x, ry, face, 120)
    c.px(x, ry - 1, rim, 55)
    if (hashJit(x, seed + 3, 9) < 2) coneDown(c, x, ry + 2, 4, 10 + hashJit(x, seed + 5, 14), core, 200)
  }
  lensStrata(c, cx, cy - h * 0.3, cy + h * 0.3, w * 0.36, [0x0e, 0x11, 0x1e], 120, seed + 7)
  // свисы снизу — порода продолжает капать
  for (let d = 0; d < 3; d++) {
    const dx = cx - w * 0.25 + (d / 2) * w * 0.5
    coneDown(c, Math.round(dx), Math.round(cy + h * 0.3), 10 + hashJit(seed, d, 14), 26 + hashJit(seed, d + 9, 40), core, 220)
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

/** Дальнее озеро: полоса воды с волнистой кромкой + вертикальные блики.
 *  Шаг 17.2: x0..x1 — вода живёт НА массиве пола, не на всю ширину. */
function farLake(c, y, h, x0, x1, reflections) {
  for (let x = x0; x <= x1; x++) {
    const edge = y + Math.sin(x * fPeriod(3) + 2.1) * 4 + Math.sin(x * fPeriod(7)) * 2
    for (let yy = Math.round(edge); yy < Math.round(edge + h); yy++) c.px(x, yy, [0x10, 0x13, 0x20], 235)
  }
  for (const r of reflections) {
    for (const dx of [-BGW, 0, BGW]) {
      if (r.x + dx < x0 || r.x + dx > x1) continue
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
      // Шаг 17: бог-рей — из далёкого проёма вниз падает мягкий столб света
      // (VLM: не хватало атмосферных эффектов; референс — свет из провала)
      lightBeam(c, gx + dx - Math.round(gr * 0.25), gy + Math.round(gr * 0.2), Math.round(gr * 0.34), Math.round(gr * 1.5), [0x5e, 0x72, 0xa8], 0.10)
      lightBeam(c, gx + dx + Math.round(gr * 0.3), gy + Math.round(gr * 0.1), Math.round(gr * 0.2), Math.round(gr * 1.1), [0x5e, 0x72, 0xa8], 0.07)
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
  // Шаг 17 (воздушная перспектива): мегаволт — ДАЛЬНИЙ план, уводится в
  // дымку — светлее и полупрозрачнее средней стены (раньше был глухим INK
  // и читался второй занавеской перед бездной, VLM: «плоские занавески»).
  const INK = [0x20, 0x25, 0x3c]
  const INK_SOFT = [0x26, 0x2c, 0x46]
  const RIM = [0x4c, 0x56, 0x7c]
  // Соборные арки — главные ландмарки «эта пещера огромная».
  for (let a = 0; a < 3; a++) {
    const x = 160 + Math.floor(rnd() * (BGW - 320))
    const ground = Math.floor(BGH * (0.55 + rnd() * 0.3))
    const span = 250 + Math.floor(rnd() * 210)
    const height = 330 + Math.floor(rnd() * 260)
    const thick = 18 + Math.floor(rnd() * 9)
    for (const dx of [-BGW, 0, BGW]) {
      cathedralArch(c, x + dx, ground, span, height, thick, INK, 168, RIM, 95)
    }
  }
  // Обломанные мосты-плиты между арками (set piece Dead Cells).
  for (let b = 0; b < 2; b++) {
    const x = 220 + Math.floor(rnd() * (BGW - 440))
    const y = 380 + Math.floor(rnd() * 620)
    const len = 230 + Math.floor(rnd() * 140)
    for (const dx of [-BGW, 0, BGW]) {
      brokenBridge(c, x + dx, y, len, 13, 44, INK, 150, RIM, 66)
    }
  }
  // Скелет левиафана: череп + рёбра по хребту (якорь масштаба, Carrion).
  {
    const skullX = 260 + Math.floor(rnd() * (BGW - 520))
    const skullY = 480 + Math.floor(rnd() * 400)
    const s = 90 + Math.floor(rnd() * 50)
    for (const dx of [-BGW, 0, BGW]) {
      leviathanSkull(c, skullX + dx, skullY, s, [0x6e, 0x6b, 0x88], [0x1a, 0x1e, 0x30], 92)
    }
    const spineX = skullX + s * 1.6
    const spineY = skullY + s * 0.3
    for (let r = 0; r < 7; r++) {
      const rx = 60 + r * 13
      const cx = spineX + r * 46
      const cy = spineY + Math.floor(rnd() * 16)
      for (const dx of [-BGW, 0, BGW]) {
        boneArc(c, cx + dx, cy, rx, rx * 0.8, 5, [0x6e, 0x6b, 0x88], 100)
      }
    }
  }
  // Колоссальное сталактитовое поле с потолка (двухтоновое, рваное).
  for (let k = 0; k < 14; k++) {
    const x = Math.floor(rnd() * BGW)
    const w = 70 + Math.floor(rnd() * 110)
    const len = 300 + Math.floor(rnd() * 320)
    for (const dx of [-BGW, 0, BGW]) {
      coneDown(c, x + dx + 10, 0, w, len, INK_SOFT, 125)
      coneDown(c, x + dx, 0, w, len, INK, 172)
    }
  }
  // Шпили-башни со дна.
  for (let k = 0; k < 5; k++) {
    const x = Math.floor(rnd() * BGW)
    const w = 36 + Math.floor(rnd() * 24)
    const h = 300 + Math.floor(rnd() * 220)
    for (const dx of [-BGW, 0, BGW]) {
      moundUp(c, x + dx, BGH - 1, w, h, INK, 150)
    }
  }
  // Массивы-холмы со дна (с кромкой света слева — VLM: rim-lighting).
  for (let k = 0; k < 7; k++) {
    const x = Math.floor(rnd() * BGW)
    const w = 160 + Math.floor(rnd() * 170)
    const h = 110 + Math.floor(rnd() * 150)
    for (const dx of [-BGW, 0, BGW]) {
      moundUp(c, x + dx, BGH - 1, w, h, INK, 142)
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

// ── Слой 2: bg-midwall — задняя стена зала: СВОД + КОЛОННЫ + ВЫСТУПЫ ─────────
// Шаг 17 (жалоба «полоски на фоне»): волнистые страты на всю ширину читались
// ГОРИЗОНТАЛЬНЫМИ ЛЕНТАМИ. Стена полностью перестроена под ВЕРТИКАЛЬНУЮ
// геометрию — воздух между структурами прозрачен (принцип шага 16: один
// непрозрачный задник = bg-void, остальные слои — силуэты с прорезями):
//   • ПОТОЛОЧНЫЙ СВОД — масса породы от y=0 до волнистой кромки + ГУСТОЕ
//     поле сталактитов трёх масштабов (референс: плотные сосульки) + корни;
//   • ПОЛ — масса с волнистой кромкой + сталагмитовые горы + валунная
//     осыпь + дальнее озеро во впадине;
//   • КОЛОННЫ (5) — вертикальный ритм собора: три в полный рост, одна
//     свисает со свода, одна растёт с пола; рваные края, натёки-желоба;
//   • ВЫСТУПЫ-ОБЛОМКИ (10) — неровные массы на своих высотах: стена
//     «дышит» объёмом, лент нет вовсе;
//   • Детали: тоннельные проёмы, грибные поляны, костища, нити светлячков;
//   • ОКНА (8) — арочные прорези eraseEllipse сквозь ВСЁ: бездна и
//     мегаволт (арки/череп/мосты) видны ВГЛУБЬ, глубина не только вширь.
{
  const c = new Canvas(BGW, BGH)
  const rnd = mulberry32(1703)
  const CORE = [0x18, 0x1c, 0x30]   // тело породы (плотнее дальнего INK)
  const FACE = [0x2b, 0x31, 0x52]   // освещённая грань
  const DARKCORE = [0x11, 0x14, 0x24]
  const RIM = [0x4a, 0x54, 0x80]    // кромка дальнего света

  // ── 1. ПОТОЛОЧНЫЕ СВОДЫ-СЕГМЕНТЫ (шаг 17.2): сплошной свод на всю ширину
  // сам превращался в «полосу», когда камера выравнивалась с ним. Теперь
  // свод = 3 массива-засечки с ПРОЁМАМИ между ними: в проёмах видна бездна
  // сверху, силуэт потолка — глубоко зубчатый (густая бахрома + корни).
  // Сегмент A [0..360] стыкуется с сегментом C [940..1024] через шов тайла.
  const CEIL_SEGS = [
    // t A == t C: кромка на шве тайла непрерывна (bump=0 на обоих концах)
    { x0: 0, x1: 360, t: 150 },
    { x0: 480, x1: 860, t: 196 },
    { x0: 940, x1: BGW, t: 150 },
  ]
  const ceilEdge = (x) => {
    for (const s of CEIL_SEGS) {
      if (x >= s.x0 && x <= s.x1) {
        // линза-свод: толще к центру сегмента (нервюрная арка)
        const local = (x - s.x0) / (s.x1 - s.x0)
        const bump = Math.sin(local * Math.PI)
        return 78 + s.t * (0.42 + 0.58 * bump)
          + Math.sin(x * fPeriod(5) + 0.4) * 12
          + Math.sin(x * fPeriod(9) + 2.2) * 6
      }
    }
    return -1 // проём: потолка нет
  }
  for (let x = 0; x < BGW; x++) {
    const e = Math.round(ceilEdge(x))
    if (e < 0) continue
    c.rect(x, 0, x, e, CORE, 252)
    c.rect(x, e - 14, x, e, FACE, 170)
  }
  // ГУСТОЕ поле сталактитов ТРЁХ масштабов: гиганты-своды под сегментами,
  // в проёмах — плотная висячая бахрома от кромки шва (свет сочится сверху).
  for (const dx of [-BGW, 0, BGW]) {
    let xg = 60
    while (xg < BGW - 30) {
      const e = ceilEdge(xg)
      if (e > 0) {
        const len = 230 + hashJit(xg, 11, 200)
        coneDown(c, xg + dx, Math.round(e) - 14, 52 + hashJit(xg, 12, 44), len, CORE, 250)
        coneDown(c, xg + dx + 12, Math.round(e) - 8, 34 + hashJit(xg, 13, 26), Math.round(len * 0.55), FACE, 140)
      } else {
        // проём: зубцы висят с самого верха шва — глубоко зубчатый профиль
        coneDown(c, xg + dx, 4, 46 + hashJit(xg, 12, 40), 130 + hashJit(xg, 11, 160), CORE, 245)
      }
      xg += 140 + hashJit(xg, 14, 120)
    }
    for (let xm = 18; xm < BGW; xm += 34 + hashJit(xm, 21, 26)) {
      const e = ceilEdge(xm)
      coneDown(c, xm + dx, Math.max(2, Math.round(e) - 4), 14 + hashJit(xm, 22, 18), 90 + hashJit(xm, 23, 130), CORE, 244)
    }
    for (let xf = 6; xf < BGW; xf += 11 + hashJit(xf, 31, 8)) {
      const e = ceilEdge(xf)
      coneDown(c, xf + dx, Math.max(1, Math.round(e) - 2), 6 + hashJit(xf, 32, 7), 26 + hashJit(xf, 33, 64), DARKCORE, 235)
    }
  }
  // Корни-занавеси (в проёмах — гуще: свисают из мира над бездной).
  for (let k = 0; k < 10; k++) {
    const x = 40 + Math.floor(rnd() * (BGW - 80))
    const e = ceilEdge(x)
    const y = e > 0 ? Math.round(e) - 6 : 8
    const n = 3 + Math.floor(rnd() * 4)
    const roots = []
    for (let r = 0; r < n; r++) {
      roots.push({
        dx: (r - n / 2) * 5 + Math.floor(rnd() * 3),
        len: 70 + Math.floor(rnd() * (e > 0 ? 150 : 220)),
        sway: 5 + rnd() * 7,
      })
    }
    for (const dx of [-BGW, 0, BGW]) {
      for (const r of roots) hangRoot(c, x + dx + r.dx, y, r.len, r.sway, [0x13, 0x15, 0x22], 185, 1)
    }
  }

  // ── 2. ПОЛ-МАССИВЫ с ПРОВАЛАМИ (шаг 17.2): сплошной пол тоже был лентой.
  // Теперь 3 массива с разрывами-пропастями: в разрыве видна бездна ВНИЗ —
  // глубина читается и под ногами. Массив A [0..300] стыкуется с C через шов.
  const FLOOR_SEGS = [
    // t A == t C: непрерывность кромки пола на шве тайла
    { x0: 0, x1: 300, t: 148 },
    { x0: 420, x1: 760, t: 176 },
    { x0: 870, x1: BGW, t: 148 },
  ]
  const floorEdge = (x) => {
    for (const s of FLOOR_SEGS) {
      if (x >= s.x0 && x <= s.x1) {
        const local = (x - s.x0) / (s.x1 - s.x0)
        const bump = Math.sin(local * Math.PI)
        return BGH - (66 + s.t * (0.4 + 0.6 * bump))
          + Math.sin(x * fPeriod(7) + 2.2) * 10
          + Math.sin(x * fPeriod(11) + 0.9) * 5
      }
    }
    return -1 // пропасть: пола нет
  }
  for (let x = 0; x < BGW; x++) {
    const e = Math.round(floorEdge(x))
    if (e < 0) continue
    c.rect(x, e, x, BGH - 1, CORE, 252)
    c.rect(x, e, x, e + 12, FACE, 160)
  }
  // Осыпь по кромкам пропастей: гребень обрыва сыплется валунами.
  for (const seg of FLOOR_SEGS) {
    for (const lipX of [seg.x0 + 14, seg.x1 - 14]) {
      if (lipX <= 4 || lipX >= BGW - 4) continue
      for (const dx of [-BGW, 0, BGW]) {
        c.roundRect(lipX + dx - 26, Math.round(floorEdge(lipX)) - 14, lipX + dx + 26, Math.round(floorEdge(lipX)) + 8, 4, [0x22, 0x27, 0x3e], 240)
        c.roundRect(lipX + dx - 12, Math.round(floorEdge(lipX)) - 22, lipX + dx + 14, Math.round(floorEdge(lipX)) - 2, 3, [0x26, 0x2a, 0x40], 234)
      }
    }
  }
  // Дальнее озеро на массиве B: тёмная вода с бликами (в пределах массива —
  // не на всю ширину: водная полоса у пола натуральна, ленты породы — нет).
  {
    const reflections = []
    for (let r = 0; r < 18; r++) {
      reflections.push({
        x: 430 + Math.floor(rnd() * 320),
        w: 1 + Math.floor(rnd() * 2),
        len: 4 + Math.floor(rnd() * 26),
        a: Math.round(24 + rnd() * 36),
      })
    }
    farLake(c, BGH - 208, 34, 430, 760, reflections)
  }
  // Сталагмитовые горы и осыпь валунов — только на массивах.
  for (let k = 0; k < 9; k++) {
    const seg = FLOOR_SEGS[k % FLOOR_SEGS.length]
    const x = seg.x0 + 30 + Math.floor(rnd() * Math.max(10, seg.x1 - seg.x0 - 60))
    const w = 80 + Math.floor(rnd() * 150)
    const h = 70 + Math.floor(rnd() * 150)
    for (const dx of [-BGW, 0, BGW]) {
      moundUp(c, x + dx, BGH - 1, w, h, k % 2 ? CORE : DARKCORE, 248)
      moundUp(c, x + dx + Math.round(w * 0.25), BGH - 1, Math.round(w * 0.5), Math.round(h * 0.6), DARKCORE, 244)
    }
  }
  for (let k = 0; k < 6; k++) {
    const seg = FLOOR_SEGS[k % FLOOR_SEGS.length]
    const x = seg.x0 + 24 + Math.floor(rnd() * Math.max(10, seg.x1 - seg.x0 - 48))
    const y = BGH - 230 + Math.floor(rnd() * 120)
    const n = 3 + Math.floor(rnd() * 3)
    const rocks = []
    for (let r = 0; r < n; r++) {
      rocks.push({
        dx: (r - n / 2) * 16 + Math.floor(rnd() * 8),
        dy: Math.floor(rnd() * 8),
        w: 10 + Math.floor(rnd() * 18),
        h: 7 + Math.floor(rnd() * 10),
      })
    }
    for (const dx of [-BGW, 0, BGW]) {
      for (const r of rocks) {
        c.roundRect(x + dx + r.dx - r.w, y + r.dy - r.h, x + dx + r.dx + r.w, y + r.dy, 3, [0x22, 0x27, 0x3e], 235)
      }
    }
  }

  // ── 3. КОЛОННЫ — вертикальный ритм (главная антитеза «полоскам»).
  // Стоят ТОЛЬКО на сводных сегментах/массивах (не в проёмах — там висят
  // зубцы и корни). Радиус колонны ≤ половины сегмента.
  const colSpecs = [
    { x: 150, w: 108, kind: 'full' },  // сегмент A
    { x: 262, w: 78, kind: 'hang' },   // свисает со свода A (обломана)
    { x: 520, w: 128, kind: 'full' },  // сегмент B
    { x: 690, w: 88, kind: 'risen' },  // растёт с массива B (обломана)
    { x: 975, w: 118, kind: 'full' },  // сегмент C
  ]
  for (const col of colSpecs) {
    const top = Math.round(ceilEdge(col.x)) - 6
    const bot = Math.round(floorEdge(col.x)) + 6
    let y0 = top, y1 = bot
    if (col.kind === 'hang') y1 = top + Math.round((bot - top) * 0.52)
    if (col.kind === 'risen') y0 = bot - Math.round((bot - top) * 0.46)
    for (const dx of [-BGW, 0, BGW]) {
      rockColumn(c, col.x + dx, y0, y1, col.w, CORE, FACE, RIM)
      // шапка/пятка обломанной колонны — рваная площадка
      if (col.kind === 'hang') {
        c.roundRect(col.x + dx - col.w * 0.55, y1 - 8, col.x + dx + col.w * 0.55, y1 + 10, 7, DARKCORE, 250)
        coneDown(c, col.x + dx - 18, y1 + 8, 16, 44, CORE, 240)
        coneDown(c, col.x + dx + 20, y1 + 8, 13, 30, CORE, 240)
      }
      if (col.kind === 'risen') {
        c.roundRect(col.x + dx - col.w * 0.6, y0 - 12, col.x + dx + col.w * 0.6, y0 + 8, 7, DARKCORE, 250)
        coneDown(c, col.x + dx + 2, y0 - 12, 20, 56, CORE, 236)
      }
    }
  }

  // ── 4. Выступы-обломки: неровные массы на своих высотах (BGH 1600:
  // диапазон расширен вниз — глубокие кадры тоже обязаны быть населены) ──
  const outcrops = [
    { cx: 176, cy: 430, w: 250, h: 170 },
    { cx: 402, cy: 610, w: 190, h: 130 },
    { cx: 648, cy: 470, w: 290, h: 190 },
    { cx: 880, cy: 700, w: 220, h: 150 },
    { cx: 250, cy: 860, w: 300, h: 200 },
    { cx: 560, cy: 950, w: 240, h: 160 },
    { cx: 120, cy: 1080, w: 210, h: 140 },
    { cx: 800, cy: 1060, w: 260, h: 170 },
    { cx: 420, cy: 1230, w: 230, h: 150 },
    { cx: 960, cy: 330, w: 180, h: 120 },
    { cx: 660, cy: 1330, w: 240, h: 160 },
    { cx: 180, cy: 1400, w: 200, h: 140 },
  ]
  for (let i = 0; i < outcrops.length; i++) {
    const o = outcrops[i]
    for (const dx of [-BGW, 0, BGW]) {
      rockOutcrop(c, o.cx + dx, o.cy, o.w, o.h, i % 3 === 0 ? DARKCORE : CORE, FACE, RIM, o.cx + i * 17)
    }
  }
  // Трещины на структурах (VLM шага 17: «пластиковые» поверхности без
  // фактуры): вертикальные зигзаги с кромок колонн и тел выступов.
  for (let k = 0; k < 16; k++) {
    const o = outcrops[k % outcrops.length]
    const x = o.cx + (hashJit(o.cx, k, Math.max(10, o.w)) - o.w / 2) * 0.7
    const y = o.cy - Math.round(o.h * 0.3)
    const len = 60 + hashJit(o.cx, k + 40, 160)
    for (const dx of [-BGW, 0, BGW]) {
      crack(c, Math.round(x + dx), y, len, [0x0b, 0x0d, 0x16], 140)
    }
  }

  // ── 5. Тоннельные проёмы: ниши с огоньком в глубине ──
  for (let k = 0; k < 6; k++) {
    const x = 90 + Math.floor(rnd() * (BGW - 180))
    const y = 330 + Math.floor(rnd() * 1050)
    const rx = 48 + Math.floor(rnd() * 38)
    const ry = 30 + Math.floor(rnd() * 24)
    for (const dx of [-BGW, 0, BGW]) {
      tunnelMouth(c, x + dx, y, rx, ry, [0x0e, 0x10, 0x1a], 240, [0x33, 0x3d, 0x5c], 80, PAL.cyan)
    }
  }

  // ── 6. Грибные поляны на выступах + костища + нити светлячков ──
  for (let k = 0; k < 8; k++) {
    const o = outcrops[k % outcrops.length]
    const x = o.cx - o.w * 0.2 + Math.floor(rnd() * o.w * 0.4)
    const y = o.cy - Math.round(o.h * 0.42)
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
  for (let k = 0; k < 4; k++) {
    const x = Math.floor(rnd() * BGW)
    const y = 400 + Math.floor(rnd() * 800)
    for (const dx of [-BGW, 0, BGW]) {
      c.roundRect(x + dx - 7, y - 10, x + dx + 7, y + 1, 3, [0x55, 0x53, 0x68], 74)
      boneArc(c, x + dx + 13, y, 7, 10, 1, [0x55, 0x53, 0x68], 60)
      boneArc(c, x + dx + 24, y + 2, 6, 9, 1, [0x55, 0x53, 0x68], 52)
    }
  }
  for (let k = 0; k < 5; k++) {
    const x = Math.floor(rnd() * BGW)
    const y = 130 + Math.floor(rnd() * 520)
    const len = 80 + Math.floor(rnd() * 120)
    const dots = []
    const n = 3 + Math.floor(rnd() * 3)
    for (let d = 0; d < n; d++) dots.push({ t: 0.25 + (d / n) * 0.7 })
    for (const dx of [-BGW, 0, BGW]) {
      hangRoot(c, x + dx, y, len, 6, [0x2a, 0x3e, 0x38], 110, 1)
      for (const d of dots) {
        const i = Math.round(len * d.t)
        const xx = x + dx + Math.sin(i * 0.055 + (x + dx) * 0.13) * 6 + Math.sin(i * 0.021 + (x + dx) * 0.31) * 3.6
        c.px(xx, y + i, PAL.cyan, 62)
      }
    }
  }

  // ── 7. Зерно породы (фактура; воздух между структурами чист) ──
  c.noise(1713, [[0x2c, 0x31, 0x4c], [0x12, 0x15, 0x26]], 0.16, 0.06, 0.15)

  // ── 8. ОКНА: арочные прорези СКВОЗЬ всё — глубина читается ВГЛУБЬ ──
  // 3 широкие арки + 5 узких вертикальных щелей; прорези идут ПОСЛЕ всех
  // деталей. Параметры считаются ОДИН раз: прорезь и обводка совпадают.
  const windows = [
    { x: 258, y: 700, rx: 118, ry: 152 },
    { x: 610, y: 880, rx: 132, ry: 168 },
    { x: 892, y: 560, rx: 104, ry: 138 },
    { x: 118, y: 470, rx: 50, ry: 205 },
    { x: 430, y: 1090, rx: 56, ry: 215 },
    { x: 742, y: 940, rx: 47, ry: 185 },
    { x: 966, y: 1120, rx: 52, ry: 195 },
    { x: 500, y: 400, rx: 60, ry: 225 },
    { x: 300, y: 1330, rx: 92, ry: 126 },
    { x: 770, y: 1400, rx: 54, ry: 190 },
  ]
  for (const win of windows) {
    for (const dx of [-BGW, 0, BGW]) {
      c.eraseEllipse(win.x + dx, win.y, win.rx, win.ry, 1.0)
    }
  }
  // Обводка кромок окон: срез камня ловит дальний свет.
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
// Шаг 17.2 (воздушная перспектива): слой БЛИЖЕ средней стены → ТЕМНЕЕ её
// (градиент глубины: бездна светлая → мегаволт в дымке → средняя стена →
// ближние формации → чёрные валуны у камеры).
{
  const c = new Canvas(BGW, BGH)
  const rnd = mulberry32(1604)
  // Большие двухтоновые сталактиты с кромкой света.
  for (let k = 0; k < 9; k++) {
    const x = Math.floor(rnd() * BGW)
    const w = 80 + Math.floor(rnd() * 90)
    const len = 280 + Math.floor(rnd() * 260)
    for (const dx of [-BGW, 0, BGW]) {
      coneDown(c, x + dx + 9, 0, w, len, [0x0d, 0x10, 0x1c], 215)
      coneDown(c, x + dx, 0, w, len, [0x17, 0x1b, 0x2c], 250)
      // левая кромка ловит дальний свет
      for (let i = 0; i <= len; i += 4) {
        const t = i / len
        const half = Math.max(1, Math.round((w / 2) * (1 - t * t)))
        c.px(x + dx - half - 1, i, [0x32, 0x3a, 0x56], 66)
      }
    }
  }
  // Сталагмитовые горы.
  for (let k = 0; k < 6; k++) {
    const x = Math.floor(rnd() * BGW)
    const w = 90 + Math.floor(rnd() * 110)
    const h = 140 + Math.floor(rnd() * 170)
    for (const dx of [-BGW, 0, BGW]) {
      moundUp(c, x + dx, BGH - 1, w, h, [0x13, 0x17, 0x27], 246)
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

/** Пять видов скал (шаг 12; шаг 22 — ОРГАНИЧНЫЕ силуэты): roundRect-валуны
 *  читались как «неизвестные тёмные фигуры/контейнеры» (жалоба игрока) —
 *  кромка теперь эллипс с шумовым смещением (blobHarmonics), rim-light и AO
 *  идут ПО силуэту (edgeBand), зерно клипается в форму, сколы глыбы —
 *  настоящие вырезы альфы (cut).
 *  a — округлый валун; b — угловатая глыба со сколами; c — россыпь;
 *  d — сталагмит-шпиль (зубчатый конус органичен — не трогаем);
 *  e — плита со светящейся жилой (редкая, ставит свечение). */
function blobHarmonics(seed, amp, n) {
  const rnd = mulberry32(seed)
  const out = []
  for (let h = 0; h < n; h++) {
    out.push({ amp: amp * (1 - h * 0.22), ph: rnd() * Math.PI * 2, freq: 2 + h * 2 + Math.floor(rnd() * 2) })
  }
  return out
}
/** Радиус-множитель кромки в направлении θ (детерминирован сидом). */
function blobR(th, harm) {
  let R = 1
  for (const h of harm) R += h.amp * Math.sin(th * h.freq + h.ph)
  return R
}
/** Радиус эллипса (rx, ry) в направлении θ. */
function blobRe(th, rx, ry) {
  return (rx * ry) / Math.hypot(rx * Math.sin(th), ry * Math.cos(th))
}
// a — валун: органичный силуэт + страта + rim/AO по кромке.
{
  const c = new Canvas(96, 64)
  c.organicBlob(48, 40, 44, 23, PAL.rockDark, 255, 121, { amp: 0.1 })
  c.organicBlob(48, 43, 35, 17, PAL.rockMid, 255, 122, { amp: 0.13 })
  c.edgeBand(48, 40, 44, 23, 121, { color: [0x4a, 0x4a, 0x62], a: 190, from: Math.PI, to: Math.PI * 2, depth: 2, amp: 0.1 })
  c.edgeBand(48, 40, 44, 23, 121, { color: PAL.ink, a: 120, from: 0.3, to: Math.PI - 0.3, depth: 3, amp: 0.1 })
  c.grainClipped(123, 90, [PAL.rockLight, PAL.rockDark])
  c.save('rock-a.png')
}
// b — угловатая глыба: низкочастотный жирный wobble + настоящие сколы кромки.
{
  const c = new Canvas(88, 72)
  c.organicBlob(44, 42, 38, 28, PAL.rockDark, 255, 124, { amp: 0.12, harmN: 3 })
  c.organicBlob(44, 46, 29, 20, PAL.rockMid, 255, 125, { amp: 0.15, harmN: 3 })
  const rnd = mulberry32(126)
  for (let i = 0; i < 5; i++) {
    const th = rnd() * Math.PI * 2
    c.cut(44 + 36 * Math.cos(th), 42 + 26 * Math.sin(th), 4 + Math.floor(rnd() * 4))
  }
  c.edgeBand(44, 42, 38, 28, 124, { color: [0x4a, 0x4a, 0x62], a: 190, from: Math.PI, to: Math.PI * 2, depth: 2, amp: 0.12, harmN: 3 })
  c.edgeBand(44, 42, 38, 28, 124, { color: PAL.ink, a: 120, from: 0.3, to: Math.PI - 0.3, depth: 3, amp: 0.12, harmN: 3 })
  c.grainClipped(127, 70, [PAL.rockLight, PAL.rockDark])
  c.save('rock-b.png')
}
// c — россыпь: 4 органичных камушка разного калибра.
{
  const c = new Canvas(80, 40)
  const blobs = [
    { cx: 17, cy: 28, rx: 13, ry: 10, seed: 131, col: PAL.rockMid },
    { cx: 41, cy: 22, rx: 15, ry: 13, seed: 132, col: PAL.rockDark },
    { cx: 63, cy: 29, rx: 12, ry: 9, seed: 133, col: PAL.rockMid },
    { cx: 25, cy: 33, rx: 8, ry: 6, seed: 134, col: PAL.rockDark },
  ]
  for (const b of blobs) {
    c.organicBlob(b.cx, b.cy, b.rx, b.ry, b.col, 255, b.seed, { amp: 0.14 })
    c.edgeBand(b.cx, b.cy, b.rx, b.ry, b.seed, { color: [0x4a, 0x4a, 0x62], a: 170, from: Math.PI, to: Math.PI * 2, depth: 1, amp: 0.14 })
  }
  c.save('rock-c.png')
}
// d — сталагмит-шпиль: высокий конус с зубчатым краем (органичен — без изменений).
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
// e — плита со светящейся жилой: приплюснутый органичный пласт (редкая: ~7%).
{
  const c = new Canvas(96, 64)
  c.organicBlob(48, 38, 45, 24, PAL.rockDark, 255, 141, { amp: 0.07, harmN: 3 })
  c.organicBlob(48, 40, 38, 18, [0x1e, 0x1e, 0x2e], 255, 142, { amp: 0.09, harmN: 3 })
  c.edgeBand(48, 38, 45, 24, 141, { color: [0x4a, 0x4a, 0x62], a: 170, from: Math.PI, to: Math.PI * 2, depth: 1, amp: 0.07, harmN: 3 })
  c.grainClipped(143, 60, [PAL.rockMid])
  // Жила: ломаная биолюм-циановая линия по поверхности пласта (клип в силуэт).
  const rnd = mulberry32(126)
  const vein = (x, y, col, a) => {
    if (x < 0 || y < 0 || x >= c.w || y >= c.h) return
    if (c.data[(y * c.w + x) * 4 + 3] < 60) return
    c.px(x, y, col, a)
  }
  let vx = 20
  let vy = 56
  for (let st = 0; st < 26; st++) {
    vx += 2 + Math.floor(rnd() * 3)
    vy -= 1 + Math.floor(rnd() * 2)
    vein(vx, vy, PAL.cyan, 235)
    vein(vx, vy + 1, [0x2a, 0x6e, 0x62], 190)
    if (rnd() > 0.6) vein(vx + 1, vy, PAL.cyan, 140)
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

// ── Шаг 25/26: Матка Улья, экспедиции, снаряжение ─────────────────────────

/** Трассер военного 12×4: тёплая светящаяся стрела (ADD + tint в коде). */
{
  const c = new Canvas(12, 4)
  for (let x = 0; x < 12; x++) {
    const t = x / 11
    const a = Math.round(255 * (0.25 + 0.75 * t))
    c.px(x, 1, [0xff, 0xf2, 0xc8], a)
    c.px(x, 2, [0xff, 0xf2, 0xc8], a)
    if (x > 7) c.px(x, 0, [0xff, 0xe0, 0x90], Math.round(a * 0.55))
    if (x > 7) c.px(x, 3, [0xff, 0xe0, 0x90], Math.round(a * 0.55))
  }
  c.px(10, 1, [0xff, 0xff, 0xf0], 255)
  c.px(11, 2, [0xff, 0xff, 0xf0], 255)
  c.save('bullet.png')
}

/** Кладка Матки 40×30: кожистая мембрана-гроздь с алыми «жилками». */
{
  const c = new Canvas(40, 30)
  const rnd = mulberry32(2525)
  // Гроздь из 5 сросшихся яиц — органика (organicBlob, шаг 22).
  const eggs = [
    { cx: 20, cy: 18, rx: 13, ry: 10 },
    { cx: 11, cy: 22, rx: 8, ry: 6 },
    { cx: 29, cy: 21, rx: 8, ry: 6 },
    { cx: 16, cy: 10, rx: 7, ry: 6 },
    { cx: 25, cy: 12, rx: 6, ry: 5 },
  ]
  for (const e of eggs) {
    c.organicBlob(e.cx, e.cy, e.rx, e.ry, [0x1e, 0x16, 0x20], 255, Math.floor(rnd() * 9999), { amp: 0.12 })
  }
  for (const e of eggs) {
    c.organicBlob(e.cx, e.cy, e.rx - 3, e.ry - 3, [0x2e, 0x20, 0x30], 200, Math.floor(rnd() * 9999), { amp: 0.1 })
  }
  // Багровые «просветы» под скорлупой — кладка дышит.
  for (const p of [[14, 20], [22, 16], [27, 20], [18, 12]]) {
    c.radial(p[0], p[1], 3.2, [0xe2, 0x3a, 0x4e], [[0, 0.85], [0.5, 0.4], [1, 0]])
  }
  c.save('queen-egg.png')
}

// Плейсхолдеры новых видов (Шаг 25/26): тёмные читаемые силуэты 4×68×46,
// чтобы игра была играбельной ДО прихода нейро-листов (как в шаге 20).
// ГРАБЛЯ шага 20: генератор НИКОГДА не трогает нейро-ассеты — только если
// файла нет. Нейро-лист положишь — плейсхолдер останется в прошлом.
{
  const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets')
  // Плейсхолдер = один canvas 272×46 (4 кадра 68×46), рисуем все 4 кадра.
  const placeholderSheet = (file, draw) => {
    const full = join(OUT, file)
    if (existsSync(full)) return
    const c = new Canvas(68 * 4, 46)
    for (let f = 0; f < 4; f++) draw(c, f * 68, f)
    c.save(file)
  }
  // Матка: исполинская туша, корона наростов, гроздь глаз.
  placeholderSheet('mob-queen.png', (c, ox, f) => {
    const rnd = mulberry32(9000 + f)
    // Брюхо-купол (кадр почти весь — она огромная, масштаб ставит код).
    c.organicBlob(ox + 34, 26, 26, 17, [0x1c, 0x12, 0x1e], 255, 71, { amp: 0.09 })
    c.organicBlob(ox + 30, 28, 18, 11, [0x2b, 0x1c, 0x2c], 230, 72, { amp: 0.1 })
    // Корона костяных наростов.
    for (let i = 0; i < 5; i++) {
      const bx = ox + 14 + i * 10
      const bh = 8 + Math.round(rnd() * 5)
      for (let y = 0; y < bh; y++) c.px(bx, 12 - y, [0x3a, 0x30, 0x42], 255 - y * 9)
    }
    // Гроздь алых глаз.
    for (const p of [[24, 20], [29, 17], [34, 21], [39, 18], [44, 22]]) {
      c.px(ox + p[0], p[1], [0xff, 0x5a, 0x72], 255)
      c.px(ox + p[0] - 1, p[1], [0x8a, 0x1a, 0x2a], 160)
    }
    // Багровое свечение брюха (пульс по кадрам — «дышит»).
    const glow = 0.35 + 0.25 * Math.sin(f * 1.6)
    c.radial(ox + 30, 32, 12, [0xe2, 0x3a, 0x4e], [[0, glow], [1, 0]])
  })

  // Учёный: костюм химзащиты, круглый шлем с тёплым фонарём.
  placeholderSheet('mob-scientist.png', (c, ox) => {
    c.roundRect(ox + 30, 18, 37, 41, 4, [0x2a, 0x28, 0x33], 255)  // корпус
    c.roundRect(ox + 31, 8, 36, 18, 6, [0x3c, 0x3a, 0x46], 255)   // шлем
    c.px(ox + 33, 13, [0xf2, 0xc1, 0x4e], 255)                    // фонарь
    c.px(ox + 34, 13, [0xff, 0xe8, 0xb0], 200)
    c.rect(ox + 39, 24, 40, 34, [0x22, 0x20, 0x2a], 200)          // чемоданчик
    c.rect(ox + 32, 41, 33, 44, [0x1a, 0x18, 0x22], 230)          // ноги
  })

  // Конвоир: броня, тактический шлем, карабин.
  placeholderSheet('mob-marine.png', (c, ox) => {
    c.roundRect(ox + 29, 17, 37, 41, 3, [0x24, 0x28, 0x30], 255)  // бронежилет
    c.roundRect(ox + 30, 7, 36, 17, 5, [0x33, 0x38, 0x42], 255)   // шлем
    c.px(ox + 33, 12, [0xe2, 0x3a, 0x4e], 255)                    // визор
    c.rect(ox + 38, 26, 52, 28, [0x4a, 0x44, 0x38], 255)          // карабин
    c.px(ox + 51, 26, [0xf2, 0xc1, 0x4e], 220)                    // дульная лампа
    c.rect(ox + 31, 41, 33, 44, [0x1c, 0x20, 0x28], 230)          // ноги
  })
}
