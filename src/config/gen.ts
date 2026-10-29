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
  /** Шаг 12: плотность лоз с потолков (доля подходящих клеток воздуха). */
  vine: number
}

export interface GenConfig {
  map: {
    cols: number
    rows: number
    tile: number
    metersPerPixel: number
    /** Шаг 13: радиус открытия тумана войны (тайлов) вокруг существа. */
    revealTiles: number
    /** Шаг 13: сколько мс держать M для полной карты. */
    bigMapHoldMs: number
    /** Шаг 13: множитель увеличения полной карты. */
    bigMapScale: number
    /** Шаг 21: отступ мини-карты от угла экрана (px). */
    miniMargin: number
    /** Шаг 21: пикселей на тайл на мини-карте. */
    miniTileScale: number
    /** Шаг 21: цвет тумана войны мини-карты (тёмно-синий: читается как
     *  «карта», а не сплошная дыра — жалоба «неизвестные тёмные фигуры»). */
    miniFogColor: number
    /** Шаг 21: альфа заливки тумана войны. */
    miniFogAlpha: number
    /** Шаг 21: цвет рамки мини-карты. */
    miniFrameColor: number
    /** Шаг 21: альфа линии рамки. */
    miniFrameAlpha: number
    /** Шаг 21: внутренний отступ рамки от карты (px). */
    miniFramePad: number
    /** Шаг 21: альфа подложки под картой. */
    miniBackingAlpha: number
    /** Шаг 21: альфа подписи «M — карта». */
    miniLabelAlpha: number
  }
  /** Шаг 14: большие органичные каверны (референсы Hollow Knight/Blasphemous). */
  caverns: {
    hubRxMin: number
    hubRxMax: number
    hubRyMin: number
    hubRyMax: number
    hubYFrom: number
    hubYTo: number
    hubXFrom: number
    hubXTo: number
    countMin: number
    countMax: number
    rxMin: number
    rxMax: number
    ryMin: number
    ryMax: number
    wobble: number
    edgeNoiseScale: number
    edgeNoiseOffsetX: number
    edgeNoiseOffsetY: number
    expMin: number
    expMax: number
    tierTopFrom: number
    tierTopTo: number
    tierMidFrom: number
    tierMidTo: number
    tierLowFrom: number
    tierLowTo: number
    entranceXShare: number
    entranceYFrom: number
    entranceYTo: number
    entranceRx: number
    entranceRy: number
    exitXShare: number
    exitYFrom: number
    exitYTo: number
    exitRx: number
    exitRy: number
    pathHopsMin: number
    pathHopsMax: number
    centerSpacing: number
    /** Поле от края для центров каверн (тайлы). */
    edgeMarginTiles: number
    /** Множитель попыток размещения каверн. */
    placeBudget: number
    /** Амплитуда волнистой каймы карты (тайлы). */
    borderWobble: number
    /** Частота шума волнистой каймы. */
    borderNoiseScale: number
    /** Каналы декорреляции шума каймы [лево, право, верх, низ]. */
    borderNoiseChannels: number[]
  }
  /** Шаг 14: туннели — широкая тропа, узкие лазы, вертикальные шахты. */
  tunnels: {
    mainRadius: number
    mainDrift: number
    crawlRadius: number
    crawlDrift: number
    loopMin: number
    loopMax: number
    shaftRadius: number
    shaftDrift: number
    shaftsPerBoundary: number
    guardStepsPerTile: number
    guardBaseSteps: number
    /** Шанс шага вбок даже в дрейфе — стены шахт не прямые. */
    wanderStep: number
    /** «Дыхание» радиуса туннеля — органичное сужение/расширение. */
    wave: {
      freq: number
      amp: number
    }
  }
  /** Шаг 14: острова-уступы внутри больших каверн. */
  islands: {
    perAreaTiles: number
    maxPerCavern: number
    wMin: number
    wMax: number
    hMin: number
    hMax: number
    tierFracs: number[]
    xSpread: number
    ySpread: number
    marginSide: number
    marginTop: number
    placeBudget: number
    taperSoftness: number
    edgeJitter: number
  }
  connectivity: {
    targetReachable: number
    repairMaxTries: number
  }
  biomeJitter: {
    noiseScale: number
    amplitudeTiles: number
    channelStep: number
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
    minDistFromExitTiles: number
    placeBudget: number
    fieldMarginTiles: number
  }
  seedAlphabet: string
  seedLength: number
}

export const GEN = data as unknown as GenConfig

/** Цвет полосы биома как число 0xrrggbb. */
export function bandColorInt(band: BiomeBand): number {
  return parseInt(band.glowColor.replace('#', ''), 16)
}
