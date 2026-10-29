/**
 * NestSave — профиль мета-прогрессии «Гнездо» (шаг 11).
 *
 * Единственный versioned-сейв профиля (save-systems: отделяй run-состояние
 * от profile-состояния; забег умирает — профиль живёт). Всё в одном JSON в
 * localStorage: Эссенция, купленные узлы, бестиарий, коллекция геномов,
 * накопительная статистика. Загрузка защищённая: битый/чужой JSON → пустой
 * профиль, а не вылет. Миграция: старый сейв генов шага 8 (cave-genes-v1)
 * импортируется один раз; дальше он остаётся только читаться совместимостью.
 */
import { NEST } from '../config/nest'
import type { Rarity } from '../config/mutations'

export interface BestiaryEntry {
  /** Сколько особей съедено (туши/чавканье — рацион хищника). */
  eaten: number
  /** Сколько особей убито любым способом. */
  killed: number
}

export interface BestRun {
  essence: number
  depthM: number
  eaten: number
}

export interface NestStats {
  runs: number
  deaths: number
  bestDepthM: number
  bestEaten: number
  /** Сколько пещер (уникальных сидов) посещено. */
  cavesVisited: number
  /** Всего мобов сожрано за всю жизнь. */
  totalEaten: number
  /** Всего Эссенции заработано за всю жизнь. */
  totalEssence: number
  /** Лучший забег (валюта гордости, гайд). */
  bestRun: BestRun
  /** Шаг 25: сколько Маток Улья повергнуто (включая Узурпаторов). */
  queensSlain: number
  /** Шаг 25: сколько чужих Узурпаторов (PvP-вызовов) побеждено. */
  challengersBeaten: number
}

/** Шаг 25: ТРОН — след победы над Маткой (билд → Код Матки). */
export interface ReignData {
  name: string
  power: number
  code: string
  depthM: number
  at: number
}

/** Шаг 25: активный PvP-вызов (Узурпатор из чужого кода). */
export interface ChallengerData {
  name: string
  power: number
  code: string
}

export interface NestSave {
  version: 1
  essence: number
  /** Купленные узлы древа (id из nest.json) — хоть один ранг. */
  nodes: string[]
  /** Шаг 24: ранг узла по id (статы качаются до 3; старые сейвы — 1). */
  ranks: Record<string, number>
  /** Бестиарий: speciesId → съедено/убито. */
  bestiary: Record<string, BestiaryEntry>
  /** Коллекция геномов: geneId → сколько копий добыто. */
  genomes: Record<string, { count: number }>
  stats: NestStats
  /** Сиды посещённых пещер (кап 300 — «пещеры посещено», шаг 11). */
  seenSeeds: string[]
  /** Шаг 25: ТРОН — победа над Маткой Улья (null — трон пуст). */
  reign: ReignData | null
}

export function emptyStats(): NestStats {
  return {
    runs: 0,
    deaths: 0,
    bestDepthM: 0,
    bestEaten: 0,
    cavesVisited: 0,
    totalEaten: 0,
    totalEssence: 0,
    bestRun: { essence: 0, depthM: 0, eaten: 0 },
    queensSlain: 0,
    challengersBeaten: 0,
  }
}

