/**
 * sfxr.ts — шаг 10: ретро-синтез звуков прямо в браузере (jsfxr-подход,
 * гайд: «SFX генерируются бесплатно и мгновенно в jsfxr»). Никаких файлов:
 * пресет из audio.json → Float32 PCM → WAV dataURI → кэш Phaser.
 * Плюс генераторы музыкальных слоёв: гул, капли, бой, глубина.
 * Всё детерминированно (собственный Rng) — звук одинаковый при каждом запуске.
 */

export type WaveForm = 'square' | 'saw' | 'sine' | 'triangle' | 'noise'

/** Пресет одного SFX (все поля — из audio.json, ноль магии в коде). */
export interface SfxPreset {
  wave: WaveForm
  /** Стартовая частота, Гц. */
  freqStart: number
  /** Конечная частота (слайд за slideMs; 0 = держать freqStart). */
  freqEnd: number
  /** Длительность слайда, мс (0 = слайд на всю длительность). */
  slideMs: number
  /** Общая длительность, мс. */
  durationMs: number
  /** Атака (линейный подъём 0→1), мс. */
  attackMs: number
  /** Уровень после атаки (0..1), дальше экспоненциальный спад. */
  sustainVol: number
  /** Крутизна спада (>1 — резче в конец). */
  decayCurve: number
  /** Виброто: частота, Гц (0 = нет). */
  vibratoHz: number
  /** Глубина вибрато (доля частоты, 0..1). */
  vibratoDepth: number
  /** Доля белого шума в сигнале (0..1). */
  noiseMix: number
  /** Частота среза однополюсного lowpass, Гц (0 = выкл). */
  lowpassHz: number
  /** Базовая громкость 0..1. */
  volume: number
  /** Повторы огибающей (сердцебиение = два толчка) — 1 = один. */
  repeats: number
  /** Пауза между повторами, мс. */
  repeatGapMs: number
}

const TAU = Math.PI * 2

/** Простой детерминированный ГПСЧ для шума (mulberry32). */
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Синтез одного пресета → моно PCM (-1..1). */
export function renderPreset(p: SfxPreset, sampleRate: number, seed = 20261027): Float32Array {
  const totalMs = p.durationMs
  const n = Math.max(1, Math.floor((totalMs / 1000) * sampleRate))
  const out = new Float32Array(n)
  const rng = makeRng(seed)
  const segMs = p.repeats > 1
    ? Math.max(20, (totalMs - p.repeatGapMs * (p.repeats - 1)) / p.repeats)
    : totalMs
  const slideSamples = Math.max(1, Math.floor(((p.slideMs > 0 ? p.slideMs : segMs) / 1000) * sampleRate))
  const noiseBuf = new Float32Array(n)
  for (let i = 0; i < n; i++) noiseBuf[i] = rng() * 2 - 1

  let phase = 0
  let lp = 0
  const dt = 1 / sampleRate
  const lpA = p.lowpassHz > 0 ? dt / (dt + 1 / (TAU * p.lowpassHz)) : 1

  for (let i = 0; i < n; i++) {
    const tMs = (i / sampleRate) * 1000
    // Индекс сегмента при повторе огибающей (два толчка сердца и т.п.).
    let seg = 0
    let segLocalMs = tMs
    if (p.repeats > 1) {
      const step = segMs + p.repeatGapMs
      seg = Math.min(p.repeats - 1, Math.floor(tMs / step))
      segLocalMs = tMs - seg * step
    }
    if (p.repeats > 1 && segLocalMs > segMs) continue // пауза между повторами

    // Огибающая: атака → экспоненциальный спад от sustain до 0.
    const segN = (segMs / 1000) * sampleRate
    const localI = (segLocalMs / 1000) * sampleRate
    let env: number
    const attackN = Math.max(1, (p.attackMs / 1000) * sampleRate)
    if (localI < attackN) {
      env = localI / attackN
    } else {
      const k = (localI - attackN) / Math.max(1, segN - attackN)
      env = p.sustainVol * Math.pow(1 - Math.min(1, k), p.decayCurve)
    }

    // Частота: слайд start→end внутри сегмента + вибрато.
    const slideT = Math.min(1, i / slideSamples)
    let freq = p.freqStart + (p.freqEnd - p.freqStart) * slideT
    if (p.vibratoHz > 0) {
      freq *= 1 + p.vibratoDepth * Math.sin(TAU * (p.vibratoHz * i) / sampleRate)
    }
    freq = Math.max(1, freq)

    phase += freq / sampleRate
    phase -= Math.floor(phase)

    let sample: number
    switch (p.wave) {
      case 'square': sample = phase < 0.5 ? 1 : -1; break
      case 'saw': sample = 2 * (phase - Math.floor(phase + 0.5)); break
      case 'triangle': sample = 1 - 4 * Math.abs(phase - Math.floor(phase + 0.5)); break
      case 'noise': sample = noiseBuf[i]; break
      default: sample = Math.sin(TAU * phase); break
    }
    sample = sample * (1 - p.noiseMix) + noiseBuf[i] * p.noiseMix

    if (p.lowpassHz > 0) lp += lpA * (sample - lp)
    const sig = p.lowpassHz > 0 ? lp : sample
    out[i] += sig * env * p.volume
  }
  return out
}

