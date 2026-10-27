import Phaser from 'phaser'
import { ENEMIES, type SpeciesConfig } from '../config/enemies'

/**
 * Enemy — шаг 6: база добычи. Скелет FSM (wander → flee → windup →
 * lunge → stunned → dead) уже повторяет форму шага 7 (патруль →
 * преследование → атака → бегство) — экосистема ляжет сверху.
 *
 * Читаемость в темноте (гайд §7): у атаки моба — замах с подстветкой
 * (раздувание + алая пульсация), у смерти — «мешок» отброса.
 * Вне света моб рендерится двойником-силуэтом ПОВЕРХ маски тьмы
 * (как мошь шага 5): «чуть более чёрные силуэты на чёрном».
 */

export type EnemyState = 'wander' | 'flee' | 'windup' | 'lunge' | 'stunned' | 'dead'

export interface EnemyContext {
  playerX: number
  playerY: number
  /** Текущий радиус света игрока (детекция — на свет, не на звук). */
  playerLightR: number
  /** Множитель радиуса детекции (мутация «Хамелеонская плёнка»). */
  detectMult: number
  frozen: boolean
}

export interface EnemyCallbacks {
  /** Контратака слизня долетела до игрока (attacker — для «Токсичной шкуры»). */
  onPlayerBitten: (damage: number, fromX: number, attacker: Enemy) => void
  /** Моб умер: сцена решает кровь/тушу/опыт. */
  onDeath: (enemy: Enemy) => void
}

