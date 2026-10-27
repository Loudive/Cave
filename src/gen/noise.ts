/**
 * noise.ts — 2D value noise в духе FastNoiseLite (шаг 4).
 * Сеедированная таблица перестановок + квинтическая интерполяция.
 * Используется для дрожания границ биомов по глубине.
 */
import { Rng } from './rng'

export class Noise2D {
  private readonly perm: Uint8Array

  constructor(seed: number) {
    const rng = new Rng(seed)
    const p = new Uint8Array(256)
    for (let i = 0; i < 256; i++) p[i] = i
    // Перемешивание Фишера—Йетса.
    for (let i = 255; i > 0; i--) {
      const j = rng.int(i + 1)
      const t = p[i]
      p[i] = p[j]
      p[j] = t
    }
    this.perm = p
  }

  /** Случайность решётки: детерминированный хеш клетки. */
  private lattice(ix: number, iy: number): number {
    const a = this.perm[ix & 0xff]
    const b = this.perm[(iy + a) & 0xff]
    return b / 255
  }

  /** Значение шума в точке: [0, 1], квинтическое сглаживание. */
  value(x: number, y: number): number {
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0
    const ux = fade(fx)
    const uy = fade(fy)

    const v00 = this.lattice(x0, y0)
    const v10 = this.lattice(x0 + 1, y0)
    const v01 = this.lattice(x0, y0 + 1)
    const v11 = this.lattice(x0 + 1, y0 + 1)

    const top = v00 + (v10 - v00) * ux
    const bottom = v01 + (v11 - v01) * ux
    return top + (bottom - top) * uy
  }

  /** Фрактальный шум (2 октавы по умолчанию): [0, 1]. */
  fbm(x: number, y: number, octaves = 2): number {
    let sum = 0
    let amp = 1
    let norm = 0
    let freq = 1
    for (let o = 0; o < octaves; o++) {
      sum += this.value(x * freq, y * freq) * amp
      norm += amp
      amp *= 0.5
      freq *= 2
    }
    return sum / norm
  }
}

/** Квинтика Перлина: 6t⁵−15t⁴+10t³. */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}
