/**
 * TileBuilder.ts — шаг 4 → шаг 14: сборка Phaser-тайлмапа из CaveData.
 *
 * Шаг 14 — многослойные стены (референсы Hollow Knight / Blasphemous):
 * один атлас tiles-cave.png (8×4 слота) вместо россыпи текстур.
 * Слои:
 *  · edge — край стены к воздуху: АВТОТАЙЛ по битмаске воздушных соседей
 *    (N=1 E=2 S=4 W=8, 16 контекстов): пол несёт тёплую светлую кромку
 *    (rim-light), стена — вертикальный градиент, потолок — тёмную кромку
 *    со сталактитиками, внешние углы скруглены. Коллизии: да.
 *  · stone — ядро стены со СТРАТАМИ ГЛУБИНЫ: BFS-дистанция от воздуха
 *    (2→близко, 5+=бездна), камень темнеет вглубь — стена читается
 *    толстой 3D-массой. Коллизии: да.
 *  · decor — мох/кристалл/кость (прозрачный фон, без коллизий).
 */
import Phaser from 'phaser'
import type { CaveData } from '../gen/cave'

export interface CaveLayers {
  stone: Phaser.Tilemaps.TilemapLayer
  ground: Phaser.Tilemaps.TilemapLayer
  /** ВСЕ слои с коллизиями (edge + stone). */
  solid: Phaser.Tilemaps.TilemapLayer[]
  /** Слой декора (верхний, без коллизий) — для сортировки глубины. */
  decor: Phaser.Tilemaps.TilemapLayer
}

/** ID слотов атласа tiles-cave.png (8 колонок). */
const STONE_NEAR = 0
const STONE_MID = 1
const STONE_DEEP = 2
const STONE_VOID = 3
/** Край стены: слот 4 + битмаска воздушных соседей (N=1 E=2 S=4 W=8). */
const EDGE_BASE = 4
/** Максимальная рисуемая глубина страт (дальше — бездна). */
const DEPTH_MAX = 5

function airAt(cave: CaveData, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= cave.cols || y >= cave.rows) return false
  return cave.solid[y * cave.cols + x] === 0
}

/** Битмаска воздушных соседей тайла: N=1 E=2 S=4 W=8. */
function edgeMask(cave: CaveData, x: number, y: number): number {
  let m = 0
  if (airAt(cave, x, y - 1)) m |= 1
  if (airAt(cave, x + 1, y)) m |= 2
  if (airAt(cave, x, y + 1)) m |= 4
  if (airAt(cave, x - 1, y)) m |= 8
  return m
}

/**
 * BFS-дистанция каждой твёрдой клетки до ближайшего воздуха (1 = край).
 * Мульти-источник из всех воздушных клеток — один проход O(N).
 */
function depthMap(cave: CaveData): Uint8Array {
  const W = cave.cols
  const H = cave.rows
  const d = new Uint8Array(W * H)
  const queue = new Int32Array(W * H)
  let head = 0
  let tail = 0
  for (let i = 0; i < W * H; i++) {
    if (cave.solid[i] === 0) {
      d[i] = 0
      queue[tail++] = i
    }
  }
  while (head < tail) {
    const idx = queue[head++]
    const x = idx % W
    const y = (idx - x) / W
    const next = d[idx] + 1
    if (next > DEPTH_MAX) continue
    const nb: Array<[number, boolean]> = [
      [idx - 1, x > 0],
      [idx + 1, x < W - 1],
      [idx - W, y > 0],
      [idx + W, y < H - 1],
    ]
    for (const [j, ok] of nb) {
      if (ok && cave.solid[j] === 1 && d[j] === 0) {
        d[j] = next
        queue[tail++] = j
      }
    }
  }
  return d
}

/** Собрать data-массив (-1 = пусто) по предикату, вычисляющему ID тайла. */
function dataWhere(
  cave: CaveData,
  pred: (x: number, y: number, i: number) => number,
): number[][] {
  const rows: number[][] = []
  for (let y = 0; y < cave.rows; y++) {
    const row: number[] = []
    for (let x = 0; x < cave.cols; x++) {
      const id = pred(x, y, y * cave.cols + x)
      row.push(id)
    }
    rows.push(row)
  }
  return rows
}

/** Однослойный тайлмап из data-массива по атласу tiles-cave. */
function makeAtlasLayer(
  scene: Phaser.Scene,
  data: number[][],
  collide: boolean,
  depth: number,
): Phaser.Tilemaps.TilemapLayer {
  const map = scene.make.tilemap({
    data,
    tileWidth: 16,
    tileHeight: 16,
  })
  const tileset = map.addTilesetImage('tiles-cave', 'tiles-cave', 16, 16, 0, 0)!
  const layer = map.createLayer(0, tileset, 0, 0)!
  if (collide) layer.setCollisionByExclusion([-1])
  layer.setDepth(depth)
  return layer
}

/** Тайлмап декора по отдельной текстуре (как в шаге 4). */
function makeLayer(
  scene: Phaser.Scene,
  texKey: string,
  data: number[][],
  depth: number,
): Phaser.Tilemaps.TilemapLayer {
  const map = scene.make.tilemap({
    data,
    tileWidth: 16,
    tileHeight: 16,
  })
  const tileset = map.addTilesetImage(texKey, texKey, 16, 16, 0, 0)!
  const layer = map.createLayer(0, tileset, 0, 0)!
  layer.setDepth(depth)
  return layer
}

export function buildCaveTilemap(scene: Phaser.Scene, cave: CaveData): CaveLayers {
  const depth = depthMap(cave)

  // ── Край стены: автотайл по битмаске воздушных соседей ────────────────
  const edgeLayer = makeAtlasLayer(
    scene,
    dataWhere(cave, (x, y, i) =>
      cave.ground[i] === 1 ? EDGE_BASE + edgeMask(cave, x, y) : -1),
    true, 1,
  )

  // ── Ядро стены: страты глубины (2 → near … 5+ → void) ────────────────
  const stoneLayer = makeAtlasLayer(
    scene,
    dataWhere(cave, (_x, _y, i) => {
      if (cave.solid[i] !== 1 || cave.ground[i] === 1) return -1
      const band = Math.min(depth[i], DEPTH_MAX)
      return band <= 2 ? STONE_NEAR : band === 3 ? STONE_MID : band === 4 ? STONE_DEEP : STONE_VOID
    }),
    true, 0,
  )

  // ── Декор (мох/кристалл/кость) — прозрачный фон, без коллизий ────────
  const moss = makeLayer(scene, 'decor-moss',
    dataWhere(cave, (_x, _y, i) => (cave.decor[i] === 1 ? 0 : -1)), 2)
  makeLayer(scene, 'decor-crystal',
    dataWhere(cave, (_x, _y, i) => (cave.decor[i] === 2 ? 0 : -1)), 2)
  makeLayer(scene, 'decor-bone',
    dataWhere(cave, (_x, _y, i) => (cave.decor[i] === 3 ? 0 : -1)), 2)

  return {
    stone: stoneLayer,
    ground: edgeLayer,
    solid: [edgeLayer, stoneLayer],
    decor: moss,
  }
}
