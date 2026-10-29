import Phaser from 'phaser'
import { Enemy, type EnemyCallbacks, type EnemyContext, type KillerKind } from './Enemy'
import { QUEEN } from '../config/queen'
import { ENEMIES, armorResist, type DamageType } from '../config/enemies'
import { LIGHT } from '../config/light'

/**
 * Queen — шаг 25: МАТКА УЛЬЯ, финальная цель игры.
 *
 * НЕ обычный моб: расширяет Enemy (урон/смерть/силеэт/глубинное усиление
 * работают как у всех — укус/сильный удар/пике/пули бьют её через общий
 * пайплайн), но update() полностью свой: якорная (не двигается),
 * трёхфазный бой по долям HP.
 *
 * Фазы: 1 — размах клешнёй + выводок; 2 — +КРИК (волна с отбросом);
 * 3 — +КИСЛОТНЫЙ ПЛЕВОК (веер снарядов через Spores, параметры —
 * species.attack 'shoot' в enemies.json) и бешеный темп.
 *
 * Узурпатор (PvP-связка): если передан challenger {name, power}, Матка
 * первого Гнездовья подменяется Узурпатором — имя из кода, статы от
 * мощи билда соперника (hp/dmg по refPower, кап maxMult), фиолетовый
 * тон вместо багрового. Все числа — queen.json.
 */

export interface QueenHooks {
  /** Матка проснулась (баннер, босс-бар, рык). */
  onActivate: (q: Queen) => void
  /** Смена фазы (рык + кольцо + тряска). */
  onPhase: (q: Queen, phase: number) => void
  /** Размах дошёл до цели: сцена бьёт игрока + отбрасывает. */
  onSwipe: (q: Queen, damage: number) => void
  /** Крик разорвался: сцена бьёт по радиусу + отброс от Матки. */
  onScream: (q: Queen, damage: number, radius: number) => void
  /** Кислотный плевок: сцена запускает веер снарядов (Spores). */
  onSpit: (q: Queen, tx: number, ty: number) => void
  /** Выводок: сцена спавнит детей Матки вокруг гнездовья. */
  onBrood: (q: Queen, phase: number) => void
  /** Смерть Матки: сцена запускает ПОБЕДУ (спец-последовательность). */
  onVictory: (q: Queen, killer: KillerKind) => void
}

export interface QueenChallenger {
  name: string
  power: number
}

type QueenAction = 'idle' | 'swipe-windup' | 'scream-windup' | 'spit-windup' | 'recover'

const DEPTH_FX = 4

export class Queen extends Enemy {
  /** Проснулась: бой начался. */
  activated = false
  /** Текущая фаза (1..3). */
  phase = 1
  /** Цикл Матки: 1 = первая (слой everyNDepths), 2 = вторая (NG+)… */
  readonly cycle: number
  /** Узурпатор (чужой билд) или null — родная Матка. */
  readonly challenger: QueenChallenger | null
  /** Множитель мощи (для награды за Узурпатора; ставит applyBossScale). */
  powerMult = 1

