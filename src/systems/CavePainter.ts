/**
 * CavePainter.ts — шаг 15: ЗАПЕЧЁННЫЙ ОРГАНИЧЕСКИЙ РЕНДЕР ПЕЩЕР.
 *
 * Жалоба игрока (шаг 14 → 15): «Как были острые края от поганых квадратов,
 * так и остались. Нет фонов, нет нормальных пещер». Корень зла: тайловая
 * сетка 16×16 КВАНТУЕТ силуэт стен в лестницу из квадратов — какой бы
 * органичной ни была генерация (супердиски с дрожанием края), рендер
 * всё равно режет её в машину. Тайловый автотайл починить это не может
 * в принципе: сетка есть сетка.
 *
 * Схема шага 15 (референсы Hollow Knight / Blasphemous / Hidden Deep):
 *  · Физика ОСТАЁТСЯ на тайлмапе (невидимом) — ноль риска для геймплея.
 *  · ВИЗУАЛ стен запекается ОДИН РАЗ в canvas: мелкая сетка ×4 →
 *    marching squares → контуры → шумовое дрожание вершин → сглаживание
 *    Чайкина → НИ ОДНОГО прямого угла в силуэте.
 *  · Толща: бесшовный паттерн страт + затемнение по BFS-глубине (3D-масса,
 *    Hidden Deep) + AO-кромка.
 *  · Кромки: rim-light на полах (Hollow Knight), тень под потолками,
 *    сталактиты/сталагматы/наросты, мох и микрокристаллы цвета биома.
 *  · Запечёнка режется на чанки ≤ chunks.size px (лимиты текстур GPU);
 *    декор не пересекает границы чанков — швов нет. Чанки кулятся камерой.
 *
 * Чистый canvas 2D → нулевая стоимость в кадре (статичные картинки).
 */
import Phaser from 'phaser'
import type { CaveData } from '../gen/cave'
import { PAINTER } from '../config/painter'
import { GEN } from '../config/gen'
import { Rng, hashSeed } from '../gen/rng'
import { Noise2D } from '../gen/noise'
import { depthMap } from './TileBuilder'

// ── Палитра проекта (design/DECISIONS.md; дублируется намеренно, как в
// generate-assets.mjs — генерация самодостаточна) ─────────────────────────
const PAL = {
  bg: '#0b0b10',
  ink: '#040408',
  rockVoid: '#181826',
  rockDeep: '#20202f',
  rockDark: '#282838',
  rockMid: '#34344a',
  rockLight: '#48485e',
  rockStrata: '#2b2b40',
}

/** '#58e6c8' → {r,g,b}. */
function hexRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace('#', ''), 16)
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex)
  return `rgba(${r},${g},${b},${a})`
}

/** Точка контура в px мира. */
interface Pt {
  x: number
  y: number
}

/** Класс кромки отн. воздуха: пол / потолок / отвес. */
type EdgeClass = 'floor' | 'ceiling' | 'side'

// ── 0. Шумовая эрозия (лечит «террасы» тайловой сетки) ───────────────────

/**
 * erodeCave — размывает границу породы коррелированным value-шумом.
 *
 * Замер шага 15: даже органичная генерация режет сетку 16×16 — 66% границы
 * составляют ОСЕВЫЕ отрезки (0°/90°), «террасы» по 50–100px. Чайкин
 * сглаживает углы, но прямые прогоны остаются прямыми — машинный вид,
 * жалоба игрока «острые края от поганых квадратов».
 *
 * Решение (классика Noita/Terraria-генерации): тайлы глубины 1 с шумом
 * выше порога уходят в воздух — граница начинает следовать ИЗОЛИНИЯМ
 * шума, осевость исчезает. Глубина 2 эродируется редко (глубокие укусы).
 * Эрозия детерминирована (seed → тот же мир) и только ДОБАВЛЯЕТ воздух,
 * поэтому связность не может упасть. Вызывать ПОСЛЕ generateCave и ДО
 * всех систем сцены (физика/спавны/декор видят эродированный мир).
 */
export function erodeCave(cave: CaveData): void {
  const E = PAINTER.erode
  const depth = depthMap(cave)
  const noise = new Noise2D(hashSeed(cave.seed + ':erode'))
  const W = cave.cols
  const H = cave.rows
  const sc = E.tileNoiseScale
  const protect = E.borderProtect
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (cave.solid[i] !== 1) continue
      const d = depth[i]
      if (d < 1 || d > 2) continue
      if (x < protect || y < protect || x >= W - protect || y >= H - protect) continue
      const n = noise.value(x * sc, y * sc)
      const carve = d === 1 ? n > E.tileNearThr : n > E.tileDeepThr
      if (carve) {
        cave.solid[i] = 0
        cave.decor[i] = 0
        cave.ground[i] = 0
      }
    }
  }
}

// ── 1. Мелкая сетка + marching squares → направленные отрезки ────────────

