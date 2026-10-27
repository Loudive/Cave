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
  glide: GlideConfig
  gravity: number
  terminalVelocity: number
  respawnFallY: number
}

export const MOVEMENT = data as unknown as MovementConfig
