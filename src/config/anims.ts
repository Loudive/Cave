/**
 * anims.ts — типизированный доступ к параметрам анимаций героя.
 * Источник правды — src/config/anims.json (шаг 11, переработка).
 * unwrapDoc + assertNumbers — слепой каст не допускается (урок фриз-инцидента).
 */
import data from './anims.json'
import { unwrapDoc, assertNumbers, type NumberKeys } from './unwrap'

export interface SheetAnimConfig {
  /** Кадров в листе (валидируется слайсером process-hero.mjs). */
  frames: number
  /** Частота кадров, к/с. */
  fps: number
  /** Циклическая анимация? */
  loop: boolean
  /** Порядок проигрывания кадров (нестандартный цикл, glide). */
  order?: number[]
  /** Мс до скрытия спрайта после старта (одноразовые анимации). */
  hideAfterMs?: number
}

export interface AnimsConfig {
  frame: { w: number; h: number }
  idle: SheetAnimConfig
  run: SheetAnimConfig
  glide: SheetAnimConfig
  bite: SheetAnimConfig
  eat: SheetAnimConfig
  hurt: SheetAnimConfig
  death: SheetAnimConfig
  /** Статичный кадр glide для прыжка/падения. */
  airborneFrame: number
}

const cfg = unwrapDoc<AnimsConfig>(data as unknown as Record<string, unknown>, 'anims.json')

const SHEET_KEYS = ['frames', 'fps'] as const

// fail-fast при старте: каждое числовое поле обязано быть числом.
for (const name of ['idle', 'run', 'glide', 'bite', 'eat', 'hurt', 'death'] as const) {
  assertNumbers(cfg[name], `anims.json.${name}`, SHEET_KEYS as unknown as readonly NumberKeys<SheetAnimConfig>[])
}
assertNumbers(cfg.death, 'anims.json.death', ['hideAfterMs'] as unknown as readonly NumberKeys<SheetAnimConfig>[])
assertNumbers(cfg.frame, 'anims.json.frame', ['w', 'h'])
assertNumbers(cfg, 'anims.json', ['airborneFrame'])

export const ANIMS = cfg
