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

  save(name) {
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

/** Тайл стены 16×16 (шаг 4 возьмёт в тайлмап). */
{
  const c = new Canvas(16, 16)
  c.fill(PAL.rockDark)
  const rnd = mulberry32(1)
  for (let i = 0; i < 26; i++) {
    c.rect(Math.floor(rnd() * 16), Math.floor(rnd() * 16),
      Math.floor(rnd() * 16), Math.floor(rnd() * 16),
      rnd() > 0.5 ? PAL.rockMid : PAL.rockLight,
      Math.round((0.2 + rnd() * 0.4) * 255))
  }
  c.save('tile-wall.png')
}

/** Тайл пола 16×16 — чуть светлее стены, крупное зерно. */
{
  const c = new Canvas(16, 16)
  c.fill(PAL.rockMid)
  const rnd = mulberry32(2)
  for (let i = 0; i < 22; i++) {
    c.rect(Math.floor(rnd() * 16), Math.floor(rnd() * 16),
      Math.floor(rnd() * 16), Math.floor(rnd() * 16),
      rnd() > 0.6 ? PAL.rockLight : PAL.rockDark,
      Math.round((0.2 + rnd() * 0.35) * 255))
  }
  c.save('tile-floor.png')
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

/** Тайл камня 16×16 — ядро стен, почти чёрный с редким зерном. */
{
  const c = new Canvas(16, 16)
  c.fill([0x14, 0x14, 0x1c])
  const rnd = mulberry32(31)
  for (let i = 0; i < 14; i++) {
    c.rect(Math.floor(rnd() * 16), Math.floor(rnd() * 16),
      Math.floor(rnd() * 16), Math.floor(rnd() * 16),
      PAL.rockDark, Math.round((0.35 + rnd() * 0.4) * 255))
  }
  c.save('tile-stone.png')
}

/** Тайл земли 16×16 — край стены, обращённый к воздуху: теплее и светлее. */
{
  const c = new Canvas(16, 16)
  c.fill([0x3a, 0x32, 0x2c])
  const rnd = mulberry32(32)
  for (let i = 0; i < 20; i++) {
    c.rect(Math.floor(rnd() * 16), Math.floor(rnd() * 16),
      Math.floor(rnd() * 16), Math.floor(rnd() * 16),
      rnd() > 0.5 ? PAL.rockMid : [0x46, 0x3c, 0x33],
      Math.round((0.25 + rnd() * 0.4) * 255))
  }
  c.save('tile-dirt.png')
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

/**
 * Параллакс-силуэт пещеры 768×1280: сталактиты сверху, сталагмиты снизу,
 * столбы-кляксы в середине. Горизонтальная бесшовность — каждая фигура
 * дублируется на ±W; вертикальной склейки на экране не бывает (окно
 * камеры всегда внутри высоты текстуры — см. light.json, factor).
 */
function makeSilhouette(name, seed, opts) {
  const W = 768
  const H = 1280
  const c = new Canvas(W, H)
  if (opts.bg) c.fill(opts.bg)
  const rnd = mulberry32(seed)
  const shapes = []
  for (let i = 0; i < opts.stalactites; i++) {
    shapes.push({
      x: Math.floor(rnd() * W),
      kind: 'stalactite',
      w: opts.minW + Math.floor(rnd() * (opts.maxW - opts.minW)),
      len: Math.floor(H * (0.12 + rnd() * opts.maxLen)),
    })
  }
  for (let i = 0; i < opts.stalagmites; i++) {
    shapes.push({
      x: Math.floor(rnd() * W),
      kind: 'stalagmite',
      w: opts.minW + Math.floor(rnd() * (opts.maxW - opts.minW)),
      len: Math.floor(H * (0.1 + rnd() * opts.maxLen * 0.7)),
    })
  }
  for (let i = 0; i < opts.pillars; i++) {
    shapes.push({
      x: Math.floor(rnd() * W),
      kind: 'pillar',
      w: opts.minW + Math.floor(rnd() * (opts.maxW - opts.minW)),
      len: Math.floor(H * (0.08 + rnd() * 0.14)),
      cy: Math.floor(H * (0.3 + rnd() * 0.4)),
    })
  }
  for (const s of shapes) {
    for (const dx of [-W, 0, W]) {
      const x = s.x + dx
      if (s.kind === 'pillar') {
        c.roundRect(x - s.w / 2, s.cy - s.len / 2, x + s.w / 2, s.cy + s.len / 2,
          Math.floor(s.w / 3), opts.ink, opts.inkA)
        // Шаг 12: бугристый край столба — пещера органичная, не машинная.
        for (let b = 0; b < 6; b++) {
          const by = s.cy - s.len / 2 + Math.floor(rnd() * s.len)
          const bw = 3 + Math.floor(rnd() * (s.w / 3))
          c.roundRect(x - s.w / 2 - bw, by, x - s.w / 2, by + 4 + Math.floor(rnd() * 6), 2, opts.ink, opts.inkA)
          c.roundRect(x + s.w / 2, by + 3, x + s.w / 2 + bw, by + 8 + Math.floor(rnd() * 6), 2, opts.ink, opts.inkA)
        }
      } else if (s.kind === 'stalactite') {
        for (let y = 0; y <= s.len; y++) {
          const t = y / s.len
          let half = Math.max(1, Math.round((s.w / 2) * (1 - t * t)))
          // Шаг 12: зубчатый край — сталактит «рваный», не идеальный конус.
          if (y % 6 < 2 && y > 4) half = Math.max(1, half - 1 - Math.floor(rnd() * 2))
          c.rect(x - half, y, x + half, y, opts.ink, opts.inkA)
        }
      } else {
        for (let y = 0; y <= s.len; y++) {
          const t = y / s.len
          let half = Math.max(1, Math.round((s.w / 2) * (1 - (1 - t) * (1 - t))))
          if (y % 7 < 2 && y < s.len - 4) half = Math.max(1, half - 1 - Math.floor(rnd() * 2))
          c.rect(x - half, H - 1 - y, x + half, H - 1 - y, opts.ink, opts.inkA)
        }
        // Шаг 12: rim-light — верхняя кромка сталагмита ловит свет сверху
        // (приём из референсов: светлая кромка отделяет камень от бездны).
        if (opts.rim) {
          const rw = Math.max(2, Math.floor(s.w / 2) - 2)
          const topY = H - 1 - s.len
          c.rect(x - rw, topY, x + rw, topY + 1, opts.rim, opts.rimA)
        }
      }
    }
  }
  // Шаг 12: свисающие корни-нити — жизнь прорастает даже в камень.
  if (opts.roots) {
    for (let i = 0; i < opts.roots; i++) {
      const x0 = Math.floor(rnd() * W)
      const len = 30 + Math.floor(rnd() * 110)
      for (const dx of [-W, 0, W]) {
        let x = x0
        for (let y = 0; y < len; y++) {
          if (y % 9 === 0) x += rnd() > 0.5 ? 1 : -1
          const a = Math.round(opts.inkA * (0.55 + 0.45 * (1 - y / len)))
          c.rect(x + dx, y, x + dx, y, opts.ink, a)
          if (rnd() > 0.86) c.rect(x + dx + 1, y, x + dx + 1, y, opts.ink, Math.round(a * 0.6))
        }
      }
    }
  }
  c.save(name)
}

/** Дальний слой: чуть светлее полотна, мелкий и частый — «стена пещеры в дымке». */
makeSilhouette('silhouette-far.png', 51, {
  bg: [0x0a, 0x0a, 0x11], ink: [0x08, 0x08, 0x0d], inkA: 255,
  stalactites: 14, stalagmites: 10, pillars: 9, minW: 36, maxW: 120, maxLen: 0.34,
  roots: 16,
})
/** Ближний слой: прозрачный фон, крупные тёмные формы поверх дальнего. */
makeSilhouette('silhouette-near.png', 52, {
  bg: null, ink: [0x06, 0x06, 0x09], inkA: 235,
  stalactites: 8, stalagmites: 6, pillars: 5, minW: 60, maxW: 190, maxLen: 0.42,
  roots: 9, rim: [0x1c, 0x22, 0x2c], rimA: 140,
})

// ── Шаг 12: лучший визуал пещеры ───────────────────────────────────────
// Приёмы из анализа бесплатных пиксельных референсов (itch.io):
// страта-полосы фара, дизеринг на границах, rim-light верхних кромок,
// AO (затемнение) в нижних углах, «бугристые» органичные контуры,
// висящие корни. Всё — в палитре контракта (design/DECISIONS.md).

/** Страта-задник 768×1280: дальняя стена пещеры за силуэтами — слоистые
 *  напластования породы с дизерингом, трещинами и карманами свечения.
 *  Горизонтально бесшовный (дублирование фигур на ±W). */
{
  const W = 768
  const H = 1280
  const c = new Canvas(W, H)
  c.fill([0x0c, 0x0c, 0x13])
  const rnd = mulberry32(71)
  // Напластования: 8 полос — каждая чуть другого оттенка тёмного,
  // граница — дизеринг (шум перекрытия), не прямая линия.
  const strataColors = [
    [0x13, 0x13, 0x20], [0x10, 0x11, 0x1c], [0x15, 0x14, 0x22],
    [0x11, 0x10, 0x1a], [0x17, 0x15, 0x24], [0x10, 0x12, 0x1d],
    [0x14, 0x13, 0x1e], [0x11, 0x13, 0x20],
  ]
  let y = 0
  for (let b = 0; b < strataColors.length; b++) {
    const bandH = Math.floor(H / strataColors.length * (0.7 + rnd() * 0.7))
    const col = strataColors[b]
    for (let yy = y; yy < Math.min(H, y + bandH); yy++) {
      for (let x = 0; x < W; x++) {
        // Дизеринг на границе полосы — «рваный» геологический срез.
        const edge = Math.min(yy - y, y + bandH - yy)
        if (edge < 6 && rnd() > 0.45) continue
        c.px(x, yy, col, 255)
      }
    }
    y += bandH
  }
  // Вертикальные трещины — тонкие тёмные зигзаги сверху донизу.
  for (let i = 0; i < 22; i++) {
    let x = Math.floor(rnd() * W)
    for (let yy = 0; yy < H; yy++) {
      if (yy % 11 === 0) x += rnd() > 0.5 ? 1 : -1
      c.px(x, yy, [0x07, 0x07, 0x0d], 200)
      if (rnd() > 0.7) c.px(x + 1, yy, [0x07, 0x07, 0x0d], 120)
    }
  }
  // Крошечные кристаллы в глубине породы — тусклые искры (биолюм-пыль).
  for (let i = 0; i < 130; i++) {
    const x = Math.floor(rnd() * W)
    const yy = Math.floor(rnd() * H)
    const col = rnd() > 0.5 ? PAL.cyan : PAL.spore
    c.px(x, yy, col, Math.round(18 + rnd() * 38))
    if (rnd() > 0.6) c.px(x + 1, yy + 1, col, Math.round(10 + rnd() * 18))
  }
  // Карманы дальнего свечения — очень тусклые радиальные пятна
  // (грибные поляны где-то там, в глубине).
  for (let i = 0; i < 9; i++) {
    const gx = Math.floor(rnd() * W)
    const gy = Math.floor(rnd() * H)
    const col = rnd() > 0.5 ? PAL.cyan : PAL.blood
    c.radial(gx, gy, 60 + rnd() * 90, col, [[0, 0.08], [0.5, 0.03], [1, 0]])
  }
  c.save('bg-strata.png')
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

/** Варианты тайла камня (шаг 12): зерно/окаменелость/трещина — стена
 *  перестаёт быть одним размноженным тайлом. tile-stone.png — вариант A. */
{
  // B — крупное зерно.
  const c = new Canvas(16, 16)
  c.fill([0x13, 0x13, 0x1b])
  const rnd = mulberry32(41)
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(rnd() * 14)
    const yy = Math.floor(rnd() * 14)
    c.rect(x, yy, x + 1 + Math.floor(rnd() * 2), yy + 1, PAL.rockDark, Math.round((0.4 + rnd() * 0.4) * 255))
  }
  c.save('tile-stone-b.png')
}
{
  // C — окаменелость: светлая спираль-ракушка в толще.
  const c = new Canvas(16, 16)
  c.fill([0x14, 0x14, 0x1c])
  const rnd = mulberry32(42)
  for (let i = 0; i < 8; i++) {
    c.rect(Math.floor(rnd() * 16), Math.floor(rnd() * 16),
      Math.floor(rnd() * 16), Math.floor(rnd() * 16), PAL.rockDark, Math.round(0.35 * 255))
  }
  const fossil = [0x55, 0x55, 0x6e]
  c.rect(7, 6, 10, 9, fossil, 200)
  c.rect(5, 7, 6, 8, fossil, 160)
  c.rect(9, 8, 12, 11, [0x3a, 0x3a, 0x50], 170)
  c.save('tile-stone-c.png')
}
{
  // D — трещина: тонкий тёмный зигзаг через тайл.
  const c = new Canvas(16, 16)
  c.fill([0x13, 0x13, 0x1b])
  const rnd = mulberry32(43)
  for (let i = 0; i < 10; i++) {
    c.rect(Math.floor(rnd() * 16), Math.floor(rnd() * 16),
      Math.floor(rnd() * 16), Math.floor(rnd() * 16), PAL.rockDark, Math.round(0.3 * 255))
  }
  let cx = 3 + Math.floor(rnd() * 4)
  for (let yy = 1; yy < 15; yy++) {
    if (yy % 3 === 0) cx += rnd() > 0.5 ? 1 : -1
    c.rect(cx, yy, cx + 1, yy, [0x08, 0x08, 0x0e], 220)
  }
  c.save('tile-stone-d.png')
}

/** Земля по контексту (шаг 12): tile-dirt.png остаётся «внутренним краем»,
 *  новые варианты — ориентация к воздуху: верх (пол — со светлой кромкой),
 *  бок (вертикальная штриховка), низ (потолок — с потёками). */
{
  // top: пол — тёплая земля со светлой кромкой (rim-light сверху).
  const c = new Canvas(16, 16)
  c.fill([0x3a, 0x32, 0x2c])
  const rnd = mulberry32(51)
  for (let i = 0; i < 14; i++) {
    c.rect(Math.floor(rnd() * 16), Math.floor(rnd() * 16),
      Math.floor(rnd() * 16), Math.floor(rnd() * 16),
      rnd() > 0.5 ? PAL.rockMid : [0x46, 0x3c, 0x33], Math.round((0.25 + rnd() * 0.4) * 255))
  }
  c.rect(0, 0, 15, 1, [0x5a, 0x50, 0x44], 235)
  c.rect(0, 1, 15, 2, [0x4a, 0x40, 0x38], 140)
  c.save('tile-dirt-top.png')
}
{
  // side: стена — вертикальная штриховка, у краёв «скруглённая губа».
  const c = new Canvas(16, 16)
  c.fill([0x35, 0x2e, 0x28])
  const rnd = mulberry32(52)
  for (let x = 2; x < 14; x += 3) {
    for (let yy = 0; yy < 16; yy++) {
      if (rnd() > 0.35) c.rect(x, yy, x, yy, [0x40, 0x37, 0x2f], Math.round((0.3 + rnd() * 0.4) * 255))
    }
  }
  c.rect(0, 0, 1, 15, [0x48, 0x3e, 0x34], 190)
  c.rect(14, 0, 15, 15, [0x48, 0x3e, 0x34], 190)
  c.save('tile-dirt-side.png')
}
{
  // bottom: потолок — темнее, с потёками-сталактитиками по нижней кромке.
  const c = new Canvas(16, 16)
  c.fill([0x2e, 0x28, 0x22])
  const rnd = mulberry32(53)
  for (let i = 0; i < 12; i++) {
    c.rect(Math.floor(rnd() * 16), Math.floor(rnd() * 12),
      Math.floor(rnd() * 16), Math.floor(rnd() * 12),
      rnd() > 0.5 ? PAL.rockMid : [0x38, 0x30, 0x28], Math.round((0.25 + rnd() * 0.35) * 255))
  }
  // Потёки: 3 сталактитика 1–3px с нижней кромки.
  for (let d = 0; d < 3; d++) {
    const dx = 2 + Math.floor(rnd() * 12)
    const dh = 2 + Math.floor(rnd() * 3)
    c.rect(dx, 15 - dh, dx, 15, [0x40, 0x37, 0x2c], 220)
  }
  c.rect(0, 0, 15, 1, [0x1e, 0x1a, 0x16], 200)
  c.save('tile-dirt-bottom.png')
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