/** Твёрдость мелкой ячейки (субъячейка тайла) с субъячейстой эрозией. */
function fineSolid(cave: CaveData, fx: number, fy: number, depth: Uint8Array, erodeNoise: Noise2D): boolean {
  const S = PAINTER.grid.scale
  if (fx < 0 || fy < 0 || fx >= cave.cols * S || fy >= cave.rows * S) {
    return PAINTER.grid.latticeInflate
  }
  const ti = (fy >> 2) * cave.cols + (fx >> 2)
  if (cave.solid[ti] !== 1) return false
  // Субъячеистая эрозия: внутри ГРАНИЧНЫХ тайлов (глубина 1) шум выгрызает
  // 4px-фрагменты — субтайловый рваный край. Расхождение с физикой ≤ 4px.
  if (depth[ti] === 1) {
    const cell = GEN.map.tile / S
    const n = erodeNoise.value(fx * cell * PAINTER.erode.fineNoiseScale, fy * cell * PAINTER.erode.fineNoiseScale)
    if (n > PAINTER.erode.fineThr) return false
  }
  return true
}

interface Seg {
  ax: number
  ay: number
  bx: number
  by: number
}

/**
 * Marching squares с конвенцией «твёрдое СЛЕВА от направления a→b»
 * (направленность нужна для сборки замкнутых контуров и для того, чтобы
 * нормаль воздуха всегда была справа). Координаты — удвоенные решётчатые
 * (полутайлы точек середины рёбер остаются целыми).
 */
function marchingSquares(cave: CaveData, depth: Uint8Array, erodeNoise: Noise2D): Seg[] {
  const S = PAINTER.grid.scale
  const W = cave.cols * S
  const H = cave.rows * S
  const segs: Seg[] = []
  const push = (
    ax: number, ay: number, bx: number, by: number,
  ): void => { segs.push({ ax: ax * 2, ay: ay * 2, bx: bx * 2, by: by * 2 }) }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const tl = fineSolid(cave, x, y, depth, erodeNoise)
      const tr = fineSolid(cave, x + 1, y, depth, erodeNoise)
      const br = fineSolid(cave, x + 1, y + 1, depth, erodeNoise)
      const bl = fineSolid(cave, x, y + 1, depth, erodeNoise)
      const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0)
      // Середины рёбер ячейки.
      const tX = x + 0.5, tY = y
      const bX = x + 0.5, bY = y + 1
      const lX = x, lY = y + 0.5
      const rX = x + 1, rY = y + 0.5
      switch (c) {
        case 0: case 15: break
        case 1: push(bX, bY, lX, lY); break
        case 2: push(rX, rY, bX, bY); break
        case 3: push(rX, rY, lX, lY); break
        case 4: push(tX, tY, rX, rY); break
        case 5: push(tX, tY, rX, rY); push(bX, bY, lX, lY); break
        case 6: push(tX, tY, bX, bY); break
        case 7: push(tX, tY, lX, lY); break
        case 8: push(lX, lY, tX, tY); break
        case 9: push(bX, bY, tX, tY); break
        case 10: push(lX, lY, tX, tY); push(rX, rY, bX, bY); break
        case 11: push(rX, rY, tX, tY); break
        case 12: push(lX, lY, rX, rY); break
        case 13: push(bX, bY, rX, rY); break
        case 14: push(lX, lY, bX, bY); break
        default: break
      }
    }
  }
  return segs
}

// ── 2. Сборка замкнутых контуров из отрезков ──────────────────────────────

const KEY_STRIDE = 16384

function keyOf(x: number, y: number): number {
  return x * KEY_STRIDE + y
}

/** Цепочка отрезков в замкнутые полилинии (решётка замкнута — контуры петли). */
function assembleLoops(segs: Seg[]): number[][] {
  const startMap = new Map<number, number>()
  const used = new Uint8Array(segs.length)
  for (let i = 0; i < segs.length; i++) {
    startMap.set(keyOf(segs[i].ax, segs[i].ay), i)
  }
  const loops: number[][] = []
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue
    const chain: number[] = [i]
    used[i] = 1
    let endKey = keyOf(segs[i].bx, segs[i].by)
    let guard = segs.length + 1
    while (guard-- > 0) {
      const next = startMap.get(endKey)
      if (next === undefined || used[next]) break
      used[next] = 1
      chain.push(next)
      endKey = keyOf(segs[next].bx, segs[next].by)
    }
    // Полная петля: конец последнего == начало первого.
    const first = segs[chain[0]]
    if (keyOf(first.ax, first.ay) !== endKey || chain.length < 4) continue
    loops.push(chain)
  }
  return loops
}

// ── 3. Упрощение → дрожание → Чайкин ──────────────────────────────────────

/** Полилиния в px из цепочки отрезков. */
function chainToPts(segs: Seg[], chain: number[]): Pt[] {
  const pts: Pt[] = []
  const cs = GEN.map.tile / PAINTER.grid.scale / 2
  for (const i of chain) {
    const s = segs[i]
    pts.push({ x: s.ax * cs, y: s.ay * cs })
  }
  return pts
}

