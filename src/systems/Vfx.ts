import Phaser from 'phaser'
import { QUALITY } from './quality'
import { ChromaticPipeline } from './ChromaticPipeline'
import type { BloodFx } from './BloodFx'
import type { HitStop } from './HitStop'

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
 * 4. Glow-фильтр на источниках света (грибы, врата, лужи огня, аура
 *    уникальных): реестр целей, включается на высоком качестве в WebGL,
 *    тумблер Q переключает на лету.
 * 5. Spark-бёрсты: искры по событиям (панцирь «кланк», уникальные,
 *    «Грива шипов») — через общий пул BloodFx.
 */

interface GlowEntry {
  target: Phaser.GameObjects.Image
  fx: Phaser.FX.Glow | null
}

const CHROMA_MAX = 0.006
const CHROMA_FADE_MS = 420
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
      if (this.flashPool.length < 6) {
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
      scale: scale * 2.1,
      duration: 260,
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
    this.chromaStrength = CHROMA_MAX * strength
    this.chromaUntil = this.scene.time.now + CHROMA_FADE_MS
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

  /** «Мир замирает на мгновение величия»: 0.3 c замедления + наезд камеры. */
  uniqueKillSlowMo(): void {
    this.hitStop.slowMo(300)
    const cam = this.scene.cameras.main
    cam.zoomTo(1.035, 140, 'Sine.Out')
    this.scene.time.delayedCall(320, () => cam.zoomTo(1, 220, 'Sine.In'))
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

  // ── Glow-реестр ─────────────────────────────────────────────────────────────

  /** Зарегистрировать источник света для Glow-фильтра (Q переключает). */
  registerGlow(target: Phaser.GameObjects.Image): void {
    const entry: GlowEntry = { target, fx: null }
    this.glows.add(entry)
    this.applyGlow(entry)
    target.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.glows.delete(entry)
    })
  }

  private applyGlow(entry: GlowEntry): void {
    if (this.fxAllowed && !entry.fx) {
      const post = entry.target.postFX
      if (post) entry.fx = post.addGlow(0xffffff, 0.6, 0.8)
    } else if (!this.fxAllowed && entry.fx) {
      entry.target.postFX?.remove(entry.fx)
      entry.fx = null
    }
  }

  /** Переключение качества (Q): пересобрать все пост-эффекты. */
  refreshForQuality(): void {
    // Хроматика на низком качестве не нужна вовсе.
    if (!this.fxAllowed) this.chromaOff()
    for (const entry of this.glows) this.applyGlow(entry)
  }

  /** Вызывать из scene.update каждый кадр. */
  update(): void {
    // Затухание хроматики до нуля, затем снятие пайплайна.
    if (this.chromaOn) {
      const left = this.chromaUntil - this.scene.time.now
      if (left <= 0) {
        this.chromaOff()
      } else {
        this.chromaStrength = CHROMA_MAX * (left / CHROMA_FADE_MS)
        this.chromaApply()
      }
    }
  }
}
