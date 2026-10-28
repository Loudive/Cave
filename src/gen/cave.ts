/**
 * cave.ts — генератор пещер (шаг 4 → шаг 14).
 * Шаг 14 (референсы Hollow Knight / Blasphemous / Hidden Deep, по запросу
 * игрока): «скудные и грустные» каверны cellular-automata заменены на
 * БОЛЬШИЕ ОРГАНИЧНЫЕ каверны — супердиски с шумовым дрожанием края,
 * ни одного прямого машинного среза. Пещера многоярусная: 3 вертикальных
 * яруса, связанных шахтами; широкая извилистая тропа вход→выход, куча
 * узких лазов-петлей, внутри больших каверн — каменные острова-уступы
 * (многоуровневый трэверсал). Cellular automata удалён.
 *
 * Чистый TypeScript без Phaser: генерация тестируема отдельно,
 * а сцена только потребляет CaveData. Один seed → одна пещера.
 */
import { GEN } from '../config/gen'
import { Rng, hashSeed } from './rng'
import { Noise2D } from './noise'

/** Клетка сетки в тайловых координатах. */
export interface CavePoint {
  x: number
  y: number
}

/** Каверна (для аудита стиля и будущих систем). */
export interface CaveCavern {
  cx: number
  cy: number
  rx: number
  ry: number
  /** Порядковый ярус: 0 верх, 1 середина, 2 низ. */
  tier: number
}

export interface CaveMushroom {
  tx: number
  ty: number
  /** Индекс полосы биома. */
  biome: number
}

export interface CaveNest {
  tx: number
  ty: number
  biome: number
}

export interface CaveStats {
  /** Клеток воздуха после запечатывания. */
  airTiles: number
  /** Доля воздуха, достижимого от входа (до запечатывания карманов). */
  reachableRatio: number
  /** Попыток генерации (1 = пещера прошла критерий сразу). */
  attempts: number
  /** FNV-хеш сетки — проверка детерминизма. */
  hash: number
  /** Шаг 14: стайл-метрики для аудита стража стиля пещер. */
  cavernCount: number
  /** Узких лазов (петли + связка всех каверн). */
  crawlTunnels: number
  /** Вертикальных шахт между ярусами. */
  shafts: number
  /** Каменных островов-уступов внутри каверн. */
  islands: number
  /** Площадь крупнейшей каверны в тайлах (воздух связной области). */
  largestCavernTiles: number
  /** Средняя площадь каверны в тайлах. */
  avgCavernTiles: number
  /** Самый длинный прямой горизонтальный участок пола (тайлов). */
  maxFloorRun: number
  /** Самая длинная прямая вертикальная стена (тайлов). */
  maxWallRun: number
  /** Острых 90° углов с длинными рукавами (сигнатура квадратных камер). */
  machineCorners: number
}

export interface CaveData {
  /** Полный seed этой карты: `${base}#${depth}` (+ /attempt при ретраях). */
  seed: string
  cols: number
  rows: number
  tile: number
  /** Глобальная глубина верха карты, метров. */
  depthOffsetMeters: number
  /** 1 = стена (камень или земля), 0 = воздух. */
  solid: Uint8Array
  /** 1 = земля (край стены, обращённый к воздуху). Подмножество solid. */
  ground: Uint8Array
  /** 0 нет, 1 мох, 2 кристалл, 3 кость. */
  decor: Uint8Array
  /** Индекс полосы биома на каждую клетку. */
  biomes: Uint8Array
  entrance: CavePoint
  exit: CavePoint
  /** Шаг 14: каверны (центры/радиусы/ярусы) — для аудита и систем. */
  caverns: CaveCavern[]
  mushrooms: CaveMushroom[]
  nests: CaveNest[]
  stats: CaveStats
}

/** Клетка стены? */
export function isSolid(cave: CaveData, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= cave.cols || ty >= cave.rows) return true
  return cave.solid[ty * cave.cols + tx] === 1
}

