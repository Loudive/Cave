import Phaser from 'phaser'
import { MOVEMENT } from '../config/movement'
import { Creature, CreatureKeys } from '../entities/Creature'
import { DebugOverlay } from '../systems/DebugOverlay'

/**
 * CaveScene — шаг 3: полигон контроллера существа.
 * Сайд-вью с гравитацией: тестовый уровень для проверки бега, прыжков
 * (coyote time + jump buffer), wall slide/wall jump и планирования.
 * Ничего «игрового» пока нет — геймпад-фил важнее контента.
 * Управление: A/D (стрелки) — бег, Space — прыжок, W (вверх) — планирование.
 */

/** Прямоугольная платформа: x, y — левый верхний угол, w×h — размер. */
interface PlatformRect {
  x: number
  y: number
  w: number
  h: number
  tex: 'tile-floor' | 'tile-wall'
}

export class CaveScene extends Phaser.Scene {
  private creature!: Creature
  private creatureGlow!: Phaser.GameObjects.Image
  private debug!: DebugOverlay
  private solidsGroup!: Phaser.Physics.Arcade.StaticGroup
  private spawn = { x: 300, y: 880 }

  private readonly worldW = 2600
  private readonly worldH = 1600

  constructor() {
    super('Cave')
  }

  create(): void {
    const { width, height } = this.scale
    // Горизонтальные границы мира — стены, но низ открыт: пропасть → респавн.
    this.physics.world.setBounds(0, 0, this.worldW, this.worldH, true, true, false, false)
    this.physics.world.gravity.y = MOVEMENT.gravity
    this.cameras.main.setBounds(0, 0, this.worldW, this.worldH)
    this.cameras.main.fadeIn(500, 4, 4, 8)

    this.buildDecor()
    this.buildLevel()

    // Существо: A/D или стрелки — бег, Space — прыжок, W/вверх — планирование.
    const kb = this.input.keyboard!
    const keys: CreatureKeys = {
      left: [
        kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      ],
      right: [
        kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      ],
      glide: [
        kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      ],
      jump: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
    }

    this.creature = new Creature(this, this.spawn.x, this.spawn.y, keys)
    this.physics.add.collider(this.creature, this.solidsGroup)
    this.creatureGlow = this.add.image(this.spawn.x, this.spawn.y, 'glow-cyan')
      .setScale(1.7)
      .setAlpha(0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(2)

    this.tweens.add({
      targets: this.creatureGlow,
      scale: { from: 1.5, to: 1.9 },
      alpha: { from: 0.38, to: 0.6 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })

    this.cameras.main.startFollow(this.creature, true, 0.09, 0.09)

    kb.on('keydown-ESC', () => {
      this.cameras.main.fadeOut(220, 4, 4, 8)
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('Menu')
      })
    })

    this.debug = new DebugOverlay(this, this.creature)

    // Виньетка + подсказка — приколочены к камере.
    this.add.image(width / 2, height / 2, 'vignette')
      .setDisplaySize(width * 1.15, height * 1.15)
      .setScrollFactor(0)
      .setDepth(10)

    this.add.text(16, height - 14,
      'A/D — бег · SPACE — прыжок · W — планирование · ESC — меню · F3 — debug',
      { fontFamily: 'monospace', fontSize: '12px', color: '#8A8894' },
    )
      .setScrollFactor(0)
      .setOrigin(0, 1)
      .setDepth(11)
      .setAlpha(0.8)
  }

  private buildDecor(): void {
    // Дальние камни-силуэты по всей пещере.
    for (let i = 0; i < 40; i++) {
      this.add.image(
        Phaser.Math.Between(0, this.worldW),
        Phaser.Math.Between(0, this.worldH),
        'rock',
      )
        .setAlpha(Phaser.Math.FloatBetween(0.18, 0.45))
        .setAngle(Phaser.Math.Between(0, 360))
        .setScale(Phaser.Math.FloatBetween(0.8, 2.6))
        .setDepth(0)
    }
  }

  override update(time: number, delta: number): void {
    this.creature.update(time, delta)
    this.debug.update(this)

    this.creatureGlow.setPosition(this.creature.x, this.creature.y)

    // Бездна: существо тонет — возвращаем на точку входа.
    if (this.creature.y > MOVEMENT.respawnFallY) {
      this.creature.setPosition(this.spawn.x, this.spawn.y)
      const body = this.creature.body as Phaser.Physics.Arcade.Body
      body.velocity.set(0)
      this.cameras.main.flash(300, 88, 230, 200)
    }
  }

  /** Физические платформы (tileSprite + статическое тело) и грибы-маяки. */
  private buildLevel(): void {
    const level: PlatformRect[] = [
      // Стартовая площадка.
      { x: 0, y: 900, w: 900, h: 700, tex: 'tile-floor' },
      // Разрыв-пропасть (падение → респавн), потом длинный пол.
      { x: 1100, y: 900, w: 1500, h: 700, tex: 'tile-floor' },
      // Ступени вверх (проверка прыжков и coyote на краях).
      { x: 980, y: 760, w: 240, h: 60, tex: 'tile-floor' },
      { x: 1320, y: 620, w: 240, h: 60, tex: 'tile-floor' },
      { x: 1660, y: 480, w: 240, h: 60, tex: 'tile-floor' },
      // Шахта: две стены для wall jump (внизу пол, наверху выход).
      { x: 2080, y: 320, w: 80, h: 620, tex: 'tile-wall' },
      { x: 2360, y: 320, w: 80, h: 620, tex: 'tile-wall' },
      // Высокая площадка справа от шахты.
      { x: 2440, y: 320, w: 160, h: 940, tex: 'tile-floor' },
      // Высокая стартовая вышка слева: спрыгнул — спланировал через полпещеры.
      { x: 0, y: 260, w: 200, h: 640, tex: 'tile-floor' },
      // Островок посреди пропасти между вышкой и стартом.
      { x: 430, y: 520, w: 200, h: 50, tex: 'tile-floor' },
    ]

    const solids = this.physics.add.staticGroup()
    for (const p of level) {
      const tile = this.add.tileSprite(p.x + p.w / 2, p.y + p.h / 2, p.w, p.h, p.tex)
        .setDepth(1)
      solids.add(tile)
      if (p.tex === 'tile-wall') tile.setTint(0x9a9ab8)
    }

    // Коллайдер существа со всеми платформами (Arcade требует явный collider).
    if (this.creature) {
      this.physics.add.collider(this.creature, solids)
    } else {
      // create() вызывает buildLevel() до создания существа — запомним группу.
      this.solidsGroup = solids
    }

    // Маяки-грибы на ключевых точках уровня.
    const beacons: Array<[number, number]> = [
      [120, 880], [700, 880], [1250, 880], [1440, 600], [1780, 460], [2400, 300],
    ]
    for (const [x, y] of beacons) {
      const glow = this.add.image(x, y, 'glow-purple')
        .setAlpha(0.4)
        .setScale(0.9)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(0)
      this.add.image(x, y, 'mushroom').setScale(1.8).setDepth(2)

      this.tweens.add({
        targets: glow,
        alpha: { from: 0.25, to: 0.55 },
        scale: { from: 0.8, to: 1.1 },
        duration: Phaser.Math.Between(1800, 3200),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
    }
  }


}
