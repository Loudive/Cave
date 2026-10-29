/**
 * expedition.ts — типизированный доступ к конфигу экспедиций (шаг 26).
 * Источник правды — src/config/expedition.json. Ноль магических чисел.
 */
import data from './expedition.json'

export interface ExpeditionConfig {
  timing: {
    firstAfterMs: [number, number]
    intervalMs: [number, number]
    maxAliveHumans: number
  }
  squads: { byBand: string[][] }
  march: {
    retargetMs: [number, number]
    jitterTiles: number
    marchPauseChance: number
    hopVelocityY: number
  }
  panic: { escapeRadiusTiles: number; escapedRingColor: string }
  light: { radius: number; glowAlpha: number; glowScale: number; lampColor: string }
  rewards: {
    sampleEssence: number
    marineEssence: number
    banner: string
    bannerMs: number
  }
  bullets: {
    hitRadius: number
    lifeMs: number
    mobDmgShare: number
    muzzleLightRadius: number
    tint: string
    friendly: string[]
  }
}

export const EXPEDITION = data as unknown as ExpeditionConfig