/** Выкинуть коллинеарные точки (прямые прогоны сжимаются в 2 точки). */
function simplify(pts: Pt[]): Pt[] {
  const n = pts.length
  const out: Pt[] = []
  for (let i = 0; i < n; i++) {
    const a = pts[(i + n - 1) % n]
    const b = pts[i]
    const c = pts[(i + 1) % n]
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
    const run = Math.hypot(c.x - a.x, c.y - a.y)
    // Порог в px² площади: точка почти на отрезке a→c — не нужна.
    if (Math.abs(cross) > run * 0.02 + 0.01) out.push(b)
  }
  return out
}

/** Коррелированное дрожание вершин (не белый шум — живая волна). */
function jitter(pts: Pt[], nx: Noise2D, ny: Noise2D, seed: number): void {
  const amp = PAINTER.smooth.jitterAmp
  const sc = PAINTER.smooth.jitterScale
  for (const p of pts) {
    p.x += (nx.value(p.x * sc + seed, p.y * sc) - 0.5) * 2 * amp
    p.y += (ny.value(p.x * sc, p.y * sc + seed) - 0.5) * 2 * amp
  }
}

/** Сглаживание Чайкина замкнутой полилинии. */
function chaikin(pts: Pt[]): Pt[] {
  let cur = pts
  for (let it = 0; it < PAINTER.smooth.chaikinIters; it++) {
    const out: Pt[] = []
    const n = cur.length
    for (let i = 0; i < n; i++) {
      const a = cur[i]
      const b = cur[(i + 1) % n]
      out.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 })
      out.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 })
    }
    cur = out
  }
  return cur
}

/** Слить подряд идущие точки ближе minDist (анти-микрозигзаг). */
function dedupe(pts: Pt[], minDist: number): Pt[] {
  const out: Pt[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p)
  }
  while (out.length > 2) {
    const last = out[out.length - 1]
    if (Math.hypot(out[0].x - last.x, out[0].y - last.y) < minDist) out.pop()
    else break
  }
  return out
}

// ── 3.5. Контурное смещение (добивание «лестницы») ──────────────────────

/**
 * displaceContours — сдвиг вершин контура вдоль нормали воздуха
 * многооктавным шумом от дуги. После эрозии + Чайкина остаются плоские
 * прогоны 20–60px со сбросами 1–2px (замер: «читается как сетка»).
 * Потолки и отвесы качает на otherAmp — большие органические волны
 * (там расхождение с физикой нечувствительно), полы лишь на floorAmp —
 * существо стоит на картинке, а не в воздухе.
 */
function displaceContours(polys: Pt[][], seed: number): void {
  const D = PAINTER.displace
  const mega = new Noise2D(seed)
  const slow = new Noise2D(seed ^ 0x9e3779b9)
  const fast = new Noise2D(seed ^ 0x51ed270b)
  for (const poly of polys) {
    const n = poly.length
    // Средние нормали вершин (полусумма нормалей смежных сегментов).
    const norms: Pt[] = []
    for (let i = 0; i < n; i++) {
      const a = poly[(i + n - 1) % n]
      const b = poly[i]
      const c = poly[(i + 1) % n]
      const n1 = airNormal(a, b)
      const n2 = airNormal(b, c)
      let nx = n1.x + n2.x
      let ny = n1.y + n2.y
      const l = Math.hypot(nx, ny) || 1
      nx /= l
      ny /= l
      norms.push({ x: nx, y: ny })
    }
    // Дуга от первой вершины.
    let arc = 0
    for (let i = 0; i < n; i++) {
      const p = poly[i]
      const a = arc
      if (i > 0) {
        const prev = poly[i - 1]
        arc += Math.hypot(p.x - prev.x, p.y - prev.y)
      }
      const nrm = norms[i]
      const isFloor = nrm.y < -PAINTER.rim.slopeFrac
      const amp = isFloor ? D.floorAmp : D.otherAmp
      // Три октавы: МЕГА-волны (макро-органика, период ~250px — туннели
      // генератора горизонтальны в тайлах, микросглаживание их не лечит)
      // + средние волны рельефа + мелкая рябь.
      const m = mega.value(a * D.megaFreq, 0.5)
      const s = slow.value(a * D.slowFreq, 1)
      const f = fast.value(a * D.fastFreq, 2)
      const rest = 1 - D.megaShare
      const k = (m * D.megaShare + s * rest * (1 - D.fastShare) + f * rest * D.fastShare - 0.5) * 2
      p.x += nrm.x * k * amp
      p.y += nrm.y * k * amp
    }
  }
}

// ── 4. Бесшовный паттерн породы со стратами ───────────────────────────────

/** Y-координата верхней границы полосы b (для волнистых линий страт). */
function bandYof(b: number, heights: number[], hScale: number): number {
  let y = 0
  for (let i = 0; i < b && i < heights.length; i++) y += heights[i] * hScale
  return y
}

