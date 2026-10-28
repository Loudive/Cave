/**
 * painter.ts — типизированный доступ к параметрам запекания пещер (шаг 15).
 * Источник правды — src/config/painter.json.
 * Правило гайда: код не содержит магических чисел рендера.
 */
import data from './painter.json'
import { assertNumbers } from './unwrap'

export interface PainterConfig {
  erode: {
    tileNearThr: number
    tileDeepThr: number
    tileNoiseScale: number
    fineThr: number
    fineNoiseScale: number
    borderProtect: number
  }
  grid: { scale: number; latticeInflate: boolean }
  smooth: { chaikinIters: number; jitterAmp: number; jitterScale: number }
  displace: {
    floorAmp: number
    otherAmp: number
    megaFreq: number
    megaShare: number
    slowFreq: number
    fastFreq: number
    fastShare: number
  }
  pattern: {
    patternSize: number
    bands: number
    bandWaviness: number
    bandJitter: number
    grainSpecks: number
    speckAlpha: number
  }
  depth: { nearAlpha: number; step: number; maxAlpha: number }
  ao: { widths: number[]; alphas: number[]; color: string }
  rim: {
    coreWidth: number
    coreAlpha: number
    glowWidth: number
    glowAlpha: number
    tint: string
    slopeFrac: number
  }
  ceiling: { underShadowWidth: number; underShadowAlpha: number; slopeFrac: number }
  stalactites: {
    spacing: number
    lenMin: number
    lenMax: number
    widthMin: number
    widthMax: number
    drop: number
    tipFlat: number
    curve: number
    backShade: number
  }
  stalagmites: {
    spacing: number
    lenMin: number
    lenMax: number
    widthMin: number
    widthMax: number
    mound: number
  }
  bumps: { spacing: number; sizeMin: number; sizeMax: number; out: number; shade: number }
  moss: { clusterMin: number; clusterMax: number; density: number; alpha: number; fringe: number }
  crystals: {
    density: number
    sizeMin: number
    sizeMax: number
    alpha: number
    glowPad: number
  }
  chunks: { size: number; margin: number }
  salt: Record<string, string>
}

export const PAINTER = data as unknown as PainterConfig

/** Fail-fast: ключевые числа конфига валидируются при старте (грабли шага 10/11). */
assertNumbers(PAINTER.smooth, 'painter.smooth', ['chaikinIters', 'jitterAmp', 'jitterScale'])
assertNumbers(PAINTER.grid, 'painter.grid', ['scale'])
assertNumbers(PAINTER.depth, 'painter.depth', ['nearAlpha', 'step', 'maxAlpha'])
assertNumbers(PAINTER.chunks, 'painter.chunks', ['size', 'margin'])
assertNumbers(PAINTER.pattern, 'painter.pattern', ['patternSize', 'bands'])
assertNumbers(PAINTER.erode, 'painter.erode', ['tileNearThr', 'tileDeepThr', 'tileNoiseScale', 'fineThr', 'fineNoiseScale', 'borderProtect'])
assertNumbers(PAINTER.displace, 'painter.displace', ['floorAmp', 'otherAmp', 'megaFreq', 'megaShare', 'slowFreq', 'fastFreq', 'fastShare'])
