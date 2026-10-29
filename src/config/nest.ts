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
  /** Шаг 24: сколько рангов у узла (статы — 3, способности/ключи — 1). */
  ranks?: number
  desc: string
  effect: NestEffect
}

/** Рангов у узла (по умолчанию — 1). */
export function nodeRanks(n: NestNode): number {
  return Math.max(1, n.ranks ?? 1)
}

/** Цена ранга r узла (ранг 1 — базовая; дальше ×rankCostMult за ранг). */
export function nodeRankCost(n: NestNode, rank: number): number {
  return Math.max(1, Math.round(n.cost * Math.pow(NEST.rankCostMult, rank - 1)))
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
  /** Шаг 24: каждый следующий ранг узла дороже в это число раз. */
  rankCostMult: number
  /** Шаг 24: сколько узлов предыдущего тира открывают этот (тиры 3+). */
  tierReqNodes: number
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
  economy: { eliteEssenceMult: { value: number }; depthMetersPerEssence: { value: number }; essencePerEaten: { value: number }; rankCostMult: { value: number }; tierReqNodes: { value: number } }
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

interface EconomyCfg { eliteEssenceMult: number; depthMetersPerEssence: number; essencePerEaten: number; rankCostMult: number; tierReqNodes: number }
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

assertNumbers(economy, 'nest.json.economy', ['eliteEssenceMult', 'depthMetersPerEssence', 'essencePerEaten', 'rankCostMult', 'tierReqNodes'])
assertNumbers(ui, 'nest.json.ui', ['nodeCellH', 'nodeR', 'branchColW'])

// Ветки тоже несут _doc-обёртку в unlockDepthM — разворачиваем каждую,
// иначе UI печатает «[object Object]» (тот же грабль, что и шаг 10).
export const NEST: NestConfig = {
  eliteEssenceMult: economy.eliteEssenceMult,
  depthMetersPerEssence: economy.depthMetersPerEssence,
  essencePerEaten: economy.essencePerEaten,
  rankCostMult: economy.rankCostMult,
  tierReqNodes: economy.tierReqNodes,
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

/** Полная стоимость древа «каждый по разу» (для UI прогресса). */
export const NEST_TOTAL_COST: number = NEST.branches.reduce(
  (sum, b) => sum + b.nodes.reduce((s, n) => s + n.cost, 0),
  0,
)

/** Шаг 24: ПОЛНАЯ стоимость со всеми рангами — «древо X◈/Y◈».
 *  Вот эта цифра — настоящий долгосрочный план игрока. */
export const NEST_TOTAL_FULL: number = NEST.branches.reduce(
  (sum, b) => sum + b.nodes.reduce((s, n) => {
    let acc = 0
    for (let r = 1; r <= nodeRanks(n); r++) acc += nodeRankCost(n, r)
    return s + acc
  }, 0),
  0,
)

/** Сколько Эссенции вложено в узлы с учётом рангов. */
export function nestSpent(bought: Record<string, number>): number {
  let sum = 0
  for (const [id, rank] of Object.entries(bought)) {
    const n = NEST_NODES.get(id)
    if (!n) continue
    for (let r = 1; r <= Math.min(rank, nodeRanks(n)); r++) sum += nodeRankCost(n, r)
  }
  return sum
}

/** Шаг 24: развернуть купленные ранги в список id с повторами —
 *  applyPerks применяет эффект за каждый ранг (статы складываются). */
export function expandNestRanks(bought: Record<string, number>): string[] {
  const out: string[] = []
  for (const [id, rank] of Object.entries(bought)) {
    const n = NEST_NODES.get(id)
    if (!n) continue
    for (let i = 0; i < Math.min(rank, nodeRanks(n)); i++) out.push(id)
  }
  return out
}

// ── Шаг 24: иконки древа (assets/icon-<name>.png, scripts/process-icons.mjs) ──

/** Иконка ветки (заголовок колонки). */
export const BRANCH_ICON: Record<string, string> = {
  predator: 'fangs',
  flesh: 'heart',
  symbiosis: 'mushroom',
  shadow: 'ghost',
  genes: 'dna',
}

/** Иконка узла по типу эффекта (все 58 типов сведены к 16 образам). */
const ICON_OF_EFFECT: Record<string, string> = {
  // Пасть и удары
  bite: 'fangs', biteMult: 'fangs', biteRange: 'fangs', symbHunter: 'fangs',
  claw: 'claw', biteArc: 'claw', lungeMult: 'claw', windupMult: 'claw', wallSlideMult: 'claw',
  jaw: 'jaw', capJaw: 'jaw', stunMs: 'jaw',
  blood: 'blood', parasite: 'blood', essenceOnKill: 'blood', essenceKillMult: 'blood',
  essenceEatMult: 'blood', depthBonusMult: 'blood', wrath: 'blood',
  // Тело
  heart: 'heart', maxHp: 'heart', hpOnKill: 'heart', heartPump: 'heart', healOnEat: 'heart',
  shield: 'shield', armorPct: 'shield', boneArmor: 'shield', adaptivePlasma: 'shield',
  stomach: 'stomach', hungerMax: 'stomach', digest: 'stomach', hungerSlow: 'stomach', xpMult: 'stomach',
  // Восприятие и тьма
  eye: 'eye', nightPounce: 'eye', darkStrike: 'eye', dangerSense: 'eye', detectMult: 'eye', echo: 'eye',
  ghost: 'ghost', dreadAura: 'ghost', panicKill: 'ghost', becomeDark: 'ghost',
  // Пещера
  wing: 'wing', jumpMult: 'wing', airJump: 'wing', airControlMult: 'wing', glideUpgrade: 'wing',
  paw: 'paw', speedMult: 'paw',
  mushroom: 'mushroom', mushFriend: 'mushroom', sporeImmune: 'mushroom', sporeHeal: 'mushroom', flowerSense: 'mushroom',
  flame: 'flame', fireResist: 'flame', fireFriend: 'flame',
  crystal: 'crystal', lightMult: 'crystal', membraneGlow: 'crystal', crystalHeal: 'crystal',
  // Мета
  dna: 'dna', dropChance: 'dna', curseResist: 'dna', extraSlot: 'dna', geneArchive: 'dna',
  mutationStorm: 'dna', perfectPredator: 'dna', geneSense: 'dna',
  egg: 'egg', nestPulse: 'egg', caveChild: 'egg',
}

/** Ключ текстуры иконки узла (фолбэк — кристалл мутаций). */
export function nodeIcon(effectType: string): string {
  return `icon-${ICON_OF_EFFECT[effectType] ?? 'crystal'}`
}