/** Индекс полосы биома по метрам глобальной глубины. */
export function biomeIndexAtMeters(meters: number): number {
  const bands = GEN.biomeBands
  for (let i = 0; i < bands.length; i++) {
    if (meters < bands[i].toMeters) return i
  }
  return bands.length - 1
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

/** Центр каверны как точка сетки. */
function center(c: CaveCavern): CavePoint {
  return { x: c.cx, y: c.cy }
}

/**
 * Сгенерировать пещеру для слоя `depth` забега `seedBase`.
 * Гарантирует критерий гайда: пещера проходима от входа до выхода
 * (тропа и лазы высекаются по построению), ≥ targetReachable воздуха достижимо.
 */
export function generateCave(seedBase: string, depth: number): CaveData {
  const depthOffsetMeters = Math.round(
    (depth - 1) * GEN.map.rows * GEN.map.tile * GEN.map.metersPerPixel,
  )
  const seed = `${seedBase}#${depth}`

  let last: CaveData | null = null
  for (let attempt = 1; attempt <= GEN.connectivity.repairMaxTries; attempt++) {
    const cave = tryGenerate(seed, depthOffsetMeters, attempt)
    last = cave
    if (cave.stats.reachableRatio >= GEN.connectivity.targetReachable) {
      return cave
    }
  }
  // Крайне маловероятно: возвращаем последнюю попытку.
  return last as CaveData
}

function tryGenerate(seed: string, depthOffsetMeters: number, attempt: number): CaveData {
  const { cols: W, rows: H, tile: T } = GEN.map
  const fullSeed = `${seed}/${attempt}`
  const rng = new Rng(hashSeed(fullSeed))
  const noise = new Noise2D(hashSeed(fullSeed + ':noise'))

  const solid = new Uint8Array(W * H)
  solid.fill(1)

  // ── 1. Каверны: большие органичные супердиски с шумовым краем ──────────
  // Ярусы: верх / середина / низ (многоуровневость по вертикали).
  const tierBands = [
    [Math.round(H * GEN.caverns.tierTopFrom), Math.round(H * GEN.caverns.tierTopTo)],
    [Math.round(H * GEN.caverns.tierMidFrom), Math.round(H * GEN.caverns.tierMidTo)],
    [Math.round(H * GEN.caverns.tierLowFrom), Math.round(H * GEN.caverns.tierLowTo)],
  ]

  // Вход — верх (сторона рандомна), выход — низ напротив.
  const entranceLeft = rng.chance(0.5)
  const entranceCavern: CaveCavern = {
    cx: Math.round(W * (entranceLeft ? GEN.caverns.entranceXShare : 1 - GEN.caverns.entranceXShare)),
    cy: Math.round(H * rng.span(GEN.caverns.entranceYFrom, GEN.caverns.entranceYTo)),
    rx: GEN.caverns.entranceRx,
    ry: GEN.caverns.entranceRy,
    tier: 0,
  }
  const exitCavern: CaveCavern = {
    cx: Math.round(W * (entranceLeft ? 1 - GEN.caverns.exitXShare : GEN.caverns.exitXShare)),
    cy: Math.round(H * rng.span(GEN.caverns.exitYFrom, GEN.caverns.exitYTo)),
    rx: GEN.caverns.exitRx,
    ry: GEN.caverns.exitRy,
    tier: 2,
  }
  // Хаб — центр карты, самая большая каверна (многоярусная, с островами).
  const hub: CaveCavern = {
    cx: Math.round(W * rng.span(GEN.caverns.hubXFrom, GEN.caverns.hubXTo)),
    cy: Math.round(H * rng.span(GEN.caverns.hubYFrom, GEN.caverns.hubYTo)),
    rx: rng.range(GEN.caverns.hubRxMin, GEN.caverns.hubRxMax),
    ry: rng.range(GEN.caverns.hubRyMin, GEN.caverns.hubRyMax),
    tier: 1,
  }

  const caverns: CaveCavern[] = [entranceCavern, exitCavern, hub]

  // Обычные каверны: по ярусам, без слипания центров.
  const targetCount = rng.range(GEN.caverns.countMin, GEN.caverns.countMax)
  for (let n = 0; n < targetCount * GEN.caverns.placeBudget && caverns.length - 3 < targetCount; n++) {
    const tier = caverns.length % 3 === 2 ? 1 : rng.int(3)
    const [ty0, ty1] = tierBands[tier]
    const cand: CaveCavern = {
      cx: rng.range(GEN.caverns.edgeMarginTiles, W - 1 - GEN.caverns.edgeMarginTiles),
      cy: rng.range(ty0, ty1),
      rx: rng.range(GEN.caverns.rxMin, GEN.caverns.rxMax),
      ry: rng.range(GEN.caverns.ryMin, GEN.caverns.ryMax),
      tier,
    }
    // Минимальная дистанция центров — каверны сливаются, но не поглощают.
    let ok = true
    for (const c of caverns) {
      const d = Math.hypot(c.cx - cand.cx, c.cy - cand.cy)
      if (d < (c.rx + cand.rx) * GEN.caverns.centerSpacing) {
        ok = false
        break
      }
    }
    if (!ok) continue
    caverns.push(cand)
  }

  for (const c of caverns) {
    carveOrganicBlob(solid, W, H, noise, rng, c)
  }

  // ── 2. Главная тропа: широкая извилина вход → каверны по ярусам → выход ──
  const pathCaverns = [entranceCavern]
  const mids = caverns
    .filter((c) => c !== entranceCavern && c !== exitCavern)
    .sort((a, b) => a.cy - b.cy)
  // Через 2–4 каверны по пути (многоярусный спуск).
  const hopCount = clamp(
    rng.range(GEN.caverns.pathHopsMin, GEN.caverns.pathHopsMax), 0, mids.length)
  for (let i = 0; i < hopCount; i++) {
    // Равномерно по отсортированному списку — тропа «ныряет» по ярусам.
    const idx = Math.min(mids.length - 1, Math.round(((i + 1) * mids.length) / (hopCount + 1)))
    pathCaverns.push(mids[idx])
  }
  pathCaverns.push(exitCavern)
  for (let i = 0; i + 1 < pathCaverns.length; i++) {
    windingTunnel(solid, W, H, rng, center(pathCaverns[i]), center(pathCaverns[i + 1]),
      GEN.tunnels.mainRadius, GEN.tunnels.mainDrift, 'none')
  }

  // ── 3. Каждая каверна достижима: лаз к ближайшей связанной ─────────────
  const connected = new Set<CaveCavern>(pathCaverns)
  let crawlTunnels = 0
  for (const c of caverns) {
    if (connected.has(c)) continue
    let nearest: CaveCavern | null = null
    let bestD = Infinity
    for (const cc of connected) {
      const d = Math.hypot(cc.cx - c.cx, cc.cy - c.cy)
      if (d < bestD) {
        bestD = d
        nearest = cc
      }
    }
    if (nearest) {
      windingTunnel(solid, W, H, rng, center(c), center(nearest),
        GEN.tunnels.crawlRadius, GEN.tunnels.crawlDrift, 'none')
      crawlTunnels++
      connected.add(c)
    }
  }

  // ── 4. Петлевые лазы: короткие пути и обходные маршруты ────────────────
  const loops = rng.range(GEN.tunnels.loopMin, GEN.tunnels.loopMax)
  for (let l = 0; l < loops; l++) {
    const a = rng.pick(caverns)
    const b = rng.pick(caverns)
    if (a === b) continue
    windingTunnel(solid, W, H, rng, center(a), center(b),
      GEN.tunnels.crawlRadius, GEN.tunnels.crawlDrift, 'none')
    crawlTunnels++
  }

  // ── 5. Вертикальные шахты между ярусами ────────────────────────────────
  let shafts = 0
  for (let tier = 0; tier < 2; tier++) {
    const upper = caverns.filter((c) => c.tier === tier)
    const lower = caverns.filter((c) => c.tier === tier + 1)
    if (!upper.length || !lower.length) continue
    for (let s = 0; s < GEN.tunnels.shaftsPerBoundary; s++) {
      // Ближайшая пара ярусов — шахта вырастает там, где логично.
      let bestPair: [CaveCavern, CaveCavern] | null = null
      let bestD = Infinity
      for (const u of upper) {
        for (const lo of lower) {
          const d = Math.hypot(u.cx - lo.cx, u.cy - lo.cy)
          if (d < bestD) {
            bestD = d
            bestPair = [u, lo]
          }
        }
      }
      if (bestPair) {
        windingTunnel(solid, W, H, rng, center(bestPair[0]), center(bestPair[1]),
          GEN.tunnels.shaftRadius, GEN.tunnels.shaftDrift, 'vertical')
        shafts++
      }
    }
  }

  // ── 6. Острова-уступы в больших кавернах: многоуровневый трэверсал ─────
  let islands = 0
  for (const c of caverns) {
    islands += placeIslands(solid, W, H, rng, c)
  }

  // ── 6.5. Органичная граница: волнистая кайма вместо машинного среза ────
  // Внешние 2 кольца всегда твёрдые (герметичность), дальше кайма «дышит»
  // шумом на 0–2 тайла вглубь — каверна у края карты не упирается в
  // идеально прямую стену (страж стиля: прямая стена = машинный срез).
  organicBorder(solid, W, H, noise)

  // ── 7. Биомы: полосы по глубине + шумовое дрожание границ ───────────────
  const biomes = new Uint8Array(W * H)
  const metersPerTile = T * GEN.map.metersPerPixel
  const boundaries = GEN.biomeBands.map(
    (b) => (b.toMeters - depthOffsetMeters) / metersPerTile,
  )
  for (let x = 0; x < W; x++) {
    const jittered: number[] = []
    for (let k = 0; k < boundaries.length; k++) {
      const j = (noise.fbm(x * GEN.biomeJitter.noiseScale, k * GEN.biomeJitter.channelStep) - 0.5) * 2
      jittered.push(boundaries[k] + j * GEN.biomeJitter.amplitudeTiles)
    }
    for (let y = 0; y < H; y++) {
      let band = 0
      for (let k = 0; k < jittered.length; k++) {
        if (y >= jittered[k]) band = k + 1
      }
      biomes[y * W + x] = Math.min(band, GEN.biomeBands.length - 1)
    }
  }

  // ── 8. Связность: flood fill от входа, запечатывание карманов ───────────
  const entrance = floorPointNear(solid, W, H, entranceCavern)
  const exit = floorPointNear(solid, W, H, exitCavern)
  const entranceIdx = entrance.y * W + entrance.x
  const reach = new Uint8Array(W * H)
  const queue = new Int32Array(W * H)
  let head = 0
  let tail = 0
  queue[tail++] = entranceIdx
  reach[entranceIdx] = 1
  let reached = 1
  let airTotal = 1
  for (let i = 0; i < W * H; i++) {
    if (i !== entranceIdx && solid[i] === 0) airTotal++
  }
  while (head < tail) {
    const idx = queue[head++]
    const x = idx % W
    const y = (idx - x) / W
    const nb: Array<[number, boolean]> = [
      [idx - 1, x > 0],
      [idx + 1, x < W - 1],
      [idx - W, y > 0],
      [idx + W, y < H - 1],
    ]
    for (const [j, ok] of nb) {
      if (!ok) continue
      if (solid[j] === 0 && reach[j] === 0) {
        reach[j] = 1
        queue[tail++] = j
        reached++
      }
    }
  }

  const reachableRatio = reached / airTotal

  // Запечатать недостижимые воздушные карманы (мини-карта не врёт).
  for (let i = 0; i < W * H; i++) {
    if (solid[i] === 0 && reach[i] === 0) solid[i] = 1
  }

  // ── 9. Стайл-метрики (для стража стиля) + финализация ──────────────────
  const areas = caverns.map((c) => measureRegion(solid, W, H, c))
  const stats: CaveStats = {
    airTiles: countAir(solid),
    reachableRatio,
    attempts: attempt,
    hash: 0,
    cavernCount: caverns.length,
    crawlTunnels,
    shafts,
    islands,
    largestCavernTiles: Math.max(...areas.map((a) => a.area)),
    avgCavernTiles: areas.reduce((s, a) => s + a.area, 0) / areas.length,
    ...straightEdgeMetrics(solid, W, H),
  }

  const cave = finalize(fullSeed, depthOffsetMeters, solid, W, H, T,
    entrance, exit, stats, biomes, caverns)
  cave.stats.hash = hashGrid(cave.solid)
  return cave
}

/** Общая доводка: земля-край, декор, грибы, гнёзда. */
function finalize(
  fullSeed: string,
  depthOffsetMeters: number,
  solid: Uint8Array,
  W: number,
  H: number,
  T: number,
  entrance: CavePoint,
  exit: CavePoint,
  stats: CaveStats,
  biomes: Uint8Array,
  caverns: CaveCavern[],
): CaveData {
  const rng = new Rng(hashSeed(fullSeed + ':finish'))
  const cave: CaveData = {
    seed: fullSeed,
    cols: W,
    rows: H,
    tile: T,
    depthOffsetMeters,
    solid,
    ground: new Uint8Array(W * H),
    decor: new Uint8Array(W * H),
    biomes,
    entrance,
    exit,
    caverns,
    mushrooms: [],
    nests: [],
    stats,
  }

  // ── Земля: край стены, обращённый к воздуху ─────────────────────────────
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x
      if (solid[i] === 1 && (airAt(solid, W, H, x - 1, y) || airAt(solid, W, H, x + 1, y)
        || airAt(solid, W, H, x, y - 1) || airAt(solid, W, H, x, y + 1))) {
        cave.ground[i] = 1
      }
    }
  }

  // ── Декор на полу (по правилам биома) ───────────────────────────────────
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const i = y * W + x
      if (solid[i] !== 0 || solid[i + W] === 0) continue // воздух с полом ниже
      const band = GEN.biomeBands[biomes[i]]
      if (!band) continue
      const r = rng.float()
      if (r < band.crystal) cave.decor[i] = 2
      else if (r < band.crystal + band.bone) cave.decor[i] = 3
      else if (r < band.crystal + band.bone + band.moss) cave.decor[i] = 1
    }
  }

  // ── Грибы-светильники ───────────────────────────────────────────────────
  const minSp2 = GEN.mushroom.minSpacingTiles * GEN.mushroom.minSpacingTiles
  const skip2 = GEN.mushroom.skipNearEntranceTiles * GEN.mushroom.skipNearEntranceTiles
  for (let y = 1; y < H - 1 && cave.mushrooms.length < GEN.mushroom.maxTotal; y++) {
    for (let x = 1; x < W - 1 && cave.mushrooms.length < GEN.mushroom.maxTotal; x++) {
      const i = y * W + x
      if (solid[i] !== 0 || solid[i + W] === 0) continue
      if (cave.decor[i] !== 0) continue
      const dx = x - entrance.x
      const dy = y - entrance.y
      if (dx * dx + dy * dy < skip2) continue
      const band = GEN.biomeBands[biomes[i]]
      if (!band || !rng.chance(band.mushroomDensity)) continue
      if (!hasSpacing(cave.mushrooms, x, y, minSp2)) continue
      cave.mushrooms.push({ tx: x, ty: y, biome: biomes[i] })
    }
  }

  // ── Гнёзда мобов (данные для шага 5) ────────────────────────────────────
  const nestSp2 = GEN.nest.minSpacingTiles * GEN.nest.minSpacingTiles
  const ent2 = GEN.nest.minDistFromEntranceTiles * GEN.nest.minDistFromEntranceTiles
  for (let b = 0; b < GEN.biomeBands.length; b++) {
    let placed = 0
    for (let tryN = 0; tryN < GEN.nest.placeBudget && placed < GEN.biomeBands[b].nests; tryN++) {
      const x = rng.range(GEN.nest.fieldMarginTiles, W - 1 - GEN.nest.fieldMarginTiles)
      const y = rng.range(GEN.nest.fieldMarginTiles, H - 1 - GEN.nest.fieldMarginTiles)
      const i = y * W + x
      if (biomes[i] !== b) continue
      if (solid[i] !== 0 || solid[i + W] === 0) continue
      const dEnt = (x - entrance.x) ** 2 + (y - entrance.y) ** 2
      const dExit = (x - exit.x) ** 2 + (y - exit.y) ** 2
      if (dEnt < ent2 || dExit < GEN.nest.minDistFromExitTiles * GEN.nest.minDistFromExitTiles) continue
      if (!hasSpacing(cave.nests, x, y, nestSp2)) continue
      cave.nests.push({ tx: x, ty: y, biome: b })
      placed++
    }
  }

  void depthOffsetMeters
  return cave
}