  private hooks: QueenHooks
  private action: QueenAction = 'idle'
  private actionUntil = 0
  private nextActionReadyAt = 0
  private broodNextAt = 0
  private screamFx: Phaser.GameObjects.Graphics
  private chargeGlow: Phaser.GameObjects.Image | null = null

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    callbacks: EnemyCallbacks,
    hooks: QueenHooks,
    opts: { cycle: number; challenger: QueenChallenger | null },
  ) {
    super(scene, x, y, 'queen', callbacks)
    this.hooks = hooks
    this.cycle = opts.cycle
    this.challenger = opts.challenger

    // Габарит: лист 68×46, но Матка — исполин (×scale из queen.json).
    const s = QUEEN.stats.scale
    this.setScale(s, s)

    // Якорь: Гнездовье не двигается с места (физика — только мишень).
    const body = this.body as Phaser.Physics.Arcade.Body
    body.allowGravity = false
    body.moves = false
    body.immovable = true

    // Узурпатор: фиолетовый тон вместо родного багрово-костяного.
    if (opts.challenger) this.setTint(0xd8b8ff)

    this.screamFx = scene.add.graphics().setDepth(DEPTH_FX)
  }

  /**
   * Босс-масштаб после applyDepthScale (вызывает сцена): NG+ циклы и
   * мощь Узурпатора. Урон растёт вполовину темпа живучести — бой
   * длиннее, но не мгновенно смертельный.
   */
  applyBossScale(): void {
    const ngMult = Math.pow(QUEEN.stats.ngPlusHpMult, this.cycle - 1)
    const chMult = this.challenger
      ? Math.min(QUEEN.reign.maxMult, 1 + this.challenger.power / QUEEN.reign.refPower)
      : 1
    const hpMult = ngMult * chMult
    this.maxHp = Math.round(this.maxHp * hpMult)
    this.hp = this.maxHp
    this.dmgMult *= 1 + (hpMult - 1) * 0.5
    this.powerMult = hpMult
    // Выводок злее: интервал сжимается корнем от множителя.
    this.broodRateMult = Math.sqrt(hpMult)
  }

  /** Сжатие интервала выводка (NG+/Узурпатор). */
  broodRateMult = 1

  override update(time: number, _delta: number, ctx: EnemyContext): void {
    if (this.dead) return
    const now = time
    const dist = Phaser.Math.Distance.Between(this.x, this.y, ctx.playerX, ctx.playerY)

    // Пробуждение: игрок достаточно близко к Гнездовью.
    if (!this.activated) {
      if (ctx.playerAlive && dist < QUEEN.lair.activationRadius) {
        this.activated = true
        this.nextActionReadyAt = now + 1200
        this.broodNextAt = now + 2400 / this.broodRateMult
        this.hooks.onActivate(this)
      }
      this.updateAnim()
      this.syncTwin()
      return
    }

    // Фазы по долям HP (ярость = скорость).
    const ratio = this.hp / this.maxHp
    const newPhase = ratio <= QUEEN.phases.phase3At ? 3 : ratio <= QUEEN.phases.phase2At ? 2 : 1
    if (newPhase !== this.phase) {
      this.phase = newPhase
      this.hooks.onPhase(this, newPhase)
    }

    // Выводок — независимый таймер (гнездо работает даже между атаками).
    if (ctx.playerAlive && now >= this.broodNextAt) {
      this.broodNextAt = now + QUEEN.phases.brood.broodMs[this.phase - 1] / this.broodRateMult
      this.hooks.onBrood(this, this.phase)
    }

    if (this.action === 'idle') {
      if (ctx.playerAlive && now >= this.nextActionReadyAt) {
        this.chooseAction(now, ctx, dist)
      }
    } else if (this.action !== 'recover' && now >= this.actionUntil) {
      this.releaseAction(now, ctx)
    } else if (this.action === 'recover' && now >= this.actionUntil) {
      this.action = 'idle'
      this.nextActionReadyAt = now + QUEEN.phases.actionGapMs[this.phase - 1]
    } else {
      this.drawTelegraph(now)
    }

    this.updateAnim()
    this.syncTwin()
  }

  /** Выбор атаки по дистанции и фазе (читаемость: у всего — телеграф). */
  private chooseAction(now: number, ctx: EnemyContext, dist: number): void {
    const atk = QUEEN.attacks
    const spit = this.species.attack
    const spitRange = spit && spit.type === 'shoot' ? spit.shotRange : 400
    this.setFlipX(ctx.playerX < this.x)

    if (dist < atk.swipe.range) {
      this.action = 'swipe-windup'
      this.actionUntil = now + atk.swipe.windupMs
      this.spawnChargeGlow('#E23A4E')
    } else if (this.phase >= 2 && dist < atk.scream.radius * 1.7) {
      this.action = 'scream-windup'
      this.actionUntil = now + atk.scream.windupMs
    } else if (this.phase >= 3 && dist < spitRange) {
      this.action = 'spit-windup'
      this.actionUntil = now + (spit?.windupMs ?? 600)
      this.spawnChargeGlow('#B36BFF')
    } else {
      // Игрок далеко и не в фазе плевка — Матка ждёт (выводок работает).
      this.nextActionReadyAt = now + 400
    }
  }

  private releaseAction(now: number, ctx: EnemyContext): void {
    const atk = QUEEN.attacks
    const dist = Phaser.Math.Distance.Between(this.x, this.y, ctx.playerX, ctx.playerY)

    if (this.action === 'swipe-windup') {
      // Размах: дуга перед Маткой (чуть шире радиуса входа — свип честный).
      const dx = ctx.playerX - this.x
      const dy = ctx.playerY - this.y
      const facing = this.flipX ? -1 : 1
      const inArc = dx * facing > -24
        && Math.abs(Phaser.Math.RadToDeg(Math.atan2(dy, dx * facing))) < atk.swipe.arcDeg / 2
      if (inArc && dist < atk.swipe.range + 28) {
        this.hooks.onSwipe(this, Math.round(atk.swipe.damage * this.dmgMult))
      }
      this.afterAction(now, 700)
    } else if (this.action === 'scream-windup') {
      this.screamFx.clear()
      this.hooks.onScream(this, Math.round(atk.scream.damage * this.dmgMult), atk.scream.radius)
      this.afterAction(now, 900)
    } else if (this.action === 'spit-windup') {
      this.hooks.onSpit(this, ctx.playerX, ctx.playerY)
      const spit = this.species.attack
      this.afterAction(now, spit && spit.type === 'shoot' ? spit.cooldownMs : 2000)
    } else {
      this.action = 'idle'
    }
  }

  /** Откат: короткая передышка + пауза темпа фазы. */
  private afterAction(now: number, recoverMs: number): void {
    this.action = 'recover'
    this.actionUntil = now + recoverMs
    this.nextActionReadyAt = now + recoverMs + QUEEN.phases.actionGapMs[this.phase - 1]
    this.destroyChargeGlow()
  }

  /** Телеграфы (гайд: замах 0.3–0.6 с с подсветкой — у босса читаемо ВСЁ). */
  private drawTelegraph(now: number): void {
    if (this.action === 'scream-windup') {
      const atk = QUEEN.attacks.scream
      const total = atk.windupMs
      const p = Phaser.Math.Clamp(1 - (this.actionUntil - now) / total, 0, 1)
      const g = this.screamFx
      g.clear()
      const pulse = 0.4 + 0.6 * Math.abs(Math.sin(now / 80))
      const r = 30 + p * atk.radius
      g.lineStyle(2.4, 0xe23a4e, 0.3 + pulse * 0.55)
      g.strokeCircle(this.x, this.y, r)
      g.lineStyle(1.2, 0xff8a94, 0.25)
      g.strokeCircle(this.x, this.y, r * 0.66)
      return
    }
    if (this.action === 'spit-windup') {
      const spit = this.species.attack
      const total = spit?.windupMs ?? 600
      const p = Phaser.Math.Clamp(1 - (this.actionUntil - now) / total, 0, 1)
      const g = this.screamFx
      g.clear()
      const pulse = 0.4 + 0.6 * Math.abs(Math.sin(now / 80))
      g.lineStyle(1.8, 0xb36bff, 0.3 + pulse * 0.5)
      g.strokeCircle(this.x, this.y - this.displayHeight * 0.22, 16 + p * 14)
    }
  }

  /** Заряд-сияние атаки (багровое — размах, лиловое — плевок). */
  private spawnChargeGlow(color: string): void {
    this.destroyChargeGlow()
    const glow = color === '#E23A4E' ? 'glow-red' : 'glow-purple'
    this.chargeGlow = this.scene.add.image(this.x, this.y, glow)
      .setDepth(LIGHT.halo.depth)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.2)
      .setScale(1)
    this.scene.tweens.add({
      targets: this.chargeGlow,
      alpha: { from: 0.18, to: 0.55 },
      scale: { from: 0.8, to: 2 },
      duration: 420,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })
  }

  private destroyChargeGlow(): void {
    if (this.chargeGlow) {
      this.scene.tweens.killTweensOf(this.chargeGlow)
      this.chargeGlow.destroy()
      this.chargeGlow = null
    }
  }

  /**
   * Урон по Матке: своя реализация (босс не бегает, не станится, не
   * паникует — только вспышка и HP). Смерть уходит в onVictory сцены
   * (спец-последовательность, НЕ туша).
   */
  override takeDamage(
    amount: number,
    _knockDirX: number,
    _stunMs = 0,
    dmgType: DamageType = 'physical',
    killer: KillerKind = 'player',
    _from?: Enemy,
    opts?: { knockForce?: number; resistMult?: number },
  ): number {
    if (this.dead) return 0
    const resist = Math.max(0, armorResist(this.species, dmgType) * (opts?.resistMult ?? 1))
    const applied = Math.max(1, Math.round(amount * (1 - resist)))
    this.hp -= applied

    if (this.hp <= 0) {
      this.dead = true
      this.stateName = 'dead'
      this.activated = true
      this.screamFx.clear()
      this.clearWindupFx()
      this.destroyChargeGlow()
      this.hooks.onVictory(this, killer)
      return applied
    }

    // Босс-стойкость: только вспышка урона.
    this.setTintFill(0xffffff)
    this.scene.time.delayedCall(70, () => {
      if (!this.dead && !this.challenger) this.clearTint()
      else if (!this.dead) this.setTint(0xd8b8ff)
    })
    return applied
  }

  /** Туша рушится (вызывает сцена в спец-последовательности победы). */
  collapseVisual(ms: number): void {
    this.scene.tweens.killTweensOf(this)
    this.scene.tweens.add({
      targets: this,
      scaleY: QUEEN.stats.scale * 0.22,
      scaleX: QUEEN.stats.scale * 1.18,
      angle: Phaser.Math.Between(-8, 8),
      duration: ms,
      ease: 'Quad.In',
    })
  }

  override destroy(fromScene?: boolean): void {
    this.screamFx.destroy()
    this.destroyChargeGlow()
    super.destroy(fromScene)
  }

  /** Служебное: вид босса для бестиария/UI. */
  get title(): string {
    return this.challenger ? `Узурпатор «${this.challenger.name}»` : ENEMIES.species.queen.name
  }
}
