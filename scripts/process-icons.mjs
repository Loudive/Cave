/**
 * process-icons.mjs — шаг 24: нарезка нейро-листов иконок древа навыков.
 *
 * Заказ игрока: «Стилизуй древо навыков по норм арты. Иконки можешь
 * сгенерировать тоже». Пайплайн как у мобов (process-mobs.mjs):
 * хромакей мадженты → компоненты (ряды сверху вниз) → 8 иконок на лист
 * (сетка 4×2) → вписать в клетку 40×40 (тело ~30px) → assets/icon-<id>.png.
 *
 * Два листа (scripts/gen-step24.mjs):
 *   icons-a: fangs, jaw, blood, claw, heart, shield, stomach, eye
 *   icons-b: wing, paw, mushroom, flame, crystal, dna, ghost, egg
 *
 * Фолбэк: если нейро-лист отсутствует или компонентов ≠ 8 — рисуем
 * ПРОЦЕДУРНУЮ заглушку (ромб цвета узла), чтобы сборка игры никогда
 * не ломалась. Приход нейро-листа — перезапуск скрипта, файлы заменятся.
 *
 * Запуск: node scripts/process-icons.mjs
 */
import sharp from 'sharp'
import path from 'node:path'
import fs from 'node:fs'

const HERE = path.dirname(fileURLToPathImport())
function fileURLToPathImport() { return import.meta.url.replace('file://', '') }

const ROOT = path.resolve(HERE, '..')
const SRC = path.join(ROOT, 'design/raw/icons')
const OUT = path.join(ROOT, 'assets')

/** Клетка иконки: тело вписывается в ICON, поле — в CELL. */
const CELL = 40
const ICON = 30

/** Порядок иконок на листах = порядок в промпте генерации (ряды слева-направо). */
const SHEETS = {
  'icons-a': ['fangs', 'jaw', 'blood', 'claw', 'heart', 'shield', 'stomach', 'eye'],
  'icons-b': ['wing', 'paw', 'mushroom', 'flame', 'crystal', 'dna', 'ghost', 'egg'],
}

/** Фолбэк-цвета заглушек (близко к палитре будущих иконок). */
const PLACEHOLDER_COLOR = {
  fangs: '#E8E6E3', jaw: '#E23A4E', blood: '#E23A4E', claw: '#9a9aa8',
  heart: '#E23A4E', shield: '#7DB8FF', stomach: '#E8A34F', eye: '#E23A4E',
  wing: '#58E6C8', paw: '#9a9aa8', mushroom: '#58E6C8', flame: '#E2763A',
  crystal: '#58E6C8', dna: '#B36BFF', ghost: '#B36BFF', egg: '#E8A34F',
}

const CFG = { keyTol: 55, edgeBand: 34, despill: 0.8, dilateR: 4, frames: 8 }

/** Шаг 24 (грабля раздробленных иконок): «коготь-царапина» = 3 ОТДЕЛЬНЫЕ
 * полосы, «след лапы» = раздельные пальцы — один компонент ≠ одна иконка.
 * Лист рисуется РЕГУЛЯРНОЙ сеткой 4×2: назначаем каждый компонент в ячейку
 * по его ЦЕНТРУ (клетка = imgW/4 × imgH/2) и сливаем рамки внутри ячейки.
 * Мусор рядом с иконкой попадает в ту же ячейку — поглощается её рамкой. */
function clusterComponents(comps, imgW, imgH) {
  const cols = 4
  const rows = 2
  const cellW = imgW / cols
  const cellH = imgH / rows
  const cells = Array.from({ length: cols * rows }, () => null)
  for (const c of comps) {
    const cx = c.left + c.width / 2
    const cy = c.top + c.height / 2
    const gx = Math.min(cols - 1, Math.max(0, Math.floor(cx / cellW)))
    const gy = Math.min(rows - 1, Math.max(0, Math.floor(cy / cellH)))
    const idx = gy * cols + gx
    if (!cells[idx]) {
      cells[idx] = { left: c.left, top: c.top, width: c.width, height: c.height, area: c.area }
    } else {
      const m = cells[idx]
      const right = Math.max(m.left + m.width, c.left + c.width)
      const bottom = Math.max(m.top + m.height, c.top + c.height)
      m.left = Math.min(m.left, c.left)
      m.top = Math.min(m.top, c.top)
      m.width = right - m.left
      m.height = bottom - m.top
      m.area += c.area
    }
  }
  return cells.filter(Boolean)
}

