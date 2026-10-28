import Phaser from 'phaser'
import { QUALITY } from './quality'
import { FPS } from '../config/fps'

/**
 * FpsGuard — шаг 10 (перфоманс): наблюдатель кадровой частоты.
 * Гайд: «общий тумблер качества для слабых устройств» — тумблер Q есть,
 * но игрок не обязан знать о нём. Если реальный FPS ниже порога
 * несколько секунд подряд, качество автоматически падает на «низкое»:
 * режутся bloom-ореолы, хроматика, частицы (×0.4), декали живут вполовину.
 * Обратно автоматически не поднимаем (нет осцилляций); игрок может
 * вернуть «высокое» клавишей Q — тогда guard больше не вмешивается.
 */
export class FpsGuard {
  private scene: Phaser.Scene
  private checkAt = 0
  private lowStreak = 0
  /** Однократность срабатывания за сессию. */
  private fired = false
  /** Пауза наблюдения: первые секунды сцена грузится (фейд-ин, спавн). */
  private readonly warmupMs: number
  private readonly sampleMs: number
  private readonly threshold: number
  private readonly strikes: number
  private toast: Phaser.GameObjects.Text | null = null

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.warmupMs = FPS.warmupMs
    this.sampleMs = FPS.sampleMs
    this.threshold = FPS.threshold
    this.strikes = FPS.strikes
    // Игрок уже вручную выбрал «низкое» — guard не нужен.
    if (QUALITY.level === 'low') this.fired = true
  }

  /** Вызывать из scene.update каждый кадр (дёшево: один if до таймера). */
  update(): void {
    if (this.fired) return
    const now = this.scene.time.now
    if (now < this.warmupMs) return
    if (now < this.checkAt) return
    this.checkAt = now + this.sampleMs

    const fps = this.scene.game.loop.actualFps
    if (fps >= this.threshold) {
      this.lowStreak = 0
      return
    }
    this.lowStreak++
    if (this.lowStreak < this.strikes) return

    this.fired = true
    QUALITY.level = 'low'
    this.showToast()
  }

  /** Тихий тост в углу: честно объясняем, что произошло. */
  private showToast(): void {
    const { width, height } = this.scene.scale
    this.toast = this.scene.add.text(width / 2, height - 44,
      'Качество снижено для стабильных 60 FPS — вернуть: Q',
      {
        fontFamily: 'monospace', fontSize: '11px', color: '#8A8894',
        backgroundColor: 'rgba(11,11,16,0.8)', padding: { x: 8, y: 4 },
      })
      .setScrollFactor(0)
      .setDepth(24)
      .setOrigin(0.5)
    this.scene.tweens.add({
      targets: this.toast,
      alpha: 0,
      delay: FPS.toastMs,
      duration: 600,
      onComplete: () => this.toast?.destroy(),
    })
  }
}
