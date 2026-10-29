import Phaser from 'phaser'
import { ASSETS, assetUrl, HERO_FRAME } from '../config/assets'
import { ANIMS } from '../config/anims'
import { ENEMIES } from '../config/enemies'
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

    // Шаг 11 (переработка): герой полностью анимирован — 7 листов
    // (кадры 68×46, нарезка scripts/process-hero.mjs, сырьё design/raw/v3).
    // Параметры — src/config/anims.json (ноль магических чисел в коде).
    for (const name of ['idle', 'run', 'glide', 'bite', 'eat', 'hurt', 'death'] as const) {
      this.load.spritesheet(`hero-${name}`, assetUrl(`hero-${name}.png`), {
        frameWidth: HERO_FRAME.w,
        frameHeight: HERO_FRAME.h,
      })
      // Шаг 18: lumen-двойники — только биолюм-метки (циан + глаза),
      // рендерятся НАД маской тьмы: существо — самосветящийся источник
      // (референсы). Сетка кадров 1:1 с основными листами.
      this.load.spritesheet(`hero-${name}-lumen`, assetUrl(`hero-${name}-lumen.png`), {
        frameWidth: HERO_FRAME.w,
        frameHeight: HERO_FRAME.h,
      })
    }

    // Шаг 20: мобы — анимированные листы (4 кадра 68×46, нарезка
    // scripts/process-mobs.mjs, нейро-генерация scripts/gen-mobs.mjs).
    // ТЕКСТУРЫ 'mob-*' НЕ в ASSETS-манифесте — они грузятся ЗДЕСЬ
    // спрайтлистами (та же сетка кадров, что hero-*).
    // Шаг 24: + два хищника глубины (сталкер, пожиратель) — gen-step24.mjs.
    for (const id of ['slug', 'bat', 'reaper', 'bloodsucker', 'shell', 'lava', 'stalker', 'devourer'] as const) {
      this.load.spritesheet(`mob-${id}`, assetUrl(`mob-${id}.png`), {
        frameWidth: HERO_FRAME.w,
        frameHeight: HERO_FRAME.h,
      })
    }

    // Шаг 10: SFX + музыка синтезированы в браузере — ставим в кэш напрямую
    // (декодирование в фоне, без участия загрузчика).
    installGeneratedAudio(this)
  }

  create(): void {
    // Шаг 11 (переработка): анимации героя (глобальные — создаются один раз).
    // Параметры (кадры/частоты/порядок) — ANIMS из src/config/anims.json.
    const defs = [
      'idle',
      'run',
      'glide',
      'bite',
      'eat',
      'hurt',
      'death',
    ] as const
    for (const name of defs) {
      const key = `hero-${name}`
      if (this.anims.exists(key)) continue
      const c = ANIMS[name]
      const frames = c.order
        ? c.order.map((n) => ({ key, frame: n }))
        : this.anims.generateFrameNumbers(key, { start: 0, end: c.frames - 1 })
      this.anims.create({
        key,
        frames,
        frameRate: c.fps,
        repeat: c.loop ? -1 : 0,
      })
    }

    // Шаг 20: walk-анимации мобов (4 кадра, fps из enemies.json species.anim).
    // Шаг 24: список видов — единый источник (enemies.json), чтобы новые
    // хищники подключались без правки кода загрузчика.
    for (const id of ['slug', 'bat', 'reaper', 'bloodsucker', 'shell', 'lava', 'stalker', 'devourer'] as const) {
      const key = `mob-${id}-walk`
      if (this.anims.exists(key)) continue
      const a = ENEMIES.species[id].anim
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers(`mob-${id}`, { start: 0, end: 3 }),
        frameRate: a ? a.fps : 8,
        repeat: -1,
      })
    }

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