const dist = (r, g, b, c) => Math.sqrt((r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2)

async function loadRaw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}

/** Хромакей мадженты — как process-mobs.mjs (BFS с краёв + кромка + зачистка). */
function chromaKey(img) {
  const { data: px, w, h } = img
  const bg = [px[0], px[1], px[2]]
  const keyed = new Uint8Array(w * h)
  const queue = []
  const tryPush = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return
    const i = y * w + x
    if (keyed[i]) return
    const o = i * 4
    if (dist(px[o], px[o + 1], px[o + 2], bg) > CFG.keyTol) return
    keyed[i] = 1
    queue.push(i)
  }
  for (let x = 0; x < w; x++) { tryPush(x, 0); tryPush(x, h - 1) }
  for (let y = 0; y < h; y++) { tryPush(0, y); tryPush(w - 1, y) }
  while (queue.length) {
    const i = queue.pop()
    px[i * 4 + 3] = 0
    const x = i % w, y = (i / w) | 0
    tryPush(x + 1, y); tryPush(x - 1, y); tryPush(x, y + 1); tryPush(x, y - 1)
  }
  const band = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (keyed[i] || px[i * 4 + 3] === 0) continue
      const near =
        (x > 0 && keyed[i - 1]) || (x < w - 1 && keyed[i + 1]) ||
        (y > 0 && keyed[i - w]) || (y < h - 1 && keyed[i + w])
      if (near) band.push(i)
    }
  }
  for (const i of band) {
    const o = i * 4
    const d = dist(px[o], px[o + 1], px[o + 2], bg)
    if (d >= CFG.keyTol + CFG.edgeBand) continue
    const t = Math.max(0, Math.min(1, (d - CFG.keyTol) / CFG.edgeBand))
    px[o + 3] = Math.min(px[o + 3], Math.round(255 * t))
    const avg = (px[o] + px[o + 2]) >> 1
    px[o] = Math.round(px[o] + (avg - px[o]) * CFG.despill * (1 - t))
    px[o + 2] = Math.round(px[o + 2] + (avg - px[o + 2]) * CFG.despill * (1 - t))
  }
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    if (px[o + 3] === 0) continue
    const r = px[o], g = px[o + 1], b = px[o + 2]
    if (r > g + 40 && b > g + 20 && Math.abs(r - b) < 70) px[o + 3] = 0
  }
  return img
}

function dilateMask(img, r) {
  const { data: px, w, h } = img
  let cur = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) cur[i] = px[i * 4 + 3] > 30 ? 1 : 0
  for (let pass = 0; pass < r; pass++) {
    const next = new Uint8Array(cur)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (cur[i]) continue
        if ((x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) || (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w])) next[i] = 1
      }
    }
    cur = next
  }
  return cur
}

/** Связные компоненты, ряды сверху вниз, в ряду слева направо. */
function components(img) {
  const { data: px, w, h } = img
  const mask = dilateMask(img, CFG.dilateR)
  const seen = new Uint8Array(w * h)
  const labels = []
  const stack = new Int32Array(w * h)
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !mask[start]) continue
    let sp = 0
    stack[sp++] = start
    seen[start] = 1
    let x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0
    while (sp > 0) {
      const i = stack[--sp]
      const x = i % w, y = (i / w) | 0
      if (px[i * 4 + 3] > 30) {
        area++
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const ni = ny * w + nx
        if (seen[ni] || !mask[ni]) continue
        seen[ni] = 1
        stack[sp++] = ni
      }
    }
    if (area > 120) labels.push({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, area })
  }
  const byTop = [...labels].sort((a, b) => a.top - b.top)
  const rows = []
  for (const c of byTop) {
    const row = rows.find((r) => Math.abs(r.top - c.top) < h / 4)
    if (row) row.items.push(c)
    else rows.push({ top: c.top, items: [c] })
  }
  const out = []
  for (const r of rows.sort((a, b) => a.top - b.top)) {
    r.items.sort((a, b) => a.left - b.left)
    out.push(...r.items)
  }
  return out
}