const DEPTH_ENEMY = 3
/** Силуэт-двойник — над маской (14), под мошью (16). */
const DEPTH_TWIN = 15

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  readonly species: SpeciesConfig
  readonly speciesId: string
  hp: number
  stateName: EnemyState = 'wander'
  dead = false

  /** Силуэт вне света (двойник над маской). */
  readonly twin: Phaser.GameObjects.Image

  private ctxNextChange = 0
  private wanderDir = 0
  private hopAcc = 0
  private counterReadyAt = 0
  /** Копится, пока добыча толкается в стену в бегстве («прижата»). */
  private corneredAcc = 0
  private windupUntil = 0
  private lungeUntil = 0
  private lungeHasHit = false
  private lungeFromX = 0
  private lungeFromY = 0
  private stunnedUntil = 0
  private windupFx: Phaser.GameObjects.Graphics
  private batAnchor: { x: number; y: number } | null = null
  private flapTwin = 0

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    speciesId: string,
    private callbacks: EnemyCallbacks,
  ) {
    super(scene, x, y, ENEMIES.species[speciesId].texture)
    const sp = ENEMIES.species[speciesId]
    this.species = sp
    this.speciesId = speciesId
    this.hp = sp.hp

    scene.add.existing(this)
    scene.physics.add.existing(this)
    this.setDepth(DEPTH_ENEMY)
    const [w, h] = sp.size
    this.body!.setSize(w, h)
    this.setOffset((this.width - w) / 2, this.height - h)
    if (!sp.fly) {
      this.setCollideWorldBounds(false)
      // Слизень слегка пружинит от стен, чтобы не залипал в них.
      this.setBounce(0.15, 0)
    } else {
      const body = this.body as Phaser.Physics.Arcade.Body
      body.allowGravity = false
    }

    this.twin = scene.add.image(x, y, sp.texture)
      .setDepth(DEPTH_TWIN)
      .setTint(0x0d0d13)
      .setAlpha(0)
      .setFlipX(this.flipX)

    this.windupFx = scene.add.graphics().setDepth(DEPTH_ENEMY + 1)

    // Таймеры состояния (мс).
    this.ctxNextChange = scene.time.now + Phaser.Math.Between(400, 1200)
  }

  get aiState(): EnemyState {
    return this.stateName
  }

  /** Слизень прижат к стене (для отладки и ИИ шага 7). */
  get isCornered(): boolean {
    return this.corneredAcc > 0
  }

  /** Тест-хук: форсировать замах контратаки (agent-browser верификация). */
  debugForceWindup(): void {
    const c = this.species.counter
    if (!c || this.dead) return
    this.stateName = 'windup'
    this.windupUntil = this.scene.time.now + c.windupMs
    const body = this.body as Phaser.Physics.Arcade.Body
    body.velocity.x = 0
    this.tweenInflate(1.28, c.windupMs)
  }

  /** Вызывать из scene.update, когда мир НЕ заморожен. */
  override update(time: number, delta: number, ctx: EnemyContext): void {
    if (this.dead) return
    const now = time
    const body = this.body as Phaser.Physics.Arcade.Body

    if (this.stateName === 'stunned') {
      if (now >= this.stunnedUntil) {
        this.stateName = 'flee'
        this.ctxNextChange = now + 600
        this.setTintFill(0xffffff)
        this.scene.time.delayedCall(60, () => !this.dead && this.clearTint())
      }
      this.syncTwin()
      return
    }

    const dx = ctx.playerX - this.x
    const dy = ctx.playerY - this.y
    const dist = Math.hypot(dx, dy)
    const detect = this.species.detectRadius * ctx.detectMult

    // ── Замах контратаки (телеграф) ────────────────────────────────────────
    if (this.stateName === 'windup') {
      body.velocity.x = 0
      if (now >= this.windupUntil) {
        // Выпад в сторону игрока.
        const dir = Math.sign(dx) || 1
        const c = this.species.counter!
        body.velocity.x = dir * c.lungeSpeed
        if (body.blocked.down) body.velocity.y = -140
        this.stateName = 'lunge'
        this.lungeUntil = now + 220
        this.lungeHasHit = false
        this.lungeFromX = this.x
        this.lungeFromY = this.y
        this.setFlipX(dir < 0)
        this.tweenInflate(1, 120)
      } else {
        this.drawWindup(now)
      }
      this.syncTwin()
      return
    }

    // ── Активная фаза выпада ───────────────────────────────────────────────
    if (this.stateName === 'lunge') {
      this.windupFx.clear()
      const c = this.species.counter!
      // Контакт укуса: игрок в носу у выпада.
      const biteDx = ctx.playerX - this.x
      const biteDy = ctx.playerY - this.y
      const face = Math.sign(body.velocity.x) || 1
      if (
        !this.lungeHasHit
        && Math.abs(biteDy) < 20
        && biteDx * face > 0
        && Math.abs(biteDx) < 26
        && now < this.lungeUntil
      ) {
        this.lungeHasHit = true
        this.callbacks.onPlayerBitten(c.damage, this.x, this)
      }
      if (now >= this.lungeUntil) {
        // Свип-проверка: выпад — это размах, укус засчитывается, если игрок
        // был в коридоре выпада (важно и на низком fps).
        if (!this.lungeHasHit) {
          const minX = Math.min(this.lungeFromX, this.x) - 26
          const maxX = Math.max(this.lungeFromX, this.x) + 26
          const minY = Math.min(this.lungeFromY, this.y) - 20
          const maxY = Math.max(this.lungeFromY, this.y) + 20
          if (
            ctx.playerX > minX && ctx.playerX < maxX
            && ctx.playerY > minY && ctx.playerY < maxY
            && (ctx.playerX - this.lungeFromX) * Math.sign(body.velocity.x || 1) > -26
          ) {
            this.lungeHasHit = true
            this.callbacks.onPlayerBitten(c.damage, this.x, this)
          }
        }
        this.stateName = 'flee'
        this.counterReadyAt = now + c.cooldownMs
        this.ctxNextChange = now + 500
      }
      this.syncTwin()
      return
    }

    // ── Решение о контратаке: прижатая добыча кусается ──────────────────────────
    // Проверка «стена-в-лицо» копится по контактным кадрам: панические прыжки
    // добычи размывают блокировку — считаем именно безуспешное давление.
    const c = this.species.counter
    if (c && this.stateName === 'flee') {
      const pressed = body.blocked.left || body.blocked.right
      this.corneredAcc = pressed ? this.corneredAcc + delta : Math.max(0, this.corneredAcc - delta * 2)
      if (
        now >= this.counterReadyAt
        && this.corneredAcc >= c.stuckMs
        && dist < c.triggerRange
      ) {
        this.corneredAcc = 0
        this.stateName = 'windup'
        this.windupUntil = now + c.windupMs
        body.velocity.x = 0
        this.tweenInflate(1.28, c.windupMs)
        this.setFlipX(dx < 0)
        return
      }
    }

    // ── Бегство: свет игрока рядом — добыча чувствует хищника ─────────────
    const lightNear = dist < detect
    if (this.stateName === 'wander' && lightNear) {
      this.stateName = 'flee'
      this.ctxNextChange = now + Phaser.Math.Between(500, 900)
    } else if (this.stateName === 'flee' && !lightNear && now >= this.ctxNextChange) {
      this.stateName = 'wander'
      this.ctxNextChange = now + Phaser.Math.Between(600, 1500)
    }

    if (this.species.fly) {
      this.updateFlight(delta, ctx, now)
    } else {
      this.updateGround(ctx, now, delta)
    }

    this.syncTwin()
  }

  /** Наземное движение: wander (блуждание с паузами) / flee (рывки-прыжки). */
  private updateGround(ctx: EnemyContext, now: number, delta: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body
    const sp = this.species
    const awayDir = Math.sign(this.x - ctx.playerX) || 1

    if (this.stateName === 'flee') {
      const f = sp.flee
      body.velocity.x = Phaser.Math.Linear(body.velocity.x, awayDir * f.speed, 0.2)
      // Панические прыжки: добыча так и лезет в стены.
      if (body.blocked.down && Math.random() < (f.hopChance ?? 0.4) * (delta / 16.7)) {
        body.velocity.y = -(f.hopVelocityY ?? 180)
      }
      this.setFlipX(body.velocity.x < 0)
      // Хоп-анимация бега.
      this.hopAcc += delta
      if (this.hopAcc > 150) {
        this.hopAcc = 0
        this.tweenSquish(0.82, 1.12, 130)
      }
      return
    }

    // Wander: пауза → выбор направления → ходьба; спружинил в стену — развернулся.
    if (now >= this.ctxNextChange) {
      const w = sp.wander!
      if (this.wanderDir !== 0) {
        this.wanderDir = 0
        this.ctxNextChange = now + Phaser.Math.Between(w.pauseMs[0], w.pauseMs[1])
      } else {
        this.wanderDir = Math.random() < 0.5 ? -1 : 1
        this.ctxNextChange = now + Phaser.Math.Between(w.moveMs[0], w.moveMs[1])
      }
    }
    const speed = sp.wander!.speed
    body.velocity.x = this.wanderDir * speed
    if (body.blocked.left) this.wanderDir = 1
    if (body.blocked.right) this.wanderDir = -1
    this.setFlipX(this.wanderDir < 0)

    // Ленивое скольжение-подпрыгивание ( слизень «течёт»).
    this.hopAcc += delta
    if (this.wanderDir !== 0 && this.hopAcc > sp.wander!.hopEveryMs) {
      this.hopAcc = 0
      this.tweenSquish(1.06, 0.92, 260)
    }
  }

  /** Полёт нетопыря: якорь + синусоида (гайд, шаг 7), бегство — вверх. */
  private updateFlight(delta: number, ctx: EnemyContext, now: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body
    const f = this.species.fly!

    if (this.stateName === 'flee') {
      // Уходит вверх и прочь от хищника.
      const awayX = Math.sign(this.x - ctx.playerX) || 1
      const upY = Math.sign(this.y - ctx.playerY) * this.species.flee.climbBias! || -0.5
      const len = Math.hypot(awayX, upY) || 1
      body.velocity.x = Phaser.Math.Linear(body.velocity.x, (awayX / len) * this.species.flee.speed, 0.12)
      body.velocity.y = Phaser.Math.Linear(body.velocity.y, (upY / len) * this.species.flee.speed, 0.12)
    } else {
      // Дрейф к якорю с лиссажу-биением.
      if (!this.batAnchor || Phaser.Math.Distance.Between(this.x, this.y, this.batAnchor.x, this.batAnchor.y) < 14) {
        const base = this.batAnchor ?? { x: this.x, y: this.y }
        const ang = Math.random() * Math.PI * 2
        const r = Math.random() * f.anchorRadius
        this.batAnchor = {
          x: base.x + Math.cos(ang) * r,
          y: base.y - Phaser.Math.Between(f.anchorYMin, f.anchorYMax),
        }
        this.batAnchor.y -= f.anchorYMin // якорь всегда над землёй
      }
      const t = now / f.sinePeriodMs * Math.PI * 2
      const targetX = this.batAnchor.x + Math.cos(t) * f.sineAmplitudePx
      const targetY = this.batAnchor.y + Math.sin(t * 2) * f.sineAmplitudePx * 0.6
      const toX = targetX - this.x
      const toY = targetY - this.y
      const len = Math.hypot(toX, toY) || 1
      body.velocity.x = Phaser.Math.Linear(body.velocity.x, (toX / len) * f.speed, 0.08)
      body.velocity.y = Phaser.Math.Linear(body.velocity.y, (toY / len) * f.speed, 0.08)
    }

    // Взмахи крыльев: чередуем наклон.
    this.flapTwin += delta
    if (this.flapTwin > 160) {
      this.flapTwin = 0
      this.tweenSquish(1.1, 0.9, 140)
    }
    this.setFlipX(body.velocity.x < 0)
  }

  /** Синхронизация силуэта-двойника вне света. */
  private syncTwin(): void {
    this.twin.setPosition(this.x, this.y)
    this.twin.setFlipX(this.flipX)
    this.twin.setScale(this.scaleX, this.scaleY)
  }

  /** Обновить видимость силуэта (сцена знает радиус света). */
  updateSilhouette(playerX: number, playerY: number, lightR: number): void {
    if (this.dead) return
    const d = Phaser.Math.Distance.Between(this.x, this.y, playerX, playerY)
    const inner = lightR * 0.92
    const outer = lightR * 1.3
    const t = Phaser.Math.Clamp((d - inner) / (outer - inner), 0, 1)
    this.twin.setAlpha(t * this.species.twinAlpha)
  }

  /** Замах: алая пульсация-телеграф (гайд: «замах 0,3–0,4 с с подстветкой»). */
  private drawWindup(now: number): void {
    const c = this.species.counter
    if (!c) return
    const progress = Phaser.Math.Clamp(1 - (this.windupUntil - now) / c.windupMs, 0, 1)
    const g = this.windupFx
    g.clear()
    const pulse = 0.45 + 0.55 * Math.abs(Math.sin(now / 70))
    const r = 13 + progress * 8
    g.lineStyle(1.6, 0xe23a4e, 0.35 + pulse * 0.5)
    g.strokeCircle(this.x, this.y, r)
    g.lineStyle(1, 0xe23a4e, 0.25)
    g.strokeCircle(this.x, this.y, r + 4 + progress * 5)
  }

  private tweenInflate(target: number, ms: number): void {
    this.scene.tweens.add({
      targets: this,
      scaleX: target,
      scaleY: target,
      duration: ms,
      ease: 'Sine.InOut',
    })
  }

  private tweenSquish(sx: number, sy: number, ms: number): void {
    this.scene.tweens.killTweensOf(this)
    this.scene.tweens.add({
      targets: this,
      scaleX: sx,
      scaleY: sy,
      duration: ms,
      yoyo: true,
      ease: 'Sine.InOut',
    })
  }

  /**
   * Урон по мобу. Возвращает true, если моб умер.
   * stunMs — мутация «Электроорганы».
   */
  takeDamage(amount: number, knockDirX: number, stunMs = 0): boolean {
    if (this.dead) return false
    this.hp -= amount
    this.windupFx.clear()

    if (this.hp <= 0) {
      this.die(knockDirX)
      return true
    }

    const body = this.body as Phaser.Physics.Arcade.Body
    const resist = this.species.knockbackResist
    body.velocity.x += knockDirX * 260 * (1 - resist)
    if (this.species.fly) body.velocity.y -= 60 * (1 - resist)
    else body.velocity.y = Math.min(body.velocity.y, -120 * (1 - resist))

    if (stunMs > 0) {
      this.stateName = 'stunned'
      this.stunnedUntil = this.scene.time.now + stunMs
      body.velocity.x = 0
      // Электро-мерцание.
      this.setTintFill(0xbfefff)
      this.scene.time.delayedCall(80, () => !this.dead && this.setTintFill(0x6ecfe8))
    } else {
      // Испуг и бегство после урона.
      this.stateName = 'flee'
      this.ctxNextChange = this.scene.time.now + 700
      this.flashHurt()
    }
    return false
  }

  private flashHurt(): void {
    this.setTintFill(0xffffff)
    this.scene.time.delayedCall(70, () => {
      if (!this.dead) this.clearTint()
    })
  }

  private die(knockDirX: number): void {
    this.dead = true
    this.stateName = 'dead'
    const body = this.body as Phaser.Physics.Arcade.Body
    body.velocity.set(knockDirX * 120, -160)
    this.clearTint()
    this.setTintFill(0xff8a94)
    this.callbacks.onDeath(this)
    this.scene.tweens.killTweensOf(this)
    this.scene.time.delayedCall(140, () => {
      this.windupFx.destroy()
      this.twin.destroy()
      this.destroy()
    })
  }

  /** Прячем контратаку, если существо ушло. */
  clearWindupFx(): void {
    this.windupFx.clear()
  }

  override destroy(fromScene?: boolean): void {
    this.twin?.destroy()
    super.destroy(fromScene)
  }
}
