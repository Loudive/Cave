// normalize-hero.mjs — ШАГ 17: консистентность размера спрайтов КАДРОВО.
// Жалоба: «спрайты персонажа будто бы разные по размеру: летит — маленький,
// стоит — нормальный, бежит в стороны — больше всех». Причина: нейро-листы
// масштабировались ПО ЛИСТУ (каждый лист вписан в свою клетку), позы одного
// тела давали разную площадь силуэта (glide 487-693 px, run до 1256 px).
// Решение (дорогое, а не дешёвое): послекадровая нормализация МАССОЙ —
// каждый кадр всех листов пересобирается так, чтобы площадь его силуэта
// (alpha>24) была равна глобальной цели TARGET. Форма позы сохраняется
// (галоп остаётся растянутым, мах — собранным), но «сколько существа на
// экране» — константа. Выравнивание: низ по базовой линии y=44 (та же
// конвенция, что process-hero.mjs: baselinePad=2), центр — по клетке.
//
// Конвейер: design/raw/v3-pre17/ (архив оригиналов) → assets/hero-*.png.
// Первый запуск сам архивирует текущие листы. Идемпотентен.
//
// Исключения: death кадры 3-4 (свернувшийся труп ДОЛЖЕН быть меньше —
// это драматургия, не баг консистентности).

import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const ROOT = path.resolve('.')
const SRC_DIR = path.join(ROOT, 'design/raw/v3-pre17')
const OUT_DIR = path.join(ROOT, 'assets')
const FW = 68
const FH = 46
const BASELINE = FH - 2 // 44: лапы на базовой линии (baselinePad=2)
const ALPHA_T = 24
const CLAMP = [0.85, 1.45]
const FIT_W = 66
const FIT_H = 43

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/config/anims.json'), 'utf8'))
const unwrap = (o) => (o && typeof o === 'object' && '_doc' in o && 'value' in o ? unwrap(o.value) : o)

const ANIMS = ['idle', 'run', 'glide', 'bite', 'eat', 'hurt', 'death']
/** Кадры, которые НЕ нормализуем (труп — меньше намеренно). */
const SKIP_FRAMES = { death: new Set([3, 4]) }

async function analyze(file) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true })
  const cols = Math.floor(info.width / FW)
  const rows = Math.floor(info.height / FH)
  const frames = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c
      let minx = 1e9, miny = 1e9, maxx = -1, maxy = -1, mass = 0
      for (let y = 0; y < FH; y++) {
        for (let x = 0; x < FW; x++) {
          const gx = c * FW + x
          const gy = r * FH + y
          const a = data[(gy * info.width + gx) * 4 + 3]
          if (a > ALPHA_T) {
            mass++
            if (x < minx) minx = x
            if (x > maxx) maxx = x
            if (y < miny) miny = y
            if (y > maxy) maxy = y
          }
        }
      }
      frames.push(maxx < 0 ? null : { col: c, row: r, x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1, mass })
    }
  }
  return { data, info, frames }
}

// ── 0. Архив оригиналов при первом запуске ──────────────────────────────
if (!fs.existsSync(SRC_DIR)) {
  fs.mkdirSync(SRC_DIR, { recursive: true })
  for (const name of ANIMS) {
    fs.copyFileSync(path.join(OUT_DIR, `hero-${name}.png`), path.join(SRC_DIR, `hero-${name}.png`))
  }
  console.log('архив оригиналов → design/raw/v3-pre17/ (первый запуск)')
}

