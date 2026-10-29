/**
 * process-mobs.mjs — шаг 20: нарезка нейро-листов мобов в игровые листы.
 *
 * Пожелание игрока: «Мобов надо сделать новые спрайты и анимации».
 * Пайплайн повторяет героя (process-hero.mjs, шаг 11): хромакей мадженты
 * BFS с краёв → глобальная зачистка маджента-семьи → дилатация → связные
 * компоненты (ряды сверху вниз, в ряду слева направо) → ровно 4 кадра →
 * ЕДИНЫЙ масштаб на лист (анти-пульсация) → низ по базовой линии 44
 * (baselinePad=2, как у героя) → центр клетки → assets/mob-<id>.png
 * (лист 272×46 = 4 кадра 68×46 — та же сетка, что hero-*; BootScene
 * грузит их спрайтлистами, физика вида не меняется: хитбокс из
 * enemies.json, оффсет (68−w)/2 × (46−h) — лапы на базовой линии).
 *
 * Отличие от героя: масштаб листа не «вписать в клетку», а ЦЕЛЕВОЙ
 * drawH вида (высота нарисованного тела) — мобы обязаны читаться МЕНЬШЕ
 * героя (герой почти заполняет кадр 68×46). Целевые высоты подобраны к
 * хитбоксам видов (enemies.json size) с запасом ~1.6× на крылья/панцирь.
 *
 * Режимы:
 *   node scripts/process-mobs.mjs                — из design/raw/mobs/nana-pro/<id>-sheet.jpg
 *   node scripts/process-mobs.mjs --placeholder  — временные листы из СТАРЫХ
 *                  статичных текстур (4 одинаковых кадра), чтобы строить и
 *                  тестировать игру ДО прихода нейро-листов (сервис ждал
 *                  техобслуживание). Старые текстуры бэкапнуты в design/raw/mobs/old.
 *
 * Валидация: компонентов ровно 4 — иначе лист бракуется с перечнем
 * (куркация pick, как у героя: отредакруй sheets[i].pick руками).
 */
import sharp from 'sharp'
import path from 'node:path'
import fs from 'node:fs'

const HERE = path.dirname(fileURLToPathImport())
function fileURLToPathImport() { return import.meta.url.replace('file://', '') }

const ROOT = path.resolve(HERE, '..')
const SRC = path.join(ROOT, 'design/raw/mobs/nana-pro')
const OLD = path.join(ROOT, 'design/raw/mobs/old')
const OUT = path.join(ROOT, 'assets')
const PLACEHOLDER = process.argv.includes('--placeholder')

const FW = 68
const FH = 46
const BASELINE = FH - 2 // 44 — как у героя (baselinePad=2)

/** Целевая высота нарисованного тела вида, px (меньше героя!). */
const SPECIES = {
  slug:        { drawH: 22, name: 'мышевидный слизень' },
  bat:         { drawH: 26, name: 'пещерный нетопырь' },
  reaper:      { drawH: 36, name: 'споровый жнец' },
  bloodsucker: { drawH: 26, name: 'кровосос' },
  shell:       { drawH: 30, name: 'бронепанцирь' },
  lava:        { drawH: 26, name: 'лавовый ползун' },
}

/** Куркация кадров (после просмотра preview.png; индексы компонентов). */
const PICK = {}

const CFG = {
  keyTol: 55,
  edgeBand: 34,
  despill: 0.8,
  dilateR: 4,
  frames: 4,
}

const dist = (r, g, b, c) => Math.sqrt((r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2)

async function loadRaw(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}

/** Хромакей мадженты: BFS с краёв + полутоновая кромка + глобальная зачистка (из process-hero). */
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

/** Связные компоненты по дилатации, bbox по альфе; ряды → слева-направо. */
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
    if (area > 60) labels.push({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, area })
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
  const buf = await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
    .extract(box).png().toBuffer()
  return { buf, w: box.width, h: box.height }
}

