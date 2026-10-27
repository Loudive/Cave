import Phaser from 'phaser'
import { MOVEMENT } from '../config/movement'
import { BALANCE } from '../config/balance'

/**
 * Состояние существа — показывается в debug-оверлее (шаг 3).
 */
export type CreatureState =
  | 'ground'      // стоит/бежит по полу
  | 'jump'        // поднимается после прыжка
  | 'fall'        // падает
  | 'wall-slide'  // скользит по стене
  | 'glide'       // планирует (удержание вверх)
  | 'wall-lock'   // инерция после wall jump (ввод по горизонтали отключён)

export interface CreatureKeys {
  /** Клавиши влево (A + стрелка). */
  left: Phaser.Input.Keyboard.Key[]
  /** Клавиши вправо (D + стрелка). */
  right: Phaser.Input.Keyboard.Key[]
  /** Вверх: удержание в воздухе = планирование (W + стрелка). */
  glide: Phaser.Input.Keyboard.Key[]
  /** Прыжок: пробел. */
  jump: Phaser.Input.Keyboard.Key
}

/** Двигает value к target не быстрее maxDelta (аналог Unity Mathf.MoveTowards). */
function moveToward(value: number, target: number, maxDelta: number): number {
  if (Math.abs(target - value) <= maxDelta) return target
  return value + Math.sign(target - value) * maxDelta
}

/**
 * Creature — контроллер существа, «душа игры» (шаг 3).
 * Arcade Physics: бег с ускорением/трением, прыжок с coyote time и
 * jump buffering, переменная высота прыжка, wall slide, wall jump,
 * планирование (удержание вверх). Все числа — в movement.json.
 *
 * Один класс = один файл (правило вайбкодинга). Графика не важна:
 * геймпад-фил важнее спрайтов.
 */
export class Creature extends Phaser.Physics.Arcade.Sprite {
  private keys: CreatureKeys

  /** Модификаторы мутаций (шаг 6): сцепление и воздушные прыжки. */
  public mods = { wallSlideMult: 1, airJumps: 0 }
  private airJumpsLeft = 0

  /** Последнее горизонтальное направление взгляда (1 правый, −1 левый). */
  private facingDir: 1 | -1 = 1

  /** Визуальный рост (Vitals.bodyScale) — твины укуса считаются от него. */
  private growthScale = 1

  /** Сцена подписывается: фиолетовый выброс спор на воздушном прыжке. */
  onAirJump: (() => void) | null = null

  // Таймеры состояния (мс, отсчёт от scene.time.now).
  private lastOnFloorAt = -Infinity
  private lastJumpPressedAt = -Infinity
  private wallLockUntil = -Infinity
  // Переменная высота прыжка: срез применяется один раз за прыжок.
  private jumpCutDone = true

  // Направление активной стены: -1 левая, 1 правая, 0 нет.
  private wallDir = 0

