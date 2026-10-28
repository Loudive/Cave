import Phaser from 'phaser'
import { BALANCE, xpToNext } from '../config/balance'

/**
 * Vitals — шаг 6: живучесть, голод, рост существа.
 * Голод снижается каждые hunger.tickMs на drainPerTick (гайд: «каждые
 * 2 секунды»); при нуле HP «тает» — starveDamage за starveTickMs.
 * Еда даёт опыт: xpToNext(level) = xpBase·level^exp; каждый уровень —
 * существо visibly растёт (scalePerLevel), крепнет и голодает быстрее
 * (аппетит — цена размера, GDD §5 «Размер»).
 *
 * Мутации (Mutations.ts) применяют свои модификаторы сюда и в Creature.
 */
export class Vitals {
  hp: number
  maxHp: number
  hunger: number
  maxHunger: number
  xp = 0
  level = 1
  alive = true

  /** Модификаторы мутаций (шаг 8: множители копятся). */
  biteDamageMult = 1
  digestMult = 1
  hasSecondHeart = false
  /** «Кислотные железы» (шаг 7): укус — кислотный, пробивает панцири. */
  biteAcid = false
  /** Шаг 8: «Костяная броня» — получаемый урон умножается на это. */
  damageTakenMult = 1
  /** Шаг 8: «Проклятие Голодных жил» — голод тает быстрее. */
  hungerDrainMult = 1
  /** Шаг 8: «Чрево-пасть» — прибавка к аппетиту (цена сытости). */
  appetiteBonus = 0
  /** Шаг 11 (Гнездо): множитель опыта с еды (узлы древа). */
  xpMult = 1
  /** Шаг 11 (Гнездо): множитель прямого лечения (heal). */
  healMult = 1
  /** Постоянные гены (шаг 8): прибавки к характеристикам. */
  geneMaxHpBonus = 0
  geneBiteBonus = 0
  geneHungerMaxBonus = 0
  geneDigestMult = 1
  /** Сколько слотов мутаций (6 базовых + геном-гнездо). */
  mutationSlots = BALANCE.mutations.maxOwned
  /** Последняя причина урона (экран итога забега, шаг 8). */
  lastDamageCause = 'пещера'

  /** Счётчики забега (для экрана смерти). */
  eatenCount = 0
  mutationsCount = 0

  private hungerAcc = 0
  private starveAcc = 0

  /** Сцена подписывается: levelUp(level), damaged(n), starving... */
  onLevelUp: ((level: number) => void) | null = null
  onHurt: ((amount: number) => void) | null = null
  /** «Второе сердце» погасило смертельный урон (баннер сцены). */
  onSecondHeart: (() => void) | null = null

  constructor() {
    this.maxHp = BALANCE.player.maxHp
    this.hp = this.maxHp
    this.maxHunger = BALANCE.hunger.max
    this.hunger = this.maxHunger
  }

  /** Масштаб тела по уровню (визуальный рост). */
  get bodyScale(): number {
    const g = BALANCE.growth
    return Math.min(g.maxScale, 1 + (this.level - 1) * g.scalePerLevel)
  }

  get biteDamage(): number {
    const g = BALANCE.growth
    return Math.round((BALANCE.player.biteDamage + this.geneBiteBonus + (this.level - 1) * g.bitePerLevel) * this.biteDamageMult)
  }

  /** Голод тает быстрее с уровнем (аппетит). */
  get appetiteMult(): number {
    const g = BALANCE.growth
    return 1 + (this.level - 1) * g.appetitePerLevel + this.appetiteBonus
  }

  get hungerRatio(): number {
    return Phaser.Math.Clamp(this.hunger / this.maxHunger, 0, 1)
  }

  get hpRatio(): number {
    return Phaser.Math.Clamp(this.hp / this.maxHp, 0, 1)
  }

  get xpRatio(): number {
    return Phaser.Math.Clamp(this.xp / xpToNext(this.level), 0, 1)
  }

  get starving(): boolean {
    return this.hunger <= 0
  }

  get lowHp(): boolean {
    return this.hpRatio <= BALANCE.hunger.warnBelow / 100
  }

  /** Вызывать из scene.update, когда мир НЕ заморожен. */
  update(dtMs: number): void {
    if (!this.alive) return
    const h = BALANCE.hunger

    // Голод тикает каждые tickMs — аккуратно по dt (независимо от fps);
    // проклятие «Голодных жил» разгоняет таяние (шаг 8).
    if (this.hunger > 0) {
      this.hungerAcc += dtMs * this.appetiteMult * this.hungerDrainMult
      while (this.hungerAcc >= h.tickMs && this.hunger > 0) {
        this.hungerAcc -= h.tickMs
        this.hunger = Math.max(0, this.hunger - h.drainPerTick)
      }
    }

    // Голод нулевой — HP тает.
    if (this.hunger <= 0) {
      this.starveAcc += dtMs
      while (this.starveAcc >= h.starveTickMs) {
        this.starveAcc -= h.starveTickMs
        this.lastDamageCause = 'голод'
        this.damage(h.starveDamage)
      }
    }
  }

  /** Сытость и рост от еды (мутация «Переваривание» усиливает). */
  eat(hungerPoints: number, xpPoints: number): void {
    this.hunger = Math.min(this.maxHunger, this.hunger + hungerPoints * this.digestMult * this.geneDigestMult)
    this.addXp(xpPoints * this.digestMult * this.geneDigestMult * this.xpMult)
    this.onEat?.()
  }

  /** Сцена подписывается: «Кровавый напор» после трапезы. */
  onEat: (() => void) | null = null

  addXp(points: number): void {
    if (!this.alive) return
    this.xp += points
    while (this.level < BALANCE.growth.maxLevel && this.xp >= xpToNext(this.level)) {
      this.xp -= xpToNext(this.level)
      this.level++
      const g = BALANCE.growth
      this.maxHp += g.hpPerLevel
      this.hp = Math.min(this.maxHp, this.hp + g.hpPerLevel)
      this.maxHunger += g.hungerMaxPerLevel
      this.hunger = Math.min(this.maxHunger, this.hunger + g.hungerMaxPerLevel)
      this.onLevelUp?.(this.level)
    }
  }

  /** «Костяная броня»/прочее: применяет множитель получаемого урона. */
  damageWithMult(amount: number): number {
    return this.damage(Math.max(1, Math.round(amount * this.damageTakenMult)))
  }

  /** Проклятие «Прозрачная кожа»: потолок HP режется долей. */
  applyHpPct(pct: number): void {
    this.maxHp = Math.max(1, Math.floor(this.maxHp * pct))
    this.hp = Math.min(this.hp, this.maxHp)
  }

  /**
   * Урон по существу. Возвращает фактически применённый урон
   * («Второе сердце» гасит смертельный раз за забег).
   */
  damage(amount: number): number {
    if (!this.alive) return 0
    if (this.hasSecondHeart && this.hp - amount <= 0) {
      this.hasSecondHeart = false
      this.hp = 1
      this.onSecondHeart?.()
      this.onHurt?.(amount)
      return 0
    }
    this.hp -= amount
    this.onHurt?.(amount)
    if (this.hp <= 0) {
      this.hp = 0
      this.alive = false
    }
    return amount
  }

  /** Прямое лечение (кусок мяса возвращает немного HP). */
  heal(amount: number): void {
    if (!this.alive || amount <= 0) return
    this.hp = Math.min(this.maxHp, this.hp + amount * this.healMult)
  }
}
