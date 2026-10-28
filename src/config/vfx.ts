/**
 * vfx.ts — типизированный доступ к параметрам juice-слоя.
 * Источник правды — src/config/vfx.json (шаг 10, перфоманс).
 */
import data from './vfx.json'

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

export const VFX = data as unknown as VfxConfig