// ── 1. Замер всех используемых кадров ───────────────────────────────────
const sheets = {}
const masses = []
for (const name of ANIMS) {
  const spec = cfg[name]
  const frames = unwrap(spec.frames)
  const order = unwrap(spec.order) ?? null
  // used = порядок анимации; для glide ДОБАВЛЯЕМ airborneFrame — статичный
  // кадр раскрытых крыльев (setFrame в Creature для прыжка/падения/сцепа):
  // это самый частый «воздушный» кадр, без него «летит — маленький».
  const airborne = name === 'glide' ? unwrap(cfg.airborneFrame) : null
  const used = order ?? Array.from({ length: frames }, (_, i) => i)
  const usedAll = airborne !== null && !used.includes(airborne) ? [...used, airborne] : used
  const an = await analyze(path.join(SRC_DIR, `hero-${name}.png`))
  const skip = SKIP_FRAMES[name] ?? new Set()
  sheets[name] = { an, used: usedAll, skip }
  for (const i of usedAll) {
    if (skip.has(i)) continue
    const f = an.frames[i]
    if (f) masses.push(f.mass)
  }
}
masses.sort((a, b) => a - b)
const TARGET = masses[Math.floor(masses.length / 2)]
console.log(`цель по массе (медиана ${masses.length} кадров): ${TARGET} px`)

// ── 2. Пересборка листов ────────────────────────────────────────────────
for (const name of ANIMS) {
  const { an, used, skip } = sheets[name]
  const usedSet = new Set(used)
  const comps = []
  const log = []
  for (let i = 0; i < an.frames.length; i++) {
    const f = an.frames[i]
    if (!f) continue
    const cellX = (i % Math.floor(an.info.width / FW)) * FW
    const cellY = Math.floor(i / Math.floor(an.info.width / FW)) * FH
    let s = 1
    let note = 'как есть'
    if (usedSet.has(i) && !skip.has(i)) {
      s = Math.sqrt(TARGET / f.mass)
      if (s < CLAMP[0]) { s = CLAMP[0]; note = 'кламп min' }
      if (s > CLAMP[1]) { s = CLAMP[1]; note = 'кламп max' }
      note += ` (${f.mass}→${Math.round(f.mass * s * s)})`
    } else if (skip.has(i)) {
      note = 'пропущен (труп)'
    }
    // вписать в клетку с сохранением пропорций
    const fit = Math.min(1, FIT_W / (f.w * s), FIT_H / (f.h * s))
    if (fit < 1) { s *= fit; note += ` вписан ×${fit.toFixed(2)}` }
    // Шаг 17: ВЫСОТА упёрлась в клетку (высокие позы: крылья вверх) — масса
    // недобирается. Компенсируем ШИРИНОЙ (анизотропно, но ≤66px): «сколько
    // существа» важнее пиксельно-точных пропорций высокого кадра.
    if (f.mass * s * s < TARGET * 0.92 && f.h * s >= FIT_H - 1) {
      const need = Math.sqrt((TARGET * 0.98) / (f.mass * s * s))
      const sx = Math.min(s * need, FIT_W / f.w)
      if (sx > s) { note += ` ширина ×${(sx / s).toFixed(2)} (высота в клетке)`; s = sx }
    }
    const rw = Math.max(1, Math.round(f.w * s))
    const rh = Math.max(1, Math.round(f.h * Math.min(s, FIT_H / f.h)))
    const resized = await sharp(an.data, { raw: { width: an.info.width, height: an.info.height, channels: 4 } })
      .extract({ left: cellX + f.x, top: cellY + f.y, width: f.w, height: f.h })
      .resize(rw, rh, { kernel: 'lanczos3' })
      .png().toBuffer()
    // низ по базовой линии, центр по клетке (конвенция process-hero.mjs)
    const left = cellX + Math.round((FW - rw) / 2)
    const top = cellY + BASELINE - rh
    comps.push({ input: resized, left, top })
    log.push(`#${i} ${f.w}x${f.h} м=${f.mass} ×${s.toFixed(3)} → ${rw}x${rh} м=${Math.round(f.mass * s * s)} ${note}`)
  }
  const cols = Math.floor(an.info.width / FW)
  const rows = Math.floor(an.info.height / FH)
  await sharp({
    create: { width: cols * FW, height: rows * FH, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(comps).png().toFile(path.join(OUT_DIR, `hero-${name}.png`))
  console.log(`hero-${name}.png:`)
  for (const l of log) console.log('  ' + l)
}
console.log('готово: все кадры приведены к единой визуальной массе')
