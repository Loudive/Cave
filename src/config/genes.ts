/**
 * genes.ts — типизированный доступ к постоянным генам (шаг 8).
 * Источник правды — src/config/genes.json. Постоянные гены переживают
 * смерть и хранятся в localStorage (структура сейва — JSON, гайд шаг 8).
 */
import data from './genes.json'
import type { Rarity } from './mutations'

export type GeneEffect =
  | { type: 'maxHp'; bonus: number }
  | { type: 'bite'; bonus: number }
  | { type: 'hungerMax'; bonus: number }
  | { type: 'grip'; wallSlideMult: number }
  | { type: 'glow'; lightMult: number }
  | { type: 'digest'; mult: number }
  | { type: 'socket' }

export interface GeneDef {
  id: string
  name: string
  rarity: Rarity
  weight: number
  desc: string
  effect: GeneEffect
}

export interface GenesConfig {
  storageKey: string
  maxCopies: number
  genes: GeneDef[]
}

export const GENES = data as unknown as GenesConfig

/** Структура сейва постоянной части (localStorage, переживает смерть). */
export interface GeneSave {
  version: 1
  /** Собранные постоянные гены (id, без повторов — maxCopies 1). */
  genes: string[]
  /** Накопительная статистика между забегами (валюта гордости). */
  stats: {
    runs: number
    deaths: number
    bestDepthM: number
    bestEaten: number
  }
}

const EMPTY: GeneSave = { version: 1, genes: [], stats: { runs: 0, deaths: 0, bestDepthM: 0, bestEaten: 0 } }

/** Загрузить сейв (приватный режим / битый JSON — пустой сейв). */
export function loadGeneSave(): GeneSave {
  try {
    const raw = localStorage.getItem(GENES.storageKey)
    if (!raw) return { ...EMPTY, genes: [], stats: { ...EMPTY.stats } }
    const parsed = JSON.parse(raw) as GeneSave
    if (parsed.version !== 1 || !Array.isArray(parsed.genes)) return { ...EMPTY, genes: [], stats: { ...EMPTY.stats } }
    return parsed
  } catch {
    return { ...EMPTY, genes: [], stats: { ...EMPTY.stats } }
  }
}

/** Сохранить сейв целиком. */
export function saveGeneSave(save: GeneSave): void {
  try {
    localStorage.setItem(GENES.storageKey, JSON.stringify(save))
  } catch {
    /* приватный режим — гены живут только в этой сессии */
  }
}

/** Выдать постоянный ген (без повторов). Возвращает true, если новый. */
export function grantGene(id: string, save: GeneSave): boolean {
  if (save.genes.includes(id)) return false
  const def = GENES.genes.find((g) => g.id === id)
  if (!def) return false
  save.genes.push(id)
  saveGeneSave(save)
  return true
}