// ── Резка породы ───────────────────────────────────────────────────────────

/**
 * Органичная каверна: супердиск (|x/rx|^n + |y/ry|^n)^(1/n) с шумовым
 * дрожанием радиуса по клеткам. n ∈ ~1.7–2.3 — между кругом и мягким
 * овалом, НИКОГДА прямоугольник (см. стража стиля: maxFloorRun).
 */
function carveOrganicBlob(
  solid: Uint8Array, W: number, H: number,
  noise: Noise2D, rng: Rng, c: CaveCavern,
): void {
  const cv = GEN.caverns
  const exp = rng.span(cv.expMin, cv.expMax)
  const pad = Math.ceil(Math.max(c.rx, c.ry) * cv.wobble) + 1
  const x0 = clamp(Math.floor(c.cx - c.rx - pad), 2, W - 3)
  const x1 = clamp(Math.ceil(c.cx + c.rx + pad), 2, W - 3)
  const y0 = clamp(Math.floor(c.cy - c.ry - pad), 2, H - 3)
  const y1 = clamp(Math.ceil(c.cy + c.ry + pad), 2, H - 3)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x - c.cx) / c.rx
      const ny = (y - c.cy) / c.ry
      const r = Math.pow(Math.abs(nx) ** exp + Math.abs(ny) ** exp, 1 / exp)
      const wob = 1 + (noise.fbm(x * cv.edgeNoiseScale + c.cy * cv.edgeNoiseOffsetY,
        y * cv.edgeNoiseScale + c.cx * cv.edgeNoiseOffsetX) - 0.5) * 2 * cv.wobble
      if (r <= wob) solid[y * W + x] = 0
    }
  }
}

