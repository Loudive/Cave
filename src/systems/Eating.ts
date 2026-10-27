import Phaser from 'phaser'
import { BALANCE } from '../config/balance'
import { ENEMIES } from '../config/enemies'
import type { BloodFx } from './BloodFx'
import type { Vitals } from './Vitals'

/**
 * Eating — шаг 6: туша = объект поедания (гайд).
 * Мёртвая добыча остаётся мясом: чавканье по кускам (chewMs), каждый
 * кусок — сытость + немного HP + опыт роста, из туши летят чанки.
 * Съевший существо visibly растёт (Vitals.addXp → level up).
 * Туша истлевает за carcassLifeMs; рядом с ней светится слабый
 * «шёлк падали» над тьмой — «еда сама зовёт» (читаемость в темноте).
 */

interface Carcass {
  speciesId: string
  sprite: Phaser.GameObjects.Image
  /** Тёплый отблеск над маской: падаль видно в темноте. */
  shimmer: Phaser.GameObjects.Image
  hint: Phaser.GameObjects.Text
  meatLeft: number
  meatTotal: number
  bornAt: number
}

const DEPTH_CARCASS = 2
const DEPTH_SHIMMER = 15

export class Eating {
  private carcasses: Carcass[] = []
  private chewing: Carcass | null = null
  private nextChewAt = 0
  private chewsDone = 0

  constructor(
    private scene: Phaser.Scene,
    private vitals: Vitals,
    private blood: BloodFx,
    /** Координаты «рта» существа: x, y и направление взгляда. */
    private getMouth: () => { x: number; y: number; facing: number },
  ) {}

  get list(): readonly Carcass[] {
    return this.carcasses
  }

  get isChewing(): boolean {
    return this.chewing !== null
  }

