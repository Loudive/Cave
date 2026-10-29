/**
 * light.ts — типизированный доступ к параметрам света и атмосферы.
 * Источник правды — src/config/light.json (шаг 5).
 * Правило гайда: код не содержит магических констант света.
 */
import data from './light.json'

export interface ParallaxLayer {
  key: string
  depth: number
  factor: number
  alpha: number
  /** Шаг 12: доля цвета биома в тонировке слоя (0 — нет, 1 — целиком). */
  tintStrength: number
  /** Шаг 18: альфа ADD-близнеца (эмиссивная выжимка `-em`) НАД маской тьмы;
   * 0 — у слоя нет эмиссивы (чистая порода), близнец не создаётся. */
  emissiveAlpha: number
}

export interface LightConfig {
  darkness: {
    color: string
    alpha: number
    holeTexture: string
    /** Шаг 18: кривые выреза тьмы в шейдере — умбра игрока + кольцо. */
    falloff: {
      plateauEnd: number
      plateauLevel: number
      playerUmbra: number
      playerRingAt: number
      playerRingPeak: number
      playerFalloffPow: number
    }
  }
  /** Шаг 18: эмиссивный слой над маской — гало источников + lumen героя. */
  halo: {
    depth: number
    mushroom: number
    gate: number
    flower: number
    pool: number
    nest: number
    fire: number
    vein: number
    elite: number
    lumenDepth: number
    lumenAlpha: number
    aura: { alpha: number; scale: number; pulseAmp: number; pulseMs: number }
  }
  playerLight: {
    radius: number
    breatheAmp: number
    breathePeriodMs: number
    /** Шаг 15: доля визуального радиуса для ГЕЙМПЛЕЙНОГО обнаружения мобами. */
    detectionShare: number
  }
  /** Шаг 13 (Hidden Deep): вытяжение света существа вперёд по взгляду. */
  gaze: {
    stretch: number
  }
  /** Шаг 13 (Hidden Deep): неровное мерцание сидированных источников. */
  flicker: {
    amp: number
    speedMs: number
    minShare: number
  }
  /** Шаг 13 (Dead Cells): столбы света из потолочных трещин. */
  shafts: {
    count: number
    alpha: number
    swayDeg: number
    swayMs: number
    lightRadius: number
    searchTries: number
  }
  mushroomLight: { radius: number }
  gateLight: { radius: number }
  nestLight: { radius: number }
  /** Шаг 10 (перфоманс): GLSL-маска тьмы — бюджет источников на кадр. */
  shader: { maxLights: number }
  parallax: ParallaxLayer[]
  motes: {
    count: number
    alpha: number
    tint: string
    driftRadiusPx: number
    speedMinMs: number
    speedMaxMs: number
    fadeInner: number
    fadeOuter: number
  }
  vignette: {
    alpha: number
    overscan: number
  }
}

export const LIGHT = data as unknown as LightConfig

/** '#58E6C8' → 0x58e6c8. */
export function hexInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16)
}
