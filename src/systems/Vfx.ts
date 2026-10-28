import Phaser from 'phaser'
import { QUALITY } from './quality'
import { ChromaticPipeline } from './ChromaticPipeline'
import type { BloodFx } from './BloodFx'
import type { HitStop } from './HitStop'
import { VFX } from '../config/vfx'

/**
 * Vfx — шаг 9: juice-слой поверх геймплея (гайд: «Juice it or lose it»).
 * Всё здесь — ПРЕЗЕНТАЦИЯ: ни один эффект не двигает статы и хитбоксы.
 *
 * 1. Flash поедания: тёплая вспышка у пасти на каждом чавканье и всплеск
 *    при доедании туши («вспышка света при поедании», гайд §7).
 * 2. Chromatic aberration: рывок цветовых каналов камеры при тяжёлом
 *    уроне и смерти уникального моба (только WebGL + высокое качество).
 * 3. Slow-mo 0.3 c на убийстве уникального монстра (делегирует HitStop:
 *    мир замедляется в 4 раза, камера чуть наезжает).
 * 4. Glow-ореолы источников света (грибы, врата, аура уникальных).
 *    Шаг 10 (перфоманс): вместо postFX.addGlow (каждый объект с postFX
 *    в Phaser 3.60+ рендерится в ОТДЕЛЬНЫЙ фреймбуфер — 17+ объектов
 *    убивали FPS) — синхронный bloom-спрайт: копия ореола чуть крупнее
 *    и тусклее, следует за целью каждый кадр, ноль доп. пассов.
 * 5. Spark-бёрсты: искры по событиям (панцирь «кланк», уникальные,
 *    «Грива шипов») — через общий пул BloodFx.
 */

interface GlowEntry {
  target: Phaser.GameObjects.Image
  bloom: Phaser.GameObjects.Image | null
}

const PIPELINE_KEY = 'ChromaticAB'

export class Vfx {
  private chromaOn = false
  private chromaStrength = 0
  private chromaUntil = 0
  private glows = new Set<GlowEntry>()
  private flashPool: Phaser.GameObjects.Image[] = []

  constructor(
    private scene: Phaser.Scene,
    private blood: BloodFx,
    private hitStop: HitStop,
  ) {}

  /** WebGL + высокое качество — пост-эффекты включены. */
  private get fxAllowed(): boolean {
    return this.scene.game.renderer.type === Phaser.WEBGL && QUALITY.level === 'high'
  }

  // ── Flash поедания ──────────────────────────────────────────────────────────

  /** Тёплая вспышка у точки (пасть/туша): пул из 6 бликов. */
  eatFlash(x: number, y: number, scale = 0.55): void {
    let img = this.flashPool.find((f) => !f.visible)
    if (!img) {
      if (this.flashPool.length < VFX.flashPoolSize) {
        img = this.scene.add.image(x, y, 'glow-red')
          .setDepth(17)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setVisible(false)
        this.flashPool.push(img)
      } else {
        img = this.flashPool[0]
      }
    }
    img.setPosition(x, y).setScale(scale).setAlpha(0.7).setVisible(true)
    this.scene.tweens.killTweensOf(img)
    this.scene.tweens.add({
      targets: img,
      alpha: 0,
      scale: scale * VFX.flashScaleGain,
      duration: VFX.flashMs,
      ease: 'Quad.Out',
      onComplete: () => img!.setVisible(false),
    })
  }

  // ── Chromatic aberration ────────────────────────────────────────────────────

  /** Рывок цветовых каналов при тяжёлом ударе (свой GLSL-пайплайн). */
  chromaticHit(strength = 1): void {
    if (!this.fxAllowed) return
    const cam = this.scene.cameras.main
    if (!this.chromaOn) {
      const renderer = this.scene.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer
      if (!renderer.pipelines.has(PIPELINE_KEY)) {
        renderer.pipelines.addPostPipeline(PIPELINE_KEY, ChromaticPipeline)
      }
      cam.setPostPipeline(PIPELINE_KEY)
      this.chromaOn = true
    }
    this.chromaStrength = VFX.chromaMax * strength
    this.chromaUntil = this.scene.time.now + VFX.chromaFadeMs
  }

  private chromaOff(): void {
    if (!this.chromaOn) return
    this.chromaOn = false
    this.chromaStrength = 0
    this.scene.cameras.main.removePostPipeline(PIPELINE_KEY)
  }