  /** Создать тушу на месте смерти моба. */
  spawnCarcass(speciesId: string, x: number, y: number): void {
    const sp = ENEMIES.species[speciesId]
    const sprite = this.scene.add.image(x, y, sp.texture)
      .setDepth(DEPTH_CARCASS)
      .setTint(0xb06a72)
      .setScale(1.15, 0.6)
      .setAlpha(0.95)
    // Мягкий красный «шёлк» падали над тьмой — путь к еде.
    const shimmer = this.scene.add.image(x, y, 'glow-red')
      .setDepth(DEPTH_SHIMMER)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.1)
      .setScale(0.8)
    this.scene.tweens.add({
      targets: shimmer,
      alpha: { from: 0.05, to: 0.14 },
      duration: 1500,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })
    const hint = this.scene.add.text(x, y - 22, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#E8A34F',
    }).setOrigin(0.5).setDepth(DEPTH_SHIMMER)

    this.carcasses.push({
      speciesId,
      sprite,
      shimmer,
      hint,
      meatLeft: sp.meat,
      meatTotal: sp.meat,
      bornAt: this.scene.time.now,
    })
  }

  /** Ближайшая туша в радиусе (кнопка укуса становится «съесть»). */
  nearestCarcass(px: number, py: number, radius: number): Carcass | null {
    let best: Carcass | null = null
    let bestD = radius
    for (const c of this.carcasses) {
      const d = Phaser.Math.Distance.Between(px, py, c.sprite.x, c.sprite.y)
      if (d < bestD) {
        best = c
        bestD = d
      }
    }
    return best
  }

  startChewing(carcass: Carcass): void {
    if (this.chewing) return
    this.chewing = carcass
    this.chewsDone = 0
    this.nextChewAt = 0
  }

  /** Сцена подписывается: сжатие существа на каждом чавканье. */
  onChew: (() => void) | null = null

  /** Вызывать из scene.update, когда мир НЕ заморожен. */
  update(time: number, playerX: number, playerY: number): void {
    const e = BALANCE.eating
    const now = this.scene.time.now

    // Срок жизни туш.
    for (let i = this.carcasses.length - 1; i >= 0; i--) {
      const c = this.carcasses[i]
      if (now - c.bornAt > e.carcassLifeMs) {
        if (c === this.chewing) this.cancelChew()
        this.despawnCarcass(i, false)
      }
    }

    // Процесс чавканья.
    if (this.chewing) {
      const c = this.chewing
      const dist = Phaser.Math.Distance.Between(playerX, playerY, c.sprite.x, c.sprite.y)
      if (dist > e.range * 1.5 || !this.vitals.alive) {
        this.cancelChew()
      } else if (time >= this.nextChewAt) {
        this.chew(c, time)
      }
    }

    // Подсказки над тушами в радиусе доедания.
    for (const c of this.carcasses) {
      const d = Phaser.Math.Distance.Between(playerX, playerY, c.sprite.x, c.sprite.y)
      const show = d <= BALANCE.player.biteRange + 14 && c !== this.chewing
      c.hint.setText(show ? 'укус — съесть' : '')
      c.hint.setPosition(c.sprite.x, c.sprite.y - 20)
    }
  }

  private chew(c: Carcass, time: number): void {
    const e = BALANCE.eating
    const portion = Math.min(e.hungerPerChew, c.meatLeft)
    // Опыт считается от полной ценности вида (не от остатка — иначе
    // опыт «съедается» сам собой с каждым чавканьем).
    const xpShare = (portion / c.meatTotal) * ENEMIES.species[c.speciesId].xp

    c.meatLeft -= portion
    this.nextChewAt = time + e.chewMs
    this.chewsDone++

    // Сытость + чуть HP + опыт роста.
    this.vitals.eat(portion, xpShare)
    this.vitals.heal(BALANCE.player.hpFromChew)
    this.onChew?.()

    // Juice чавканья: куски изо рта, сжатие существа, число сытости.
    const mouth = this.getMouth()
    this.blood.burst(mouth.x, mouth.y, {
      count: e.chunkParticles,
      dirDeg: mouth.facing < 0 ? 200 : -20,
      spreadDeg: 70,
      speedMult: 0.55,
      texture: 'meat-chunk',
      sticky: false,
    })
    this.blood.number(c.sprite.x, c.sprite.y - 14, `+${Math.round(portion)}`, '#E8A34F')

    // Туша тает визуально.
    const ratio = Math.max(0.12, c.meatLeft / c.meatTotal)
    this.scene.tweens.killTweensOf(c.sprite)
    this.scene.tweens.add({
      targets: c.sprite,
      scaleX: 1.15 * ratio + 0.35,
      scaleY: 0.6 * ratio + 0.2,
      duration: 120,
      ease: 'Quad.Out',
    })

    if (c.meatLeft <= 0) {
      const idx = this.carcasses.indexOf(c)
      this.chewing = null
      if (idx >= 0) this.despawnCarcass(idx, true)
    }
  }

  private cancelChew(): void {
    this.chewing = null
    this.nextChewAt = 0
  }

  private despawnCarcass(index: number, eaten: boolean): void {
    const c = this.carcasses[index]
    this.carcasses.splice(index, 1)
    this.scene.tweens.killTweensOf(c.sprite)
    this.scene.tweens.killTweensOf(c.shimmer)
    c.hint.destroy()

    if (eaten) {
      // Сытый всплеск: тёплая вспышка + последние куски.
      const flash = this.scene.add.image(c.sprite.x, c.sprite.y, 'glow-red')
        .setDepth(DEPTH_SHIMMER)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setScale(0.5)
        .setAlpha(0.7)
      this.scene.tweens.add({
        targets: flash,
        scale: 1.6,
        alpha: 0,
        duration: 380,
        onComplete: () => flash.destroy(),
      })
      c.sprite.destroy()
      c.shimmer.destroy()
    } else {
      // Истлела: растворяется в темноте.
      this.scene.tweens.add({
        targets: [c.sprite, c.shimmer],
        alpha: 0,
        duration: 900,
        onComplete: () => {
          c.sprite.destroy()
          c.shimmer.destroy()
        },
      })
    }
  }

  get chewingProgress(): number {
    if (!this.chewing) return 0
    return 1 - this.chewing.meatLeft / this.chewing.meatTotal
  }
}
