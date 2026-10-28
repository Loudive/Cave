/**
 * NestPerks — применение купленных узлов «Гнезда» к забегу (шаг 11).
 *
 * Один узел древа = один эффект {type, value} из nest.json. Здесь они
 * сворачиваются в модификаторы уже существующих систем (гайд: «эффекты —
 * хуки в существующие системы»): Vitals, Creature.mods, Combat.mods,
 * Mutations, sceneMods. Поведенческие узлы (эхо, паника, кристальное
 * лечение…) возвращаются как флаги — их читает CaveScene в своих хуках.
 *
 * Чистая функция-агрегатор (aggregatePerks) легко тестируется; побочные
 * эффекты — только в applyPerks().
 */
import type { Vitals } from './Vitals'
import type { Creature } from '../entities/Creature'
import type { Combat } from './Combat'
import type { Mutations } from './Mutations'
import { NEST_NODES } from '../config/nest'

/** Поведенческие флаги, которые сцена обслуживает сама. */
export interface RunPerks {
  /** Эссенция: множитель награды за убийство / плата за добивание / за поедание / за глубину. */
  essenceKillMult: number
  essenceOnKill: number
  essenceEatMult: number
  depthBonusMult: number
  /** «Споровый иммунитет»: споры не замедляют (урон остаётся). */
  sporeImmune: boolean
  /** «Тёплая шерсть»: множитель урона огня. */
  fireResist: number
  /** «Грибной доктор»: споры лечат вместо урона. */
  sporeHeal: boolean
  /** «Кровавый нюх»: охотящиеся на игрока подсвечиваются сквозь тьму. */
  dangerSense: boolean
  /** «Дрожь тьмы»: мобы вблизи игрока в темноте пугаются. */
  dreadAura: boolean
  /** «Паника стаи»: убийство обращает соседей жертвы в бегство. */
  panicKill: boolean
  /** «Кристальный покров»: кристаллы пещеры лечат при касании. */
  crystalHeal: boolean
  /** «Мутационный шторм»: элита гарантированно роняет мутацию. */
  eliteGuarantee: boolean
  /** Лечение за каждое чавканье («Сытость лечит»). */
  healOnEat: number
  /** Лечение за убийство («Жир регенерации»). */
  hpOnKill: number
}

export function emptyRunPerks(): RunPerks {
  return {
    essenceKillMult: 1,
    essenceOnKill: 0,
    essenceEatMult: 1,
    depthBonusMult: 1,
    sporeImmune: false,
    fireResist: 1,
    sporeHeal: false,
    dangerSense: false,
    dreadAura: false,
    panicKill: false,
    crystalHeal: false,
    eliteGuarantee: false,
    healOnEat: 0,
    hpOnKill: 0,
  }
}

interface PerkTargets {
  vitals: Vitals
  creature: Creature
  combat: Combat
  mutations: Mutations
  /** Модификаторы сцены (свет/маскировка/эхо). */
  sceneMods: { detectMult: number; lightMult: number; echo: boolean }
}

/** Уровень «планирования» из узлов «Кожаные перепонки / Нырок / Крыло ночи». */
const GLIDE_LEVELS: Record<number, { fallMult: number; drift: number }> = {
  1: { fallMult: 0.8, drift: 1.15 },
  2: { fallMult: 0.65, drift: 1.3 },
  3: { fallMult: 0.55, drift: 1.45 },
}

