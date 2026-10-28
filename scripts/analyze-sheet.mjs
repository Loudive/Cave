#!/usr/bin/env node
/** Анализ листа: сколько РЕАЛЬНО связных существ (без валидации количества). */
import sharp from 'sharp'
import path from 'node:path'

const SRC = '/home/z/cave-repo/design/raw/v3'
const file = process.argv[2]
const keyTol = 55

const { data: px, info } = await sharp(path.join(SRC, file))
  .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const w = info.width
const h = info.height
const dist = (r, g, b, c) => Math.sqrt((r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2)
const bg = [px[0], px[1], px[2]]
// Грубый хромакей по близости к фону + глобальная зачистка маджента-семьи.
const on = new Uint8Array(w * h)
for (let i = 0; i < w * h; i++) {
  const o = i * 4
  const r = px[o], g = px[o + 1], b = px[o + 2]
  const isBg = dist(r, g, b, bg) <= keyTol || (r > g + 40 && b > g + 20 && Math.abs(r - b) < 70)
  on[i] = isBg ? 0 : 1
}
// Дилатация r=5 (как в слайсере).
let cur = on
for (let pass = 0; pass < 5; pass++) {
  const next = new Uint8Array(cur)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x
    if (cur[i]) continue
    if ((x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) || (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w])) next[i] = 1
  }
  cur = next
}
// Связные компоненты 4-связности.
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
    area++
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
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
console.log(`${file} (${w}x${h}):`)
console.log(`  компонентов: ${comps.length}`)
for (const c of comps.slice(0, 14)) {
  console.log(`  left=${c.left} top=${c.top} ${c.wdt}x${c.hgt} area=${c.area}`)
}
