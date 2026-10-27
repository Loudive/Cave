/**
 * quality.ts — тумблер «качество: высокое/низкое» (гайд §7: на слабых
 * телефонах частицы режутся первыми). Переключение — Q в сцене,
 * значение живёт в localStorage. Низкое: меньше частиц, короче декали.
 */
export type QualityLevel = 'high' | 'low'

const STORAGE_KEY = 'cave-quality'

function initial(): QualityLevel {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    if (v === 'low' || v === 'high') return v
  } catch {
    /* приватный режим — просто высокое */
  }
  return 'high'
}

let level: QualityLevel = initial()

const changeHandlers: (() => void)[] = []

export const QUALITY = {
  get level(): QualityLevel {
    return level
  },
  set level(v: QualityLevel) {
    if (level === v) return
    level = v
    try {
      localStorage.setItem(STORAGE_KEY, v)
    } catch {
      /* приватный режим */
    }
    for (const h of changeHandlers) h()
  },
  toggle(): QualityLevel {
    QUALITY.level = level === 'high' ? 'low' : 'high'
    return level
  },
  /** Подписка на смену качества (шаг 9: Vfx пересобирает пост-эффекты). */
  onChange(handler: () => void): void {
    changeHandlers.push(handler)
  },
  /** Множитель числа частиц. */
  get particleMult(): number {
    return level === 'high' ? 1 : 0.4
  },
  /** Множитель срока декалей (быстрее освобождают пул). */
  get decalLifeMult(): number {
    return level === 'high' ? 1 : 0.4
  },
}