/** Тайл-паттерн: горизонтальные напластования + зерно. */
function makeRockPattern(): HTMLCanvasElement {
  const size = PAINTER.pattern.patternSize
  const cv = document.createElement('canvas')
  cv.width = size
  cv.height = size
  const ctx = cv.getContext('2d')!
  const rnd = new Rng(9150)
  const noise = new Noise2D(9151)
  const bands = PAINTER.pattern.bands
  const bandColors = [PAL.rockVoid, PAL.rockDeep, PAL.rockDark, PAL.rockStrata, PAL.rockDark, PAL.rockDeep, PAL.rockMid]
  // Шаг 15: ВЫСОТЫ полос нерегулярны (шум) — равномерные страты читались
  // как «игровая сетка». Бесшовность по вертикали: сумма высот = size.
  const heights: number[] = []
  let hSum = 0
  for (let b = 0; b < bands; b++) {
    const h = size / bands * (0.55 + noise.value(b * 3.1, 7.7) * 0.9)
    heights.push(h)
    hSum += h
  }
  const hScale = size / hSum
  let bandY = 0
  for (let b = 0; b < bands; b++) {
    const base = bandColors[b % bandColors.length]
    const y0 = Math.round(bandY)
    bandY += heights[b] * hScale
    const y1 = Math.round(bandY)
    ctx.fillStyle = base
    ctx.fillRect(0, y0, size, y1 - y0)
    for (let y = y0; y < y1; y++) {
      // Дрожание яркости строки.
      const j = (rnd.float() - 0.5) * PAINTER.pattern.bandJitter
      if (j > 0.12) {
        ctx.fillStyle = rgba(PAL.rockLight, 0.05)
        ctx.fillRect(0, y, size, 1)
      }
    }
  }
  // Зерно породы.
  for (let i = 0; i < PAINTER.pattern.grainSpecks; i++) {
    const x = Math.floor(rnd.float() * size)
    const y = Math.floor(rnd.float() * size)
    const w = 1 + Math.floor(rnd.float() * 3)
    ctx.fillStyle = rnd.float() > 0.5
      ? rgba(PAL.rockLight, PAINTER.pattern.speckAlpha)
      : rgba(PAL.ink, PAINTER.pattern.speckAlpha)
    ctx.fillRect(x, y, w, 1)
  }
  // Страты: тонкие светлые линии на границах полос (напластования читаются).
  // Шаг 15: граница полосы волнистая по X (bandWaviness) — не прямая линия.
  for (let b = 1; b < bands; b++) {
    const yb = Math.round(bandYof(b, heights, hScale))
    for (let x = 0; x < size; x++) {
      const off = Math.round((noise.value(x / size * 9, b * 11.3) - 0.5) * PAINTER.pattern.bandWaviness)
      ctx.fillStyle = rgba(PAL.rockLight, 0.1)
      ctx.fillRect(x, yb + off, 1, 1)
      ctx.fillStyle = rgba(PAL.ink, 0.22)
      ctx.fillRect(x, yb + off + 1, 1, 1)
    }
  }
  return cv
}

// ── 5. Классификация кромок ───────────────────────────────────────────────

/** Нормаль в сторону воздуха для сегмента (справа от направления). */
function airNormal(a: Pt, b: Pt): Pt {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  return { x: -dy / len, y: dx / len }
}

/**
 * Класс кромки по нормали воздуха (справа от направления обхода,
 * твёрдое всегда слева). Потолок = камень НАД воздухом: нормаль воздуха
 * смотрит ВНИЗ (+y). Пол = камень ПОД воздухом: нормаль ВВЕРХ (−y).
 */
function classify(n: Pt): EdgeClass {
  if (n.y < -PAINTER.rim.slopeFrac) return 'floor'
  if (n.y > PAINTER.ceiling.slopeFrac) return 'ceiling'
  return 'side'
}

// ── 6. Запекание ──────────────────────────────────────────────────────────

export interface PaintedCave {
  /** Чанки-картинки (для куллинга сценой). */
  chunks: Phaser.GameObjects.Image[]
  /** Прямоугольники чанков в мировых px. */
  rects: Phaser.Geom.Rectangle[]
  /** Слой, на котором стоит запечёнка. */
  depth: number
  /** Убрать текстуры (шатдаун сцены / перегенерация). */
  destroy(): void
}

/** Префикс текстур запечёнки. */
const TEX_PREFIX = 'cave-bake-'

/** Биом-полоса в точке (px). */
function bandAt(cave: CaveData, x: number, y: number): number {
  const tx = Math.min(cave.cols - 1, Math.max(0, Math.floor(x / GEN.map.tile)))
  const ty = Math.min(cave.rows - 1, Math.max(0, Math.floor(y / GEN.map.tile)))
  return cave.biomes[ty * cave.cols + tx]
}

/** Максимум мшистости/кристалльности по полосам (нормировка без магии). */
function maxOf(field: 'moss' | 'crystal'): number {
  let m = 0
  for (const b of GEN.biomeBands) m = Math.max(m, b[field])
  return m || 1
}

