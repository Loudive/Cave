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

  /** Модификаторы мутаций. */
  biteDamageMult = 1
  digestMult = 1
  hasSecondHeart = false

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
    return Math.round((BALANCE.player.biteDamage + (this.level - 1) * g.bitePerLevel) * this.biteDamageMult)
  }

  /** Голод тает быстрее с уровнем (аппетит). */
  get appetiteMult(): number {
    const g = BALANCE.growth
    return 1 + (this.level - 1) * g.appetitePerLevel
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

    // Голод тикает каждые tickMs — аккуратно по dt (независимо от fps).
    if (this.hunger > 0) {
      this.hungerAcc += dtMs * this.appetiteMult
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
        this.damage(h.starveDamage)
      }
    }
  }

  /** Сытость и рост от еды (мутация «Переваривание» усиливает). */
  eat(hungerPoints: number, xpPoints: number): void {
    this.hunger = Math.min(this.maxHunger, this.hunger + hungerPoints * this.digestMult)
    this.addXp(xpPoints * this.digestMult)
  }

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
    if (!this.alive) return
    this.hp = Math.min(this.maxHp, this.hp + amount)
  }
}