/**
 * Извилистый туннель между точками: пьяница с дрейфом к цели.
 * bias 'vertical' — шаги предпочитают ось Y (шахты между ярусами).
 * Радиус «дышит» синусоидой — туннель органично расширяется и сужается,
 * иначе трубка постоянного радиуса режет идеально прямой пол/потолок
 * (запрещено стражем стиля: maxFloorRun/maxWallRun).
 */
function windingTunnel(
  solid: Uint8Array, W: number, H: number, rng: Rng,
  from: CavePoint, to: CavePoint, radius: number, drift: number,
  bias: 'none' | 'vertical',
): void {
  const cur: CavePoint = { x: from.x, y: from.y }
  const guard = (Math.abs(to.x - from.x) + Math.abs(to.y - from.y) + GEN.tunnels.guardBaseSteps) * GEN.tunnels.guardStepsPerTile
  const phase = rng.float() * Math.PI * 2
  let steps = 0
  while ((Math.abs(cur.x - to.x) > 1 || Math.abs(cur.y - to.y) > 1) && steps++ < guard) {
    carveDisc(solid, W, H, cur, breatheRadius(radius, steps, phase))
    if (rng.float() < drift) {
      // Даже в дрейфе иногда шаг вбок — центр туннеля блуждает, стены
      // шахт не вытягиваются в идеально прямые линии.
      if (rng.float() < GEN.tunnels.wanderStep) {
        cur.x += rng.chance(0.5) ? 1 : -1
      } else {
        const dx = to.x - cur.x
        const dy = to.y - cur.y
        const stepY = bias === 'vertical' ? dy !== 0 : Math.abs(dy) > Math.abs(dx)
        if (stepY && dy !== 0) cur.y += Math.sign(dy)
        else if (dx !== 0) cur.x += Math.sign(dx)
        else if (dy !== 0) cur.y += Math.sign(dy)
      }
    } else {
      const dir = rng.int(4)
      cur.x += dir === 0 ? 1 : dir === 1 ? -1 : 0
      cur.y += dir === 2 ? 1 : dir === 3 ? -1 : 0
    }
    cur.x = clamp(cur.x, 3, W - 4)
    cur.y = clamp(cur.y, 3, H - 4)
  }
  carveLine(solid, W, H, cur, to, radius, phase)
  carveDisc(solid, W, H, to, radius)
}

