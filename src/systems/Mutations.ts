import Phaser from 'phaser'
import { MUTATIONS, type MutationDef, type Rarity } from '../config/mutations'
import { BALANCE } from '../config/balance'
import { hexInt } from '../config/light'
import type { Vitals } from './Vitals'
import { uiAttach } from './UiLayer'

/**
 * Mutations — шаг 6: забеговые мутации, выпадающие из туш с шансом
 * dropChance (25%, гайд). Взвешенный пул без повторов за забег;
 * эффекты — хуки в уже существующие системы ( Creature.mods, Vitals,
 * Combat, stealth в EnemyContext, thorns при уроне игроку).
 * Шаг 8 превратит это в полноценные слоты + постоянные гены.
 *
 * Редкость чувствуется (гайд): цвет кристалла/баннера по редкости,
 * эпические вспыхивают ярче.
 */

const DEPTH_GEM = 3
const DEPTH_GEM_TWIN = 15
const DEPTH_BANNER = 26

interface Gem {
  img: Phaser.GameObjects.Image
  twin: Phaser.GameObjects.Image
  def: MutationDef
}

/** Цвет редкости → int. */
export function rarityColor(r: Rarity): number {
  return hexInt(MUTATIONS.rarityColors[r])
}

export class Mutations {
  private owned: MutationDef[] = []
  private gems: Gem[] = []
  private banner: Phaser.GameObjects.Container | null = null

  // Шаг 11 (Гнездо): модификаторы древа навыков.
  /** Прибавка к базовому шансу выпадения мутации (узлы «Генов»). */
  chanceBonus = 0
  /** Множитель веса проклятий в броске («Стабильный код» — ×0.5). */
  curseWeightMult = 1
  /** Элитные гарантированно роняют («Мутационный шторм»). */
  eliteGuarantee = false

  /** Сцена применяет хуки эффекта (grip/doubleJump/thorns/...). */
  onApply: ((def: MutationDef, silent?: boolean) => void) | null = null
  onPickedUp: (() => void) | null = null

  constructor(private scene: Phaser.Scene, private vitals: Vitals) {}

  get ownedList(): readonly MutationDef[] {
    return this.owned
  }

  get ownedCount(): number {
    return this.owned.length
  }

  /** Слоты мутаций (шаг 8): 6 базовых + геном-гнездо; ставит сцена. */
  slots = BALANCE.mutations.maxOwned

  /**
   * Шаг 12: перенос мутаций между слоями пещеры — переиграть эффекты
   * тихо (без баннеров/вспышек/звука). Вызывается из CaveScene.restoreRun
   * ПОСЛЕ генов и перков, чтобы SET-модификаторы легли поверх.
   */
  restore(ids: string[]): void {
    for (const id of ids) {
      const def = MUTATIONS.pool.find((m) => m.id === id)
      if (!def || this.owned.some((o) => o.id === id)) continue
      this.owned.push(def)
      this.applyEffect(def)
      this.onApply?.(def, true)
    }
  }

  /** Бросок на выпадение из туши. Шанс 25% (+бонус Гнезда); если повезло —
   * кристалл вырастает из туши (пул без повторов; пусто — кристалл не вырастет).
   * opts.guaranteed — «Мутационный шторм»: элита роняет всегда.
   */
  rollDrop(x: number, y: number, opts?: { guaranteed?: boolean }): void {
    const chance = BALANCE.mutations.dropChance + this.chanceBonus
    if (!opts?.guaranteed && Math.random() >= chance) return
    // Потолок: подобранное + невыбранные кристаллы не превышают слоты
    // (шаг 8: слоты = 6 базовых + геном-гнездо).
    if (this.owned.length + this.gems.length >= this.slots) return
    // Легендарные в общем пуле не выпадают (только с уникальных — шаг 8).
    const left = MUTATIONS.pool.filter((m) => m.rarity !== 'legendary' && !this.owned.some((o) => o.id === m.id))
    if (left.length === 0) return

    const total = left.reduce((s, m) => s + this.weightOf(m), 0)
    let roll = Math.random() * total
    let picked = left[0]
    for (const m of left) {
      roll -= this.weightOf(m)
      if (roll <= 0) {
        picked = m
        break
      }
    }
    this.spawnGem(x, y, picked)
  }

  /** Вес мутации в броске с учётом «Стабильного кода» (шаг 11). */
  private weightOf(m: MutationDef): number {
    return m.rarity === 'curse' ? m.weight * this.curseWeightMult : m.weight
  }

