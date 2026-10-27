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

console.log('Готово: assets/ обновлён (детерминированно, seed=20261027).')