/** Текущий радиус туннеля: база ± синусоидальное дыхание (целое ≥ 1). */
function breatheRadius(base: number, step: number, phase: number): number {
  const w = GEN.tunnels.wave
  return Math.max(1, Math.round(base + Math.sin(step * w.freq + phase) * w.amp))
}

/**
 * Каменные острова-уступы внутри каверны: плоская верхушка со светящейся
 * кромкой земли, сужающийся низ. Полностью окружены воздухом (проверка
 * бокса с полями) — не срастаются со стенами и не запирают проход.
 */
function placeIslands(
  solid: Uint8Array, W: number, H: number, rng: Rng, c: CaveCavern,
): number {
  const ic = GEN.islands
  const area = Math.PI * c.rx * c.ry
  const want = clamp(Math.round(area / ic.perAreaTiles), 0, ic.maxPerCavern)
  let placed = 0
  for (let t = 0; t < want * ic.placeBudget && placed < want; t++) {
    const frac = rng.pick(ic.tierFracs)
    const ix = Math.round(c.cx + (rng.float() * 2 - 1) * c.rx * ic.xSpread)
    const iy = Math.round(c.cy + (frac * 2 - 1) * c.ry * ic.ySpread)
    const w = rng.range(ic.wMin, ic.wMax)
    const h = rng.range(ic.hMin, ic.hMax)
    const half = Math.floor(w / 2)
    // Бокс острова + поля: весь воздух (стены не ближе margin, проход снизу).
    let clear = true
    for (let y = iy - h - ic.marginTop; y <= iy + ic.marginSide && clear; y++) {
      for (let x = ix - half - ic.marginSide; x <= ix + half + ic.marginSide && clear; x++) {
        if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2 || solid[y * W + x] !== 0) clear = false
      }
    }
    if (!clear) continue
    // Рез: верхняя строка — почти полная ширина (концы дрожат — живой
    // уступ, не машинный срез), ниже — сужение (полуэллипс).
    for (let dy = 0; dy < h; dy++) {
      const taper = Math.max(1, Math.round(half * (1 - dy / (h + ic.taperSoftness))))
      const jitter = dy === 0 ? rng.range(-ic.edgeJitter, ic.edgeJitter) : 0
      for (let x = ix - taper + jitter; x <= ix + taper - jitter; x++) {
        solid[(iy + dy) * W + x] = 1
      }
    }
    placed++
  }
  return placed
}