  /**
   * Прямая выдача мутации (тест-хук верификации и будущие источники —
   * уникальные мобы, ген-цветки). Полный путь подбора: эффект + баннер.
   */
  grantForTest(def: MutationDef): void {
    if (this.owned.some((o) => o.id === def.id)) return
    if (this.owned.length >= BALANCE.mutations.maxOwned) return
    const color = rarityColor(def.rarity)
    const epic = def.rarity === 'epic'
    const flash = this.scene.add.image(this.scene.cameras.main.midPoint.x, this.scene.cameras.main.midPoint.y, 'glow-purple')
      .setDepth(DEPTH_GEM_TWIN + 1)
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.4)
      .setAlpha(0.8)
    this.scene.tweens.add({
      targets: flash,
      scale: epic ? 2.6 : 1.8,
      alpha: 0,
      duration: 420,
      onComplete: () => flash.destroy(),
    })
    this.owned.push(def)
    this.vitals.mutationsCount++
    this.applyEffect(def)
    this.showBanner(def)
    this.onApply?.(def)
    this.onPickedUp?.()
  }

  private spawnGem(x: number, y: number, def: MutationDef): void {
    const color = rarityColor(def.rarity)
    const img = this.scene.add.image(x, y, 'mutation-gem')
      .setDepth(DEPTH_GEM)
      .setTint(color)
      .setScale(1.4)
    // Силуэтное сияние над тьмой: «всё, что светится, — еда или путь».
    const twin = this.scene.add.image(x, y, 'mutation-gem')
      .setDepth(DEPTH_GEM_TWIN)
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.16)
      .setScale(1.4)

    this.scene.tweens.add({
      targets: [img, twin],
      scaleX: { from: 1.2, to: 1.55 },
      scaleY: { from: 1.55, to: 1.2 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })
    this.scene.tweens.add({
      targets: twin,
      alpha: { from: 0.08, to: 0.3 },
      duration: 1300,
      yoyo: true,
      repeat: -1,
    })
    // Вспышка рождения кристалла.
    this.scene.tweens.add({
      targets: [img, twin],
      scale: { from: 0.2, to: 1.4 },
      alpha: { from: 1, to: img.alpha },
      duration: 340,
      ease: 'Back.Out',
    })

    this.gems.push({ img, twin, def })
  }

  /** Вызывать из scene.update: подбор кристаллов у существа. */
  update(playerX: number, playerY: number): void {
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const gem = this.gems[i]
      const d = Phaser.Math.Distance.Between(gem.img.x, gem.img.y, playerX, playerY)
      if (d < 22) {
        this.collect(gem)
        this.gems.splice(i, 1)
      }
    }
  }

  private collect(gem: Gem): void {
    // Страховка потолка слотов (кристаллы могли вырасти до переполнения).
    if (this.owned.length >= BALANCE.mutations.maxOwned) {
      gem.img.destroy()
      gem.twin.destroy()
      return
    }
    const def = gem.def
    const color = rarityColor(def.rarity)
    const epic = def.rarity === 'epic'

    // Пить-вспышка в цвет редкости.
    const flash = this.scene.add.image(gem.img.x, gem.img.y, 'glow-purple')
      .setDepth(DEPTH_GEM_TWIN + 1)
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.4)
      .setAlpha(0.8)
    this.scene.tweens.add({
      targets: flash,
      scale: epic ? 2.6 : 1.8,
      alpha: 0,
      duration: 420,
      onComplete: () => flash.destroy(),
    })

    this.owned.push(def)
    this.vitals.mutationsCount++
    this.applyEffect(def)
    this.showBanner(def)
    this.onApply?.(def)
    this.onPickedUp?.()

    gem.img.destroy()
    gem.twin.destroy()
  }

  /** Хук эффекта: каждая мутация — точка в существующей системе. */
  private applyEffect(def: MutationDef): void {
    const e = def.effect
    switch (e.type) {
      case 'grip':
      case 'doubleJump':
      case 'stealth':
      case 'thorns':
      case 'stunBite':
        // Сеттеры вешает сцена в onApply (Creature.mods / Combat.mods).
        break
      case 'digestion':
        this.vitals.digestMult = e.mult
        break
      case 'biteDamage':
        this.vitals.biteDamageMult = e.mult
        if (e.acid) this.vitals.biteAcid = true
        break
      case 'secondHeart':
        this.vitals.hasSecondHeart = true
        break
      // ── Шаг 8: расширенный пул геномов ──
      case 'gluttonMaw':
        this.vitals.digestMult *= e.digestMult
        this.vitals.appetiteBonus += e.appetiteMult
        break
      case 'bonePlate':
        this.vitals.damageTakenMult *= e.mult
        break
      case 'lightHungerCore':
        this.vitals.biteDamageMult *= e.dmgMult
        break
      case 'hungryVeins':
        this.vitals.hungerDrainMult = e.hungerMult
        this.vitals.biteDamageMult *= e.dmgMult
        break
      case 'transparentSkin':
        this.vitals.applyHpPct(e.hpPct)
        break
      default:
        break
    }
  }

  /** Баннер-карточка мутации: имя, редкость, эффект. */
  private showBanner(def: MutationDef): void {
    const { width } = this.scene.scale
    const color = MUTATIONS.rarityColors[def.rarity]

    if (this.banner) {
      this.banner.destroy()
      this.banner = null
    }

    const c = this.scene.add.container(width / 2, 64).setDepth(DEPTH_BANNER)
    // Шаг 20: баннер мутации — экранным слоем (твин y:78 внутри uiRoot = экранные px).
    uiAttach(this.scene, c)
    const bg = this.scene.add.rectangle(0, 0, 340, 56, 0x0b0b10, 0.86)
      .setStrokeStyle(1, rarityColor(def.rarity))
    const title = this.scene.add.text(0, -14, `МУТАЦИЯ · ${def.name.toUpperCase()}`, {
      fontFamily: 'monospace',
      fontSize: '14px',
      fontStyle: 'bold',
      color,
    }).setOrigin(0.5)
    const desc = this.scene.add.text(0, 10, def.desc, {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#E8E6E3',
    }).setOrigin(0.5)
    c.add([bg, title, desc])
    c.setAlpha(0)
    this.banner = c

    this.scene.tweens.add({ targets: c, alpha: 1, y: 78, duration: 260, ease: 'Cubic.Out' })
    this.scene.time.delayedCall(2600, () => {
      if (!this.banner || this.banner !== c) return
      this.scene.tweens.add({
        targets: c,
        alpha: 0,
        y: 60,
        duration: 300,
        onComplete: () => c.destroy(),
      })
      if (this.banner === c) this.banner = null
    })
  }
}
