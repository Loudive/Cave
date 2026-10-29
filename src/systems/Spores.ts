import Phaser from 'phaser'
import { QUALITY } from './quality'
import type { CaveData } from '../gen/cave'
import type { DarknessMask, LightSource } from './DarknessMask'
import type { BloodFx } from './BloodFx'
import type { Enemy } from '../entities/Enemy'

/**
 * Spores — шаг 7: споровые снаряды спорового жнеца.
 * Веер снарядов после замаха (телеграф рисует сам Enemy), лёгкая
 * гравитация, столкновение со стенами пещеры и целями. Попадание в
 * игрока — урон + споровая пыль (замедление в Creature.slowUntil);
 * в моба — дружественный огонь экосистемы (дешевле). Каждый снаряд —
 * слабая дыра света в маске тьмы (на высоком качестве): жнец светится.
 */

interface SporeBolt {
  img: Phaser.GameObjects.Image
  light: LightSource | null
  vx: number
  vy: number
  gravity: number
  damage: number
  bornAt: number
  alive: boolean
}

const DEPTH_SPORE = 4
const LIFETIME_MS = 1700
const PLAYER_HIT_R = 13
const MOB_HIT_R = 12

export interface SporeHooks {
  onHitPlayer: (damage: number, x: number, y: number) => void
  onHitMob: (victim: Enemy, applied: number) => void
}

export class Spores {
  private pool: SporeBolt[] = []

  constructor(
    private scene: Phaser.Scene,
    private cave: CaveData,
    private mask: DarknessMask,
    private blood: BloodFx,
    private hooks: SporeHooks,
  ) {}

  get activeCount(): number {
    return this.pool.filter((b) => b.alive).length
  }

  /** Жнец стреляет: веер из attack.shots в сторону цели.
   *  Шаг 24: урон масштабируется глубинным множителем стрелка (depthScale). */
  fireFrom(attacker: Enemy, tx: number, ty: number): void {
    const atk = attacker.species.attack
    if (!atk || atk.type !== 'shoot') return

    const baseAngle = Math.atan2(ty - attacker.y, tx - attacker.x)
    const spreadRad = Phaser.Math.DegToRad(atk.spreadDeg)
    for (let i = 0; i < atk.shots; i++) {
      const t = atk.shots > 1 ? i / (atk.shots - 1) - 0.5 : 0
      const angle = baseAngle + t * spreadRad
      this.spawnBolt(
        attacker.x, attacker.y - 6,
        Math.cos(angle) * atk.shotSpeed,
        Math.sin(angle) * atk.shotSpeed,
        atk.projGravity, Math.round(atk.damage * attacker.dmgMult),
      )
    }
    // Выстрел виден даже сквозь тьму: пшик спор у дула.
    this.blood.burst(attacker.x, attacker.y - 6, {
      count: QUALITY.level === 'high' ? 6 : 3, dirDeg: Phaser.Math.RadToDeg(baseAngle),
      spreadDeg: 40, speedMult: 0.35, texture: 'spore', sticky: false,
    })
  }

  private spawnBolt(x: number, y: number, vx: number, vy: number, gravity: number, damage: number): void {
    let bolt = this.pool.find((b) => !b.alive)
    if (!bolt) {
      if (this.pool.length >= 24) bolt = this.pool.reduce((a, b) => (a.bornAt < b.bornAt ? a : b))
      else {
        const img = this.scene.add.image(x, y, 'spore-bolt')
          .setDepth(DEPTH_SPORE)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setTint(0xc88aff)
        bolt = { img, light: null, vx: 0, vy: 0, gravity: 0, damage: 0, bornAt: 0, alive: false }
        this.pool.push(bolt)
      }
    }

    bolt.alive = true
    bolt.vx = vx
    bolt.vy = vy
    bolt.gravity = gravity
    bolt.damage = damage
    bolt.bornAt = this.scene.time.now
    bolt.img.setPosition(x, y).setAlpha(1).setScale(1).setVisible(true)

    // Слабый свет снаряда (высокое качество): жнец «стреляет светом».
    if (!bolt.light && QUALITY.level === 'high') {
      bolt.light = this.mask.add({ x: () => bolt.img.x, y: () => bolt.img.y, radius: 26 })
    }
  }

  /** Вызывать из scene.update, когда мир НЕ заморожен. */
  update(time: number, playerX: number, playerY: number, playerAlive: boolean, mobs: Enemy[]): void {
    const dt = Math.min(48, this.scene.game.loop.delta) / 1000
    for (const b of this.pool) {
      if (!b.alive) continue

      if (time - b.bornAt > LIFETIME_MS) {
        this.pop(b, false)
        continue
      }

      b.vy += b.gravity * dt
      const nx = b.img.x + b.vx * dt
      const ny = b.img.y + b.vy * dt
      b.img.setPosition(nx, ny)
      // Спора «дышит» в полёте.
      b.img.setScale(0.9 + 0.2 * Math.sin(time / 90))

      // Стена пещеры — спора лопается.
      if (this.solidAtPx(nx, ny)) {
        this.pop(b, true)
        continue
      }

      // Игрок.
      if (playerAlive && Phaser.Math.Distance.Between(nx, ny, playerX, playerY) < PLAYER_HIT_R) {
        this.pop(b, true)
        this.hooks.onHitPlayer(b.damage, nx, ny)
        continue
      }

      // Дружественный огонь экосистемы (дешевле игрока — геймдизайн).
      let hitMob: Enemy | null = null
      for (const m of mobs) {
        if (m.dead) continue
        if (Phaser.Math.Distance.Between(nx, ny, m.x, m.y) < MOB_HIT_R) {
          hitMob = m
          break
        }
      }
      if (hitMob) {
        this.pop(b, true)
        const applied = hitMob.takeDamage(Math.max(1, Math.round(b.damage * 0.6)), Math.sign(b.vx), 0, 'physical', 'env')
        if (applied > 0) this.hooks.onHitMob(hitMob, applied)
      }
    }
  }

  private pop(b: SporeBolt, withBurst: boolean): void {
    b.alive = false
    if (b.light) {
      this.mask.remove(b.light)
      b.light = null
    }
    b.img.setVisible(false)
    if (withBurst) {
      this.blood.burst(b.img.x, b.img.y, {
        count: QUALITY.level === 'high' ? 7 : 3, dirDeg: 90, spreadDeg: 360,
        speedMult: 0.4, texture: 'spore', sticky: false,
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
