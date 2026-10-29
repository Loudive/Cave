/**
 * vfx.ts — типизированный доступ к параметрам juice-слоя.
 * Источник правды — src/config/vfx.json (шаг 10, перфоманс).
 *
 * Шаг 11 (фикс «зависания намертво»): раньше стоял слепой каст
 * `data as unknown as VfxConfig` — после перевода vfx.json на формат
 * {_doc, value} каждое поле стало объектом: `0 < {…}` — false, пул
 * вспышек не заполнялся, `undefined.setPosition` ронял игровой цикл
 * Phaser навсегда (первое чавканье = фриз). Теперь unwrapDoc разворачивает
 * значения, assertNumbers валидирует их при старте — ошибка конфига
 * падает сразу и с понятным текстом, а не через NaN в рантайме.
 */
import data from './vfx.json'
import { unwrapDoc, assertNumbers, type NumberKeys } from './unwrap'

export interface VfxConfig {
  flashPoolSize: number
  flashMs: number
  flashScaleGain: number
  chromaMax: number
  chromaFadeMs: number
  slowMoMs: number
  slowMoZoom: number
  slowMoZoomInMs: number
  slowMoZoomOutMs: number
  bloomScale: number
  bloomAlpha: number
  cameraBaseZoom: number
  cameraFollowLerp: number
  aero: VfxAero
}

/** Шаг 20: аэро-джус — шлейф крыльев / взмахи / всплески ударов. */
export interface VfxAeroWingTrail {
  everyMs: number
  speedMin: number
  speedMax: number
  dirDeg: number
  spreadDeg: number
  lifeMin: number
  lifeMax: number
  scaleStart: number
  scaleEnd: number
  alphaStart: number
  alphaEnd: number
  tint: number
}

export interface VfxAeroWingSweep {
  count: number
  speedMin: number
  speedMax: number
  dirDeg: number
  spreadDeg: number
  lifeMin: number
  lifeMax: number
  scaleStart: number
  scaleEnd: number
  alphaStart: number
  alphaEnd: number
  tint: number
}

export interface VfxAeroHitSplash {
  ringScaleFrom: number
  ringScaleTo: number
  ringAlpha: number
  ringMs: number
  sparkCount: number
  sparkSpeedMin: number
  sparkSpeedMax: number
  sparkSpreadDeg: number
  sparkLifeMin: number
  sparkLifeMax: number
  sparkGravityY: number
  sparkScaleStart: number
  sparkScaleEnd: number
  sparkAlphaStart: number
  flashScale: number
  flashAlpha: number
  flashMs: number
  tint: number
}

export interface VfxAero {
  wingTrail: VfxAeroWingTrail
  wingSweep: VfxAeroWingSweep
  hitSplash: VfxAeroHitSplash
}

const VFX_NUMBER_KEYS: readonly NumberKeys<VfxConfig>[] = [
  'flashPoolSize',
  'flashMs',
  'flashScaleGain',
  'chromaMax',
  'chromaFadeMs',
  'slowMoMs',
  'slowMoZoom',
  'slowMoZoomInMs',
  'slowMoZoomOutMs',
  'bloomScale',
  'bloomAlpha',
  'cameraBaseZoom',
  'cameraFollowLerp',
]

const unwrapped = unwrapDoc<VfxConfig>(data as { _doc?: string }, 'vfx.json')
assertNumbers(unwrapped, 'vfx.json', VFX_NUMBER_KEYS)
// Шаг 20: вложенная секция aero — валидируем каждую группу отдельно
// (NumberKeys ходит только по верхнему уровню).
assertNumbers(unwrapped.aero.wingTrail, 'vfx.json aero.wingTrail', [
  'everyMs', 'speedMin', 'speedMax', 'dirDeg', 'spreadDeg',
  'lifeMin', 'lifeMax', 'scaleStart', 'scaleEnd', 'alphaStart', 'alphaEnd', 'tint',
] as const)
assertNumbers(unwrapped.aero.wingSweep, 'vfx.json aero.wingSweep', [
  'count', 'speedMin', 'speedMax', 'dirDeg', 'spreadDeg',
  'lifeMin', 'lifeMax', 'scaleStart', 'scaleEnd', 'alphaStart', 'alphaEnd', 'tint',
] as const)
assertNumbers(unwrapped.aero.hitSplash, 'vfx.json aero.hitSplash', [
  'ringScaleFrom', 'ringScaleTo', 'ringAlpha', 'ringMs',
  'sparkCount', 'sparkSpeedMin', 'sparkSpeedMax', 'sparkSpreadDeg',
  'sparkLifeMin', 'sparkLifeMax', 'sparkGravityY',
  'sparkScaleStart', 'sparkScaleEnd', 'sparkAlphaStart',
  'flashScale', 'flashAlpha', 'flashMs', 'tint',
] as const)

export const VFX = unwrapped
