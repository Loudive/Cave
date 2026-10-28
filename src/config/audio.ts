/**
 * audio.ts — типизированный доступ к конфигу звука (шаг 10).
 * Источник правды — src/config/audio.json. Синтез — systems/sfxr.ts.
 */
import data from './audio.json'
import type { SfxPreset } from '../systems/sfxr'

export interface LoopGain { key: string; gain: number }

export interface AudioConfig {
  sampleRate: number
  defaults: { music: number; sfx: number }
  storageKey: { _doc?: string; value: string }
  rateJitter: number
  ambient: { hum: LoopGain; drips: LoopGain }
  layers: {
    combat: { key: string; target: number; fadeUpMs: number; fadeDownMs: number; combatHoldMs: number }
    depth: { key: string; target: number; fadeUpMs: number; fadeDownMs: number }
    depthThresholdMeters: number
  }
  heartbeat: { key: string; gain: number; rateGain: number }
  sfx: Record<string, { _doc?: string; minGapMs: number; preset: SfxPreset }>
  music: {
    hum: import('../systems/sfxr').HumConfig
    drips: import('../systems/sfxr').DripsConfig
    combat: import('../systems/sfxr').CombatConfig
    depth: import('../systems/sfxr').DepthConfig
  }
}

export const AUDIO = data as unknown as AudioConfig

export interface AudioSave {
  /** Громкость музыки 0..1. */
  music: number
  /** Громкость эффектов 0..1. */
  sfx: number
}

export function loadAudioSave(): AudioSave {
  try {
    const raw = localStorage.getItem(AUDIO.storageKey.value)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AudioSave>
      return {
        music: clamp01(parsed.music ?? AUDIO.defaults.music),
        sfx: clamp01(parsed.sfx ?? AUDIO.defaults.sfx),
      }
    }
  } catch {
    /* приватный режим */
  }
  return { music: AUDIO.defaults.music, sfx: AUDIO.defaults.sfx }
}

export function saveAudioSave(save: AudioSave): void {
  try {
    localStorage.setItem(AUDIO.storageKey.value, JSON.stringify(save))
  } catch {
    /* приватный режим */
  }
}

/** Локальный clamp 0..1. */
function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0
  return v < 0 ? 0 : v > 1 ? 1 : v
}
