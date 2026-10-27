import Phaser from 'phaser'

/**
 * BootScene — шаг 0.
 * Генерирует программные текстуры (пока нет ассетов) и показывает
 * заглушку preload-бара. Реальная загрузка ассетов появится в шаге 2.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  create(): void {
    this.createTextures()
    this.showFakeLoading()
  }

  private createTextures(): void {
    this.createGlowTexture('glow-cyan', 0x58e6c8)
    this.createGlowTexture('glow-purple', 0xb36bff)
    this.createGlowTexture('glow-red', 0xe23a4e)
    this.createPlayerTexture()
    this.createRockTexture()
    this.createVignetteTexture()
  }

  /** Мягкий радиальный градиент — источник биолюминесцентного света. */
  private createGlowTexture(key: string, color: number): void {
    if (this.textures.exists(key)) return

    const size = 128
    const canvas = this.textures.createCanvas(key, size, size)
    if (!canvas) return
    const ctx = canvas.getContext()
    const c = Phaser.Display.Color.IntegerToColor(color)
    const rgb = `${c.red},${c.green},${c.blue}`

    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, `rgba(${rgb},1)`)
    grad.addColorStop(0.25, `rgba(${rgb},0.55)`)
    grad.addColorStop(0.6, `rgba(${rgb},0.14)`)
    grad.addColorStop(1, `rgba(${rgb},0)`)

    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    canvas.refresh()
  }

  /** Игрок-плейсхолдер: светящийся прямоугольник (геймпад-фил важнее графики). */
  private createPlayerTexture(): void {
    if (this.textures.exists('player')) return

    const g = this.add.graphics()
    g.fillStyle(0x58e6c8, 1)
    g.fillRoundedRect(0, 0, 28, 28, 6)
    g.fillStyle(0x0b0b10, 1)
    g.fillRoundedRect(9, 9, 10, 10, 3)
    g.generateTexture('player', 28, 28)
    g.destroy()
  }

  /** Камень-плейсхолдер для декора пола пещеры. */
  private createRockTexture(): void {
    if (this.textures.exists('rock')) return

    const g = this.add.graphics()
    g.fillStyle(0x1a1a26, 1)
    g.fillRoundedRect(0, 0, 96, 64, 12)
    g.fillStyle(0x2a2a3a, 1)
    g.fillRoundedRect(10, 10, 76, 44, 9)
    g.generateTexture('rock', 96, 64)
    g.destroy()
  }

  /** Виньетка: тёмные края кадра — ощущение тоннеля. */
  private createVignetteTexture(): void {
    if (this.textures.exists('vignette')) return

    const size = 512
    const canvas = this.textures.createCanvas('vignette', size, size)
    if (!canvas) return
    const ctx = canvas.getContext()

    const grad = ctx.createRadialGradient(
      size / 2, size / 2, size * 0.22,
      size / 2, size / 2, size * 0.52,
    )
    grad.addColorStop(0, 'rgba(4,4,8,0)')
    grad.addColorStop(0.7, 'rgba(4,4,8,0.45)')
    grad.addColorStop(1, 'rgba(4,4,8,0.92)')

    ctx.fillStyle = grad
    ctx.fillRect(0, 0, size, size)
    canvas.refresh()
  }

  /** Короткий имитационный прогресс — на шаге 2 заменяется настоящей загрузкой. */
  private showFakeLoading(): void {
    const { width, height } = this.scale
    const cx = width / 2
    const cy = height / 2

    this.add.text(cx, cy - 34, 'CAVE DEVOURER', {
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontSize: '30px',
      color: '#E23A4E',
      fontStyle: 'bold',
    }).setOrigin(0.5)

    this.add.text(cx, cy - 4, 'пробуждаемся в темноте…', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#8A8894',
    }).setOrigin(0.5)

    const barW = 260
    const barH = 8
    this.add.rectangle(cx, cy + 30, barW, barH, 0x1a1a26).setStrokeStyle(1, 0x2a2a3a)
    const fill = this.add.rectangle(cx - barW / 2 + 2, cy + 30, 0, barH - 4, 0x58e6c8).setOrigin(0, 0.5)

    this.tweens.addCounter({
      from: 0,
      to: 100,
      duration: 900,
      ease: 'Sine.InOut',
      onUpdate: (t) => {
        const v = t.getValue() as number
        fill.width = ((barW - 4) * v) / 100
      },
      onComplete: () => {
        this.cameras.main.fadeOut(220, 4, 4, 8)
        this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
          this.scene.start('Menu')
        })
      },
    })
  }
}