  private stateName: CreatureState = 'fall'

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    keys: CreatureKeys,
  ) {
    super(scene, x, y, 'player')
    scene.add.existing(this)
    scene.physics.add.existing(this)

    this.keys = keys
    this.setCollideWorldBounds(false)
    this.setMaxVelocity(MOVEMENT.run.runMaxSpeed, MOVEMENT.terminalVelocity)
    this.setDrag(0, 0)
    this.setDepth(3)
    this.setName('player')
  }

  /** Направление взгляда: куда был последний ввод по горизонтали. */
  get facing(): 1 | -1 {
    return this.facingDir
  }

  /** Применить визуальный рост (Vitals.level → bodyScale). */
  applyGrowth(scale: number): void {
    this.growthScale = scale
    this.setScale(scale)
  }

  /** Вызывать из scene.update(time, delta) каждый кадр. */
  override update(_time: number, delta: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body
    const now = this.scene.time.now
    const dt = delta / 1000

    this.readWalls(body)
    this.handleTimers(body, now)

    this.horizontalControl(body, dt)
    this.jumpLogic(body, now)
    this.airLogic(body, dt)

    this.updateStateName(body)
  }

  /** Текущее состояние — для debug-оверлея. */
  getState(): CreatureState {
    return this.stateName
  }

  /** Сколько мс осталось у coyote-окна (для оверлея). */
  coyoteLeft(now: number): number {
    return Math.max(0, MOVEMENT.jump.coyoteTime - (now - this.lastOnFloorAt))
  }

  /** Сколько мс осталось у буфера прыжка (для оверлея). */
  jumpBufferLeft(now: number): number {
    return Math.max(0, MOVEMENT.jump.jumpBuffer - (now - this.lastJumpPressedAt))
  }

  /** Направление активной стены: -1 левая, 1 правая, 0 нет. */
  get wallSide(): number {
    return this.wallDir
  }

  get onFloor(): boolean {
    const body = this.body as Phaser.Physics.Arcade.Body
    return body.blocked.down || body.touching.down
  }

  // ── Внутренняя механика ────────────────────────────────────────────────

  private readWalls(body: Phaser.Physics.Arcade.Body): void {
    const pushingLeft = this.down(this.keys.left)
    const pushingRight = this.down(this.keys.right)
    const againstLeftWall = body.blocked.left && pushingLeft
    const againstRightWall = body.blocked.right && pushingRight
    this.wallDir = againstLeftWall ? -1 : againstRightWall ? 1 : 0
  }

  private handleTimers(body: Phaser.Physics.Arcade.Body, now: number): void {
    if (body.blocked.down) this.lastOnFloorAt = now

    const jumpJustPressed = Phaser.Input.Keyboard.JustDown(this.keys.jump)
    if (jumpJustPressed) this.lastJumpPressedAt = now
  }

  private horizontalControl(body: Phaser.Physics.Arcade.Body, dt: number): void {
    const cfg = MOVEMENT.run
    const inAir = !body.blocked.down
    const locked = this.scene.time.now < this.wallLockUntil

    // После wall jump ввод по горизонтали отключён, пока не выйдет lockTime.
    if (locked) return

    const accel = inAir ? cfg.runAccel * cfg.airControl : cfg.runAccel
    const dir = (this.down(this.keys.right) ? 1 : 0) - (this.down(this.keys.left) ? 1 : 0)
    if (dir !== 0) this.facingDir = dir as 1 | -1

    if (dir !== 0) {
      body.velocity.x = moveToward(body.velocity.x, dir * cfg.runMaxSpeed, accel * dt)
    } else {
      // Трение: к нулю за счёт runFriction (в воздухе — слабее, airControl).
      const fr = (inAir ? cfg.runFriction * cfg.airControl : cfg.runFriction) * dt
      body.velocity.x = moveToward(body.velocity.x, 0, fr)
    }
  }

  private jumpLogic(body: Phaser.Physics.Arcade.Body, now: number): void {
    const jump = MOVEMENT.jump
    const wall = MOVEMENT.wall
    const canGround = now - this.lastOnFloorAt <= jump.coyoteTime
    const buffered = this.jumpBufferLeft(now) > 0

    if (!buffered) return

    // 1) Обычный прыжок (в том числе coyote — сход с края).
    if (canGround) {
      body.velocity.y = jump.jumpVelocity
      this.lastOnFloorAt = -Infinity
      this.lastJumpPressedAt = -Infinity
      this.jumpCutDone = false
      this.airJumpsLeft = this.mods.airJumps
      return
    }

    // 2) Wall jump — от любой стены, даже в падении.
    if (this.wallDir !== 0) {
      body.velocity.y = wall.wallJumpVelocityY
      body.velocity.x = -this.wallDir * wall.wallJumpVelocityX
      this.wallLockUntil = now + wall.wallLockTime
      this.lastJumpPressedAt = -Infinity
      this.jumpCutDone = false
      this.airJumpsLeft = this.mods.airJumps
      return
    }

    // 3) Мутация «Сгусток-прыгун»: двойной прыжок на кровавой пружине.
    if (this.airJumpsLeft > 0) {
      this.airJumpsLeft--
      body.velocity.y = jump.jumpVelocity * 0.92
      this.lastJumpPressedAt = -Infinity
      this.jumpCutDone = false
      this.onAirJump?.()
    }
  }

  private airLogic(body: Phaser.Physics.Arcade.Body, dt: number): void {
    const jump = MOVEMENT.jump
    const wall = MOVEMENT.wall
    const glide = MOVEMENT.glide

    // Переменная высота: ранний отпуск прыжка один раз гасит подъём.
    if (body.velocity.y < 0 && !this.keys.jump.isDown && !this.jumpCutDone) {
      body.velocity.y *= jump.jumpCutMultiplier
      this.jumpCutDone = true
    }

    const rising = body.velocity.y < 0
    const onWall = this.wallDir !== 0 && !body.blocked.down

    // Wall slide: тянемся к стене и падаем — замедляем падение
    // (мутация «Липкая кровь» умножает потолок падения).
    if (onWall && !rising && body.velocity.y > wall.wallSlideMaxFall * this.mods.wallSlideMult) {
      body.velocity.y = wall.wallSlideMaxFall * this.mods.wallSlideMult
    }

    // Планирование: удержание вверх в падении — плавный тормоз до потолка.
    if (
      !rising && !onWall
      && this.down(this.keys.glide)
      && body.velocity.y > glide.glideFallSpeed
    ) {
      body.velocity.y = moveToward(body.velocity.y, glide.glideFallSpeed, glide.glideBrake * dt)
    }
  }

  // ── Визуальные хуки шага 6 (укус, урон, чавканье) ─────────────────────

  /** Замах: существо приседает и сжимается — телеграф укуса. */
  biteWindupVisual(): void {
    this.scene.tweens.killTweensOf(this)
    this.scene.tweens.add({
      targets: this,
      scaleX: this.growthScale * 0.88,
      scaleY: this.growthScale * 1.1,
      duration: BALANCE.player.biteWindupMs,
      ease: 'Quad.In',
    })
  }

  /** Выпад: разжатие с перерастяжением — бросок в жертву. */
  biteActiveVisual(): void {
    this.scene.tweens.killTweensOf(this)
    this.scene.tweens.add({
      targets: this,
      scaleX: this.growthScale * 1.3,
      scaleY: this.growthScale * 0.78,
      duration: 70,
      yoyo: true,
      ease: 'Quad.Out',
      onComplete: () => this.setScale(this.growthScale),
    })
  }

  /** Чавканье: довольное сжатие. */
  chewVisual(): void {
    this.scene.tweens.killTweensOf(this)
    this.scene.tweens.add({
      targets: this,
      scaleX: this.growthScale * 1.12,
      scaleY: this.growthScale * 0.9,
      duration: 90,
      yoyo: true,
      ease: 'Sine.InOut',
      onComplete: () => this.setScale(this.growthScale),
    })
  }

  /** Урон: мигание на время неуязвимости. */
  hurtVisual(ms: number): void {
    this.scene.tweens.killTweensOf(this)
    this.setScale(this.growthScale)
    this.scene.tweens.add({
      targets: this,
      alpha: 0.35,
      duration: 70,
      yoyo: true,
      repeat: Math.ceil(ms / 140),
      onComplete: () => this.setAlpha(1),
    })
  }

  private down(keys: Phaser.Input.Keyboard.Key[]): boolean {
    return keys.some((k) => k.isDown)
  }

  private updateStateName(body: Phaser.Physics.Arcade.Body): void {
    const now = this.scene.time.now
    if (body.blocked.down) {
      this.stateName = 'ground'
    } else if (now < this.wallLockUntil) {
      this.stateName = 'wall-lock'
    } else if (this.wallDir !== 0 && body.velocity.y > 0) {
      this.stateName = 'wall-slide'
    } else if (
      this.down(this.keys.glide)
      && !body.blocked.down
      && body.velocity.y >= MOVEMENT.glide.glideFallSpeed
    ) {
      this.stateName = 'glide'
    } else if (body.velocity.y < 0) {
      this.stateName = 'jump'
    } else {
      this.stateName = 'fall'
    }
  }
}
