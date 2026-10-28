/**
 * nest.ts — типизированный доступ к мета-прогрессии «Гнездо» (шаг 11).
 * Источник правды — src/config/nest.json.
 *
 * Урок шага 10 (см. unwrap.ts): конфиг с _doc-обёртками обязан проходить
 * unwrapDoc + assertNumbers — слепой каст превращал числа в объекты и
 * ронял игру в рантайме. Числовые листья здесь вытащены в константы.
 */
import data from './nest.json'
import { unwrapDoc, assertNumbers } from './unwrap'

export type NodeType = 'stat' | 'ability' | 'key'

export interface NestEffect {
  type: string
  value: number
}

export interface NestNode {
  id: string
  tier: number
  type: NodeType
  name: string
  cost: number
  desc: string
  effect: NestEffect
}

export interface NestBranch {
  id: string
  name: string
  color: string
  unlockDepthM: number
  nodes: NestNode[]
}

export interface NestConfig {
  eliteEssenceMult: number
  depthMetersPerEssence: number
  essencePerEaten: number
  storageKey: string
  legacyGeneKey: string
  tabNames: string[]
  nodeCellH: number
  nodeR: number
  branchColW: number
  rarityColors: Record<string, string>
  branches: NestBranch[]
}

interface RawNest {
  _doc?: string
  economy: { eliteEssenceMult: { value: number }; depthMetersPerEssence: { value: number }; essencePerEaten: { value: number } }
  save: { storageKey: { value: string }; legacyGeneKey: { value: string } }
  ui: {
    tabNames: { value: string[] }
    nodeCellH: { value: number }
    nodeR: { value: number }
    branchColW: { value: number }
    rarityColors: { value: Record<string, string> }
  }
  branches: NestBranch[]
}

const raw = data as unknown as RawNest

interface EconomyCfg { eliteEssenceMult: number; depthMetersPerEssence: number; essencePerEaten: number }
interface SaveCfg { storageKey: string; legacyGeneKey: string }
interface UiCfg {
  tabNames: string[]
  nodeCellH: number
  nodeR: number
  branchColW: number
  rarityColors: Record<string, string>
}

const economy = unwrapDoc<EconomyCfg>(raw.economy, 'nest.json.economy')
const save = unwrapDoc<SaveCfg>(raw.save, 'nest.json.save')
const ui = unwrapDoc<UiCfg>(raw.ui, 'nest.json.ui')

assertNumbers(economy, 'nest.json.economy', ['eliteEssenceMult', 'depthMetersPerEssence', 'essencePerEaten'])
assertNumbers(ui, 'nest.json.ui', ['nodeCellH', 'nodeR', 'branchColW'])

// Ветки тоже несут _doc-обёртку в unlockDepthM — разворачиваем каждую,
// иначе UI печатает «[object Object]» (тот же грабль, что и шаг 10).
export const NEST: NestConfig = {
  eliteEssenceMult: economy.eliteEssenceMult,
  depthMetersPerEssence: economy.depthMetersPerEssence,
  essencePerEaten: economy.essencePerEaten,
  storageKey: save.storageKey,
  legacyGeneKey: save.legacyGeneKey,
  tabNames: ui.tabNames,
  nodeCellH: ui.nodeCellH,
  nodeR: ui.nodeR,
  branchColW: ui.branchColW,
  rarityColors: ui.rarityColors,
  branches: raw.branches.map((b) => ({
    ...b,
    unlockDepthM: unwrapDoc<{ value: number }>(b.unlockDepthM as unknown as { _doc?: string }, 'nest.json.branch').value,
  })),
}

/** Плоский реестр узлов по id — быстрый поиск при покупке/применении. */
export const NEST_NODES: ReadonlyMap<string, NestNode & { branchId: string; branchColor: string }> = new Map(
  NEST.branches.flatMap((b) => b.nodes.map((n) => [n.id, { ...n, branchId: b.id, branchColor: b.color }])),
)

/** Полная стоимость древа (для UI «куплено X из Y Эссенции»). */
export const NEST_TOTAL_COST: number = NEST.branches.reduce(
  (sum, b) => sum + b.nodes.reduce((s, n) => s + n.cost, 0),
  0,
)
