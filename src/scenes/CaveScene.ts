import Phaser from 'phaser'

/**
 * CaveScene — шаг 2, пустая сцена пещеры.
 * Играбельный плейсхолдер: светящийся прямоугольник в темноте с грибами.
 * Спрайты приходят из загрузчика BootScene (assets/, шаг 2).
 * Настоящий контроллер (coyote time, wall jump, планирование) — шаг 3.
 */
export class CaveScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Image
  private playerGlow!: Phaser.GameObjects.Image
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: Record<'up' | 'left' | 'down' | 'right', Phaser.Input.Keyboard.Key>

  // Временные константы движения. С шага 3 переедут в src/config/movement.json.
  private readonly MOVE_ACCEL = 1500
  private readonly MOVE_DRAG = 1100
  private readonly MOVE_MAX = 280

  constructor() {
    super('Cave')
  }

  create(): void {
    const { width, height } = this.scale
    this.physics.world.setBounds(0, 0, 1920, 1080)
    this.cameras.main.setBounds(0, 0, 1920, 1080)
    this.cameras.main.fadeIn(500, 4, 4, 8)

    // Декор пола: тёмные камни по всей пещере.
    for (let i = 0; i < 26; i++) {
      const rock = this.add.image(
        Phaser.Math.Between(0, 1920),
        Phaser.Math.Between(0, 1080),
        'rock',
      )
        .setAlpha(Phaser.Math.FloatBetween(0.5, 0.9))
        .setAngle(Phaser.Math.Between(0, 360))
        .setScale(Phaser.Math.FloatBetween(0.7, 2.4))
        .setDepth(0)
      rock.setTint(Phaser.Math.Between(0, 1) > 0.5 ? 0xffffff : 0xd8d8e8)
    }

    // Биолюминесцентные грибы: спрайт + пульсирующее свечение под ним.
    for (let i = 0; i < 12; i++) {
      const mx = Phaser.Math.Between(80, 1840)
      const my = Phaser.Math.Between(80, 1000)
      const glowColor = i % 3 === 0 ? 'glow-purple' : 'glow-cyan'

      const glow = this.add.image(mx, my, glowColor)
        .setAlpha(Phaser.Math.FloatBetween(0.3, 0.55))
        .setScale(Phaser.Math.FloatBetween(0.5, 1.1))
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(1)

      const mushroom = this.add.image(mx, my, 'mushroom')
        .setScale(Phaser.Math.FloatBetween(1.4, 2.6))
        .setDepth(2)

      this.tweens.add({
        targets: glow,
        alpha: { from: glow.alpha * 0.4, to: Math.min(1, glow.alpha * 1.5) },
        scale: { from: glow.scale, to: glow.scale * 1.22 },
        duration: Phaser.Math.Between(1800, 3600),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
        delay: Phaser.Math.Between(0, 1500),
      })
      this.tweens.add({
        targets: mushroom,
        scaleY: { from: mushroom.scaleY, to: mushroom.scaleY * 0.94 },
        duration: Phaser.Math.Between(2200, 4200),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
        delay: Phaser.Math.Between(0, 1200),
      })
    }

    // Игрок-плейсхолдер + его биолюминесцентный ореол.
    this.playerGlow = this.add.image(width / 2, height / 2, 'glow-cyan')
      .setScale(1.6)
      .setAlpha(0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(2)

    this.player = this.physics.add.image(width / 2, height / 2, 'player')
      .setDepth(3)
      .setCollideWorldBounds(true)
      .setDamping(false)
    this.player.setDrag(this.MOVE_DRAG, this.MOVE_DRAG)
    this.player.setMaxVelocity(this.MOVE_MAX, this.MOVE_MAX)

    this.tweens.add({
      targets: this.playerGlow,
      scale: { from: 1.45, to: 1.8 },
      alpha: { from: 0.38, to: 0.6 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })

    this.cameras.main.startFollow(this.player, true, 0.09, 0.09)

    // Управление: стрелки + WASD.
    this.cursors = this.input.keyboard!.createCursorKeys()
    this.wasd = this.input.keyboard!.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      right: Phaser.Input.Keyboard.KeyCodes.D,
    }) as Record<'up' | 'left' | 'down' | 'right', Phaser.Input.Keyboard.Key>
    this.input.keyboard!.on('keydown-ESC', () => {
      this.cameras.main.fadeOut(220, 4, 4, 8)
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('Menu')
      })
    })

    // Виньетка + подсказка — приколочены к камере.
    this.add.image(width / 2, height / 2, 'vignette')
      .setDisplaySize(width * 1.15, height * 1.15)
      .setScrollFactor(0)
      .setDepth(10)

    this.add.text(16, height - 14,
      'WASD / стрелки — движение · ESC — меню · шаг 2: скелет и загрузчик ассетов',
      { fontFamily: 'monospace', fontSize: '12px', color: '#8A8894' },
    )
      .setScrollFactor(0)
      .setOrigin(0, 1)
      .setDepth(11)
      .setAlpha(0.8)
  }

  override update(): void {
    const onMove = this.cursors.left.isDown || this.wasd.left.isDown
      || this.cursors.right.isDown || this.wasd.right.isDown
      || this.cursors.up.isDown || this.wasd.up.isDown
      || this.cursors.down.isDown || this.wasd.down.isDown

    if (this.cursors.left.isDown || this.wasd.left.isDown) {
      this.player.setAccelerationX(-this.MOVE_ACCEL)
    } else if (this.cursors.right.isDown || this.wasd.right.isDown) {
      this.player.setAccelerationX(this.MOVE_ACCEL)
    } else {
      this.player.setAccelerationX(0)
    }

    if (this.cursors.up.isDown || this.wasd.up.isDown) {
      this.player.setAccelerationY(-this.MOVE_ACCEL)
    } else if (this.cursors.down.isDown || this.wasd.down.isDown) {
      this.player.setAccelerationY(this.MOVE_ACCEL)
    } else {
      this.player.setAccelerationY(0)
    }

    if (onMove) {
      const body = this.player.body as Phaser.Physics.Arcade.Body | null
      const speed = body?.speed ?? 0
      if (speed > 40) {
        this.playerGlow.setScale(Phaser.Math.Clamp(1.5 + speed / 400, 1.5, 2.1))
      }
    }

    this.playerGlow.setPosition(this.player.x, this.player.y)
  }
}
