/**
 * balance.ts — типизированный доступ к числам боёвки, голода и роста.
 * Источник правды — src/config/balance.json (шаг 6).
 * Правило гайда: код не содержит магических констант баланса.
 */
import data from './balance.json'

export interface PlayerBalance {
  maxHp: number
  biteDamage: number
  biteWindupMs: number
  biteActiveMs: number
  biteCooldownMs: number
  biteRange: number
  biteArcDeg: number
  biteLungeSpeed: number
  biteKnockback: number
  hpFromChew: number
  invulnAfterHitMs: number
}

export interface HungerBalance {
  max: number
  tickMs: number
  drainPerTick: number
  starveDamage: number
  starveTickMs: number
  warnBelow: number
}

export interface GrowthBalance {
  xpBase: number
  xpCurveExp: number
  maxLevel: number
  scalePerLevel: number
  maxScale: number
  hpPerLevel: number
  bitePerLevel: number
  hungerMaxPerLevel: number
  appetitePerLevel: number
}

export interface EatingBalance {
  chewMs: number
  range: number
  hungerPerChew: number
  carcassLifeMs: number
  chunkParticles: number
}

export interface ClotsBalance {
  hunger: number
  xp: number
  lifeMs: number
  pickupRadius: number
}

export interface HitBalance {
  hitstopMs: number
  shakePx: number
  shakeMs: number
  killHitstopMs: number
  killShakePx: number
  killShakeMs: number
}

export interface BloodBalance {
  particlesPerHit: [number, number]
  particlesPerKill: [number, number]
  speedMin: number
  speedMax: number
  lifespanMin: number
  lifespanMax: number
  gravity: number
  stickyChance: number
  decalDarkenMs: number
  decalLifeMs: number
  maxDecals: number
  clotsPerKill: [number, number]
}

export interface MutationsBalance {
  dropChance: number
  maxOwned: number
}

export interface SpawnBalance {
  perNest: [number, number]
  entrancePrey: number
  maxAlive: number
}

/** Споровая пыль жнеца (шаг 7): замедление существа. */
export interface SporeBalance {
  slowFactor: number
  slowMs: number
}

export interface DeathBalance {
  hitstopMs: number
  fadeMs: number
  bloodMultiplier: number
}

/** Шаг 13 (Dead Cells): серия быстрых укусов — множитель урона растёт. */
export interface ComboBalance {
  /** Окно между ударами, чтобы серия жила, мс. */
  windowMs: number
  /** Прибавка множителя за удар серии. */
  damageStep: number
  /** Потолок множителя. */
  maxMult: number
  /** Серия считается (и множитель растёт) с этого удара. */
  minHits: number
}

/** Шаг 13 (Carrion): раненое существо кровоточит на ходу. */
export interface WoundDripBalance {
  hpBelow: number
  intervalMs: number
  decalChance: number
  /** Медленнее этого — рана не каплет (не спамим частицами в статике). */
  minSpeed: number
}

/** Шаг 13 (Carrion): подёргивание туши — мёртвое мясо живо. */
export interface TwitchBalance {
  minMs: number
  maxMs: number
}

export interface BalanceConfig {
  player: PlayerBalance
  hunger: HungerBalance
  growth: GrowthBalance
  eating: EatingBalance
  clots: ClotsBalance
  hit: HitBalance
  blood: BloodBalance
  mutations: MutationsBalance
  spawn: SpawnBalance
  spore: SporeBalance
  death: DeathBalance
  combo: ComboBalance
  woundDrip: WoundDripBalance
  twitch: TwitchBalance
}

export const BALANCE = data as unknown as BalanceConfig

/** XP до следующего уровня роста (кривая из growth). */
export function xpToNext(level: number): number {
  const g = BALANCE.growth
  return Math.round(g.xpBase * Math.pow(level, g.xpCurveExp))
}
