/**
 * rng.ts — детерминированный RNG для генерации пещер (шаг 4).
 * mulberry32 + FNV-хеш строкового seed'а. Одинаковый seed → одинаковая пещера.
 */

/** FNV-1a: строка → 32-битный хеш. */
export function hashSeed(str: string): number {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export class Rng {
  private state: number

  constructor(seed: number) {
    this.state = seed >>> 0
  }

  /** [0, 1). */
  float(): number {
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Целое [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.float() * maxExclusive)
  }

  /** Целое [min, max] включительно. */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1)
  }

  /** Дробное [min, max). Шаг 14: показатели формы каверн (экспоненты, доли). */
  span(min: number, max: number): number {
    return min + this.float() * (max - min)
  }

  /** Событие с вероятностью p. */
  chance(p: number): boolean {
    return this.float() < p
  }

  /** Случайный элемент массива. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]
  }
}
