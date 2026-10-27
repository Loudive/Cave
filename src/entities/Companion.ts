import Phaser from 'phaser'
import { ENEMIES } from '../config/enemies'
import type { Enemy } from './Enemy'

/**
 * Companion — шаг 8: спутник от легендарной мутации «Корона Матки».
 * Побеждённый мелкий моб (слизень/нетопырь) становится союзником:
 * держится рядом с маткой (игроком), сам бросается на ближайшего моба
 * и кусает его (урон — от лица игрока: туши и счётчик его заслуг).
 * Сгусток жизни мата — спутник неуязвим для чужих атак, но хрупок
 * логически: живёт до конца забега.
 */

const DEPTH_COMPANION = 3

export interface CompanionHost {
  playerX: () => number
  playerY: () => number
  enemies: () => Enemy[]
  onCompanionBite: (victim: Enemy, applied: number) => void
}

export class Companion extends Phaser.Physics.Arcade.Sprite {
  private host: CompanionHost
  private thinkAt = 0
  private biteReadyAt = 0
  private target: Enemy | null = null
  private twin: Phaser.GameObjects.Image

  constructor(scene: Phaser.Scene, x: number, y: number, host: CompanionHost) {
    // Спутник наследует облик слизня с королевской споровой краской.
    super(scene, x, y, 'mob-slug')
    this.host = host
    scene.add.existing(this)
    scene.physics.add.existing(this)
    this.setDepth(DEPTH_COMPANION)
    this.setTint(0xd8b4ff)
    this.setScale(0.85)
    const body = this.body as Phaser.Physics.Arcade.Body
    body.setSize(18, 12)
    this.setOffset((this.width - 18) / 2, this.height - 12)
    this.setBounce(0.15, 0)

    this.twin = scene.add.image(x, y, 'mob-slug')
      .setDepth(15)
      .setTint(0x0d0d13)
      .setAlpha(0)
      .setScale(0.85)
  }

  /** Вызывать из scene.update, когда мир не заморожен. */
  override update(time: number, delta: number, playerLightR: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body
    const px = this.host.playerX()
    const py = this.host.playerY()
    const distP = Phaser.Math.Distance.Between(this.x, this.y, px, py)

    // Выбор цели: ближайший моб в радиусе чуть больше света матки.
    if (time >= this.thinkAt) {
      this.thinkAt = time + 400
      this.target = null
      let bestD = playerLightR * 1.2
      for (const e of this.host.enemies()) {
        if (e.dead) continue
        const d = Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y)
        if (d < bestD) {
          bestD = d
          this.target = e
        }
      }
    }

    if (this.target && !this.target.dead) {
      // Погоня за целью + укус в упор.
      const d = Phaser.Math.Distance.Between(this.x, this.y, this.target.x, this.target.y)
      const dirX = Math.sign(this.target.x - this.x) || 1
      if (d > 24) {
        body.velocity.x = Phaser.Math.Linear(body.velocity.x, dirX * (ENEMIES.species.slug.flee?.speed ?? 200) * 0.8, 0.15)
      } else {
        body.velocity.x = Phaser.Math.Linear(body.velocity.x, 0, 0.2)
        if (time >= this.biteReadyAt) {
          this.biteReadyAt = time + 1800
          const applied = this.target.takeDamage(5, dirX, 0, 'physical', 'player')
          if (applied > 0) this.host.onCompanionBite(this.target, applied)
          this.tweenSquish(1.2, 0.85, 140)
        }
      }
      this.setFlipX(dirX < 0)
    } else {
      // Свита: держится рядом с маткой.
      if (distP > 44) {
        const dirX = Math.sign(px - this.x) || 1
        body.velocity.x = Phaser.Math.Linear(body.velocity.x, dirX * 140, 0.14)
        if (py < this.y - 26 && body.blocked.down) body.velocity.y = -190
      } else {
        body.velocity.x = Phaser.Math.Linear(body.velocity.x, 0, 0.18)
      }
      this.setFlipX(px < this.x)
    }

    // Силуэт вне света и лёгкая пульсация свиты.
    this.twin.setPosition(this.x, this.y).setFlipX(this.flipX).setScale(this.scaleX, this.scaleY)
    const d = Phaser.Math.Distance.Between(this.x, this.y, px, py)
    const inner = playerLightR * 0.92
    const outer = playerLightR * 1.3
    this.twin.setAlpha(Phaser.Math.Clamp((d - inner) / (outer - inner), 0, 1) * 0.5)
    void delta
  }

  private tweenSquish(sx: number, sy: number, ms: number): void {
    this.scene.tweens.killTweensOf(this)
    this.scene.tweens.add({
      targets: this,
      scaleX: sx * 0.85,
      scaleY: sy * 0.85,
      duration: ms,
      yoyo: true,
      ease: 'Sine.InOut',
    })
  }

  override destroy(fromScene?: boolean): void {
    this.twin?.destroy()
    super.destroy(fromScene)
  }
}
