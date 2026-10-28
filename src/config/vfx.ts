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
]

const unwrapped = unwrapDoc<VfxConfig>(data as { _doc?: string }, 'vfx.json')
assertNumbers(unwrapped, 'vfx.json', VFX_NUMBER_KEYS)

export const VFX = unwrapped
