#!/usr/bin/env node
/** Нумерованное превью компонент листа (для курирования кадров глазами). */
import sharp from 'sharp'
import path from 'node:path'

const SRC = '/home/z/cave-repo/design/raw/v3'
const file = process.argv[2]
const dilateR = Number(process.argv[3] || 5)
const byLeft = process.argv[4] === 'left'  // полётные листы: тела на разной высоте — ряд один, сортировка чисто по left
const OUT = `/tmp/numbered_${file.replace('.png', '')}_r${dilateR}.png`

const { data: px, info } = await sharp(path.join(SRC, file))
  .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const w = info.width, h = info.height
const dist = (r, g, b, c) => Math.sqrt((r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2)
const bg = [px[0], px[1], px[2]]
const on = new Uint8Array(w * h)
for (let i = 0; i < w * h; i++) {
  const o = i * 4
  const r = px[o], g = px[o + 1], b = px[o + 2]
  const isBg = dist(r, g, b, bg) <= 55 || (r > g + 40 && b > g + 20 && Math.abs(r - b) < 70)
  on[i] = isBg ? 0 : 1
}
let cur = on
for (let pass = 0; pass < dilateR; pass++) {
  const next = new Uint8Array(cur)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    if (cur[i]) continue
    if ((x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) || (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w])) next[i] = 1
  }
  cur = next
}
const seen = new Uint8Array(w * h)
const comps = []
const stack = new Int32Array(w * h)
for (let start = 0; start < w * h; start++) {
  if (seen[start] || !cur[start]) continue
  let sp = 0; stack[sp++] = start; seen[start] = 1
  let x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0
  while (sp > 0) {
    const i = stack[--sp]
    const x = i % w, y = (i / w) | 0
    if (on[i]) { area++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
    for (const [nx, ny] of [[x+1,y],[x-1,y],[x,y+1],[x,y-1]]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      const ni = ny * w + nx
      if (seen[ni] || !cur[ni]) continue
      seen[ni] = 1; stack[sp++] = ni
    }
  }
  if (area > 40) comps.push({ left: x0, top: y0, wdt: x1 - x0 + 1, hgt: y1 - y0 + 1, area })
}
comps.sort((a, b) => b.area - a.area)

// Порядок: по left (полёт) или рядами сверху вниз → слева направо.
const ordered = byLeft
  ? [...comps].sort((a, b) => a.left - b.left)
  : (() => {
      const sorted = [...comps].sort((a, b) => a.top - b.top)
      const rows = []
      for (const c of sorted) {
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
    })()

// Превью: сетка 4 колонок, каждый кадр с номером.
const CELL = 220
const cols = Math.min(4, ordered.length)
const rowsN = Math.ceil(ordered.length / cols)
const comps2 = []
for (let i = 0; i < ordered.length; i++) {
  const c = ordered[i]
  const x = (i % cols) * CELL, y = Math.floor(i / cols) * CELL
  const buf = await sharp(px, { raw: { width: w, height: h, channels: 4 } })
    .extract({ left: c.left, top: c.top, width: c.wdt, height: c.hgt }).png().toBuffer()
  const meta = await sharp(buf).metadata()
  const sc = Math.min((CELL - 30) / meta.width, (CELL - 44) / meta.height)
  const rw = Math.round(meta.width * sc), rh = Math.round(meta.height * sc)
  const resized = await sharp(buf).resize(rw, rh, { kernel: 'lanczos3' }).png().toBuffer()
  comps2.push({ input: resized, left: x + Math.round((CELL - rw) / 2), top: y + 26 })
  const num = Buffer.from(`<svg width="${CELL}" height="26"><rect width="26" height="22" fill="#E8A34F"/><text x="6" y="17" font-family="monospace" font-size="15" fill="#0B0B10" font-weight="bold">${i}</text><text x="34" y="17" font-family="monospace" font-size="12" fill="#8A8894">${c.wdt}x${c.hgt}</text></svg>`)
  comps2.push({ input: num, left: x, top: y })
}
await sharp({ create: { width: cols * CELL, height: rowsN * CELL, channels: 4, background: { r: 24, g: 24, b: 34, alpha: 1 } } })
  .composite(comps2).png().toFile(OUT)
console.log(`${file}: ${comps.length} компонент (dilate r=${dilateR}), порядок ряд→слева-направо:`)
ordered.forEach((c, i) => console.log(`  #${i}: left=${c.left} top=${c.top} ${c.wdt}x${c.hgt}`))
console.log('превью:', OUT)
