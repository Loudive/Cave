/**
 * transform-nest-step24.mjs — шаг 24: переработка экономики древа.
 *
 * Жалоба игрока: «слишком легко прокачать всё древо» (2213◈ ≈ 10-15
 * забегов на всё). Три рычага:
 *  1) РАНГИ: каждый stat-узел качается до 3 раз (эффект складывается),
 *     следующий ранг дороже (×rankCostMult за ранг);
 *  2) ЦЕНЫ: тиры 4-5 дорожают (×t45CostMult) — вершина ветки = цель;
 *  3) СТРОГОСТЬ ТИРОВ: тир 3+ требует ДВА купленных узла предыдущего
 *     тира (раньше хватало любого одного).
 *
 * Итог: полное древо ≈ 6600◈ ≈ 30-40 забегов — мета на долгую игру,
 * при этом каждый ранг даёт ощутимый шаг силы (не «гринд в пустоту»).
 *
 * Запуск: node scripts/transform-nest-step24.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const FILE = join(HERE, '..', 'src', 'config', 'nest.json')

const RANKS = 3
const RANK_COST_MULT = 2.1
const T45_COST_MULT = 1.4
const TIER_REQ_NODES = 2

const unwrap = (v) => (v && typeof v === 'object' && !Array.isArray(v) && 'value' in v) ? v.value : v
// node.cost в nest.json — ПЛОСКОЕ число (nest.ts читает напрямую): обёртки
// не добавляем, только меняем значение.
const wrap = (orig, value, doc) => ({ ...(doc ? { _doc: doc } : (orig && orig._doc ? { _doc: orig._doc } : {})), value })

const data = JSON.parse(readFileSync(FILE, 'utf8'))

// ── 1) Экономика: множитель цены ранга + строгость тиров ────────────────
data.economy = data.economy || {}
data.economy.rankCostMult = {
  _doc: `Шаг 24: ранг ${2}+ узла стоит во столько раз дороже предыдущего (экспонента — ранги ощутимы, но не бесконечный гринд).`,
  value: RANK_COST_MULT,
}
data.economy.tierReqNodes = {
  _doc: `Шаг 24: сколько узлов предыдущего тира нужно купить, чтобы открылся этот (тиры 3+; тир 2 — по-прежнему любой один).`,
  value: TIER_REQ_NODES,
}

// ── 2) Узлы: ранги статам, цены тиров 4-5 вверх ─────────────────────────
let statNodes = 0
let raised = 0
for (const branch of data.branches) {
  for (const node of branch.nodes) {
    if (node.type === 'stat') {
      node.ranks = RANKS
      statNodes++
    }
    if (node.tier >= 4) {
      const base = node.cost
      const cur = unwrap(base)
      node.cost = Math.max(1, Math.round(cur * T45_COST_MULT))
      raised++
    }
  }
}

// ── 3) Документация сверху ───────────────────────────────────────────────
data._doc = 'Шаг 11 — мета-прогрессия «Гнездо». Шаг 24 — ЭКОНОМИКА ПЕРЕРАБОТАНА: stat-узлы качаются до 3 рангов (ranks), ранг N стоит rankCostMult^N от базовой цены; тиры 4-5 дороже (×1.4); тир 3+ требует tierReqNodes узлов предыдущего тира. Полное древо ≈ 6600 Эссенции ≈ 30-40 забегов — вершина каждой ветки теперь долгая цель. Валюта: Эссенция за убийства (species.essence + глубинный бонус), поедание и рекорд глубины.'

writeFileSync(FILE, JSON.stringify(data, null, 2) + '\n')

// ── Отчёт ────────────────────────────────────────────────────────────────
let base = 0
let full = 0
for (const b of data.branches) {
  for (const n of b.nodes) {
    const c = unwrap(n.cost)
    base += c
    const ranks = n.ranks ?? 1
    for (let r = 1; r <= ranks; r++) full += Math.round(c * Math.pow(RANK_COST_MULT, r - 1))
  }
}
console.log(`stat-узлов с рангами: ${statNodes}, узлов тира 4-5 подорожало: ${raised}`)
console.log(`стоимость «каждый по разу»: ${base}◈; ПОЛНОЕ древо (все ранги): ${full}◈`)
