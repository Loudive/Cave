import Phaser from 'phaser'
import { ENEMIES, type SpeciesConfig } from '../config/enemies'
import { hexInt } from '../config/light'
import { QUALITY } from './quality'
import type { Enemy } from '../entities/Enemy'

/**
 * Ecosystem — шаг 7: режиссёр живой пещеры.
 * 1. Кольца шума над маской тьмы: писк, замах, удар, еда — пещеру
 *    «слышно» глазами (гайд: «стоя на месте и слушая»). Пул, не GC.
 * 2. Слух: удар рядом с мобом будит его — он идёт смотреть (alert).
 * 3. Восстановление населения: гнёзда шага 4 возрождают своих через
 *    respawnMs, пока живых меньше потолка и не превышен кап вида.
 * 4. Счётчики жизни пещеры (debug + верификация «аквариума»): драки,
 *    убийства мобами, трапезы падальщиков, писки, возрождения.
 */

interface RingSlot {
  img: Phaser.GameObjects.Image
  busy: boolean
}

export interface NestRecord {
  index: number
  tx: number
  ty: number
  biome: number
  respawnAt: number | null
}

export interface EcoCounters {
  mobHits: number
  mobKills: number
  mobMeals: number
  squeaks: number
  respawns: number
  rings: number
}

export interface EcoHooks {
  /** Порождение моба у гнезда (сцена соблюдает потолки и капы видов). */
  spawnAtNest: (nest: NestRecord) => boolean
}

const DEPTH_RING = 15.5

export class Ecosystem {
  readonly nests: NestRecord[] = []
  readonly counters: EcoCounters = { mobHits: 0, mobKills: 0, mobMeals: 0, squeaks: 0, respawns: 0, rings: 0 }
  private rings: RingSlot[] = []

  constructor(
    private scene: Phaser.Scene,
    private hooks: EcoHooks,
  ) {}

  // ── Кольца шума («слышно» глазами) ─────────────────────────────────────────

  /** Расширяющееся кольцо в цвете вида — звук, увиденный сквозь тьму. */
  ring(x: number, y: number, color: string, alpha: number): void {
    const cfg = ENEMIES.eco.ring
    let slot = this.rings.find((r) => !r.busy)
    if (!slot) {
      if (this.rings.length >= 18) slot = this.rings[0]
      else {
        const img = this.scene.add.image(x, y, 'ring')
          .setDepth(DEPTH_RING)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setVisible(false)
        slot = { img, busy: false }
        this.rings.push(slot)
      }
    }

    slot.busy = true
    slot.img.setPosition(x, y)
      .setTint(hexInt(color))
      .setAlpha(alpha)
      .setScale(cfg.growFrom / 32)
      .setVisible(true)
    this.counters.rings++

    this.scene.tweens.killTweensOf(slot.img)
    this.scene.tweens.add({
      targets: slot.img,
      scale: cfg.growTo / 32,
      alpha: 0,
      duration: cfg.lifeMs,
      ease: 'Sine.Out',
      onComplete: () => {
        slot.img.setVisible(false)
        slot.busy = false
      },
    })
  }

  /** Событие шума моба: кольцо + слух у соседей. */
  emitNoise(source: Enemy, kind: 'windup' | 'hit' | 'eat' | 'squeak' | 'curl', others: Enemy[]): void {
    const cfg = ENEMIES.eco.ring
    const alpha = kind === 'hit' ? cfg.alphaHit
      : kind === 'windup' ? cfg.alphaWindup
      : kind === 'eat' ? cfg.alphaEat
      : cfg.alphaSqueak
    const col = (source.species as SpeciesConfig).noiseColor

    if (kind === 'squeak') this.counters.squeaks++
    // На низком качестве кольца не рисуем (слабые телефоны), но слух работает.
    if (QUALITY.level === 'high') this.ring(source.x, source.y, col, alpha)

    // Слух: удар/замах рядом будит патрульных — идут смотреть (alert).
    if (kind === 'hit' || kind === 'windup') {
      const hearR = ENEMIES.eco.leashRadius * 1.2
      for (const e of others) {
        if (e === source || e.dead) continue
        if (Phaser.Math.Distance.Between(e.x, e.y, source.x, source.y) < hearR) {
          e.hearNoise(source.x, source.y, this.scene.time.now)
        }
      }
    }
  }

  // ── Население: гнёзда возрождают своих ─────────────────────────────────────

  registerNest(index: number, tx: number, ty: number, biome: number): void {
    this.nests.push({ index, tx, ty, biome, respawnAt: null })
  }

  /** Моб гнезда умер — гнездо займётся восстановлением. */
  onMobDeath(nestIndex: number): void {
    this.counters.mobKills++
    if (nestIndex < 0) return
    const nest = this.nests.find((n) => n.index === nestIndex)
    if (!nest || nest.respawnAt !== null) return
    const [min, max] = ENEMIES.eco.respawnMs
    nest.respawnAt = this.scene.time.now + Phaser.Math.Between(min, max)
  }

  /** Вызывать из scene.update. */
  update(time: number): void {
    for (const nest of this.nests) {
      if (nest.respawnAt === null) continue
      if (time < nest.respawnAt) continue
      // Сцена решает по потолку карты и капам видов; не вышло — повтор позже.
      const spawned = this.hooks.spawnAtNest(nest)
      nest.respawnAt = null
      if (spawned) {
        this.counters.respawns++
      } else {
        nest.respawnAt = time + 4000
      }
    }
  }

  stats(): string {
    const c = this.counters
    return `драк=${c.mobHits} убито=${c.mobKills} трапез=${c.mobMeals} писк=${c.squeaks} возр=${c.respawns}`
  }
}
