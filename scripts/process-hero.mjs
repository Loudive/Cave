/**
 * process-hero.mjs (v3) — обработка нейро-спрайтов героя (шаг 11, переработка).
 *
 * ИСТОРИЯ БАГА (v2): buildSingle() резал одиночные листы (idle/bite/hurt) по
 * bbox() ВСЕГО листа — в одну текстуру 68×46 вписывались все 4 мыши листа
 * («записалось 4 картинки в одну» — цитата ревью пользователя). Связный
 * слайсер components() уже был в файле, но применялся только к run/glide.
 *
 * v3: ВСЕ листы режутся связными компонентами по альфе. Чтобы крыло/еда не
 * отрывались от тела в отдельные компоненты — сначала дилатация маски
 * (r=5px) для ПОИСКА компонент, bbox считаем по исходной альфе внутри
 * компоненты. Жёсткая валидация: ровно N компонент, лог ширин/высот,
 * контрольные контактные превью (contact sheet) для проверки глазами.
 *
 * Пайплайн: BFS-хромакей магенты с краёв → глобальная зачистка
 * маджента-семьи → дилатация → связные компоненты → N крупнейших слева
 * направо → ЕДИНЫЙ масштаб на лист (анти-пульсация) → выравнивание по
 * низу (базовая линия лап) → assets/hero-*.png (кадры 68×46).
 *
 * Запуск: node scripts/process-hero.mjs design/raw/v3 [assets]
 * Превью:  design/raw/v3/preview.png (все листы, клетки пронумерованы).
 */
import sharp from 'sharp'
import path from 'node:path'
import fs from 'node:fs'

const SRC = process.argv[2] || 'design/raw/v3'
const OUT = process.argv[3] || path.resolve('assets')

const CFG = {
  keyTol: 55,          // евклидов допуск фона (JPEG-шум по кромке)
  edgeBand: 34,        // полутоновая кромка
  despill: 0.8,        // снятие магентового ореола
  dilateR: 5,          // радиус дилатации по умолчанию (слипание осколков)
  cellW: 68,           // клетка листа (CREATURE_BODY рассчитан на 68×46)
  cellH: 46,
  baselinePad: 2,      // зазор под лапами, px
  // Листы шага 11 v3. dilateR — радиус слипания (у bite/eat/death кадры
  // ближе друг к другу — r=5 склеивает соседей, берём 2). pick — какие
  // компоненты (в порядке ряд-сверху-вниз → слева-направо) брать в лист
  // и в каком порядке: run-сетка 2×4 курирована глазами (VLM): #7 — дубль
  // #3, #1 слабый; death — 5 кадров (модель дала 5, не 6).
  sheets: [
    { name: 'idle', file: 'idle.png', frames: 4 },
    { name: 'run', file: 'run.png', frames: 6, pick: [0, 2, 3, 4, 5, 6] },
    { name: 'glide', file: 'glide.png', frames: 4, byLeft: true, pick: [0, 2, 3, 1] },
    { name: 'bite', file: 'bite.png', frames: 4, dilateR: 2 },
    { name: 'eat', file: 'eat.png', frames: 4, dilateR: 2 },
    { name: 'hurt', file: 'hurt.png', frames: 2 },
    { name: 'death', file: 'death.png', frames: 5, dilateR: 2 },
  ],
}

const dist = (r, g, b, c) => Math.sqrt((r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2)

async function loadRaw(file) {
  const { data, info } = await sharp(path.join(SRC, file))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, w: info.width, h: info.height }
}

/** Хромакей: BFS с краёв (магента) + полутоновая кромка у границы ключа. */
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
  // Кромка: частичная альфа + десписл только у соседей с ключом.
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
  // Глобальная зачистка маджента-семьи: фон #FF00FF и его JPEG-тени —
  // r и b подняты над g и близки (|r-b| мал). Красная пасть (r >> b),
  // бирюза мембран (g высок) и фиолетовая шерсть не задеваются.
  // Работает и на замкнутые карманы фона внутри силуэта (BFS их не достал).
  for (let i = 0; i < w * h; i++) {
    const o = i * 4
    if (px[o + 3] === 0) continue
    const r = px[o], g = px[o + 1], b = px[o + 2]
    if (r > g + 40 && b > g + 20 && Math.abs(r - b) < 70) {
      px[o + 3] = 0
    }
  }
  return img
}

/** Дилатация альфа-маски на r px (окно; хватает для слипания осколков). */
function dilateMask(img, r) {
  const { data: px, w, h } = img
  const src = new Uint8Array(w * h)
  for (let i = 0; i < w * h; i++) src[i] = px[i * 4 + 3] > 30 ? 1 : 0
  let cur = src
  // r проходов по 1px дешевле честного окна и достаточно.
  for (let pass = 0; pass < r; pass++) {
    const next = new Uint8Array(cur)
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x
        if (cur[i]) continue
        if (
          (x > 0 && cur[i - 1]) || (x < w - 1 && cur[i + 1]) ||
          (y > 0 && cur[i - w]) || (y < h - 1 && cur[i + w])
        ) next[i] = 1
      }
    }
    cur = next
  }
  return cur
}

/**
 * Связные компоненты ПО ДИЛАТИРОВАННОЙ маске, bbox по исходной альфе.
 * Порядок: РЯДАМИ сверху вниз, внутри ряда слева направо (Nano Banana
 * упорно кладёт 6-кадровые листы сеткой 2×4 — ряд-зависимая сортировка
 * превращает сетку в честную последовательность кадров).
 * Возвращает все компоненты (>= minArea) в порядке проигрывания;
 * выборка и порядок — на совести pick-схемы листа.
 */