/** Свернуть список узлов в модификаторы и применить к системам забега. */
export function applyPerks(nodes: string[], t: PerkTargets): RunPerks {
  const perks = emptyRunPerks()

  // Мультипликативные накопители (важен порядок применения — × по узлам).
  let biteAdd = 0
  let biteMult = 1
  let maxHpAdd = 0
  let hungerMaxAdd = 0
  let digestMult = 1
  let armorMult = 1
  let hungerSlow = 1
  let xpMult = 1
  let lightMult = 1
  let speedMult = 1
  let jumpMult = 1
  let airControlMult = 1
  let wallSlideMult = 1
  let detectMult = 1
  let essenceKillMult = 1
  let essenceEatMult = 1
  let depthBonusMult = 1
  let stunMsAdd = 0
  let biteRangeAdd = 0
  let biteArcAdd = 0
  let lungeMult = 1
  let windupMult = 1
  let dropChanceAdd = 0
  let extraSlots = 0
  let airJumps = 0
  let glideLevel = 0
  let geneBoost = 1
  const flags = new Set<string>()

  const applyEffect = (type: string, v: number): void => {
    switch (type) {
      // ── Прямые статы ──
      case 'bite': biteAdd += v; break
      case 'biteMult': biteMult *= v; break
      case 'maxHp': maxHpAdd += v; break
      case 'hungerMax': hungerMaxAdd += v; break
      case 'digest': digestMult *= v; break
      case 'armorPct': armorMult *= v; break
      case 'hungerSlow': hungerSlow *= v; break
      case 'xpMult': xpMult *= v; break
      case 'lightMult': lightMult *= v; break
      case 'speedMult': speedMult *= v; break
      case 'jumpMult': jumpMult *= v; break
      case 'airControlMult': airControlMult *= v; break
      case 'wallSlideMult': wallSlideMult *= v; break
      case 'detectMult': detectMult *= v; break
      case 'essenceKillMult': essenceKillMult *= v; break
      case 'essenceEatMult': essenceEatMult *= v; break
      case 'depthBonusMult': depthBonusMult *= v; break
      case 'stunMs': stunMsAdd += v; break
      case 'biteRange': biteRangeAdd += v; break
      case 'biteArc': biteArcAdd += v; break
      case 'lungeMult': lungeMult *= v; break
      case 'windupMult': windupMult *= v; break
      case 'dropChance': dropChanceAdd += v; break
      case 'extraSlot': extraSlots += v; break
      case 'airJump': airJumps += v; break
      case 'glideUpgrade': glideLevel = Math.max(glideLevel, v); break
      case 'healOnEat': perks.healOnEat += v; break
      case 'hpOnKill': perks.hpOnKill += v; break
      case 'essenceOnKill': perks.essenceOnKill += v; break

      // ── Поведенческие флаги ──
      case 'dangerSense': flags.add('dangerSense'); break
      case 'dreadAura': flags.add('dreadAura'); break
      case 'panicKill': flags.add('panicKill'); break
      case 'crystalHeal': flags.add('crystalHeal'); break
      case 'sporeImmune': flags.add('sporeImmune'); break
      case 'sporeHeal': flags.add('sporeHeal'); break
      case 'nightPounce': flags.add('nightPounce'); break
      case 'capJaw': flags.add('capJaw'); break

      // ── Составные узлы (несколько модификаторов за один) ──
      case 'capJawPack': break
      case 'wrath':
        biteMult *= 1.3
        essenceKillMult *= 1.25
        break
      case 'boneArmor':
        armorMult *= 0.75
        speedMult *= 0.95
        break
      case 'heartPump':
        maxHpAdd += 25
        t.vitals.healMult *= 1.5
        break
      case 'membraneGlow':
        lightMult *= 1.35
        break
      case 'symbHunter':
        biteMult *= 1.1
        lightMult *= 1.1
        break
      case 'nestPulse':
        lightMult *= 1.25
        hungerSlow *= 0.85
        break
      case 'caveChild':
        hungerSlow *= 0.7
        lightMult *= 1.3
        break
      case 'becomeDark':
        detectMult *= 0.7
        speedMult *= 1.15
        lightMult *= 0.9
        break
      case 'adaptivePlasma':
        armorMult *= 0.9
        xpMult *= 1.1
        break
      case 'perfectPredator':
        biteMult *= 1.12
        maxHpAdd += 15
        xpMult *= 1.15
        break
      case 'geneArchive':
        extraSlots += 1
        geneBoost = 1.25
        break
      case 'mutationStorm':
        dropChanceAdd += 0.15
        flags.add('eliteGuarantee')
        break
      case 'fireFriend':
        perks.fireResist = 0
        biteAdd += 4
        break
      case 'fireResist':
        perks.fireResist *= v
        break
      case 'curseResist':
        t.mutations.curseWeightMult = v
        break
      case 'mushFriend':
        flags.add('mushFriend')
        break
      case 'flowerSense':
        flags.add('flowerSense')
        break
      case 'geneSense':
        flags.add('geneSense')
        break
      case 'echo':
        flags.add('echo')
        break
      case 'parasite':
        t.combat.mods.parasite = { dps: 6, durationMs: 3000 }
        break
      case 'darkStrike':
        flags.add('darkStrike')
        break
      default:
        break
    }
  }

  // Сводим эффекты всех купленных узлов.
  for (const id of nodes) {
    const node = NEST_NODES.get(id)
    if (node) applyEffect(node.effect.type, node.effect.value)
  }

  // ── Применяем к системам ──
  const v = t.vitals
  v.geneBiteBonus += biteAdd
  v.biteDamageMult *= biteMult
  v.maxHp += maxHpAdd
  v.hp = Math.min(v.maxHp, v.hp + maxHpAdd)
  v.maxHunger += hungerMaxAdd
  v.hunger = Math.min(v.maxHunger, v.hunger + hungerMaxAdd)
  v.digestMult *= digestMult
  v.damageTakenMult *= armorMult
  v.hungerDrainMult *= hungerSlow
  v.xpMult *= xpMult
  v.mutationSlots += extraSlots
  v.geneMaxHpBonus = Math.round(v.geneMaxHpBonus * geneBoost)
  v.geneBiteBonus = Math.round(v.geneBiteBonus * 1) // прибавка узлов уже внутри
  v.geneHungerMaxBonus = Math.round(v.geneHungerMaxBonus * geneBoost)

  const cm = t.combat.mods
  cm.stunMs += stunMsAdd
  cm.biteRangeBonus += biteRangeAdd
  cm.biteArcBonus += biteArcAdd
  cm.lungeMult *= lungeMult
  cm.windupMult *= windupMult
  cm.capJaw = flags.has('capJaw')
  cm.nightPounce = flags.has('nightPounce')
  cm.darkStrikeDist = flags.has('darkStrike') ? 140 : 0

  const m = t.creature.mods
  m.speedMult *= speedMult
  m.jumpMult *= jumpMult
  m.airControlMult *= airControlMult
  m.wallSlideMult *= wallSlideMult
  m.airJumps += airJumps
  if (glideLevel > 0) {
    const g = GLIDE_LEVELS[glideLevel] ?? GLIDE_LEVELS[1]
    m.glideFallMult = Math.min(m.glideFallMult, g.fallMult)
    m.glideDriftMult = Math.max(m.glideDriftMult, g.drift)
  }

  t.mutations.chanceBonus += dropChanceAdd
  t.mutations.eliteGuarantee = flags.has('eliteGuarantee')
  t.mutations.slots += extraSlots

  t.sceneMods.detectMult *= detectMult
  t.sceneMods.lightMult *= lightMult
  if (flags.has('echo')) t.sceneMods.echo = true

  perks.essenceKillMult = essenceKillMult
  perks.essenceEatMult = essenceEatMult
  perks.depthBonusMult = depthBonusMult
  perks.sporeImmune = flags.has('sporeImmune')
  perks.sporeHeal = flags.has('sporeHeal')
  perks.dangerSense = flags.has('dangerSense')
  perks.dreadAura = flags.has('dreadAura')
  perks.panicKill = flags.has('panicKill')
  perks.crystalHeal = flags.has('crystalHeal')
  perks.eliteGuarantee = flags.has('eliteGuarantee')
  return perks
}
