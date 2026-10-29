/**
 * Reign — шаг 25: ТРОН и PvP-связка «Кода Матки».
 *
 * Победа над Маткой Улья делает твоё существо НОВОЙ Маткой. Билд
 * сжимается в КОД МАТКИ: «CV1-<имя>-<мощь>-<контроль>» (base36,
 * контрольная сумма от опечаток). Ссылка ?challenger=КОД — и у друга
 * вместо родной Матки первого Гнездовья сражается ТВОЙ УЗУРПАТОР
 * (имя и статы из кода). Это асинхронный PvP без сервера: код —
 * готовый протокол для будущего лидерборда/матчинга (серверу нужно
 * лишь принимать и раздавать эти же строки).
 *
 * Данные Трона (имя/мощь/код) живут в NestSave.reign; вызов на бой —
 * в localStorage (ставится из URL и снимается после победы).
 */
import { QUEEN } from '../config/queen'
import type { NestSave, ReignData, ChallengerData } from './NestSave'

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz'
const CHALLENGER_KEY = 'cave-challenger-v1'
/** Максимальная мощь в коде (36^4) — защита от мусора в URL. */
const POWER_CAP = 36 ** 4

function toB36(n: number): string {
  n = Math.floor(Math.max(0, n))
  if (n === 0) return '0'
  let s = ''
  while (n > 0) {
    s = B36[n % 36] + s
    n = Math.floor(n / 36)
  }
  return s
}

function fromB36(s: string): number {
  let n = 0
  for (const ch of s) {
    const i = B36.indexOf(ch)
    if (i < 0) return NaN
    n = n * 36 + i
    if (n > Number.MAX_SAFE_INTEGER) return NaN
  }
  return n
}

/** Детерминированное имя из индекса: «Ржавая Королева», «Тихая Бездны»… */
export function reignNameFromIndex(idx: number): string {
  const A = QUEEN.reign.codeNameA
  const B = QUEEN.reign.codeNameB
  const a = ((idx % A.length) + A.length) % A.length
  const b = (((idx / A.length) | 0) % B.length + B.length) % B.length
  return `${A[a]} ${B[b]}`
}

/** Всего комбинаций имён (для генератора при победе). */
export function reignNameCount(): number {
  return QUEEN.reign.codeNameA.length * QUEEN.reign.codeNameB.length
}

/** Мощь билда: сколько вложено в Гнездо + коллекция + глубина + охота. */
export function computePower(save: NestSave): number {
  const w = QUEEN.reign.power
  const genomes = Object.keys(save.genomes).length
  return Math.round(
    save.stats.totalEssence * w.perEssence
    + genomes * w.perGenome
    + save.stats.bestDepthM * w.perDepthMeter
    + save.stats.totalEaten * w.perEaten
    + save.stats.queensSlain * w.perQueen,
  )
}

/** Собрать Трон после победы (имя — по индексу из генератора сцены). */
export function makeReign(save: NestSave, depthM: number, nameIdx: number): ReignData {
  const power = computePower(save)
  return {
    name: reignNameFromIndex(nameIdx),
    power,
    code: encodeCode(nameIdx, power),
    depthM,
    at: Date.now(),
  }
}

/** Контрольная сумма кода (модуль 36^2) — отсекает опечатки в чатах. */
function checksum(nameIdx: number, power: number): number {
  return (nameIdx * 7 + power * 13 + 46656) % 1296
}

export function encodeCode(nameIdx: number, power: number): string {
  return `CV1-${toB36(nameIdx)}-${toB36(power)}-${toB36(checksum(nameIdx, power))}`
}

/** Разбор кода (регистронезависимо). Невалидное — null, не исключение. */
export function decodeCode(raw: string): ChallengerData | null {
  const clean = raw.trim().toLowerCase()
  const m = /^cv1-([0-9a-z]+)-([0-9a-z]+)-([0-9a-z]+)$/.exec(clean)
  if (!m) return null
  const nameIdx = fromB36(m[1])
  const power = fromB36(m[2])
  const sum = fromB36(m[3])
  if (!Number.isFinite(nameIdx) || !Number.isFinite(power) || !Number.isFinite(sum)) return null
  if (nameIdx < 0 || nameIdx >= reignNameCount()) return null
  if (power <= 0 || power > POWER_CAP) return null
  if (sum !== checksum(nameIdx, power)) return null
  return { name: reignNameFromIndex(nameIdx), power, code: encodeCode(nameIdx, power) }
}

/** Ссылка-вызов для друга: тот же адрес игры + ?challenger=КОД. */
export function challengerShareUrl(code: string): string {
  const { origin, pathname } = window.location
  return `${origin}${pathname}?challenger=${code}`
}

/** Взять вызов из URL (?challenger=…) → сохранить и вычистить параметр. */
export function armChallengerFromUrl(): boolean {
  try {
    const url = new URL(window.location.href)
    const raw = url.searchParams.get('challenger')
    if (!raw) return false
    const ch = decodeCode(raw)
    if (!ch) return false
    localStorage.setItem(CHALLENGER_KEY, JSON.stringify(ch))
    url.searchParams.delete('challenger')
    window.history.replaceState(null, '', url.toString())
    return true
  } catch {
    return false
  }
}

/** Активный вызов (или null) — им подменяется Матка первого Гнездовья. */
export function loadPendingChallenger(): ChallengerData | null {
  try {
    const raw = localStorage.getItem(CHALLENGER_KEY)
    if (!raw) return null
    const j = JSON.parse(raw) as { name?: unknown; power?: unknown; code?: unknown }
    if (typeof j.name !== 'string' || typeof j.power !== 'number') return null
    return {
      name: j.name,
      power: Math.max(1, Math.round(j.power)),
      code: typeof j.code === 'string' ? j.code : '',
    }
  } catch {
    return null
  }
}

/** Вызов отработан (победа над Узурпатором) — снять. */
export function clearPendingChallenger(): void {
  try {
    localStorage.removeItem(CHALLENGER_KEY)
  } catch {
    /* приватный режим */
  }
}