  private chromaApply(): void {
    if (!this.chromaOn) return
    const pip = this.scene.cameras.main.getPostPipeline(PIPELINE_KEY) as ChromaticPipeline | null
    if (pip) pip.offset = this.chromaStrength
  }

  // ── Slow-mo уникальных убийств ──────────────────────────────────────────────

  /**
   * «Мир замирает на мгновение величия»: 0.3 c замедления + наезд камеры.
   *
   * Шаг 13 (рёв оранжевого зависания): изинг сюда передаётся ФУНКЦИЕЙ,
   * не строкой. У эффектов камеры (Zoom/Fade/Pan) своя EaseMap — там НЕТ
   * новых имён вида 'Sine.Out' (только 'Sine', 'Sine.easeOut', …), а
   * Zoom.start при незнакомой строке молча оставляет this.ease = undefined.
   * Первый же кадр эффекта бросал TypeError из CameraManager.update —
   * вне страховки сцены — и убивал rAF-цепочку Phaser навсегда: экран
   * застывал (у пользователя — оранжевым, в глубинном биоме). Функция
   * минует карту имён целиком.
   */
  uniqueKillSlowMo(): void {
    this.hitStop.slowMo(VFX.slowMoMs)
    const cam = this.scene.cameras.main
    cam.zoomTo(VFX.slowMoZoom, VFX.slowMoZoomInMs, Phaser.Math.Easing.Sine.Out)
    this.scene.time.delayedCall(VFX.slowMoMs + 20, () =>
      cam.zoomTo(1, VFX.slowMoZoomOutMs, Phaser.Math.Easing.Sine.In))
    this.chromaticHit(1.4)
  }

  // ── Sparks ──────────────────────────────────────────────────────────────────

  /** Искры: металл-панцирь, шипы, золотая смерть уникальных. */
  sparks(x: number, y: number, count = 10, golden = false): void {
    this.blood.burst(x, y, {
      count: Math.max(3, Math.round(count * QUALITY.particleMult)),
      dirDeg: 90, spreadDeg: 360, speedMult: 1.15,
      texture: 'spark', sticky: false,
    })
    if (golden) this.eatFlash(x, y, 0.8)
  }

  // ── Glow-ореолы (шаг 10: bloom-спрайты вместо postFX) ──────────────────────

  /**
   * Зарегистрировать ореол для мягкого свечения. Раньше вешал
   * postFX.addGlow — отдельный фреймбуфер-пасс на объект, из-за чего
   * полсотни пассов за кадр роняли FPS. Теперь bloom — копия текстуры
   * чуть крупнее и тусклее, синхронизируется с целью каждый кадр.
   */
  registerGlow(target: Phaser.GameObjects.Image): void {
    const bloom = this.scene.add.image(target.x, target.y, target.texture.key)
      .setDepth(target.depth - 1)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(target.scaleX * VFX.bloomScale)
      .setAlpha(0)
      .setVisible(false)
    const entry: GlowEntry = { target, bloom }
    this.glows.add(entry)
    target.once(Phaser.GameObjects.Events.DESTROY, () => {
      entry.bloom?.destroy()
      this.glows.delete(entry)
    })
  }

  private syncGlow(entry: GlowEntry): void {
    const { target, bloom } = entry
    if (!bloom) return
    // На низком качестве ореолы-блум гаснут первыми (гайд: эффекты режутся).
    const on = this.fxAllowed && target.visible && target.alpha > 0.01
    if (!on) {
      if (bloom.visible) bloom.setVisible(false)
      return
    }
    if (!bloom.visible) bloom.setVisible(true)
    bloom.setPosition(target.x, target.y)
      .setScale(target.scaleX * VFX.bloomScale, target.scaleY * VFX.bloomScale)
      .setAlpha(target.alpha * VFX.bloomAlpha)
      .setAngle(target.angle)
  }

  /** Переключение качества (Q): хроматика на низком не нужна вовсе. */
  refreshForQuality(): void {
    if (!this.fxAllowed) this.chromaOff()
  }

  /** Вызывать из scene.update каждый кадр. */
  update(): void {
    // Затухание хроматики до нуля, затем снятие пайплайна.
    if (this.chromaOn) {
      const left = this.chromaUntil - this.scene.time.now
      if (left <= 0) {
        this.chromaOff()
      } else {
        this.chromaStrength = VFX.chromaMax * (left / VFX.chromaFadeMs)
        this.chromaApply()
      }
    }
    // Bloom-ореолы: 15-20 целей — три десятка присваиваний, дешевле пасса.
    for (const entry of this.glows) this.syncGlow(entry)
  }
}
