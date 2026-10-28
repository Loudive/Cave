/**
 * process-hero.mjs (v2) — обработка нейро-спрайтов героя (шаг 11).
 * Сырьё: Nano Banana Pro через ai.gptml.ru (стиль-контракт из гайда §7:
 * «dark fantasy cave monster, bioluminescent, palette #0B0B10 #58E6C8
 * #E23A4E, clean silhouette, game asset»), фон — чистая магента #FF00FF.
 *
 * Шаги: BFS-хромакей с краёв (JPEG-шум → допуск с запасом) → bbox по альфе →
 * ЕДИНЫЙ масштаб для всех кадров листа (иначе цикл «пульсирует») →
 * выравнивание кадров ПО НИЗУ (лапы на одной базовой линии) →
 * assets/hero-*.png (кадры 68×46, единые для Phaser).
 * Запуск: node scripts/process-hero.mjs /tmp/herogen2
 */
import sharp from 'sharp'
import path from 'node:path'

const SRC = process.argv[2] || '/tmp/herogen2'
const OUT = process.argv[3] || path.resolve('assets')

const CFG = {
  keyTol: 55,          // евклидов допуск фона (JPEG-шум по кромке)
  edgeBand: 34,        // полутоновая кромка
  despill: 0.8,        // снятие магентового ореола
  runCells: 4,
  glideCells: 4,       // Nano Banana дал 4 фазы маха — играем порядок 1→3→2→0
  cellW: 68,           // клетка листа ( Creature CREATURE_BODY рассчитан на 68×46)
  cellH: 46,
  baselinePad: 2,      // зазор под лапами, px
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
  // Глобальный анти-магента: JPEG хрома-субдискретизация заносит розовый
  // на тёмную шерсть. Тёмные пиксели (lum < 96) с красным перевесом —
  // гасим красный к сине-фиолетовому равновесию. Красная пасть (lum высок)
  // не трогается. Полупрозрачные магента-остатки — добиваем альфой.
  // Глобальная зачистка маджента-семьи: фон #FF00FF и его JPEG-тени —
  // r и b подняты над g и близки (|r-b| мал). Красная пасть (r >> b),
  // бирюза мембран (g высок) и фиолетовая шерсть (r<g) не задеваются.
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

function bbox(img) {
  const { data, w, h } = img
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) throw new Error('пустой кадр после хромакея')
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }
}


/** Связные компоненты по альфе: вернуть bbox N крупнейших, слева направо. */
function components(img, want) {
  const { data, w, h } = img
  const seen = new Uint8Array(w * h)
  const labels = []
  const stack = new Int32Array(w * h)
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || data[start * 4 + 3] < 30) continue
    let sp = 0
    stack[sp++] = start
    seen[start] = 1
    let x0 = w, y0 = h, x1 = -1, y1 = -1, area = 0
    while (sp > 0) {
      const i = stack[--sp]
      const x = i % w, y = (i / w) | 0
      area++
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1], [x + 1, y + 1], [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const ni = ny * w + nx
        if (seen[ni] || data[ni * 4 + 3] < 30) continue
        seen[ni] = 1
        stack[sp++] = ni
      }
    }
    labels.push({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1, area })
  }
  labels.sort((a, b) => b.area - a.area)
  const picked = labels.slice(0, want)
  picked.sort((a, b) => a.left - b.left)
  if (picked.length !== want) throw new Error(`компонент найдено ${picked.length}, нужно ${want}`)
  return picked
}

/** Вырезать кадр (bbox) и вернуть буфер + размеры. */
async function crop(img) {
  const box = bbox(img)
  const buf = await sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } })
    .extract(box).png().toBuffer()
  return { buf, w: box.width, h: box.height }
}

/**
 * Собрать лист. Режимы:
 *  'width'  — каждый кадр вписан по ШИРИНЕ (длина тела постоянна; высота
 *             варьирует естественно:.stride низкий, gather высокий) — бег;
 *  'common' — один масштаб на все кадры (мах крыла меняет bbox — иначе
 *             тело «пульсирует») — планирование.
 * Кадры выровнены по низу (лапы на базовой линии) и по центру клетки.
 */