// ── Музыкальные слои ────────────────────────────────────────────────────────

export interface HumConfig {
  durationSec: number
  /** [частота, Гц; амплитуда 0..1; период LFO, c] */
  voices: [number, number, number][]
  /** Уровень мягкого шумового ложа. */
  bedVol: number
  lowpassHz: number
  volume: number
}

/** Гул пещеры: кластер низких синусов с медленным дыханием + шумовое ложе. */
export function renderHumLoop(c: HumConfig, sampleRate: number): Float32Array {
  const n = Math.floor(c.durationSec * sampleRate)
  const out = new Float32Array(n)
  const rng = makeRng(991)
  const dt = 1 / sampleRate
  const lpA = dt / (dt + 1 / (TAU * c.lowpassHz))
  let bed = 0
  for (let i = 0; i < n; i++) {
    let s = 0
    for (const [f, amp, lfoSec] of c.voices) {
      // LFO-период кратен длине петли → бесшовность.
      const breath = 0.5 + 0.5 * Math.sin(TAU * (i / (lfoSec * sampleRate)))
      s += Math.sin(TAU * f * i / sampleRate) * amp * (0.6 + 0.4 * breath)
    }
    bed += lpA * ((rng() * 2 - 1) - bed)
    out[i] = (s * (1 - c.bedVol) + bed * c.bedVol * 3) * c.volume
  }
  return out
}

export interface DripsConfig {
  durationSec: number
  /** Число капель за петлю. */
  count: number
  freqMin: number
  freqMax: number
  /** Длина капли, мс. */
  dripMs: number
  /** Громкость эха (0 = без эха) и задержка, мс. */
  echoVol: number
  echoDelayMs: number
  volume: number
}

/** Капли в темноте: короткие пинги со спадом высоты и эхом. */
export function renderDripsLoop(c: DripsConfig, sampleRate: number): Float32Array {
  const n = Math.floor(c.durationSec * sampleRate)
  const out = new Float32Array(n)
  const rng = makeRng(4242)
  for (let d = 0; d < c.count; d++) {
    const at = Math.floor(((d + rng() * 0.8) / c.count) * n)
    const freq = c.freqMin + rng() * (c.freqMax - c.freqMin)
    const dripN = Math.floor((c.dripMs / 1000) * sampleRate)
    for (let i = 0; i < dripN; i++) {
      const t = i / sampleRate
      const env = Math.exp(-t * 26)
      const f = freq * (1 - 0.35 * (i / dripN))
      const s = Math.sin(TAU * f * t) * env
      if (at + i < n) out[at + i] += s * c.volume
      const echoAt = at + Math.floor((c.echoDelayMs / 1000) * sampleRate)
      if (echoAt + i < n) out[echoAt + i] += s * c.volume * c.echoVol * 0.85
    }
  }
  return out
}

export interface CombatConfig {
  /** Темп боя, BPM. */
  bpm: number
  /** Число долей в петле (петля = beats/bpm минут). */
  beats: number
  /** Бочка: [стартовая Гц, конечная Гц, доля такта]. */
  kickFreq: [number, number]
  kickMs: number
  /** Диссонансный схваток: [Гц1, Гц2, длительность мс, на каких долях]. */
  stabFreq: [number, number]
  stabMs: number
  stabBeats: number[]
  /** Шляпа: короткий шум на слабых долях. */
  hatMs: number
  hatVol: number
  volume: number
}

