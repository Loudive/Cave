import Phaser from 'phaser'
import { ASSETS, assetUrl } from '../config/assets'
import { installGeneratedAudio } from '../systems/Audio'

/**
 * BootScene — шаг 2.
 * Реальный загрузчик ассетов: файлы из assets/ (манифест src/config/assets.ts),
 * событийный preload-бар на progress/complete загрузчика Phaser.
 * Программных текстур больше нет — всё приходит файлами (детерминированная
 * генерация: scripts/generate-assets.mjs, npm run assets).
 * Шаг 10: звук синтезируется в браузере (jsfxr-подход) и грузится
 * WAV-dataURI — аудиофайлов в репо нет.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot')
  }

  preload(): void {
    this.showPreloadBar()

    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      this.events.emit('boot:progress', value)
    })

    for (const { key, file } of ASSETS) {
      this.load.image(key, assetUrl(file))
    }

    // Шаг 10: SFX + музыка синтезированы в браузере — ставим в кэш напрямую
    // (декодирование в фоне, без участия загрузчика).
    installGeneratedAudio(this)
  }

  create(): void {
    this.events.emit('boot:progress', 1)
    this.cameras.main.fadeOut(220, 4, 4, 8)
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start('Menu')
    })
  }

  /** Настоящий прогресс-бар: подписан на события загрузчика. */
  private showPreloadBar(): void {
    const { width, height } = this.scale
    const cx = width / 2
    const cy = height / 2

    this.add.text(cx, cy - 40, 'CAVE DEVOURER', {
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontSize: '30px',
      color: '#E23A4E',
      fontStyle: 'bold',
    }).setOrigin(0.5)

    const status = this.add.text(cx, cy - 10, 'пробуждаемся в темноте…', {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#8A8894',
    }).setOrigin(0.5)

    const barW = 260
    const barH = 8
    this.add.rectangle(cx, cy + 30, barW, barH, 0x1a1a26).setStrokeStyle(1, 0x2a2a3a)
    const fill = this.add.rectangle(cx - barW / 2 + 2, cy + 30, 0, barH - 4, 0x58e6c8)
      .setOrigin(0, 0.5)

    const onProgress = (value: number): void => {
      fill.width = ((barW - 4) * Phaser.Math.Clamp(value, 0, 1))
      status.setText(`пробуждаемся в темноте… ${Math.round(value * 100)}%`)
    }
    this.events.on('boot:progress', onProgress)

    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      status.setText('темнота готова')
    })
  }
}
