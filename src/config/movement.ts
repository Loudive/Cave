/**
 * movement.ts — типизированный доступ к параметрам движения.
 * Источник правды — src/config/movement.json (шаг 3).
 * Правило гайда: код не содержит магических констант баланса.
 */
import data from './movement.json'

export interface RunConfig {
  runAccel: number
  runFriction: number
  runMaxSpeed: number
  /** Доля управления в воздухе (0..1). */
  airControl: number
}

export interface JumpConfig {
  /** Отрицательный (вверх) импульс прыжка, px/s. */
  jumpVelocity: number
  coyoteTime: number
  jumpBuffer: number
  jumpCutMultiplier: number
}

export interface WallConfig {
  wallSlideMaxFall: number
  wallJumpVelocityX: number
  wallJumpVelocityY: number
  wallLockTime: number
}

/** Шаг 12: карабканье по стенам — цепляние с прыжка и ползание. */
export interface ClimbConfig {
  /** Летим вверх быстрее этого — не цепляемся (не липнем в разгаре прыжка). */
  latchMaxRiseSpeed: number
  climbUpSpeed: number
  climbDownSpeed: number
  crawlAccel: number
  /** Сколько мс тянуть ОТ стены, чтобы отцепиться. */
  unstickMs: number
  /** Наклон спрайта к стене при цеплянии (рад). */
  clingTiltRad: number
  /** Скорость прижима к стене в сцепе — когти в камне (px/s). */
  clingPressSpeed: number
}

export interface GlideConfig {
  /** Потолок скорости падения при планировании, px/s. */
  glideFallSpeed: number
  /** Торможение падения при планировании, px/s². */
  glideBrake: number
}

/** Шаг 13 (Carrion/Dead Cells): сквош-энд-стретч тела на приземлении/отрыве. */
export interface JuiceConfig {
  /** Сжатие по X при приземлении (множитель от роста). */
  landSquashX: number
  /** Сжатие по Y при приземлении. */
  landSquashY: number
  /** Длительность сжатия, мс. */
  landSquashMs: number
  /** Падение быстрее этого (px/s) — «жёсткое» приземление со сквошем. */
  landMinVy: number
  /** Частиц пыли при жёстком приземлении. */
  landDustCount: number
  /** Растяжение по X в момент отрыва от земли. */
  takeoffStretchX: number
  /** Растяжение по Y в момент отрыва. */
  takeoffStretchY: number
  /** Длительность растяжения, мс. */
  takeoffMs: number
  /** Падение быстрее этого — сквош/пыль на максимуме (линейно от landMinVy). */
  landMaxVy: number
}

export interface MovementConfig {
  run: RunConfig
  jump: JumpConfig
  wall: WallConfig
  climb: ClimbConfig
  glide: GlideConfig
  juice: JuiceConfig
  gravity: number
  terminalVelocity: number
  respawnFallY: number
}

export const MOVEMENT = data as unknown as MovementConfig