/**
 * Волнистая кайма карты: обязательные 2 твёрдых кольца + шумовой наплыв
 * 0–2 тайла вглубь по каждой стороне. Граница читается породой, не сеткой.
 */
function organicBorder(solid: Uint8Array, W: number, H: number, noise: Noise2D): void {
  const cv = GEN.caverns
  const bw = cv.borderWobble
  const ns = cv.borderNoiseScale
  const [chL, chR, chT, chB] = cv.borderNoiseChannels
  for (let y = 0; y < H; y++) {
    const lw = Math.max(2, 2 + Math.round((noise.fbm(y * ns, chL) - 0.5) * 2 * bw))
    const rw = Math.max(2, 2 + Math.round((noise.fbm(y * ns, chR) - 0.5) * 2 * bw))
    for (let x = 0; x < lw; x++) solid[y * W + x] = 1
    for (let x = 0; x < rw; x++) solid[y * W + W - 1 - x] = 1
  }
  for (let x = 0; x < W; x++) {
    const tw = Math.max(2, 2 + Math.round((noise.fbm(x * ns, chT) - 0.5) * 2 * bw))
    const bw2 = Math.max(2, 2 + Math.round((noise.fbm(x * ns, chB) - 0.5) * 2 * bw))
    for (let y = 0; y < tw; y++) solid[y * W + x] = 1
    for (let y = 0; y < bw2; y++) solid[(H - 1 - y) * W + x] = 1
  }
}

