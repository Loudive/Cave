/**
 * TileBuilder.ts — шаг 4 → шаг 12: сборка Phaser-тайлмапа из CaveData.
 * Слои: камень (ядро стен, 4 варианта по детерминированному хэшу позиции —
 * зерно/окаменелость/трещина), земля (край у воздуха — 4 контекста:
 * top=пол со светлой кромкой, side=стена, bottom=потолок с потёками,
 * inner=диагональный край), декор (мох/кристалл/кость).
 * Камень и земля — коллизии, декор — фон.
 */
import Phaser from 'phaser'
import type { CaveData } from '../gen/cave'

export interface CaveLayers {
  stone: Phaser.Tilemaps.TilemapLayer
  ground: Phaser.Tilemaps.TilemapLayer
  /** Шаг 12: ВСЕ слои с коллизиями — камень ×4 варианта + земля ×4 контекста.
 * Коллайдеры существ обязаны использовать solid: после разбиения на
 * варианты слоёв физика только по stone/ground пропускала 3/4 стен
 * (грабля поймана верификацией: игрок пролетал сквозь стены). */
  solid: Phaser.Tilemaps.TilemapLayer[]
  /** Слой декора (верхний, без коллизий) — для сортировки глубины. */
  decor: Phaser.Tilemaps.TilemapLayer
}

/** Варианты тайла камня по хэшу позиции (детерминированно, шаг 12). */
const STONE_VARIANTS = ['tile-stone', 'tile-stone-b', 'tile-stone-c', 'tile-stone-d'] as const

/** Хэш координат → стабильный индекс варианта (одинаков каждый билд). */
function variantHash(x: number, y: number): number {
  return (((x * 73856093) ^ (y * 19349663)) >>> 0) % STONE_VARIANTS.length
}

function airAt(cave: CaveData, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= cave.cols || y >= cave.rows) return false
  return cave.solid[y * cave.cols + x] === 0
}

/** Собрать data-массив (-1 = пусто, 0 = тайл) по предикату. */
function dataWhere(cave: CaveData, pred: (x: number, y: number, i: number) => boolean): number[][] {
  const rows: number[][] = []
  for (let y = 0; y < cave.rows; y++) {
    const row: number[] = []
    for (let x = 0; x < cave.cols; x++) {
      row.push(pred(x, y, y * cave.cols + x) ? 0 : -1)
    }
    rows.push(row)
  }
  return rows
}

/** Однослойный тайлмап из data-массива. collide — клетки 0 твёрдые. */
function makeLayer(
  scene: Phaser.Scene,
  texKey: string,
  data: number[][],
  collide: boolean,
  depth: number,
): Phaser.Tilemaps.TilemapLayer {
  const map = scene.make.tilemap({
    data,
    tileWidth: 16,
    tileHeight: 16,
  })
  const tileset = map.addTilesetImage(texKey, texKey, 16, 16, 0, 0)!
  const layer = map.createLayer(0, tileset, 0, 0)!
  if (collide) layer.setCollisionByExclusion([-1])
  layer.setDepth(depth)
  return layer
}

export function buildCaveTilemap(scene: Phaser.Scene, cave: CaveData): CaveLayers {
  // ── Камень: ядро стен (не край к воздуху), 4 варианта по хэшу ──────
  // Все слои камня одинаково «твёрдые» — вариант чисто визуальный.
  const solidLayers: Phaser.Tilemaps.TilemapLayer[] = []
  let stoneMain: Phaser.Tilemaps.TilemapLayer | null = null
  for (let v = 0; v < STONE_VARIANTS.length; v++) {
    const tex = STONE_VARIANTS[v]
    const layer = makeLayer(
      scene, tex,
      dataWhere(cave, (x, y, i) =>
        cave.solid[i] === 1 && cave.ground[i] === 0 && variantHash(x, y) === v),
      true, 0,
    )
    solidLayers.push(layer)
    if (!stoneMain) stoneMain = layer
  }

  // ── Земля: край к воздуху — контекст решает текстуру (шаг 12) ──────
  // top: воздух сверху (пол) · side: воздух слева/справа · bottom: воздух
  // снизу (потолок) · inner (tile-dirt): воздух только по диагоналям.
  let groundMain: Phaser.Tilemaps.TilemapLayer | null = null
  const dirtContexts: Array<[string, (x: number, y: number) => boolean]> = [
    ['tile-dirt-top', (x, y) => airAt(cave, x, y - 1)],
    ['tile-dirt-bottom', (x, y) => airAt(cave, x, y + 1)],
    ['tile-dirt-side', (x, y) => airAt(cave, x - 1, y) || airAt(cave, x + 1, y)],
    // inner — всё остальное (диагональные края), оригинальный тайл.
    ['tile-dirt', () => true],
  ]
  for (const [tex, applies] of dirtContexts) {
    const layer = makeLayer(
      scene, tex,
      dataWhere(cave, (x, y, i) => {
        if (cave.ground[i] !== 1) return false
        // Первый подходящий контекст выигрывает (top > bottom > side > inner).
        for (const [, test] of dirtContexts) {
          if (test(x, y)) return test === applies
        }
        return false
      }),
      true, 1,
    )
    solidLayers.push(layer)
    if (!groundMain) groundMain = layer
  }

  const moss = makeLayer(scene, 'decor-moss', dataWhere(cave, (_x, _y, i) => cave.decor[i] === 1), false, 2)
  makeLayer(scene, 'decor-crystal', dataWhere(cave, (_x, _y, i) => cave.decor[i] === 2), false, 2)
  makeLayer(scene, 'decor-bone', dataWhere(cave, (_x, _y, i) => cave.decor[i] === 3), false, 2)

  return { stone: stoneMain!, ground: groundMain!, solid: solidLayers, decor: moss }
}
