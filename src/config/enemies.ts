/**
 * enemies.ts — типизированный доступ к параметрам мобов (шаг 7).
 * Источник правды — src/config/enemies.json: шесть видов, роли,
 * отношения (кто на кого охотится), экосистема. Код без магических чисел.
 */
import data from './enemies.json'

export type DamageType = 'physical' | 'acid' | 'fire'

/** Роль вида в отношении к игроку. */
export type SpeciesRole = 'prey' | 'opportunist' | 'territorial' | 'hunter'

export interface ArmorConfig {
  physical: number
  acid: number
  fire: number
}

export interface PatrolConfig {
  speed: number
  pauseMs: [number, number]
  moveMs: [number, number]
  /** 0 — без подпрыгивания (тяжёлые виды). */
  hopEveryMs: number
  /** Поводок: как далеко от точки спавна уходит патруль. */
  leashRadius: number
}

export interface PursueConfig {
  speed: number
  /** Прекратить погоню дальше этого расстояния. */
  giveUpRange: number
  /** territorial: агрится на игрока ближе этого радиуса. */
  aggroRadius?: number
  /** opportunist: атакует игрока только при HP игрока ниже доли. */
  playerHpBelowPct?: number
}

export interface FleeConfig {
  speed: number
  hopChance?: number
  hopVelocityY?: number
  climbBias?: number
}

/** Атака вида: выпад, веер спор или пиявка. */
export interface LungeAttackConfig {
  type: 'lunge'
  windupMs: number
  lungeSpeed: number
  activeMs: number
  damage: number
  damageType: DamageType
  cooldownMs: number
  triggerRange: number
  corneredOnly: boolean
  stuckMs: number
}

export interface ShootAttackConfig {
  type: 'shoot'
  windupMs: number
  shots: number
  spreadDeg: number
  shotSpeed: number
  projGravity: number
  shotRange: number
  /** Ближе этого расстояния жнец отступает (китер). */
  retreatRange: number
  damage: number
  damageType: DamageType
  cooldownMs: number
}

export interface DrainAttackConfig {
  type: 'drain'
  windupMs: number
  drainRange: number
  drainPerTick: number
  tickMs: number
  maxMs: number
  /** Доля выпитого, возвращающаяся в HP кровососа. */
  healRatio: number
  damageType: DamageType
  cooldownMs: number
}

export type AttackConfig = LungeAttackConfig | ShootAttackConfig | DrainAttackConfig

/** Контратака в углу (добыча, прижатая к стене). */
export interface CounterConfig extends LungeAttackConfig {
  corneredOnly: true
  /** Сколько мс добыча толкается в стену перед замахом. */
  stuckMs: number
}

/** Свёртка панциря: вместо бегства — неуязвимость и лечение. */
export interface CurlConfig {
  durationMs: number
  healPerSec: number
  /** Порог HP (доля от максимума), ниже которого панцирь свёртывается. */
  threshold: number
}

/** Падальщик: ест туши. */
export interface ScavengeConfig {
  corpseSense: number
  chewMs: number
  /** Очков мяса за чавканье. */
  portion: number
  healPerChew: number
}

export interface FlyConfig {
  speed: number
  /** Скорость полёта в погоне. */
  pursueSpeed: number
  anchorRadius: number
  anchorYMin: number
  anchorYMax: number
  sineAmplitudePx: number
  sinePeriodMs: number
  wingFlapMs: number
}

/** Огненный след лавового ползуна. */
export interface TrailConfig {
  everyMs: number
  lifeMs: number
  radius: number
  /** Урон в секунду по цели в луже. */
  burnDps: number
  burnTickMs: number
  maxPatches: number
  /** Радиус дыры света в маске тьмы. */
  lightRadius: number
  onlyWhenMoving: boolean
}

export interface SpeciesConfig {
  name: string
  role: SpeciesRole
  /** Кого вид охотится на мобов (экосистема). */
  hunts: string[]
  /** Кого боится с глазу (мгновенное бегство). */
  fears: string[]
  hp: number
  /** [w, h] хитбокса, px. */
  size: [number, number]
  texture: string
  /** Сытость туши (очков голода). */
  meat: number
  xp: number
  /** Шаг 11: Эссенция Гнезда за убийство этого вида (мета-валюта). */
  essence: number
  detectRadius: number
  knockbackResist: number
  twinAlpha: number
  armor?: ArmorConfig
  /** Цвет кольца шума вида (визуализация писка в темноте). */
  noiseColor: string
  patrol?: PatrolConfig
  pursue?: PursueConfig | null
  flee: FleeConfig | null
  counter?: CounterConfig | null
  attack?: AttackConfig | null
  curl?: CurlConfig | null
  scavenge?: ScavengeConfig | null
  fly?: FlyConfig | null
  trail?: TrailConfig | null
  _flavor?: string
}

export interface EcoRingConfig {
  lifeMs: number
  growFrom: number
  growTo: number
  alphaWindup: number
  alphaHit: number
  alphaEat: number
  alphaSqueak: number
}

export interface EcoConfig {
  /** Мобы дерутся между собой, только если игрок дальше этого радиуса. */
  peaceRadius: number
  respawnMs: [number, number]
  thinkEveryMs: [number, number]
  squeakEveryMs: [number, number]
  /** Прекратить погоню за целью после этого времени. */
  huntGiveUpMs: number
  leashRadius: number
  /** Поваленная тушами мобов сытость делает моба крупнее (до maxMealsGrow). */
  maxMealsGrow: number
  growPerMeal: number
  maxMobScale: number
  ring: EcoRingConfig
}

export interface EnemiesConfig {
  /** Шаг 13 (Dead Cells): разрыв тел при оверкилле. */
  gib: {
    /** Убойный урон ≥ overkillShare·maxHp — жертву разрывает. */
    overkillShare: number
    /** Мясных кусков при разрыве. */
    chunkCount: number
    /** Съедобных сгустков (мин, макс). */
    clotsPerGib: [number, number]
    /** Масштаб большой декали под жертвой. */
    decalScale: number
  }
  spawn: {
    perNest: [number, number]
    biomeFallback: string[]
    maxPerSpecies: number
    /** Шаг 12: процедурный спавн вокруг игрока (пещера не пустует). */
    roamIntervalMs: [number, number]
    roamRingTiles: [number, number]
    roamMaxBatch: number
    byBiome: { id: string; weight: number }[][]
  }
  eco: EcoConfig
  species: Record<string, SpeciesConfig>
}

export const ENEMIES = data as unknown as EnemiesConfig

/** Сопротивление виду по типу урона (0 — урон проходит полностью). */
export function armorResist(sp: SpeciesConfig, type: DamageType): number {
  return sp.armor?.[type] ?? 0
}