async function buildSheet(frames, outName, mode) {
  const maxW = Math.max(...frames.map((f) => f.w))
  const maxH = Math.max(...frames.map((f) => f.h))
  // 'width': каждый кадр вписан по своей ширине (длина тела постоянна,
  // высота живёт naturally); 'common': один масштаб на весь лист.
  const scaleFor = (f) =>
    mode === 'width'
      ? Math.min((CFG.cellW - 4) / f.w, (CFG.cellH - CFG.baselinePad) / f.h)
      : Math.min((CFG.cellW - 4) / maxW, (CFG.cellH - CFG.baselinePad) / maxH)
  const comps = []
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    const scale = scaleFor(f)
    const rw = Math.max(1, Math.round(f.w * scale))
    const rh = Math.max(1, Math.round(f.h * scale))
    const resized = await sharp(f.buf).resize(rw, rh, { kernel: 'lanczos3' }).png().toBuffer()
    const left = Math.round((CFG.cellW - rw) / 2) + i * CFG.cellW
    const top = CFG.cellH - CFG.baselinePad - rh
    comps.push({ input: resized, left, top })
  }
  await sharp({
    create: { width: CFG.cellW * frames.length, height: CFG.cellH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(comps).png().toFile(path.join(OUT, outName))
  console.log(`${outName}: ${CFG.cellW * frames.length}x${CFG.cellH}, клеток ${frames.length}, режим ${mode}`)
}

/** Одиночный кадр: вписать в клетку по центру, общий масштаб не нужен. */
async function buildSingle(img, outName) {
  const c = await crop(img)
  const scale = Math.min(CFG.cellW / c.w, (CFG.cellH - CFG.baselinePad) / c.h)
  const rw = Math.max(1, Math.round(c.w * scale))
  const rh = Math.max(1, Math.round(c.h * scale))
  const resized = await sharp(c.buf).resize(rw, rh, { kernel: 'lanczos3' }).png().toBuffer()
  const left = Math.round((CFG.cellW - rw) / 2)
  const top = CFG.cellH - CFG.baselinePad - rh
  await sharp({
    create: { width: CFG.cellW, height: CFG.cellH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: resized, left, top }]).png().toFile(path.join(OUT, outName))
  console.log(`${outName}: ${rw}x${rh} в клетке ${CFG.cellW}x${CFG.cellH}`)
}

/** Нарезать лист на кадры: проекция альфы по колонкам -> сегменты. */
async function sliceSheet(img, cells) {
  const { data, w, h } = img
  const colHas = new Uint8Array(w)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      if (data[(y * w + x) * 4 + 3] > 30) { colHas[x] = 1; break }
    }
  }
  // Сегменты: непрерывные серии непустых колонок; разрывы > GAP объединяем
  // в один сегмент (осколки одного существа), существа между собой дальше.
  const GAP = 6
  const runs = []
  let start = -1, lastFilled = -1
  for (let x = 0; x < w; x++) {
    if (colHas[x]) {
      if (start === -1) start = x
      lastFilled = x
    } else if (start !== -1 && x - lastFilled > GAP) {
      runs.push({ left: start, right: lastFilled })
      start = -1
    }
  }
  if (start !== -1) runs.push({ left: start, right: lastFilled })
  runs.sort((a, b) => (b.right - b.left) - (a.right - a.left))
  const picked = runs.slice(0, cells).sort((a, b) => a.left - b.left)
  console.log(`  сегменты: ${runs.length} -> взято ${picked.length}, ширины ${picked.map(r => r.right - r.left + 1).join('/')}`)
  const out = []
  for (const r of picked) {
    const box = { left: r.left, top: 0, width: r.right - r.left + 1, height: h }
    const buf = await sharp(img.data, { raw: { width: w, height: h, channels: 4 } })
      .extract(box).png().toBuffer()
    const { data: cd, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    out.push(await crop({ data: cd, w: info.width, h: info.height }))
  }
  return out
}

// ── Бег: 4 клетки, нормализация по ширине ──────────────────────────────
{
  const img = chromaKey(await loadRaw('run_nb.png'))
  await buildSheet(await sliceSheet(img, CFG.runCells), 'hero-run.png', 'common')
}
// ── Планирование: 4 фазы маха, общий масштаб ─────────────────────────
{
  const img = chromaKey(await loadRaw('glide_nb.png'))
  await buildSheet(await sliceSheet(img, CFG.glideCells), 'hero-glide.png', 'common')
}
// ── Одиночные ──────────────────────────────────────────────────────────────
for (const [src, out] of [
  ['idle_nb.png', 'hero-idle.png'],
  ['bite_nb.png', 'hero-bite.png'],
  ['hurt_nb.png', 'hero-hurt.png'],
]) {
  await buildSingle(chromaKey(await loadRaw(src)), out)
}
console.log('ГОТОВО')
