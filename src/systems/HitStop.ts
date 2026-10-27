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
  /** Slow-mo (шаг 9): мир замедлен до slowMoUntil. */
  private slowMoUntil = -Infinity
  private wasSlowMo = false

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

  /**
   * Slow-mo (шаг 9): мир жив, но течёт в 4 раза медленнее — 0.3 с
   * величия на убийстве уникального монстра. Физика, твины и частицы
   * замедляются вместе; хитстоп поверх не конфликтует (freeze сильнее).
   */
  slowMo(ms: number): void {
    this.slowMoUntil = Math.max(this.slowMoUntil, this.scene.time.now + ms)
    if (!this.wasSlowMo) {
      this.wasSlowMo = true
      this.scene.physics.world.timeScale = 4
      this.scene.tweens.timeScale = 0.25
      for (const e of this.emitters) e.timeScale = 0.25
    }
  }

  /** Вызывать из scene.update каждый кадр — разморозка/возврат скорости. */
  update(): void {
    if (this.wasFrozen && !this.active) {
      this.wasFrozen = false
      if (!this.wasSlowMo) {
        this.scene.physics.world.resume()
      }
      this.scene.tweens.resumeAll()
      for (const e of this.emitters) e.timeScale = this.wasSlowMo ? 0.25 : 1
    }
    // Возврат из slow-mo.
    if (this.wasSlowMo && this.scene.time.now >= this.slowMoUntil) {
      this.wasSlowMo = false
      this.scene.physics.world.timeScale = 1
      this.scene.tweens.timeScale = 1
      for (const e of this.emitters) e.timeScale = 1
      if (!this.active) this.scene.physics.world.resume()
    }
  }

  /** Регистрация эмиттера (BloodFx подписывает свои). */
  track(emitter: Phaser.GameObjects.Particles.ParticleEmitter): void {
    this.emitters.add(emitter)
    if (this.wasFrozen) emitter.timeScale = 0
    else if (this.wasSlowMo) emitter.timeScale = 0.25
  }

  untrack(emitter: Phaser.GameObjects.Particles.ParticleEmitter): void {
    this.emitters.delete(emitter)
  }
}
