/**
 * enemies.ts — типизированный доступ к параметрам добычи (шаг 6).
 * Источник правды — src/config/enemies.json. Шаг 7 расширит виды и FSM.
 */
import data from './enemies.json'

export interface WanderConfig {
  speed: number
  pauseMs: [number, number]
  moveMs: [number, number]
  hopEveryMs: number
}

export interface FleeConfig {
  speed: number
  hopChance?: number
  hopVelocityY?: number
  climbBias?: number
}

export interface CounterConfig {
  windupMs: number
  lungeSpeed: number
  damage: number
  cooldownMs: number
  triggerRange: number
  corneredOnly: boolean
  /** Сколько мс добыча толкается в стену перед замахом. */
  stuckMs: number
}

export interface FlyConfig {
  speed: number
  anchorRadius: number
  anchorYMin: number
  anchorYMax: number
  sineAmplitudePx: number
  sinePeriodMs: number
  wingFlapMs: number
}

export interface SpeciesConfig {
  name: string
  hp: number
  /** [w, h] хитбокса, px. */
  size: [number, number]
  texture: string
  /** Сытость туши (очков голода). */
  meat: number
  xp: number
  detectRadius: number
  knockbackResist: number
  twinAlpha: number
  wander?: WanderConfig
  flee: FleeConfig
  counter: CounterConfig | null
  fly?: FlyConfig
}

export interface EnemiesConfig {
  spawn: {
    perNest: number
    speciesWeights: { id: string; weight: number }[]
    biomeFallback: string[]
  }
  species: Record<string, SpeciesConfig>
}

export const ENEMIES = data as unknown as EnemiesConfig
