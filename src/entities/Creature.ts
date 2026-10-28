import Phaser from 'phaser'
import { MOVEMENT } from '../config/movement'
import { BALANCE } from '../config/balance'
import { ANIMS } from '../config/anims'

/**
 * Состояние существа — показывается в debug-оверлее (шаг 3).
 */
export type CreatureState =
  | 'ground'      // стоит/бежит по полу
  | 'jump'        // поднимается после прыжка
  | 'fall'        // падает
  | 'wall-slide'  // скользит по стене (быстрый подъём у стены)
  | 'wall-cling'  // шаг 12: зацепился — висит/ползёт по стене
  | 'glide'       // планирует (удержание вверх)
  | 'wall-lock'   // инерция после wall jump (ввод по горизонтали отключён)

export interface CreatureKeys {
  /** Клавиши влево (A + стрелка). */
  left: Phaser.Input.Keyboard.Key[]
  /** Клавиши вправо (D + стрелка). */
  right: Phaser.Input.Keyboard.Key[]
  /** Вверх: удержание в воздухе = планирование (W + стрелка), на стене — ползти вверх. */
  glide: Phaser.Input.Keyboard.Key[]
  /** Шаг 12: вниз (S + стрелка) — ползти вниз по стене. */
  down: Phaser.Input.Keyboard.Key[]
  /** Прыжок: пробел. */
  jump: Phaser.Input.Keyboard.Key
}

/** Двигает value к target не быстрее maxDelta (аналог Unity Mathf.MoveTowards). */
function moveToward(value: number, target: number, maxDelta: number): number {
  if (Math.abs(target - value) <= maxDelta) return target
  return value + Math.sign(target - value) * maxDelta
}

/**
 * Шаг 11: тело существа внутри кадра 68×46. w/h — прежний хитбокс 28×28;
 * смещение прижато к лапам (низ кадра − 2px), чтобы мышь не «тонула» в полу.
 * Числа вынесены — иначе магические литералы в физике (правило проекта).
 */