/** Собрать лист: единый масштаб по ЦЕЛЕВОЙ высоте вида; низ=44, центр клетки. */
async function buildSheet(id, frames) {
  const target = SPECIES[id].drawH
  const maxH = Math.max(...frames.map((f) => f.h))
  const scale = Math.min(target / maxH, (FW - 4) / Math.max(...frames.map((f) => f.w)), (FH - 4) / maxH)
  const comps = []
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const rw = Math.max(1, Math.round(f.w * scale))
    const rh = Math.max(1, Math.round(f.h * scale))
    const resized = await sharp(f.buf).resize(rw, rh, { kernel: 'lanczos3' }).png().toBuffer()
    comps.push({ input: resized, left: Math.round((FW - rw) / 2) + i * FW, top: BASELINE - rh })
  }
  await sharp({
    create: { width: FW * frames.length, height: FH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(comps).png().toFile(path.join(OUT, `mob-${id}.png`))
  console.log(`  mob-${id}.png: ${FW * frames.length}×${FH}, масштаб ${scale.toFixed(3)} (цель drawH=${target}px), кадров ${frames.length}`)
}

/** Плейсхолдер: старая статичная текстура ×1.6 в 4 кадра (до прихода нейро). */
async function buildPlaceholder(id) {
  const old = await sharp(path.join(OLD, `mob-${id}.png`)).ensureAlpha().toBuffer({ resolveWithObject: true })
  const meta = await sharp(old.data).metadata()
  const rh = Math.min(SPECIES[id].drawH + 8, 42)
  const rw = Math.round(old.info.width * (rh / old.info.height))
  const resized = await sharp(old.data).resize(rw, rh, { kernel: 'lanczos3' }).png().toBuffer()
  const comps = []
  for (let i = 0; i < 4; i++) {
    comps.push({ input: resized, left: Math.round((FW - rw) / 2) + i * FW, top: BASELINE - rh })
  }
  await sharp({
    create: { width: FW * 4, height: FH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(comps).png().toFile(path.join(OUT, `mob-${id}.png`))
  console.log(`  mob-${id}.png: ПЛЕЙСХОЛДЕР из старой текстуры ${old.info.width}×${old.info.height} → ${rw}×${rh}`)
}

async function contactPreview() {
  const rows = Object.keys(SPECIES).map((id) => ({ id, file: `mob-${id}.png` }))
  const SCALE = 3
  const labelH = 14
  const totalH = rows.length * (labelH + FH * SCALE)
  const canvas = sharp({
    create: { width: FW * 4 * SCALE, height: totalH, channels: 4, background: { r: 24, g: 24, b: 34, alpha: 1 } },
  })
  const comps = []
  let y = 0
  for (const r of rows) {
    const f = path.join(OUT, r.file)
    if (!fs.existsSync(f)) continue
    const label = Buffer.from(`<svg width="${FW * 4 * SCALE}" height="${labelH}"><text x="4" y="11" font-family="monospace" font-size="11" fill="#8A8894">${r.id}</text></svg>`)
    comps.push({ input: label, left: 0, top: y })
    y += labelH
    const buf = await sharp(f).toBuffer()
    comps.push({ input: buf, left: 0, top: y })
    y += FH * SCALE
  }
  await canvas.composite(comps).png().toFile(path.join(ROOT, 'design/raw/mobs/preview-mobs.png'))
  console.log('preview-mobs.png записан')
}

async function main() {
  let failed = 0
  for (const id of Object.keys(SPECIES)) {
    console.log(`Вид ${id} (${SPECIES[id].name})`)
    if (PLACEHOLDER) {
      await buildPlaceholder(id)
      continue
    }
    const raw = path.join(SRC, `${id}-sheet.jpg`)
    if (!fs.existsSync(raw)) {
      console.warn(`!! ${id}-sheet.jpg нет — пропуск`)
      failed++
      continue
    }
    const img = chromaKey(await loadRaw(raw))
    const ordered = components(img)
    console.log(`  компонент: ${ordered.length} → ${ordered.map((c, i) => `#${i}:${c.width}×${c.height}`).join(' ')}`)
    const pick = PICK[id] ?? ordered.map((_, i) => i)
    if (pick.length !== CFG.frames || ordered.length < CFG.frames) {
      console.error(`  ✗ ${id}: компонентов ${ordered.length}, нужно ${CFG.frames} — брак (перезапусти генерацию или пропиши PICK.${id})`)
      failed++
      continue
    }
    const frames = []
    for (const i of pick) frames.push(await crop(img, ordered[i]))
    await buildSheet(id, frames)
  }
  await contactPreview()
  console.log(failed === 0 ? 'ГОТОВО' : `БРАК: ${failed}`)
  process.exitCode = failed === 0 ? 0 : 1
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
