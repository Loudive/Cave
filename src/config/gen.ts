/**
 * gen.ts — типизированный доступ к параметрам генерации пещер.
 * Источник правды — src/config/gen.json (шаг 4).
 * Правило гайда: код не содержит магических констант генерации.
 */
import data from './gen.json'

/** Полоса биома по глубине (GDD §6). */
export interface BiomeBand {
  name: string
  /** Верхняя граница полосы, метров глобальной глубины (последняя — «вечность»). */
  toMeters: number
  /** Цвет биолюма биома, #rrggbb. */
  glowColor: string
  /** Ключ текстуры свечения для этого биома. */
  glow: string
  /** Шанс гриба на клетку пола (0..1). */
  mushroomDensity: number
  /** Шансы декора на клетку пола. */
  moss: number
  crystal: number
  bone: number
  /** Гнёзд мобов на одну карту в этой полосе (данные для шага 5). */
  nests: number
}

export interface GenConfig {
  map: {
    cols: number
    rows: number
    tile: number
    metersPerPixel: number
  }
  ca: {
    fillProb: number
    iterations: number
    birthLimit: number
    deathLimit: number
  }
  drunkard: {
    tunnelRadius: number
    driftToExit: number
    extraWalks: number
    extraSteps: number
    extraRadius: number
  }
  chambers: {
    entranceW: number
    entranceH: number
    exitW: number
    exitH: number
  }
  connectivity: {
    targetReachable: number
    repairMaxTries: number
  }
  biomeJitter: {
    noiseScale: number
    amplitudeTiles: number
  }
  biomeBands: BiomeBand[]
  mushroom: {
    minSpacingTiles: number
    maxTotal: number
    skipNearEntranceTiles: number
  }
  nest: {
    minSpacingTiles: number
    minDistFromEntranceTiles: number
  }
  seedAlphabet: string
  seedLength: number
}

export const GEN = data as unknown as GenConfig

/** Цвет полосы биома как число 0xrrggbb. */
export function bandColorInt(band: BiomeBand): number {
  return parseInt(band.glowColor.replace('#', ''), 16)
}