const CREATURE_BODY = { w: 28, h: 28, ox: 20, oy: 16 } as const

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

  /**
   * Модификаторы мутаций (шаг 6) и Гнезда (шаг 11): сцепление, воздушные
   * прыжки, скорость, прыжок, управление в воздухе, планирование.
   */
  public mods = {
    wallSlideMult: 1,
    airJumps: 0,
    /** Гнездо (шаг 11): множители передвижения (все нейтральны по умолчанию). */
    speedMult: 1,
    jumpMult: 1,
    airControlMult: 1,
    /** Потолок скорости планирования: <1 — падает медленнее (перепонки). */
    glideFallMult: 1,
    /** Сохранение горизонтали в планировании: >1 — дольше скользит. */
    glideDriftMult: 1,
  }
  private airJumpsLeft = 0

  /** Споровая пыль (шаг 7): до этого времени бег замедлен (BALANCE.spore). */
  public slowUntil = 0

  /** Шаг 8 «Кровавый напор»: множитель скорости бега до этого времени. */
  public speedBuffUntil = 0
  public speedBuffMult = 1

  /** Шаг 8 «Споровый вдох»: сцена помечает зоны Грибных полян. */
  public sporeBreathZone = false

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

  // ── Шаг 12: карабканье по стенам ────────────────────────────────
  /** Зацепился за стену: гравитация выключена, ползёт когтями. */
  private clinging = false
  /** Сторона зацепа: -1 левая стена, 1 правая. */
  private clingDir: 1 | -1 = 1
  /** С какого мс держится ввод ОТ стены (отцепление по unstickMs). */
  private unstickSince = -Infinity

  // Шаг 11: кадры укуса/урона держатся до этого времени (мс сцены).
  private hurtTexUntil = -Infinity

  // Шаг 11 (переработка): сцена помечает — сейчас идёт поедание туши
  // (Eating.isChewing): на земле вместо idle/run играется hero-eat.
  public isEating = false

  // Шаг 11 (переработка): играется одноразовая анимация смерти —
  // состояние её не перебивает до скрытия спрайта сценой.
  private deathPlaying = false

  // Направление активной стены: -1 левая, 1 правая, 0 нет.
  private wallDir = 0

  private stateName: CreatureState = 'fall'

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    keys: CreatureKeys,
  ) {
    super(scene, x, y, 'hero-idle')
    scene.add.existing(this)
    scene.physics.add.existing(this)

    this.keys = keys
    this.setCollideWorldBounds(false)
    this.setMaxVelocity(MOVEMENT.run.runMaxSpeed, MOVEMENT.terminalVelocity)
    this.setDrag(0, 0)
    this.setDepth(3)
    this.setName('player')
    // Шаг 11: герой теперь летучая мышь (кадры 68×46). Физическое тело
    // остаётся прежним 28×28 — выровнено по лапам, чтобы не менять геймплей:
    // крылья/уши не считаются хитбоксом (щедро к игроку).
    const body = this.body as Phaser.Physics.Arcade.Body
    body.setSize(CREATURE_BODY.w, CREATURE_BODY.h, true)
    body.setOffset(CREATURE_BODY.ox, CREATURE_BODY.oy)
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

    // Шаг 12: цепляние — до обычной воздушной логики (она выключена
    // пока висим на стене: гравитация_off, скорость задаём сами).
    if (this.clinging) {
      this.clingLogic(body, now, dt)
    } else {
      this.horizontalControl(body, dt)
      this.tryLatch(body, now)
    }
    this.jumpLogic(body, now)
    if (!this.clinging) this.airLogic(body, dt)

    this.updateStateName(body)
    this.updateVisuals(body)
  }

  /**
   * Шаг 11 (переработка): полная анимационная цепочка. Приоритет:
   * укус (играет до конца) > смерть > урон > поедание > планирование >
   * прыжок/падение (статичный кадр раскрытых крыльев) > бег > idle.
   * play(key, true) — не перезапускать уже играющую (анти-джиттер).
   */
  private updateVisuals(body: Phaser.Physics.Arcade.Body): void {
    const now = this.scene.time.now
    this.setFlipX(this.facingDir < 0)
    // Банк в воздухе: падение клюёт носом, подъём задирает морду —
    // дешёвая кодовая анимация поверх кадров (продаёт движение).
    // На сцепе (шаг 12) — наклон к стене когтями: монстр «обнимает» её.
    if (this.stateName === 'ground') this.setRotation(0)
    else if (this.stateName === 'wall-cling') this.setRotation(this.clingDir * MOVEMENT.climb.clingTiltRad)
    else this.setRotation(Phaser.Math.Clamp(body.velocity.y / 1200, -0.12, 0.22))

    // Одноразовые анимации не перебиваются состоянием: укус играет
    // от первого кадра замаха до конца (≈ windup+active из balance.json),
    // смерть — до скрытия спрайта.
    if (this.deathPlaying) return
    if (this.anims.currentAnim?.key === 'hero-bite' && this.anims.isPlaying) return

    if (now < this.hurtTexUntil) {
      this.play('hero-hurt', true)
    } else if (this.isEating && this.stateName === 'ground') {
      this.play('hero-eat', true)
    } else if (this.stateName === 'glide') {
      this.play('hero-glide', true)
    } else if (this.stateName === 'wall-cling') {
      // На стене крылья сложены, лапы растопырены — кадр полёта без маха.
      this.anims.stop()
      this.setTexture('hero-glide')
      this.setFrame(ANIMS.airborneFrame)
    } else if (
      this.stateName === 'jump'
      || this.stateName === 'fall'
      || this.stateName === 'wall-slide'
      || this.stateName === 'wall-lock'
    ) {
      // В воздухе крылья раскрыты (статичный кадр полёта без маха).
      this.anims.stop()
      this.setTexture('hero-glide')
      this.setFrame(ANIMS.airborneFrame)
    } else if (this.stateName === 'ground' && Math.abs(body.velocity.x) > 20) {
      this.play('hero-run', true)
    } else {
      this.play('hero-idle', true)
    }
  }

  /**
   * Шаг 11 (переработка): смерть — одноразовая анимация hero-death
   * (6 кадров, кадр замирает на последнем). Сцена скрывает спрайт через
   * ANIMS.death.hideAfterMs и оставляет кровавые декали.
   */
  /** Смерть с любого состояния: отцепиться от стены (гравитация назад). */
  playDeathVisual(): void {
    this.forceUncling()
    this.deathPlaying = true
    this.anims.stop()
    this.setRotation(0)
    this.play('hero-death')
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
    // Шаг 12: контакт со стеной — блокировка ИЛИ касание (без требования
    // нажатия в сторону стены: цепляемся «с прыжка», просто коснувшись).
    const touchLeft = body.blocked.left || body.touching.left
    const touchRight = body.blocked.right || body.touching.right
    this.wallDir = touchLeft ? -1 : touchRight ? 1 : 0
  }

  // ── Шаг 12: карабканье (цепляние + ползание) ─────────────────────

  /**
   * Условия зацепа: в воздухе, стена рядом, НЕ сразу после wall jump
   * (wallLock — иначе прилипнет обратно) и не на взлёте быстрее
   * latchMaxRiseSpeed (не липнем в разгаре прыжка — флоу прыжков).
   */
  private tryLatch(body: Phaser.Physics.Arcade.Body, now: number): void {
    if (body.blocked.down) return
    if (this.wallDir === 0) return
    if (now < this.wallLockUntil) return
    if (body.velocity.y < -MOVEMENT.climb.latchMaxRiseSpeed) return
    this.clinging = true
    this.clingDir = this.wallDir as 1 | -1
    this.unstickSince = -Infinity
    // Цепляемся: гасим вертикаль, но СРАЗУ прижимаемся к стене —
    // если обнулить и горизонталь, следующий физ-шаг пройдёт без
    // контакта, clingLogic решит «стены нет» и отцепит обратно
    // (гонка поймана в верификации, шаг 12).
    body.velocity.set(this.clingDir * MOVEMENT.climb.clingPressSpeed, 0)
    body.setAllowGravity(false)
    this.facingDir = this.clingDir
  }

  /** Ползание по стене: вверх/вниз, отцепление вводом от стены или полом. */
  private clingLogic(body: Phaser.Physics.Arcade.Body, now: number, dt: number): void {
    const climb = MOVEMENT.climb
    // Стена кончилась (выползли за край) или стоим — отцепиться.
    const stillOnWall = body.blocked.left || body.touching.left
      ? -1
      : body.blocked.right || body.touching.right ? 1 : 0
    if (stillOnWall === 0 || body.blocked.down) {
      this.uncling(body)
      return
    }
    this.clingDir = stillOnWall as 1 | -1
    this.wallDir = stillOnWall

    // Ввод ОТ стены дольше unstickMs — сознательно отцепиться.
    const away = this.clingDir === 1 ? this.down(this.keys.left) : this.down(this.keys.right)
    if (away) {
      if (this.unstickSince === -Infinity) this.unstickSince = now
      if (now - this.unstickSince >= climb.unstickMs) {
        this.uncling(body)
        // Лёгкий толчок от стены — не прилипнем обратно на следующем кадре.
        body.velocity.x = -this.clingDir * MOVEMENT.run.runMaxSpeed * 0.35
        return
      }
    } else {
      this.unstickSince = -Infinity
    }

    // Ползание: «Липкие когти» (wallSlideMult<1) — быстрее вверх, медленней вниз.
    const sticky = this.mods.wallSlideMult
    const upHeld = this.down(this.keys.glide)
    const downHeld = this.down(this.keys.down)
    let targetVy = 0
    if (upHeld && !body.blocked.up) targetVy = -climb.climbUpSpeed * (2 - sticky)
    else if (downHeld) targetVy = climb.climbDownSpeed * sticky
    body.velocity.y = moveToward(body.velocity.y, targetVy, climb.crawlAccel * dt)
    // Прижим к стене: флаги blocked/touching гаснут каждый физ-шаг без
    // контакта — без прижима сцеп бы рвался на втором же кадре.
    body.velocity.x = this.clingDir * climb.clingPressSpeed
    // Морда — к стене.
    this.facingDir = this.clingDir
  }

  /** Отцепиться: вернуть гравитацию, выйти из состояния цепляния. */
  private uncling(body: Phaser.Physics.Arcade.Body): void {
    if (!this.clinging) return
    this.clinging = false
    body.setAllowGravity(true)
  }

  /** Публичное отцепление (урон со стены, смерть, телепорт). */
  forceUncling(): void {
    const body = this.body as Phaser.Physics.Arcade.Body
    this.uncling(body)
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

    const accel = inAir ? cfg.runAccel * cfg.airControl * this.mods.airControlMult : cfg.runAccel
    const dir = (this.down(this.keys.right) ? 1 : 0) - (this.down(this.keys.left) ? 1 : 0)
    if (dir !== 0) this.facingDir = dir as 1 | -1

    // Споровая пыль (шаг 7): и разгон, и потолок скорости режутся.
    const slowed = this.scene.time.now < this.slowUntil
    const slowK = slowed ? 1 - BALANCE.spore.slowFactor : 1
    // «Кровавый напор» (шаг 8): временный множитель скорости.
    const rush = this.scene.time.now < this.speedBuffUntil ? this.speedBuffMult : 1

    if (dir !== 0) {
      body.velocity.x = moveToward(body.velocity.x, dir * cfg.runMaxSpeed * slowK * rush * this.mods.speedMult, accel * slowK * dt)
    } else {
      // Трение: к нулю за счёт runFriction (в воздухе — слабее, airControl).
      // В планировании перипонки несут: трение слабже (дрейф, шаг 11).
      const gliding = this.stateName === 'glide'
      const drift = gliding ? 1 / this.mods.glideDriftMult : 1
      const fr = (inAir ? cfg.runFriction * cfg.airControl : cfg.runFriction) * dt * drift
      body.velocity.x = moveToward(body.velocity.x, 0, fr)
    }
  }

  private jumpLogic(body: Phaser.Physics.Arcade.Body, now: number): void {
    // «Споровый вдох» (шаг 8): на Грибных полянах заряд воздушного
    // прыжка восстанавливается, пока стоишь на земле.
    if (this.sporeBreathZone && body.blocked.down && this.mods.airJumps > 0) {
      this.airJumpsLeft = this.mods.airJumps
    }
    const jump = MOVEMENT.jump
    const wall = MOVEMENT.wall
    const canGround = now - this.lastOnFloorAt <= jump.coyoteTime
    const buffered = this.jumpBufferLeft(now) > 0

    if (!buffered) return

    // 1) Обычный прыжок (в том числе coyote — сход с края).
    if (canGround) {
      body.velocity.y = jump.jumpVelocity * this.mods.jumpMult
      this.lastOnFloorAt = -Infinity
      this.lastJumpPressedAt = -Infinity
      this.jumpCutDone = false
      this.airJumpsLeft = this.mods.airJumps
      this.uncling(body)
      return
    }

    // 2) Wall jump — от любой стены, даже в падении (и со сцепа: шаг 12).
    if (this.wallDir !== 0) {
      this.uncling(body)
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

    // Планирование: удержание вверх в падении — плавный тормоз до потолка
    // (перепонки Гнезда, шаг 11, снижают потолок и добавляют дрейф).
    if (
      !rising && !onWall
      && this.down(this.keys.glide)
      && body.velocity.y > glide.glideFallSpeed * this.mods.glideFallMult
    ) {
      body.velocity.y = moveToward(
        body.velocity.y,
        glide.glideFallSpeed * this.mods.glideFallMult,
        glide.glideBrake * dt,
      )
    }
  }

  // ── Визуальные хуки шага 6 (укус, урон, чавканье) ─────────────────────

  /** Замах: анимация укуса с первого кадра + присед-телеграф твином. */
  biteWindupVisual(): void {
    // Кадры 0–1 (18 к/с ≈ biteWindupMs) — замах; 2–3 — выпад.
    this.play('hero-bite')
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

  /** Урон: мигание на время неуязвимости + кадр боли. */
  hurtVisual(ms: number): void {
    this.hurtTexUntil = this.scene.time.now + 220
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
    } else if (this.clinging) {
      this.stateName = 'wall-cling'
    } else if (now < this.wallLockUntil) {
      this.stateName = 'wall-lock'
    } else if (this.wallDir !== 0 && body.velocity.y > 0) {
      this.stateName = 'wall-slide'
    } else if (
      this.down(this.keys.glide)
      && !body.blocked.down
      && body.velocity.y >= MOVEMENT.glide.glideFallSpeed * this.mods.glideFallMult
    ) {
      this.stateName = 'glide'
    } else if (body.velocity.y < 0) {
      this.stateName = 'jump'
    } else {
      this.stateName = 'fall'
    }
  }
}