export function emptySave(): NestSave {
  return {
    version: 1,
    essence: 0,
    nodes: [],
    ranks: {},
    bestiary: {},
    genomes: {},
    stats: emptyStats(),
    seenSeeds: [],
    reign: null,
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/** Защитный разбор: любое поле может отсутствовать/врать — приводим к форме. */
function sanitize(parsed: unknown): NestSave {
  const out = emptySave()
  if (!isObj(parsed)) return out
  if (typeof parsed.essence === 'number' && Number.isFinite(parsed.essence)) out.essence = Math.max(0, Math.round(parsed.essence))
  if (Array.isArray(parsed.nodes)) {
    out.nodes = parsed.nodes.filter((n): n is string => typeof n === 'string').slice(0, 200)
  }
  // Шаг 24: ранги узлов (мутация: узел без записи в ranks = ранг 1).
  if (isObj(parsed.ranks)) {
    for (const [k, v] of Object.entries(parsed.ranks)) {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 1) {
        out.ranks[k] = Math.min(3, Math.round(v))
      }
    }
  }
  for (const id of out.nodes) {
    if (!out.ranks[id]) out.ranks[id] = 1
  }
  if (isObj(parsed.bestiary)) {
    for (const [k, v] of Object.entries(parsed.bestiary)) {
      if (isObj(v)) {
        out.bestiary[k] = {
          eaten: typeof v.eaten === 'number' && Number.isFinite(v.eaten) ? Math.max(0, Math.round(v.eaten)) : 0,
          killed: typeof v.killed === 'number' && Number.isFinite(v.killed) ? Math.max(0, Math.round(v.killed)) : 0,
        }
      }
    }
  }
  if (isObj(parsed.genomes)) {
    for (const [k, v] of Object.entries(parsed.genomes)) {
      const count = isObj(v) && typeof v.count === 'number' ? v.count : 0
      if (count > 0) out.genomes[k] = { count: Math.round(count) }
    }
  }
  if (isObj(parsed.stats)) {
    const s = parsed.stats
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0)
    out.stats.runs = num(s.runs)
    out.stats.deaths = num(s.deaths)
    out.stats.bestDepthM = num(s.bestDepthM)
    out.stats.bestEaten = num(s.bestEaten)
    out.stats.cavesVisited = num(s.cavesVisited)
    out.stats.totalEaten = num(s.totalEaten)
    out.stats.totalEssence = num(s.totalEssence)
    out.stats.queensSlain = num(s.queensSlain)
    out.stats.challengersBeaten = num(s.challengersBeaten)
    if (isObj(s.bestRun)) {
      out.stats.bestRun = {
        essence: num(s.bestRun.essence),
        depthM: num(s.bestRun.depthM),
        eaten: num(s.bestRun.eaten),
      }
    }
  }
  // Шаг 25: Трон (аддитивно — старые сейвы без него живут дальше).
  if (isObj(parsed.reign)) {
    const r = parsed.reign
    if (typeof r.name === 'string' && typeof r.power === 'number' && typeof r.code === 'string') {
      out.reign = {
        name: r.name.slice(0, 40),
        power: Math.max(0, Math.round(r.power)),
        code: r.code.slice(0, 40),
        depthM: typeof r.depthM === 'number' ? Math.round(r.depthM) : 0,
        at: typeof r.at === 'number' ? Math.round(r.at) : 0,
      }
    }
  }
  if (Array.isArray(parsed.seenSeeds)) {
    out.seenSeeds = parsed.seenSeeds
      .filter((v): v is string => typeof v === 'string')
      .slice(-300)
  }
  return out
}

/** Одноразовая миграция старого сейва генов (шаг 8) в профиль. */
function migrateLegacyGenes(save: NestSave): boolean {
  try {
    const raw = localStorage.getItem(NEST.legacyGeneKey)
    if (!raw) return false
    const legacy = JSON.parse(raw) as { genes?: unknown; stats?: { runs?: unknown; deaths?: unknown; bestDepthM?: unknown; bestEaten?: unknown } }
    let touched = false
    if (Array.isArray(legacy.genes)) {
      for (const id of legacy.genes) {
        if (typeof id === 'string' && !save.genomes[id]) {
          save.genomes[id] = { count: 1 }
          touched = true
        }
      }
    }
    if (legacy.stats && save.stats.runs === 0 && save.stats.deaths === 0) {
      const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0)
      save.stats.runs = num(legacy.stats.runs)
      save.stats.deaths = num(legacy.stats.deaths)
      save.stats.bestDepthM = num(legacy.stats.bestDepthM)
      save.stats.bestEaten = num(legacy.stats.bestEaten)
      touched = true
    }
    return touched
  } catch {
    return false
  }
}

export function loadNestSave(): NestSave {
  try {
    const raw = localStorage.getItem(NEST.storageKey)
    const save = raw ? sanitize(JSON.parse(raw)) : emptySave()
    // Миграция выполняется один раз: после первого же writeNestSave ключ
    // уже существует, пустым сейвом не перетираем добытое.
    if (!raw && migrateLegacyGenes(save)) writeNestSave(save)
    return save
  } catch {
    return emptySave()
  }
}

export function writeNestSave(save: NestSave): void {
  try {
    localStorage.setItem(NEST.storageKey, JSON.stringify(save))
  } catch {
    /* приватный режим — профиль живёт до перезагрузки страницы */
  }
}

/** Мутабельное обновление + запись (единая точка записи сейва). */
export function updateNestSave(mutate: (save: NestSave) => void): NestSave {
  const save = loadNestSave()
  mutate(save)
  writeNestSave(save)
  return save
}

// ── Коллекция геномов ───────────────────────────────────────────────────────

/** Засчитать геном в коллекцию (возвращает true, если он новый). */
export function collectGenome(geneId: string): boolean {
  const save = updateNestSave((s) => {
    const cur = s.genomes[geneId]
    s.genomes[geneId] = { count: (cur?.count ?? 0) + 1 }
  })
  return save.genomes[geneId]?.count === 1
}

/** Засчитать трапезу/убийство в бестиарий. */
export function recordBestiary(speciesId: string, eaten: boolean): void {
  updateNestSave((s) => {
    const cur = s.bestiary[speciesId] ?? { eaten: 0, killed: 0 }
    if (eaten) cur.eaten++
    else cur.killed++
    s.bestiary[speciesId] = cur
  })
}

/** Rarity → цвет из конфига (для UI коллекции). */
export function rarityColor(r: Rarity | string): string {
  return NEST.rarityColors[r] ?? '#8A8894'
}