/** Точка пола рядом с центром каверны (вход/выход стоят на земле). */
function floorPointNear(solid: Uint8Array, W: number, H: number, c: CaveCavern): CavePoint {
  const x = clamp(Math.round(c.cx), 3, W - 4)
  let y = clamp(Math.round(c.cy), 3, H - 4)
  for (let drop = 0; drop < Math.ceil(c.ry) + 4; drop++) {
    const below = solid[(y + 1) * W + x]
    if (below === 1) break
    y++
  }
  return { x, y }
}

/** Площадь воздуха внутри эллипса каверны (≈ размер каверны, без туннелей). */
function measureRegion(solid: Uint8Array, W: number, H: number, c: CaveCavern): { area: number } {
  let area = 0
  const ex = Math.ceil(c.rx * 1.15)
  const ey = Math.ceil(c.ry * 1.15)
  for (let dy = -ey; dy <= ey; dy++) {
    for (let dx = -ex; dx <= ex; dx++) {
      const x = c.cx + dx
      const y = c.cy + dy
      if (x < 0 || y < 0 || x >= W || y >= H) continue
      const e = (dx / c.rx) ** 2 + (dy / c.ry) ** 2
      if (e <= 1.15 && solid[y * W + x] === 0) area++
    }
  }
  return { area }
}

