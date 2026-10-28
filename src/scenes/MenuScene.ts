import Phaser from 'phaser'
import { GENES, loadGeneSave } from '../config/genes'
import { loadNestSave } from '../systems/NestSave'
import { AudioSystem } from '../systems/Audio'

/**
 * MenuScene — шаг 8 + звук шага 10.
 * Титульный экран: нейрогенерированный splash-арт (шаг 5+ разрешает
 * нейрогенерацию; Nano Banana Pro, палитра игры), споровое свечение,
 * название, вход в пещеру.
 * Шаг 10: эмбиент пещеры (гул + капли) и ползунки громкости
 * «Музыка / Эффекты» с сохранением (гайд: «громкости настраиваются
 * в меню и сохраняются»). Клик по ползункам НЕ уводит в пещеру.
 */
const SLIDER_STEPS = 10

export class MenuScene extends Phaser.Scene {
  private audio!: AudioSystem

  constructor() {
    super('Menu')
  }

  create(): void {
    const { width, height } = this.scale
    const cx = width / 2
    const cy = height / 2

    this.cameras.main.fadeIn(500, 4, 4, 8)

    // Шаг 10: звуковая система (громкости нужны ползункам).
    this.audio = new AudioSystem(this)

    // Splash-арт: хищник в биолюминесцентной пещере (кадр 16:9 — покрывает).
    this.add.image(cx, cy, 'menu-splash')
      .setDisplaySize(width, height)
      .setAlpha(0.94)

    // Полотно темноты: арт проступает снизу, верхняя треть — под логотип.
    const veil = this.add.rectangle(cx, cy, width, height, 0x0b0b10, 0.3)
    this.tweens.add({
      targets: veil,
      alpha: { from: 0.26, to: 0.4 },
      duration: 5200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })

    // Два слоя дрейфующих спор — глубина кадра.
    this.spawnSpores(10, 'glow-purple', 0.08, 0.24, 0.2, 0.5)
    this.spawnSpores(7, 'glow-cyan', 0.14, 0.4, 0.3, 0.7)

    // Кровавое свечение за названием.
    this.add.image(cx, cy - 78, 'glow-red').setScale(4.2, 1.9).setAlpha(0.3)

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
    }).setOrigin(0.5).setAlpha(0.8)

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

    this.add.text(cx, height - 28, 'шаг 10 — звук и музыка: jsfxr-синтез, эмбиент, слои боя/глубины, громкости в меню', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#8A8894',
    }).setOrigin(0.5).setAlpha(0.7)

    // Постоянная часть (шаг 8): собранные гены видны между забегами.
    const save = loadGeneSave()
    if (save.genes.length > 0) {
      const names = save.genes
        .map((id) => GENES.genes.find((g) => g.id === id)?.name ?? id)
        .join(' · ')
      this.add.text(cx, cy + 92, `постоянные гены (${save.genes.length}): ${names}`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#E8A34F',
      }).setOrigin(0.5).setAlpha(0.9)
    }

    // Шаг 11: вход в «Гнездо» — хаб мета-прогрессии (древо/бестиарий/гены).
    const nest = loadNestSave()
    const nestY = cy + 128
    const nestBtn = this.add.text(cx, nestY, `◈ ГНЕЗДО — древо · бестиарий · гены · статистика (${nest.essence}◈)`, {
      fontFamily: 'monospace',
      fontSize: '14px',
      color: '#E8A34F',
      backgroundColor: '#1c1c10',
      padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(11).setInteractive({ useHandCursor: true })
    this.tweens.add({
      targets: nestBtn,
      alpha: { from: 0.86, to: 1 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
    })
    nestBtn.on(Phaser.Input.Events.POINTER_DOWN, () => {
      this.audio.ensureAmbient()
      this.cameras.main.fadeOut(240, 4, 4, 8)
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Nest'))
    })
    // Зона кнопки для глобального обработчика: клики по кнопке не уводят в пещеру.
    const nestZone = nestBtn.getBounds()

    // Шаг 10: ползунки громкости над строкой подсказки.
    const sliderY = height - 118
    this.buildVolumeSliders(cx, sliderY)

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

    // Один обработчик клика: эмбиент стартует первым жестом (автоплей-
    // политика), клик ВНЕ зоны ползунков уводит в пещеру, по ползункам —
    // только настраивает громкость. Клик по кнопке «Гнездо» обрабатывает
    // сама кнопка — глобальный обработчик её пропускает.
    this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
      this.audio.ensureAmbient()
      if (Phaser.Geom.Rectangle.Contains(nestZone, pointer.x, pointer.y)) return
      if (!this.inSliderZone(pointer, sliderY)) enterCave()
    })
    this.input.keyboard?.once('keydown', (e: KeyboardEvent) => {
      this.audio.ensureAmbient()
      // Шаг 11: N открывает Гнездо вместо пещеры.
      if (e.code === 'KeyN') {
        this.cameras.main.fadeOut(240, 4, 4, 8)
        this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Nest'))
        return
      }
      enterCave()
    })
  }

  /** Зона ползунков громкости (клики внутри — не вход в пещеру). */
  private inSliderZone(pointer: Phaser.Input.Pointer, sliderY: number): boolean {
    const { width } = this.scale
    const rowW = 190
    return pointer.x > width / 2 - rowW / 2 - 64
      && pointer.x < width / 2 + rowW / 2 + 8
      && pointer.y > sliderY - 14
      && pointer.y < sliderY + 34
  }

  /**
   * Две строки-ползунка: «МУЗЫКА» и «ЭФФЕКТЫ», 10 сегментов.
   * Кликом ставится громкость (сохраняется в localStorage сразу),
   * звук-подтверждение играет с новой громкостью — слышно до входа.
   */
  private buildVolumeSliders(cx: number, y: number): void {
    const rowW = 190
    const segW = (rowW - SLIDER_STEPS + 1) / SLIDER_STEPS

    const makeRow = (label: string, yOff: number, getV: () => number, setV: (v: number) => void): void => {
      this.add.text(cx - rowW / 2 - 8, yOff + 3, label, {
        fontFamily: 'monospace', fontSize: '11px', color: '#8A8894',
      }).setOrigin(1, 0)

      const current = Math.round(getV() * SLIDER_STEPS)
      const segs: Phaser.GameObjects.Rectangle[] = []
      for (let i = 0; i < SLIDER_STEPS; i++) {
        const on = i < current
        const seg = this.add.rectangle(
          cx - rowW / 2 + segW / 2 + i * (segW + 1), yOff + 8, segW, 10,
          on ? 0x58e6c8 : 0x1a1a26, on ? 0.85 : 0.9,
        )
        seg.setStrokeStyle(1, 0x2a2a3a)
        seg.setInteractive({ useHandCursor: true })
        seg.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
          // Громкость по месту клика: доля строки, округлённая к 1/10.
          const rel = (pointer.x - (cx - rowW / 2)) / rowW
          const value = Phaser.Math.Clamp(Math.round(rel * SLIDER_STEPS) / SLIDER_STEPS, 0, 1)
          setV(value)
          const filled = Math.round(value * SLIDER_STEPS)
          for (let idx = 0; idx < segs.length; idx++) {
            segs[idx].setFillStyle(idx < filled ? 0x58e6c8 : 0x1a1a26, idx < filled ? 0.85 : 0.9)
          }
          // Звук-подтверждение слышен с новой громкостью.
          this.audio.play('uiClick')
        })
        segs.push(seg)
      }
    }

    makeRow('МУЗЫКА', y, () => this.audio.volumes.music, (v) => this.audio.setMusicVol(v))
    makeRow('ЭФФЕКТЫ', y + 20, () => this.audio.volumes.sfx, (v) => this.audio.setSfxVol(v))

    this.add.text(cx, y + 44, 'громкость сохраняется между забегами', {
      fontFamily: 'monospace', fontSize: '9px', color: '#5A5866',
    }).setOrigin(0.5).setAlpha(0.8)
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
