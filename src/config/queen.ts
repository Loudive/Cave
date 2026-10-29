/**
 * queen.ts — типизированный доступ к конфигу Матки Улья (шаг 25).
 * Источник правды — src/config/queen.json (стиль enemies.json: простые
 * листья + _doc-строки). Ноль магических чисел в коде.
 */
import data from './queen.json'

export interface QueenLairEggsConfig {
  count: number
  spreadTiles: number
  scale: [number, number]
  glowAlpha: number
  lightRadius: number
}

export interface QueenLairConfig {
  /** Слой глубины с Маткой: каждый N-й (4, 8, 12… — циклы NG+). */
  everyNDepths: number
  activationRadius: number
  introBanner: string
  challengerBanner: string
  gateAfterVictoryMs: number
  gateLabel: string
  eggs: QueenLairEggsConfig
  lairLight: { radius: number; haloAlpha: number; haloScale: number }
}

export interface QueenPhasesConfig {
  phase2At: number
  phase3At: number
  /** Пауза между атаками по фазам (мс) — ярость ускоряет Матку. */
  actionGapMs: number[]
  brood: {
    byPhase: string[][]
    count: number
    broodMs: number[]
  }
}

export interface QueenAttacksConfig {
  swipe: {
    windupMs: number
    range: number
    arcDeg: number
    damage: number
    knockbackX: number
    knockbackUp: number
  }
  scream: {
    windupMs: number
    radius: number
    damage: number
    knockback: number
    shakePx: number
    shakeMs: number
  }
}

export interface QueenReignConfig {
  power: {
    perEssence: number
    perGenome: number
    perDepthMeter: number
    perEaten: number
    perQueen: number
  }
  refPower: number
  maxMult: number
  challengerEssencePer100Power: number
  codeNameA: string[]
  codeNameB: string[]
}

export interface QueenConfig {
  lair: QueenLairConfig
  stats: { hp: number; scale: number; ngPlusHpMult: number; essenceBonus: number }
  phases: QueenPhasesConfig
  attacks: QueenAttacksConfig
  victory: {
    essence: number
    slowMoMs: number
    collapseMs: number
    geneId: string
    overlayAfterMs: number
  }
  reign: QueenReignConfig
}

export const QUEEN = data as unknown as QueenConfig
