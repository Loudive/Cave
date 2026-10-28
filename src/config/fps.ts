/**
 * fps.ts — типизированный доступ к параметрам FPS-guard.
 * Источник правды — src/config/fps.json (шаг 10, перфоманс).
 */
import data from './fps.json'

export interface FpsConfig {
  warmupMs: number
  sampleMs: number
  threshold: number
  strikes: number
  toastMs: number
}

export const FPS = data as unknown as FpsConfig
