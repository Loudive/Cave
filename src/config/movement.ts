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

export interface MovementConfig {
  run: RunConfig
  jump: JumpConfig
  wall: WallConfig
  climb: ClimbConfig
  glide: GlideConfig
  gravity: number
  terminalVelocity: number
  respawnFallY: number
}

export const MOVEMENT = data as unknown as MovementConfig
