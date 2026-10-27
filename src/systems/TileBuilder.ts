/**
 * TileBuilder.ts — шаг 4: сборка Phaser-тайлмапа из CaveData.
 * Три слоя по гайду: камень (ядро стен), земля (край у воздуха), декор
 * (мох/кристалл/кость). Камень и земля — коллизии, декор — фон.
 */
import Phaser from 'phaser'
import type { CaveData } from '../gen/cave'

export interface CaveLayers {
  stone: Phaser.Tilemaps.TilemapLayer
  ground: Phaser.Tilemaps.TilemapLayer
  /** Слой декора (верхний, без коллизий) — для сортировки глубины. */
  decor: Phaser.Tilemaps.TilemapLayer
}

/** Слои тайлов, созданные из данных генератора. */
export function buildCaveTilemap(scene: Phaser.Scene, cave: CaveData): CaveLayers {
  const stone = makeLayer(scene, 'tile-stone', dataWhere(cave, (i) =>
    cave.solid[i] === 1 && cave.ground[i] === 0), true)
  const ground = makeLayer(scene, 'tile-dirt', dataWhere(cave, (i) =>
    cave.ground[i] === 1), true)
  ground.setDepth(1)
  stone.setDepth(0)

  const moss = makeLayer(scene, 'decor-moss', dataWhere(cave, (i) => cave.decor[i] === 1), false)
  const crystal = makeLayer(scene, 'decor-crystal', dataWhere(cave, (i) => cave.decor[i] === 2), false)
  const bone = makeLayer(scene, 'decor-bone', dataWhere(cave, (i) => cave.decor[i] === 3), false)
  moss.setDepth(2)
  crystal.setDepth(2)
  bone.setDepth(2)

  return { stone, ground, decor: moss }
}

/** Собрать data-массив (-1 = пусто, 0 = тайл) по предикату. */
function dataWhere(cave: CaveData, pred: (i: number) => boolean): number[][] {
  const rows: number[][] = []
  for (let y = 0; y < cave.rows; y++) {
    const row: number[] = []
    for (let x = 0; x < cave.cols; x++) {
      row.push(pred(y * cave.cols + x) ? 0 : -1)
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
): Phaser.Tilemaps.TilemapLayer {
  const map = scene.make.tilemap({
    data,
    tileWidth: 16,
    tileHeight: 16,
  })
  const tileset = map.addTilesetImage(texKey, texKey, 16, 16, 0, 0)!
  const layer = map.createLayer(0, tileset, 0, 0)!
  if (collide) layer.setCollisionByExclusion([-1])
  return layer
}
