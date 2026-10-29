import Phaser from 'phaser'
import { ENEMIES } from '../config/enemies'
import { QUALITY } from './quality'
import type { CaveData } from '../gen/cave'
import type { DarknessMask, LightSource } from './DarknessMask'
import { LIGHT } from '../config/light'
import type { Enemy } from '../entities/Enemy'

/**
 * FireTrail — шаг 7: огненный след лавового ползуна.
 * Лужи-патчи: спрайт пламени + тёплый glow + динамическая дыра света
 * в маске тьмы. Жгут игрока и мобов по тикам (dps из enemies.json),
 * сами сгорают за lifeMs. Пул ограничен maxPatches — старейшая лужа
 * гаснет первой. На низком качестве — без света и glow (гайд: на
 * слабых телефонах эффекты режутся первыми).
 */

interface FirePatch {
  img: Phaser.GameObjects.Image
  glow: Phaser.GameObjects.Image | null
  light: LightSource | null
  bornAt: number
  lifeMs: number
  radius: number
  dps: number
  tickMs: number
  lastBurnAt: number
  alive: boolean
}

// Шаг 18: пламя/гало перенесены НАД маску тьмы (LIGHT.halo.depth) —
// константа DEPTH_FIRE больше не нужна.

export interface FireHooks {
  onBurnPlayer: (amount: number) => void
}

export class FireTrail {
  private patches: FirePatch[] = []

  constructor(
    private scene: Phaser.Scene,
    private cave: CaveData,
    private mask: DarknessMask,
    private hooks: FireHooks,
  ) {}

  get activeCount(): number {
    return this.patches.filter((p) => p.alive).length
  }

  /** Лавовый ползун оставил лужу. */
  spawn(x: number, y: number): void {
    const tr = ENEMIES.species.lava.trail!
    // Пол — лужи живут на твёрдом.
    const floorY = this.snapToFloor(x, y) ?? y

    let p = this.patches.find((q) => !q.alive)
    if (!p) {
      if (this.patches.length >= tr.maxPatches) {
        // Гасим старейшую.
        const oldest = this.patches.reduce((a, b) => (a.bornAt < b.bornAt ? a : b))
        this.extinguish(oldest, false)
        p = oldest
      } else {
        // Шаг 18: пламя и его гало — НАД маской тьмы (полная тьма не
        // съедает огонь: угроза/еда читается издали, гайд §7).
        const img = this.scene.add.image(x, floorY, 'fire-patch')
          .setDepth(LIGHT.halo.depth)
          .setBlendMode(Phaser.BlendModes.ADD)
        p = { img, glow: null, light: null, bornAt: 0, lifeMs: 0, radius: 0, dps: 0, tickMs: 0, lastBurnAt: 0, alive: false }
        this.patches.push(p)
      }
    }

    const high = QUALITY.level === 'high'
    p.alive = true
    p.bornAt = this.scene.time.now
    p.lifeMs = tr.lifeMs
    p.radius = tr.radius
    p.dps = tr.burnDps
    p.tickMs = tr.burnTickMs
    p.lastBurnAt = this.scene.time.now
    p.img.setPosition(x, floorY - 4).setVisible(true).setAlpha(0.9).setScale(1)

    if (high && !p.glow) {
      p.glow = this.scene.add.image(x, floorY - 4, 'glow-red')
        .setDepth(LIGHT.halo.depth)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(LIGHT.halo.fire)
        .setScale(0.5)
    }
    if (p.glow) {
      p.glow.setPosition(x, floorY - 4).setVisible(true).setAlpha(LIGHT.halo.fire).setScale(0.5)
      this.scene.tweens.killTweensOf(p.glow)
      this.scene.tweens.add({
        targets: p.glow,
        alpha: { from: LIGHT.halo.fire * 0.6, to: LIGHT.halo.fire * 1.3 },
        scale: { from: 0.42, to: 0.6 },
        duration: 340,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
    }

    // Динамический свет в темноте — «всё, что светится, — еда, угроза или путь».
    if (high && !p.light) {
      p.light = this.mask.add({ x: () => p.img.x, y: () => p.img.y - 4, radius: tr.lightRadius })
    }
  }

  /** Вызывать из scene.update, когда мир НЕ заморожен. */
  update(time: number, playerX: number, playerY: number, playerAlive: boolean, mobs: Enemy[]): void {
    for (const p of this.patches) {
      if (!p.alive) continue

      if (time - p.bornAt > p.lifeMs) {
        this.extinguish(p, true)
        continue
      }

      // Пламя дрожит.
      p.img.setScale(0.92 + 0.16 * Math.sin(time / 70 + p.bornAt))

      // Горим по тикам, пока стоим в луже.
      if (time - p.lastBurnAt < p.tickMs) continue
      p.lastBurnAt = time

      if (playerAlive && Phaser.Math.Distance.Between(p.img.x, p.img.y - 4, playerX, playerY) < p.radius + 10) {
        this.hooks.onBurnPlayer(p.dps * (p.tickMs / 1000))
      }
      for (const m of mobs) {
        if (m.dead) continue
        // Броня вида режет и огонь (лавовый ползун иммунен: armor.fire = 1).
        if (Phaser.Math.Distance.Between(p.img.x, p.img.y, m.x, m.y) < p.radius + 8) {
          m.takeDamage(p.dps * (p.tickMs / 1000), 0, 0, 'fire', 'env')
        }
      }
    }
  }

  /** Лужа гаснет: визуал уходит, свет из маски убирается. */
  private extinguish(p: FirePatch, fade: boolean): void {
    p.alive = false
    if (p.light) {
      this.mask.remove(p.light)
      p.light = null
    }
    if (fade) {
      this.scene.tweens.add({
        targets: p.img,
        alpha: 0,
        scale: 0.6,
        duration: 420,
        onComplete: () => p.img.setVisible(false),
      })
      if (p.glow) {
        this.scene.tweens.killTweensOf(p.glow)
        this.scene.tweens.add({
          targets: p.glow,
          alpha: 0,
          duration: 420,
          onComplete: () => p.glow!.setVisible(false),
        })
      }
    } else {
      p.img.setVisible(false)
      if (p.glow) {
        this.scene.tweens.killTweensOf(p.glow)
        p.glow.setVisible(false)
      }
    }
  }

  /** Пол под точкой (px) в пределах 6 клеток; null — воздух до края. */
  private snapToFloor(px: number, py: number): number | null {
    const { cols, rows, tile, solid } = this.cave
    const tx = Math.floor(px / tile)
    if (tx < 0 || tx >= cols) return null
    let ty = Math.floor(py / tile)
    for (let i = 0; i < 6 && ty < rows; i++, ty++) {
      if (solid[ty * cols + tx] === 1) return ty * tile
    }
    return null
  }

  destroyAll(): void {
    for (const p of this.patches) {
      if (p.light) this.mask.remove(p.light)
      p.img.destroy()
      p.glow?.destroy()
    }
    this.patches = []
  }
}
