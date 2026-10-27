import Phaser from 'phaser'

/**
 * HitStop — шаг 6: «мир замирает на кадр» (гайд: хитстоп 60–90 мс).
 * Полная заморозка симуляции: физика, твины, частицы. Геймплейные
 * update()-циклы сцена гейтит флагом active — всё живое стоит,
 * время (scene.time.now) идёт, поэтому разморозка детерминирована.
 *
 * Почему «дорого и правильно»: замораживается ВЕСЬ мир, а не пауза
 * рендера — тряска камеры и числа урона продолжают жить (свои твины
 * добавляются ПОСЛЕ заморозки и не глушатся), игрок чувствует удар.
 */
export class HitStop {
  private frozenUntil = -Infinity
  private wasFrozen = false
  /** Живые эмиттеры частиц — на них время останавливается timeScale=0. */
  private emitters = new Set<Phaser.GameObjects.Particles.ParticleEmitter>()

  constructor(private scene: Phaser.Scene) {}

  /** Заморозить мир на ms миллисекунд (повторный вызов продлевает). */
  freeze(ms: number): void {
    this.frozenUntil = Math.max(this.frozenUntil, this.scene.time.now + ms)
    if (!this.wasFrozen) {
      this.wasFrozen = true
      this.scene.physics.world.pause()
      this.scene.tweens.pauseAll()
      for (const e of this.emitters) e.timeScale = 0
    }
  }

  /** Заморожен ли мир прямо сейчас (гейт для update-циклов сцены). */
  get active(): boolean {
    return this.scene.time.now < this.frozenUntil
  }

  /** Вызывать из scene.update каждый кадр — разморозка по таймеру. */
  update(): void {
    if (this.wasFrozen && !this.active) {
      this.wasFrozen = false
      this.scene.physics.world.resume()
      this.scene.tweens.resumeAll()
      for (const e of this.emitters) e.timeScale = 1
    }
  }

  /** Регистрация эмиттера (BloodFx подписывает свои). */
  track(emitter: Phaser.GameObjects.Particles.ParticleEmitter): void {
    this.emitters.add(emitter)
    if (this.wasFrozen) emitter.timeScale = 0
  }

  untrack(emitter: Phaser.GameObjects.Particles.ParticleEmitter): void {
    this.emitters.delete(emitter)
  }
}
