import Phaser from 'phaser'
import { EXPEDITION } from '../config/expedition'
import type { CaveData } from '../gen/cave'
import type { DarknessMask, LightSource } from './DarknessMask'
import type { BloodFx } from './BloodFx'
import type { Enemy } from '../entities/Enemy'
import { hexInt } from '../config/light'

/**
 * Bullets — шаг 26: трассеры военных экспедиций.
 *
 * Клон паттерна Spores (пул без GC), но снаряд — прямой: без гравитации,
 * быстрый, тёплая светящаяся палочка. Вспышка у дула — короткая дыра
 * света в маске тьмы (стрельбу видно ИЗДАЛИ — тёплый свет = угроза,
 * GDD §7). Пули бьют ВСЁ живое — игрока и пещерную фауну («война трёх
 * сторон»), кроме своего отряда (friendly). Все числа — expedition.json.
 */

interface Bullet {
  img: Phaser.GameObjects.Image
  light: LightSource | null
  vx: number
  vy: number
  damage: number
  bornAt: number
  alive: boolean
}

const DEPTH_BULLET = 4

export interface BulletHooks {
  onHitPlayer: (damage: number, x: number, y: number) => void
  onHitMob: (victim: Enemy, applied: number) => void
}

export class Bullets {
  private pool: Bullet[] = []

  constructor(
    private scene: Phaser.Scene,
    private cave: CaveData,
    private mask: DarknessMask,
    private blood: BloodFx,
    private hooks: BulletHooks,
  ) {}

  get activeCount(): number {
    return this.pool.filter((b) => b.alive).length
  }

  /** Очередь стрелка: параметры — species.attack (marine), урон × dmgMult. */
  fireFrom(attacker: Enemy, tx: number, ty: number): void {
    const atk = attacker.species.attack
    if (!atk || atk.type !== 'shoot') return
    const cfg = EXPEDITION.bullets

    const baseAngle = Math.atan2(ty - attacker.y, tx - attacker.x)
    const spreadRad = Phaser.Math.DegToRad(atk.spreadDeg)
    for (let i = 0; i < atk.shots; i++) {
      const t = atk.shots > 1 ? i / (atk.shots - 1) - 0.5 : 0
      const angle = baseAngle + t * spreadRad
      this.spawnBullet(
        attacker.x, attacker.y - 4,
        Math.cos(angle) * atk.shotSpeed,
        Math.sin(angle) * atk.shotSpeed,
        Math.max(1, Math.round(atk.damage * attacker.dmgMult)),
      )
    }
    // Вспышка у дула + короткая дыра света в маске (стрельбу видно издали).
    const mx = attacker.x + Math.cos(baseAngle) * 10
    const my = attacker.y - 4
    const muzzle = this.scene.add.image(mx, my, 'glow-red')
      .setDepth(DEPTH_BULLET)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(hexInt('#F2C14E'))
      .setAlpha(0.85)
      .setScale(0.5)
    const mLight = this.mask.add({
      x: () => muzzle.x,
      y: () => muzzle.y,
      radius: cfg.muzzleLightRadius,
    })
    this.scene.tweens.add({
      targets: muzzle,
      alpha: 0,
      scale: 0.1,
      duration: 170,
      onComplete: () => {
        this.mask.remove(mLight)
        muzzle.destroy()
      },
    })
  }

  private spawnBullet(x: number, y: number, vx: number, vy: number, damage: number): void {
    const cfg = EXPEDITION.bullets
    let b = this.pool.find((it) => !it.alive)
    if (!b) {
      if (this.pool.length >= 40) b = this.pool.reduce((a, it) => (a.bornAt < it.bornAt ? a : it))
      else {
        const img = this.scene.add.image(x, y, 'bullet')
          .setDepth(DEPTH_BULLET)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(hexInt(cfg.tint))
        b = { img, light: null, vx: 0, vy: 0, damage: 0, bornAt: 0, alive: false }
        this.pool.push(b)
      }
    }

    b.alive = true
    b.vx = vx
    b.vy = vy
    b.damage = damage
    b.bornAt = this.scene.time.now
    b.img.setPosition(x, y).setAlpha(1).setVisible(true)
    b.img.setRotation(Math.atan2(vy, vx))

    if (!b.light) {
      b.light = this.mask.add({ x: () => b.img.x, y: () => b.img.y, radius: 22 })
    }
  }

  /** Вызывать из scene.update, когда мир НЕ заморожен. */
  update(time: number, playerX: number, playerY: number, playerAlive: boolean, mobs: Enemy[]): void {
    const cfg = EXPEDITION.bullets
    const dt = Math.min(48, this.scene.game.loop.delta) / 1000
    for (const b of this.pool) {
      if (!b.alive) continue

      if (time - b.bornAt > cfg.lifeMs) {
        this.pop(b, false)
        continue
      }

      const nx = b.img.x + b.vx * dt
      const ny = b.img.y + b.vy * dt
      b.img.setPosition(nx, ny)

      // Стена — искра и «дзынь».
      if (this.solidAtPx(nx, ny)) {
        this.pop(b, true)
        continue
      }

      // Игрок: трассер — как спора, честная неуязвимость после удара.
      if (playerAlive && Phaser.Math.Distance.Between(nx, ny, playerX, playerY) < cfg.hitRadius + 4) {
        this.pop(b, true)
        this.hooks.onHitPlayer(b.damage, nx, ny)
        continue
      }

      // Пещерная фауна: пули бьют ВСЁ живое, кроме своего отряда.
      let hitMob: Enemy | null = null
      for (const m of mobs) {
        if (m.dead || cfg.friendly.includes(m.speciesId)) continue
        if (Phaser.Math.Distance.Between(nx, ny, m.x, m.y) < cfg.hitRadius + 6) {
          hitMob = m
          break
        }
      }
      if (hitMob) {
        this.pop(b, true)
        const applied = hitMob.takeDamage(
          Math.max(1, Math.round(b.damage * cfg.mobDmgShare)),
          Math.sign(b.vx) || 1, 0, 'physical', 'env',
        )
        if (applied > 0) this.hooks.onHitMob(hitMob, applied)
      }
    }
  }

  private pop(b: Bullet, withBurst: boolean): void {
    b.alive = false
    if (b.light) {
      this.mask.remove(b.light)
      b.light = null
    }
    b.img.setVisible(false)
    if (withBurst) {
      this.blood.burst(b.img.x, b.img.y, {
        count: 5, dirDeg: 90, spreadDeg: 360, speedMult: 0.4, sticky: false,
      })
    }
  }

  private solidAtPx(px: number, py: number): boolean {
    const { cols, rows, tile, solid } = this.cave
    const tx = Math.floor(px / tile)
    const ty = Math.floor(py / tile)
    if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return true
    return solid[ty * cols + tx] === 1
  }

  destroyAll(): void {
    for (const b of this.pool) {
      if (b.light) this.mask.remove(b.light)
      b.img.destroy()
    }
    this.pool = []
  }
}