export function paintCave(scene: Phaser.Scene, cave: CaveData, depthLayer: number): PaintedCave {
  const worldW = cave.cols * GEN.map.tile
  const worldH = cave.rows * GEN.map.tile
  const big = document.createElement('canvas')
  big.width = worldW
  big.height = worldH
  const ctx = big.getContext('2d')!

  // Карта глубины и шум эрозии — до контуров (нужны fineSolid).
  const depth1 = depthMap(cave)
  const erodeNoise = new Noise2D(hashSeed(cave.seed + ':erode-fine'))

  // Контуры.
  const segs = marchingSquares(cave, depth1, erodeNoise)
  const loops = assembleLoops(segs)
  const nx = new Noise2D(hashSeed(cave.seed + PAINTER.salt.jitter))
  const ny = new Noise2D(hashSeed(cave.seed + PAINTER.salt.jitter + '~'))
  const js = hashSeed(cave.seed + PAINTER.salt.jitter + '#')
  const polys: Pt[][] = []
  for (const chain of loops) {
    let pts = chainToPts(segs, chain)
    pts = simplify(pts)
    if (pts.length < 4) continue
    jitter(pts, nx, ny, js)
    pts = chaikin(pts)
    pts = dedupe(pts, 1.2)
    if (pts.length >= 4) polys.push(pts)
  }
  // Шаг 15: контурное смещение — большие органические волны по потолкам
  // и стенам (полы почти на месте: существо стоит на картинке).
  displaceContours(polys, hashSeed(cave.seed + ':displace'))

  // Path2D всех стен (evenodd — внутренние дыры заливаются корректно).
  const wallPath = new Path2D()
  for (const poly of polys) {
    wallPath.moveTo(poly[0].x, poly[0].y)
    for (let i = 1; i < poly.length; i++) wallPath.lineTo(poly[i].x, poly[i].y)
    wallPath.closePath()
  }

  // База: паттерн страт.
  const patternCv = makeRockPattern()
  const pattern = ctx.createPattern(patternCv, 'repeat')!
  ctx.fillStyle = pattern
  ctx.fill(wallPath, 'evenodd')

  // Толща темнеет вглубь от воздуха (BFS-глубина, Hidden Deep).
  const dCv = document.createElement('canvas')
  dCv.width = cave.cols
  dCv.height = cave.rows
  const dCtx = dCv.getContext('2d')!
  const dImg = dCtx.createImageData(cave.cols, cave.rows)
  const [ir, ig, ib] = hexRgb(PAINTER.ao.color)
  for (let i = 0; i < cave.cols * cave.rows; i++) {
    const o = i * 4
    if (cave.solid[i] !== 1) {
      dImg.data[o + 3] = 0
      continue
    }
    const d = depth1[i]
    const a = d <= 1 ? PAINTER.depth.nearAlpha : Math.min(PAINTER.depth.maxAlpha, PAINTER.depth.nearAlpha + (d - 1) * PAINTER.depth.step)
    dImg.data[o] = ir
    dImg.data[o + 1] = ig
    dImg.data[o + 2] = ib
    dImg.data[o + 3] = Math.round(a * 255)
  }
  dCtx.putImageData(dImg, 0, 0)
  ctx.save()
  ctx.clip(wallPath, 'evenodd')
  ctx.imageSmoothingEnabled = true
  ctx.globalAlpha = 1
  ctx.drawImage(dCv, 0, 0, worldW, worldH)

  // AO-кромка: три штриха изнутри стены (клип не выпускает наружу).
  const aoW = PAINTER.ao.widths
  const aoA = PAINTER.ao.alphas
  for (let i = 0; i < aoW.length; i++) {
    ctx.strokeStyle = rgba(PAINTER.ao.color, aoA[i])
    ctx.lineWidth = aoW[i]
    ctx.lineJoin = 'round'
    ctx.stroke(wallPath)
  }
  ctx.restore()

  // Кромки: полы / потолки / отвесы — прогон по всем контурам.
  const rngStalactite = new Rng(hashSeed(cave.seed + PAINTER.salt.stalactite))
  const rngStalagmite = new Rng(hashSeed(cave.seed + PAINTER.salt.stalagmite))
  const rngBumps = new Rng(hashSeed(cave.seed + PAINTER.salt.bumps))
  const rngMoss = new Rng(hashSeed(cave.seed + PAINTER.salt.moss))
  const rngCrys = new Rng(hashSeed(cave.seed + PAINTER.salt.crystals))
  const maxMoss = maxOf('moss')
  const maxCrys = maxOf('crystal')

  // Полы: rim-light (клипом — линия прижимается внутрь стены).
  ctx.save()
  ctx.clip(wallPath, 'evenodd')
  const rimPath = new Path2D()
  const addRuns = (cls: EdgeClass, target: Path2D, minLen: number): void => {
    for (const poly of polys) {
      let run: Pt[] = []
      const flush = (): void => {
        if (run.length >= 2) {
          let len = 0
          for (let i = 1; i < run.length; i++) len += Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y)
          if (len >= minLen) {
            target.moveTo(run[0].x, run[0].y)
            for (let i = 1; i < run.length; i++) target.lineTo(run[i].x, run[i].y)
          }
        }
        run = []
      }
      const n = poly.length
      for (let i = 0; i < n; i++) {
        const a = poly[i]
        const b = poly[(i + 1) % n]
        if (classify(airNormal(a, b)) === cls) {
          if (run.length === 0) run.push(a)
          run.push(b)
        } else flush()
      }
      flush()
    }
  }
  addRuns('floor', rimPath, 6)
  ctx.strokeStyle = rgba(PAINTER.rim.tint, PAINTER.rim.glowAlpha)
  ctx.lineWidth = PAINTER.rim.glowWidth
  ctx.lineCap = 'round'
  ctx.stroke(rimPath)
  ctx.strokeStyle = rgba(PAINTER.rim.tint, PAINTER.rim.coreAlpha)
  ctx.lineWidth = PAINTER.rim.coreWidth
  ctx.stroke(rimPath)
  ctx.restore()

  // Потолки: мягкая тень СНАРУЖИ под сводом (свет умирает под потолком).
  addRunsLocal(ctx, polys, 'ceiling', PAINTER.ceiling.underShadowWidth, PAINTER.ceiling.underShadowAlpha, PAINTER.ceiling.underShadowWidth * 0.5)

  // Декор кромок. Шаг вдоль контура,ItemType выбирается классом кромки.
  const chunk = PAINTER.chunks.size
  const crossesChunk = (x0: number, y0: number, x1: number, y1: number): boolean =>
    Math.floor(Math.max(0, x0) / chunk) !== Math.floor(Math.min(worldW - 1, x1) / chunk) ||
    Math.floor(Math.max(0, y0) / chunk) !== Math.floor(Math.min(worldH - 1, y1) / chunk)

  interface Spot {
    p: Pt
    n: Pt
    cls: EdgeClass
    band: number
  }
  /** Непрерывный обход дуги: отсчёт до следующего предмета тикает по ВСЕМ
   * сегментам (и «чужим»), а предмет ставится только на сегментах нужного
   * класса. Дает ровный шаг вдоль кромки без скоплений на стыках прогонов. */
  const walkEdges = (
    cls: EdgeClass, spacing: number, rng: Rng, visitor: (s: Spot) => void,
  ): void => {
    for (const poly of polys) {
      let acc = rng.float() * spacing
      const n = poly.length
      for (let i = 0; i < n; i++) {
        const a = poly[i]
        const b = poly[(i + 1) % n]
        const norm = airNormal(a, b)
        const len = Math.hypot(b.x - a.x, b.y - a.y)
        if (len < 0.001) continue
        if (classify(norm) === cls) {
          while (acc < len) {
            const u = acc / len
            const px = a.x + (b.x - a.x) * u
            const py = a.y + (b.y - a.y) * u
            visitor({ p: { x: px, y: py }, n: norm, cls, band: bandAt(cave, px, py) })
            acc += spacing * (0.7 + rng.float() * 0.6)
          }
        }
        acc -= len
        if (acc < 0) acc = rng.float() * spacing
      }
    }
  }

  // Потолочные сталактиты — главный органический силуэт пещеры.
  // n — нормаль воздуха, у потолка смотрит ВНИЗ: сталактит растёт вдоль неё.
  const ST = PAINTER.stalactites
  walkEdges('ceiling', ST.spacing, rngStalactite, ({ p, n }) => {
    const len = ST.lenMin + rngStalactite.float() * (ST.lenMax - ST.lenMin)
    const w = ST.widthMin + rngStalactite.float() * (ST.widthMax - ST.widthMin)
    const curve = (rngStalactite.float() - 0.5) * 2 * ST.curve * len
    const ux = n.x, uy = n.y
    const tx = -uy, ty = ux
    const tipX = p.x + ux * len + curve
    const tipY = p.y + uy * len
    const x0 = p.x - tx * w, y0 = p.y - ty * w
    const x1 = p.x + tx * w, y1 = p.y + ty * w
    if (crossesChunk(Math.min(x0, x1, tipX) - 2, Math.min(y0, y1, tipY) - 2, Math.max(x0, x1, tipX) + 2, Math.max(y0, y1, tipY) + 2)) return
    // Спинка — темнее и чуть шире (глубина пещеры за сталактитом).
    const wb = w * (1 + ST.backShade)
    ctx.fillStyle = rgba(PAL.rockDeep, 0.92)
    ctx.beginPath()
    ctx.moveTo(p.x - tx * wb, p.y - ty * wb)
    ctx.quadraticCurveTo(p.x + curve * 0.5 - tx * w * ST.drop, p.y + uy * len * 0.6, tipX, tipY)
    ctx.quadraticCurveTo(p.x + curve * 0.5 + tx * w * ST.drop, p.y + uy * len * 0.6, p.x + tx * wb, p.y + ty * wb)
    ctx.closePath()
    ctx.fill()
    // Тело: сужение к кончику, последняя треть — тупой облом.
    ctx.fillStyle = PAL.rockDark
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    const midY = p.y + uy * len * 0.55
    const tipFlatY = tipY - uy * len * ST.tipFlat * 0.5
    ctx.quadraticCurveTo(p.x - tx * w * ST.drop + curve * 0.25, midY, tipX - tx * w * ST.drop * 0.45, tipFlatY)
    ctx.lineTo(tipX + tx * w * ST.drop * 0.45, tipFlatY)
    ctx.quadraticCurveTo(p.x + tx * w * ST.drop + curve * 0.25, midY, x1, y1)
    ctx.closePath()
    ctx.fill()
    // Светлая грань (слабый rim — свет ловит одна сторона).
    ctx.strokeStyle = rgba(PAL.rockLight, 0.16)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.quadraticCurveTo(p.x - tx * w * ST.drop + curve * 0.25, midY, tipX - tx * w * ST.drop * 0.45, tipFlatY)
    ctx.stroke()
  })

  // Сталагмиты и земляные бугры на полах (n у пола смотрит ВВЕРХ).
  const SG = PAINTER.stalagmites
  walkEdges('floor', SG.spacing, rngStalagmite, ({ p, n }) => {
    const len = SG.lenMin + rngStalagmite.float() * (SG.lenMax - SG.lenMin)
    const w = SG.widthMin + rngStalagmite.float() * (SG.widthMax - SG.widthMin)
    const ux = n.x, uy = n.y
    const tx = -uy, ty = ux
    const tipX = p.x + ux * len
    const tipY = p.y + uy * len
    const x0 = p.x - tx * w, x1 = p.x + tx * w
    if (crossesChunk(Math.min(x0, x1, tipX) - 2, Math.min(p.y, tipY) - 2, Math.max(x0, x1, tipX) + 2, Math.max(p.y, tipY) + 2)) return
    if (rngStalagmite.float() < SG.mound) {
      // Бугор: пологий холмик.
      ctx.fillStyle = rgba(PAL.rockDark, 0.92)
      ctx.beginPath()
      ctx.moveTo(p.x - tx * w * 1.2, p.y - ty * w * 1.2)
      ctx.quadraticCurveTo(p.x + ux * len - tx * w * 0.2, p.y + uy * len, p.x + tx * w * 1.2, p.y + ty * w * 1.2)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = rgba(PAL.rockLight, 0.1)
      ctx.beginPath()
      ctx.ellipse(p.x, p.y, w * 1.05, len * 0.45, 0, Math.PI, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.fillStyle = PAL.rockDark
      ctx.beginPath()
      ctx.moveTo(x0, p.y)
      ctx.quadraticCurveTo(p.x - tx * w * 0.5 + ux * len * 0.5, p.y + uy * len * 0.6, tipX, tipY)
      ctx.quadraticCurveTo(p.x + tx * w * 0.5 + ux * len * 0.5, p.y + uy * len * 0.6, x1, p.y)
      ctx.closePath()
      ctx.fill()
      ctx.fillStyle = rgba(PAL.rockLight, 0.12)
      ctx.beginPath()
      ctx.ellipse(p.x, p.y, w, len * 0.3, 0, Math.PI, Math.PI * 2)
      ctx.fill()
    }
  })

  // Наросты на отвесных стенах — грозди-скаллопы, ломают прямые участки.
  const BP = PAINTER.bumps
  walkEdges('side', BP.spacing, rngBumps, ({ p, n }) => {
    const r = BP.sizeMin + rngBumps.float() * (BP.sizeMax - BP.sizeMin)
    const ang = Math.atan2(n.y, n.x)
    if (crossesChunk(p.x - r * 2, p.y - r * 2, p.x + r * 2, p.y + r * 2)) return
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate(ang + Math.PI / 2)
    ctx.fillStyle = PAL.rockDark
    ctx.beginPath()
    ctx.ellipse(0, 0, r * BP.out, r, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = rgba(PAL.ink, BP.shade)
    ctx.beginPath()
    ctx.ellipse(0, r * 0.25, r * BP.out * 0.85, r * 0.75, 0, 0, Math.PI)
    ctx.fill()
    ctx.strokeStyle = rgba(PAL.rockLight, 0.14)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.ellipse(0, 0, r * BP.out, r, 0, Math.PI * 1.05, Math.PI * 1.95)
    ctx.stroke()
    ctx.restore()
  })

  // Мох на полах — цвет биолюма биома (грибные поляны светятся бирюзой).
  const MS = PAINTER.moss
  walkEdges('floor', MS.clusterMax * 2.2, rngMoss, ({ p, band }) => {
    const bio = GEN.biomeBands[band]
    if (rngMoss.float() > MS.density * (bio.moss / maxMoss)) return
    const r = MS.clusterMin + rngMoss.float() * (MS.clusterMax - MS.clusterMin)
    if (crossesChunk(p.x - r * 2, p.y - r * 2, p.x + r * 2, p.y + r * 2)) return
    const blobs = 2 + Math.floor(rngMoss.float() * 4)
    for (let i = 0; i < blobs; i++) {
      const ox = (rngMoss.float() - 0.5) * r * 2.4
      const oy = (rngMoss.float() - 0.5) * r * 0.8
      const rr = r * (0.45 + rngMoss.float() * 0.55)
      ctx.fillStyle = rgba(bio.glowColor, MS.alpha * (0.5 + rngMoss.float() * 0.5))
      ctx.beginPath()
      ctx.ellipse(p.x + ox, p.y - r * 0.35 + oy, rr, rr * 0.62, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    // Бахрома: рваные пряди вниз.
    const strands = 1 + Math.floor(rngMoss.float() * 3)
    for (let i = 0; i < strands; i++) {
      const sx = p.x + (rngMoss.float() - 0.5) * r * 3
      const sy = p.y + rngMoss.float() * MS.fringe
      ctx.strokeStyle = rgba(bio.glowColor, MS.alpha * 0.5)
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(sx, sy)
      ctx.lineTo(sx + (rngMoss.float() - 0.5) * 2, sy + MS.fringe * (0.6 + rngMoss.float() * 0.8))
      ctx.stroke()
    }
  })

  // Микрокристаллы — редкие искры биолюма.
  const CR = PAINTER.crystals
  walkEdges('floor', CR.sizeMax * 12, rngCrys, ({ p, band }) => {
    const bio = GEN.biomeBands[band]
    if (rngCrys.float() > CR.density * (bio.crystal / maxCrys)) return
    const s = CR.sizeMin + rngCrys.float() * (CR.sizeMax - CR.sizeMin)
    const pad = CR.glowPad + s
    if (crossesChunk(p.x - pad, p.y - pad, p.x + pad, p.y + pad)) return
    const glow = ctx.createRadialGradient(p.x, p.y - s * 0.5, 0, p.x, p.y - s * 0.5, pad)
    glow.addColorStop(0, rgba(bio.glowColor, CR.alpha * 0.5))
    glow.addColorStop(1, rgba(bio.glowColor, 0))
    ctx.fillStyle = glow
    ctx.beginPath()
    ctx.arc(p.x, p.y - s * 0.5, pad, 0, Math.PI * 2)
    ctx.fill()
    ctx.save()
    ctx.translate(p.x, p.y)
    ctx.rotate((rngCrys.float() - 0.5) * 0.9)
    ctx.fillStyle = rgba(bio.glowColor, CR.alpha)
    ctx.beginPath()
    ctx.moveTo(0, -s * 2)
    ctx.lineTo(s * 0.6, -s * 0.4)
    ctx.lineTo(0, 0)
    ctx.lineTo(-s * 0.6, -s * 0.4)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  })

  // ── 7. Нарезка на чанки → текстуры → картинки ───────────────────────────
  const chunks: Phaser.GameObjects.Image[] = []
  const rects: Phaser.Geom.Rectangle[] = []
  const keys: string[] = []
  let idx = 0
  for (let cy = 0; cy < worldH; cy += chunk) {
    for (let cx = 0; cx < worldW; cx += chunk) {
      const cw = Math.min(chunk, worldW - cx)
      const ch = Math.min(chunk, worldH - cy)
      const key = `${TEX_PREFIX}${idx}`
      const ccv = document.createElement('canvas')
      ccv.width = cw
      ccv.height = ch
      const cctx = ccv.getContext('2d')!
      cctx.drawImage(big, cx, cy, cw, ch, 0, 0, cw, ch)
      if (scene.textures.exists(key)) scene.textures.remove(key)
      scene.textures.addCanvas(key, ccv)
      const img = scene.add.image(cx, cy, key)
        .setOrigin(0, 0)
        .setDepth(depthLayer)
      chunks.push(img)
      rects.push(new Phaser.Geom.Rectangle(cx, cy, cw, ch))
      keys.push(key)
      idx++
    }
  }

  return {
    chunks,
    rects,
    depth: depthLayer,
    destroy(): void {
      for (const img of chunks) img.destroy()
      for (const key of keys) {
        if (scene.textures.exists(key)) scene.textures.remove(key)
      }
    },
  }
}

/** Штрих контуров одного класса со сдвигом в сторону воздуха (без клипа). */
function addRunsLocal(
  ctx: CanvasRenderingContext2D,
  polys: Pt[][],
  cls: EdgeClass,
  width: number,
  alpha: number,
  offset: number,
): void {
  ctx.save()
  ctx.strokeStyle = rgba(PAINTER.ao.color, alpha)
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.beginPath()
  for (const poly of polys) {
    let run: Pt[] = []
    const flush = (): void => {
      if (run.length >= 2) {
        const a0 = run[0]
        ctx.moveTo(a0.x, a0.y)
        for (let i = 1; i < run.length; i++) {
          const a = run[i - 1]
          const b = run[i]
          const nrm = airNormal(a, b)
          ctx.lineTo(b.x + nrm.x * offset, b.y + nrm.y * offset)
        }
      }
      run = []
    }
    const n = poly.length
    for (let i = 0; i < n; i++) {
      const a = poly[i]
      const b = poly[(i + 1) % n]
      if (classify(airNormal(a, b)) === cls) {
        if (run.length === 0) run.push(a)
        run.push(b)
      } else flush()
    }
    flush()
  }
  ctx.stroke()
  ctx.restore()
}