/** Слой боя: глухие удары + диссонансные схватки — тревога без мелодии. */
export function renderCombatLoop(c: CombatConfig, sampleRate: number): Float32Array {
  const beatSec = 60 / c.bpm
  const n = Math.floor(c.beats * beatSec * sampleRate)
  const out = new Float32Array(n)
  const rng = makeRng(777)
  const kickN = Math.floor((c.kickMs / 1000) * sampleRate)
  for (let b = 0; b < c.beats; b++) {
    const at = Math.floor(b * beatSec * sampleRate)
    const accent = b % 2 === 0 ? 1 : 0.62
    for (let i = 0; i < kickN && at + i < n; i++) {
      const t = i / sampleRate
      const k = i / kickN
      const f = c.kickFreq[0] + (c.kickFreq[1] - c.kickFreq[0]) * k
      const env = Math.exp(-t * 22) * accent
      out[at + i] += Math.sin(TAU * f * t) * env * 0.9
    }
    // Шляпы на «и» (половина доли).
    const hatAt = at + Math.floor(beatSec * 0.5 * sampleRate)
    const hatN = Math.floor((c.hatMs / 1000) * sampleRate)
    for (let i = 0; i < hatN && hatAt + i < n; i++) {
      const env = Math.exp(-(i / hatN) * 6)
      out[hatAt + i] += (rng() * 2 - 1) * env * c.hatVol
    }
  }
  for (const sb of c.stabBeats) {
    const at = Math.floor(sb * beatSec * sampleRate)
    const stabN = Math.floor((c.stabMs / 1000) * sampleRate)
    for (let i = 0; i < stabN && at + i < n; i++) {
      const t = i / sampleRate
      const env = Math.exp(-t * 14)
      const s1 = Math.sin(TAU * c.stabFreq[0] * t)
      const s2 = Math.sin(TAU * c.stabFreq[1] * t)
      out[at + i] += (s1 + s2) * env * 0.22
    }
  }
  let peak = 0.0001
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]))
  const norm = c.volume / peak
  for (let i = 0; i < n; i++) out[i] *= norm
  return out
}

export interface DepthConfig {
  durationSec: number
  /** Пэд: [частота, Гц; амплитуда]. */
  chord: [number, number][]
  /** Период тремоло пэда, c (кратен петле — бесшовность). */
  tremoloSec: number
  /** Колокольчик: [частота, доля петли для удара, длительность мс]. */
  chimeFreq: number
  chimeAt: number
  chimeMs: number
  lowpassHz: number
  volume: number
}

/** Слой глубины (600 м+): холодный пэд + редкий высокий колокол. */
export function renderDepthLoop(c: DepthConfig, sampleRate: number): Float32Array {
  const n = Math.floor(c.durationSec * sampleRate)
  const out = new Float32Array(n)
  const dt = 1 / sampleRate
  const lpA = dt / (dt + 1 / (TAU * c.lowpassHz))
  let lp = 0
  for (let i = 0; i < n; i++) {
    let s = 0
    for (const [f, amp] of c.chord) s += Math.sin(TAU * f * i / sampleRate) * amp
    const trem = 0.75 + 0.25 * Math.sin(TAU * i / (c.tremoloSec * sampleRate))
    lp += lpA * (s * trem - lp)
    out[i] = lp * c.volume
  }
  const chimeN = Math.floor((c.chimeMs / 1000) * sampleRate)
  const at = Math.floor(c.chimeAt * n)
  for (let i = 0; i < chimeN && at + i < n; i++) {
    const t = i / sampleRate
    const env = Math.exp(-t * 1.9)
    out[at + i] += Math.sin(TAU * c.chimeFreq * t) * env * c.volume * 0.7
  }
  return out
}

// ── WAV-кодирование (единый путь загрузки для WebGL и Canvas-режима) ───────

/** Float32 моно → 16-битный PCM WAV dataURI. */
export function toWavDataUri(samples: Float32Array, sampleRate: number): string {
  const n = samples.length
  const bytes = new ArrayBuffer(44 + n * 2)
  const view = new DataView(bytes)
  const w = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  w(0, 'RIFF')
  view.setUint32(4, 36 + n * 2, true)
  w(8, 'WAVE')
  w(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  w(36, 'data')
  view.setUint32(40, n * 2, true)
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true)
  }
  // btoa на бинарной строке — аудио маленькое, спред не нужен.
  let bin = ''
  const chunk = 0x8000
  const u8 = new Uint8Array(bytes)
  for (let i = 0; i < u8.length; i += chunk) {
    bin += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + chunk)))
  }
  return 'data:audio/wav;base64,' + btoa(bin)
}
