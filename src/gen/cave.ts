/**
 * cave.ts — генератор пещер (шаг 4).
 * Связка из гайда: cellular automata для каверн + drunkard's walk
 * для извилистых туннелей от входа (сверху) к выходу (глубже).
 * Биомы распределяются по глубине (полосы из GDD §6) с шумовым
 * дрожанием границ. Грибы-светильники и гнёзда мобов — по правилам биома.
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

/**
 * Сгенерировать пещеру для слоя `depth` забега `seedBase`.
 * Гарантирует критерий гайда: пещера проходима от входа до выхода
 * (туннель высекается по построению), ≥ targetReachable воздуха достижимо.
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

  // ── 1. Cellular automata: шум → каверны ────────────────────────────────
  for (let i = 0; i < solid.length; i++) {
    solid[i] = rng.float() < GEN.ca.fillProb ? 1 : 0
  }
  applyBorder(solid, W, H)
  for (let it = 0; it < GEN.ca.iterations; it++) {
    const next = new Uint8Array(solid)
    for (let y = 1; y < H - 1; y++) {
      for (let x = 1; x < W - 1; x++) {
        const n = wallsAround(solid, W, x, y)
        next[y * W + x] = n >= GEN.ca.birthLimit ? 1 : n <= GEN.ca.deathLimit ? 0 : solid[y * W + x]
      }
    }
    solid.set(next)
    applyBorder(solid, W, H)
  }

  // ── 2. Входная и выходная камеры ────────────────────────────────────────
  // Вход — в верхней части (с любой стороны), выход — в нижней напротив.
  const entranceLeft = rng.chance(0.5)
  const entrance: CavePoint = {
    x: entranceLeft
      ? rng.range(8, Math.floor(W * 0.3))
      : rng.range(Math.floor(W * 0.7), W - 9),
    y: rng.range(5, 8),
  }
  const exit: CavePoint = {
    x: entranceLeft
      ? rng.range(Math.floor(W * 0.62), W - 10)
      : rng.range(9, Math.floor(W * 0.38)),
    y: H - 9 - rng.int(3),
  }

  carveChamber(solid, W, H, entrance, GEN.chambers.entranceW, GEN.chambers.entranceH)
  carveChamber(solid, W, H, exit, GEN.chambers.exitW, GEN.chambers.exitH)

  // ── 3. Drunkard's walk: туннель вход → выход ────────────────────────────
  const path: CavePoint[] = []
  const cur: CavePoint = { ...entrance }
  let guard = W * H * 3
  while ((Math.abs(cur.x - exit.x) > 1 || Math.abs(cur.y - exit.y) > 1) && guard-- > 0) {
    carveDisc(solid, W, H, cur, GEN.drunkard.tunnelRadius)
    path.push({ ...cur })

    let sx = 0
    let sy = 0
    if (rng.float() < GEN.drunkard.driftToExit) {
      const dx = exit.x - cur.x
      const dy = exit.y - cur.y
      if (Math.abs(dx) > Math.abs(dy)) sx = Math.sign(dx)
      else if (Math.abs(dy) > Math.abs(dx)) sy = Math.sign(dy)
      else {
        sx = Math.sign(dx)
        sy = Math.sign(dy)
      }
    } else {
      const dir = rng.int(4)
      sx = dir === 0 ? 1 : dir === 1 ? -1 : 0
      sy = dir === 2 ? 1 : dir === 3 ? -1 : 0
    }
    cur.x = clamp(cur.x + sx, 3, W - 4)
    cur.y = clamp(cur.y + sy, 3, H - 4)
  }
  // Страховка: прямая борозда до выхода, если блуждание выдохлось.
  carveLine(solid, W, H, cur, exit, GEN.drunkard.tunnelRadius)
  carveDisc(solid, W, H, exit, GEN.drunkard.tunnelRadius + 1)

  // ── 4. Дополнительные блуждания: петли и каверны ───────────────────────
  for (let w = 0; w < GEN.drunkard.extraWalks; w++) {
    const start = path.length > 0 ? rng.pick(path) : { ...entrance }
    const pos: CavePoint = { ...start }
    for (let s = 0; s < GEN.drunkard.extraSteps; s++) {
      carveDisc(solid, W, H, pos, GEN.drunkard.extraRadius)
      const dir = rng.int(4)
      pos.x = clamp(pos.x + (dir === 0 ? 1 : dir === 1 ? -1 : 0), 3, W - 4)
      pos.y = clamp(pos.y + (dir === 2 ? 1 : dir === 3 ? -1 : 0), 3, H - 4)
    }
  }

  // ── 5. Биомы: полосы по глубине + шумовое дрожание границ ───────────────
  const biomes = new Uint8Array(W * H)
  const metersPerTile = T * GEN.map.metersPerPixel
  const boundaries = GEN.biomeBands.map(
    (b) => (b.toMeters - depthOffsetMeters) / metersPerTile,
  )
  for (let x = 0; x < W; x++) {
    // Дрожание каждой границы в этом столбце.
    const jittered: number[] = []
    for (let k = 0; k < boundaries.length; k++) {
      const j = (noise.fbm(x * GEN.biomeJitter.noiseScale, k * 13.7) - 0.5) * 2
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

  // ── 6. Связность: flood fill от входа, запечатывание карманов ───────────
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

  const cave = finalize(fullSeed, depthOffsetMeters, solid, W, H, T, entrance, exit, {
    airTiles: countAir(solid),
    reachableRatio,
    attempts: attempt,
    hash: 0,
  }, biomes)
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
    for (let tryN = 0; tryN < 120 && placed < GEN.biomeBands[b].nests; tryN++) {
      const x = rng.range(3, W - 4)
      const y = rng.range(3, H - 4)
      const i = y * W + x
      if (biomes[i] !== b) continue
      if (solid[i] !== 0 || solid[i + W] === 0) continue
      const dEnt = (x - entrance.x) ** 2 + (y - entrance.y) ** 2
      const dExit = (x - exit.x) ** 2 + (y - exit.y) ** 2
      if (dEnt < ent2 || dExit < 36) continue
      if (!hasSpacing(cave.nests, x, y, nestSp2)) continue
      cave.nests.push({ tx: x, ty: y, biome: b })
      placed++
    }
  }

  void depthOffsetMeters
  return cave
}

// ── Вспомогательные операции над сеткой ────────────────────────────────────

function applyBorder(solid: Uint8Array, W: number, H: number): void {
  for (let x = 0; x < W; x++) {
    solid[x] = 1
    solid[(H - 1) * W + x] = 1
    solid[(H - 2) * W + x] = 1
  }
  for (let y = 0; y < H; y++) {
    solid[y * W] = 1
    solid[y * W + 1] = 1
    solid[y * W + W - 1] = 1
    solid[y * W + W - 2] = 1
  }
}

function wallsAround(solid: Uint8Array, W: number, x: number, y: number): number {
  let n = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      if (solid[(y + dy) * W + (x + dx)] === 1) n++
    }
  }
  return n
}

function airAt(solid: Uint8Array, W: number, H: number, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= W || y >= H) return false
  return solid[y * W + x] === 0
}

function carveChamber(
  solid: Uint8Array, W: number, H: number, center: CavePoint, w: number, h: number,
): void {
  const x0 = clamp(center.x - Math.floor(w / 2), 2, W - 3)
  const y0 = clamp(center.y - Math.floor(h / 2), 2, H - 3)
  const x1 = clamp(x0 + w - 1, 2, W - 3)
  const y1 = clamp(y0 + h - 1, 2, H - 3)
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      // Скруглённые углы камеры.
      const corner = (x === x0 || x === x1) && (y === y0 || y === y1)
      if (!corner) solid[y * W + x] = 0
    }
  }
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
  solid: Uint8Array, W: number, H: number, from: CavePoint, to: CavePoint, r: number,
): void {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))
  for (let s = 0; s <= steps; s++) {
    const t = steps === 0 ? 0 : s / steps
    carveDisc(solid, W, H, {
      x: Math.round(from.x + (to.x - from.x) * t),
      y: Math.round(from.y + (to.y - from.y) * t),
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
