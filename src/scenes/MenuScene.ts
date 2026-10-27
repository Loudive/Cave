import Phaser from 'phaser'

/**
 * MenuScene — шаг 0.
 * Титульный экран: споровое свечение, название, вход в пещеру.
 */
export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu')
  }

  create(): void {
    const { width, height } = this.scale
    const cx = width / 2
    const cy = height / 2

    this.cameras.main.fadeIn(400, 4, 4, 8)

    // Два слоя дрейфующих спор — глубина кадра.
    this.spawnSpores(14, 'glow-purple', 0.1, 0.28, 0.2, 0.55)
    this.spawnSpores(9, 'glow-cyan', 0.2, 0.45, 0.35, 0.8)

    // Кровавое свечение за названием.
    this.add.image(cx, cy - 78, 'glow-red').setScale(4.2, 1.9).setAlpha(0.32)

    this.add.text(cx, cy - 108, 'CAVE  DEVOURER', {
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontSize: '64px',
      color: '#E23A4E',
      fontStyle: 'bold',
      letterSpacing: 4,
    }).setOrigin(0.5)

    this.add.text(cx, cy - 58, 'Пожиратель пещер · тёмное фэнтези · роуглайк', {
      fontFamily: 'monospace',
      fontSize: '15px',
      color: '#E8E6E3',
    }).setOrigin(0.5).setAlpha(0.75)

    const start = this.add.text(cx, cy + 52, '— нажми, чтобы войти в пещеру —', {
      fontFamily: 'monospace',
      fontSize: '18px',
      color: '#58E6C8',
    }).setOrigin(0.5)

    this.tweens.add({
      targets: start,
      alpha: { from: 1, to: 0.25 },
      duration: 1100,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })

    this.add.text(cx, height - 28, 'шаг 2 — скелет и загрузчик ассетов · Phaser 3 + TypeScript + Vite', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#8A8894',
    }).setOrigin(0.5).setAlpha(0.7)

    // Виньетка поверх всего.
    const vig = this.add.image(cx, cy, 'vignette')
    vig.setDisplaySize(width * 1.15, height * 1.15)
    vig.setDepth(10)

    const enterCave = (): void => {
      this.cameras.main.fadeOut(260, 4, 4, 8)
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('Cave')
      })
    }

    this.input.once(Phaser.Input.Events.POINTER_DOWN, enterCave)
    this.input.keyboard?.once('keydown', enterCave)
  }

  /** Споры светятся, медленно дышат и дрейфуют. */
  private spawnSpores(
    count: number,
    texture: string,
    alphaMin: number,
    alphaMax: number,
    scaleMin: number,
    scaleMax: number,
  ): void {
    const { width, height } = this.scale
    for (let i = 0; i < count; i++) {
      const x = Phaser.Math.Between(0, width)
      const y = Phaser.Math.Between(0, height)
      const spore = this.add.image(x, y, texture)
        .setAlpha(Phaser.Math.FloatBetween(alphaMin, alphaMax))
        .setScale(Phaser.Math.FloatBetween(scaleMin, scaleMax))
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(Phaser.Math.Between(1, 2))

      this.tweens.add({
        targets: spore,
        y: y + Phaser.Math.Between(-50, 50),
        x: x + Phaser.Math.Between(-35, 35),
        duration: Phaser.Math.Between(3500, 8000),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
      this.tweens.add({
        targets: spore,
        alpha: { from: spore.alpha * 0.4, to: Math.min(1, spore.alpha * 1.35) },
        duration: Phaser.Math.Between(1600, 3200),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
    }
  }
}