function components(img, sheet, label) {
  const { data: px, w, h } = img
  const dilateR = sheet.dilateR ?? CFG.dilateR
  const mask = dilateMask(img, dilateR)
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
        // bbox только по реальным пикселям (дилатация — лишь транспорт).
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
    if (area > 40) labels.push({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, area })
  }
  // Ряды: кластеризация по top (расхождение > h/4 — новый ряд).
  // byLeft (полётные листы): тела на разной высоте — ряд один, порядок по left.
  const ordered = sheet.byLeft
    ? [...labels].sort((a, b) => a.left - b.left)
    : (() => {
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
      })()
  console.log(`  [${label}] компонент: ${labels.length} (порядок: ${sheet.byLeft ? 'по left (полёт)' : 'ряды→слева'}, dilate r=${dilateR}); ` +
    `${ordered.map((c, i) => `#${i}:${c.width}×${c.height}`).join(' ')}`)
  return ordered
}

/** Вырезать кадр (bbox) и вернуть буфер + размеры. */
async function crop(img, box) {
  const buf = await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
    .extract(box).png().toBuffer()
  return { buf, w: box.width, h: box.height }
}

/**
 * Собрать лист: ЕДИНЫЙ масштаб на все кадры (мах крыла/поза меняет bbox —
 * иначе тело «пульсирует»), кадры выровнены по низу (базовая линия лап)
 * и по центру своей клетки.
 */
async function buildSheet(frames, outName) {
  const maxW = Math.max(...frames.map((f) => f.w))
  const maxH = Math.max(...frames.map((f) => f.h))
  const scale = Math.min((CFG.cellW - 4) / maxW, (CFG.cellH - CFG.baselinePad) / maxH)
  const comps = []
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const rw = Math.max(1, Math.round(f.w * scale))
    const rh = Math.max(1, Math.round(f.h * scale))
    const resized = await sharp(f.buf).resize(rw, rh, { kernel: 'lanczos3' }).png().toBuffer()
    const left = Math.round((CFG.cellW - rw) / 2) + i * CFG.cellW
    const top = CFG.cellH - CFG.baselinePad - rh
    comps.push({ input: resized, left, top })
  }
  await sharp({
    create: { width: CFG.cellW * frames.length, height: CFG.cellH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(comps).png().toFile(path.join(OUT, `hero-${outName}.png`))
  console.log(`  hero-${outName}.png: ${CFG.cellW * frames.length}×${CFG.cellH}, клеток ${frames.length}, масштаб ${scale.toFixed(3)}`)
}

// ── Основной прогон ────────────────────────────────────────────────────
const previewRows = []
for (const sheet of CFG.sheets) {
  const rawPath = path.join(SRC, sheet.file)
  if (!fs.existsSync(rawPath)) {
    console.warn(`!! ${sheet.file} отсутствует — пропущен`)
    continue
  }
  console.log(`Лист ${sheet.name} (${sheet.file})`)
  const img = chromaKey(await loadRaw(sheet.file))
  const ordered = components(img, sheet, sheet.name)
  // pick — индексы компонентов в порядке ряд→слева-направо (курирование
  // по нумерованному превью scripts/numbered-sheet.mjs + VLM); по умолчанию — все по порядку.
  const idx = sheet.pick ?? ordered.map((_, i) => i)
  for (const i of idx) {
    if (i >= ordered.length) throw new Error(`[${sheet.name}] pick ссылается на #${i}, а компонентов ${ordered.length}`)
  }
  if (idx.length !== sheet.frames) {
    throw new Error(`[${sheet.name}] pick даёт ${idx.length} кадров, заявлено ${sheet.frames}`)
  }
  const frames = []
  for (const i of idx) frames.push(await crop(img, ordered[i]))
  await buildSheet(frames, sheet.name)
  previewRows.push({ name: sheet.name, file: `hero-${sheet.name}.png`, frames: frames.length })
}

// ── Контактное превью: все листы стеком, клетки пронумерованы ──────────
if (previewRows.length > 0) {
  const SCALE = 3
  const labelH = 14
  let totalH = 0
  for (const r of previewRows) totalH += labelH + CFG.cellH * SCALE
  const maxW = Math.max(...previewRows.map((r) => r.frames)) * CFG.cellW * SCALE
  const canvas = sharp({
    create: { width: maxW, height: totalH, channels: 4, background: { r: 24, g: 24, b: 34, alpha: 1 } },
  })
  const comps = []
  let y = 0
  for (const r of previewRows) {
    const label = Buffer.from(`<svg width="${maxW}" height="${labelH}">
      <text x="4" y="11" font-family="monospace" font-size="11" fill="#8A8894">${r.name} (${r.frames}f)</text></svg>`)
    comps.push({ input: label, left: 0, top: y })
    y += labelH
    const buf = await sharp(path.join(OUT, r.file)).png().toBuffer()
    const meta = await sharp(buf).metadata()
    comps.push({ input: buf, left: 0, top: y })
    // Номера клеток
    for (let i = 0; i < r.frames; i++) {
      const num = Buffer.from(`<svg width="18" height="14">
        <text x="2" y="11" font-family="monospace" font-size="11" fill="#E8A34F">${i}</text></svg>`)
      comps.push({ input: num, left: i * CFG.cellW * SCALE + 3, top: y + CFG.cellH * SCALE - 14 })
    }
    y += CFG.cellH * SCALE
  }
  await canvas.composite(comps).png().toFile(path.join(SRC, 'preview.png'))
  console.log(`preview.png: ${maxW}×${totalH} → ${path.join(SRC, 'preview.png')}`)
}
console.log('ГОТОВО')