async function crop(img, box) {
  return sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
    .extract(box).png().toBuffer({ resolveWithObject: true })
}

/** Иконка-заглушка: ромб с рамкой цвета узла (сборка не ломается без нейро). */
async function placeholder(name) {
  const col = PLACEHOLDER_COLOR[name] ?? '#8A8894'
  const svg = Buffer.from(`<svg width="${CELL}" height="${CELL}">
  <path d="M20 5 L33 20 L20 35 L7 20 Z" fill="#141420" stroke="${col}" stroke-width="2"/>
  <circle cx="20" cy="20" r="3.5" fill="${col}"/>
</svg>`)
  return sharp(svg).png().toBuffer()
}

async function main() {
  let placeholderCount = 0
  const built = []

  for (const [sheet, names] of Object.entries(SHEETS)) {
    const src = path.join(SRC, `${sheet}.jpg`)
    let frames = null
    if (fs.existsSync(src)) {
      const img = chromaKey(await loadRaw(src))
      const rawComps = components(img)
      const comps = clusterComponents(rawComps, img.w, img.h)
      console.log(`${sheet}: компонентов ${rawComps.length} → кластеров ${comps.length} — ${comps.map((c) => `${c.width}×${c.height}`).join(' ')}`)
      if (comps.length === CFG.frames) {
        frames = []
        for (const c of comps) frames.push(await crop(img, c))
      } else {
        console.warn(`  ✗ ${sheet}: нужно ровно ${CFG.frames} — заглушки`)
      }
    } else {
      console.warn(`${sheet}.jpg нет — заглушки`)
    }

    for (let i = 0; i < names.length; i++) {
      const name = names[i]
      let buf
      if (frames) {
        const f = frames[i]
        const scale = Math.min(ICON / f.info.width, ICON / f.info.height)
        const rw = Math.max(1, Math.round(f.info.width * scale))
        const rh = Math.max(1, Math.round(f.info.height * scale))
        const resized = await sharp(f.data).resize(rw, rh, { kernel: 'lanczos3' }).png().toBuffer()
        buf = await sharp({
          create: { width: CELL, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
        }).composite([{ input: resized, left: Math.round((CELL - rw) / 2), top: Math.round((CELL - rh) / 2) }]).png().toBuffer()
      } else {
        buf = await placeholder(name)
        placeholderCount++
      }
      fs.writeFileSync(path.join(OUT, `icon-${name}.png`), buf)
      built.push(name)
    }
  }

  // Контакт-лист для проверки глазами (4×, тёмный фон).
  const SCALE = 4
  const perRow = 8
  const rows = Math.ceil(built.length / perRow)
  const comps = []
  for (let i = 0; i < built.length; i++) {
    const x = (i % perRow) * (CELL * SCALE + 8)
    const y = Math.floor(i / perRow) * (CELL * SCALE + 18)
    const label = Buffer.from(`<svg width="${CELL * SCALE}" height="14"><text x="2" y="11" font-family="monospace" font-size="11" fill="#8A8894">${built[i]}</text></svg>`)
    comps.push({ input: label, left: x, top: y })
    comps.push({
      input: await sharp(path.join(OUT, `icon-${built[i]}.png`)).resize(CELL * SCALE, CELL * SCALE, { kernel: 'nearest' }).png().toBuffer(),
      left: x, top: y + 15,
    })
  }
  await sharp({
    create: { width: perRow * (CELL * SCALE + 8), height: rows * (CELL * SCALE + 18) + 4, channels: 4, background: { r: 14, g: 14, b: 22, alpha: 1 } },
  }).composite(comps).png().toFile(path.join(SRC, 'preview-icons.png'))

  console.log(`иконок: ${built.length} (заглушек: ${placeholderCount}) → assets/icon-*.png`)
  console.log('preview-icons.png записан')
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