/**
 * Детекторы «машинных срезов» (для стража стиля): прямые участки пола/стены
 * в игровом поле (без структурной каймы карты) и острые 90° углы с длинными
 * рукавами — сигнатура квадратных камер. Органичная пещера: полы могут
 * сливаться на одном уровне (геймплейно это хорошо), но углы всегда скруглены.
 */
function straightEdgeMetrics(
  solid: Uint8Array, W: number, H: number,
): { maxFloorRun: number, maxWallRun: number, machineCorners: number } {
  // Кайма карты (2 кольца + волнистый наплыв) — структурная, не считаем.
  const x0 = 4, x1 = W - 5, y0 = 4, y1 = H - 5
  let maxFloorRun = 0
  for (let y = y0; y <= y1; y++) {
    let run = 0
    for (let x = x0; x <= x1; x++) {
      const i = y * W + x
      const isFloor = solid[i] === 0 && solid[i + W] === 1
      run = isFloor ? run + 1 : 0
      if (run > maxFloorRun) maxFloorRun = run
    }
  }
  let maxWallRun = 0
  for (let x = x0; x <= x1; x++) {
    let run = 0
    for (let y = y0; y <= y1; y++) {
      const i = y * W + x
      const isWall = solid[i] === 0 && solid[i + 1] === 1
      run = isWall ? run + 1 : 0
      if (run > maxWallRun) maxWallRun = run
    }
  }
  // Машиный угол: воздух в углу 90° (пол снизу + стена слева + блок в углу),
  // и ОБА рукава длинные (пол вправо ≥ 4, стена вверх ≥ 4). У органичной
  // каверны угол скруглён — длинных рукавов с острым углом не бывает.
  let machineCorners = 0
  for (let y = y0 + 4; y <= y1; y++) {
    for (let x = x0 + 4; x <= x1; x++) {
      const i = y * W + x
      if (solid[i] !== 0 || solid[i + W] !== 1) continue // пол снизу
      if (solid[i - 1] !== 1 || solid[i - 1 + W] !== 1) continue // стена слева + угол
      let armFloor = 0
      for (let ax = x; ax <= x1 && solid[y * W + ax] === 0 && solid[y * W + ax + W] === 1; ax++) armFloor++
      let armWall = 0
      for (let ay = y; ay >= y0 && solid[ay * W + x] === 0 && solid[ay * W + x - 1] === 1; ay--) armWall++
      if (armFloor >= 4 && armWall >= 4) machineCorners++
    }
  }
  return { maxFloorRun, maxWallRun, machineCorners }
}

// ── Вспомогательные операции над сеткой ────────────────────────────────────

function airAt(solid: Uint8Array, W: number, H: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= W || y >= H) return false
  return solid[y * W + x] === 0
}

function carveDisc(solid: Uint8Array, W: number, H: number, c: CavePoint, r: number): void {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue
      const x = c.x + dx
      const y = c.y + dy
      if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue
      solid[y * W + x] = 0
    }
  }
}

function carveLine(
  solid: Uint8Array, W: number, H: number, from: CavePoint, to: CavePoint,
  r: number, phase = 0,
): void {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.max(1, Math.hypot(dx, dy))
  // Перпендикулярное синус-дрожание — даже страховочный дорез не режет
  // идеально прямой коридор (страж стиля: никаких машинных срезов).
  const px = -dy / len
  const py = dx / len
  for (let s = 0; s <= steps; s++) {
    const t = steps === 0 ? 0 : s / steps
    const off = Math.round(Math.sin(s * GEN.tunnels.wave.freq + phase) * GEN.tunnels.wave.amp)
    carveDisc(solid, W, H, {
      x: Math.round(from.x + dx * t + px * off),
      y: Math.round(from.y + dy * t + py * off),
    }, r)
  }
}

function countAir(solid: Uint8Array): number {
  let n = 0
  for (let i = 0; i < solid.length; i++) if (solid[i] === 0) n++
  return n
}

function hashGrid(solid: Uint8Array): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < solid.length; i++) {
    h ^= solid[i]
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function hasSpacing(
  list: Array<{ tx: number, ty: number }>, x: number, y: number, minSp2: number,
): boolean {
  for (const p of list) {
    const dx = p.tx - x
    const dy = p.ty - y
    if (dx * dx + dy * dy < minSp2) return false
  }
  return true
}
