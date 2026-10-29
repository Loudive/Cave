import Phaser from 'phaser'
import { QUALITY } from './quality'
import { LIGHT } from '../config/light'
import { ChromaticPipeline } from './ChromaticPipeline'
import { uiZoom } from './RenderScale'
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

  // ── Шаг 20: аэро-джус (шлейф крыльев / взмахи / всплески ударов) ──────
  // Всё живёт НАД маской тьмы в lumen-полосе: свечение = биология
  // существа (GDD §7), читается в полной темноте как lumen-метки героя.
  private aeroEmitter: Phaser.GameObjects.Particles.ParticleEmitter
  private aeroRings: Phaser.GameObjects.Image[] = []
  private aeroGlows: Phaser.GameObjects.Image[] = []

  constructor(
    private scene: Phaser.Scene,
    private blood: BloodFx,
    private hitStop: HitStop,
  ) {
    // Шаг 20: один эмиттер на все аэро-эффекты (spark.png, ADD-tint): конфиг
    // меняется на каждый вызов как в BloodFx.burst — пул, ноль аллокаций.
    this.aeroEmitter = scene.add.particles(0, 0, 'spark', { emitting: false })
      .setDepth(LIGHT.halo.lumenDepth + 0.2)
    this.hitStop.track(this.aeroEmitter)
    for (let i = 0; i < 3; i++) {
      this.aeroRings.push(scene.add.image(0, 0, 'ring')
        .setDepth(LIGHT.halo.lumenDepth + 0.1)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(VFX.aero.hitSplash.tint)
        .setVisible(false))
    }
    for (let i = 0; i < 2; i++) {
      this.aeroGlows.push(scene.add.image(0, 0, 'glow-cyan')
        .setDepth(LIGHT.halo.lumenDepth + 0.3)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false))
    }
  }

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
    // Шаг 20: зум — МНОЖИТЕЛЬ базового (vfx.json cameraBaseZoom = 2):
    // раньше возврат был к абсолютной 1 — при базовом зуме 2 слоу-мо
    // «отдаляло» бы камеру вдвое от обычного вида. Шаг 23: база ещё и × k
    // (рендер-масштаб канваса) — worldView не меняется ни при k, ни при
    // пульсе.
    cam.zoomTo(uiZoom(VFX.cameraBaseZoom * VFX.slowMoZoom), VFX.slowMoZoomInMs, Phaser.Math.Easing.Sine.Out)
    this.scene.time.delayedCall(VFX.slowMoMs + 20, () =>
      cam.zoomTo(uiZoom(VFX.cameraBaseZoom), VFX.slowMoZoomOutMs, Phaser.Math.Easing.Sine.In))
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

  // ── Шаг 20: аэро-джус ───────────────────────────────────────────────

  /** Тонкий иллюминесцентный шлейф от крыльев: ОДНА крупица за тик.
   *  Вызывает сцена из update по таймеру (aero.wingTrail.everyMs),
   *  только в полёте при заметной скорости — «прям пару частиц». */
  wingTrailTick(x: number, y: number): void {
    const t = VFX.aero.wingTrail
    this.aeroEmitter.setConfig({
      speed: { min: t.speedMin, max: t.speedMax },
      angle: { min: t.dirDeg - t.spreadDeg / 2, max: t.dirDeg + t.spreadDeg / 2 },
      gravityY: 0,
      lifespan: { min: t.lifeMin, max: t.lifeMax },
      scale: { start: t.scaleStart, end: t.scaleEnd },
      alpha: { start: t.alphaStart, end: t.alphaEnd },
      tint: t.tint,
      emitting: false,
    })
    this.aeroEmitter.emitParticleAt(x, y, 1)
  }

  /** Взмах крыльев: короткий сноп биолюм-пыли вниз (прыжок/двойной/
   *  вход в план). power<1 — мягче (вход в планирование). */
  wingSweep(x: number, y: number, power = 1): void {
    const s = VFX.aero.wingSweep
    const count = Math.max(2, Math.round(s.count * power * QUALITY.particleMult))
    this.aeroEmitter.setConfig({
      speed: { min: s.speedMin, max: s.speedMax },
      angle: { min: s.dirDeg - s.spreadDeg / 2, max: s.dirDeg + s.spreadDeg / 2 },
      gravityY: 0,
      lifespan: { min: s.lifeMin, max: s.lifeMax },
      scale: { start: s.scaleStart, end: s.scaleEnd },
      alpha: { start: s.alphaStart, end: s.alphaEnd },
      tint: s.tint,
      emitting: false,
    })
    this.aeroEmitter.emitParticleAt(x, y, count)
  }

  /** Всплеск попадания укуса («аура удара/сплеш»): расширяющееся кольцо
   *  + конус искр от пасти в жертву + мгновенная циановая вспышка.
   *  Всё НАД маской тьмы — попадание читается в полной темноте. */
  hitSplash(x: number, y: number, dirX: number, killed = false): void {
    const h = VFX.aero.hitSplash
    // Кольцо из пула (3 — перекрытие малое: всплески реже чавканья).
    let ring = this.aeroRings.find((r) => !r.visible)
    if (!ring) ring = this.aeroRings[0]
    this.scene.tweens.killTweensOf(ring)
    ring.setPosition(x, y)
      .setScale(h.ringScaleFrom)
      .setAlpha(h.ringAlpha * (killed ? 1.25 : 1))
      .setVisible(true)
    this.scene.tweens.add({
      targets: ring,
      scale: h.ringScaleTo * (killed ? 1.2 : 1),
      alpha: 0,
      duration: h.ringMs,
      ease: 'Cubic.Out',
      onComplete: () => ring!.setVisible(false),
    })
    // Конус искр по направлению укуса (в сторону жертвы), с гравитацией.
    const dir = dirX >= 0 ? -25 : 205
    const count = Math.max(
      2,
      Math.round(h.sparkCount * (killed ? 1.5 : 1) * QUALITY.particleMult),
    )
    this.aeroEmitter.setConfig({
      speed: { min: h.sparkSpeedMin, max: h.sparkSpeedMax },
      angle: { min: dir - h.sparkSpreadDeg / 2, max: dir + h.sparkSpreadDeg / 2 },
      gravityY: h.sparkGravityY,
      lifespan: { min: h.sparkLifeMin, max: h.sparkLifeMax },
      scale: { start: h.sparkScaleStart, end: h.sparkScaleEnd },
      alpha: { start: h.sparkAlphaStart, end: 0 },
      tint: h.tint,
      emitting: false,
    })
    this.aeroEmitter.emitParticleAt(x, y, count)
    // Мгновенная циановая вспышка (glow-cyan, пул из 2).
    let glow = this.aeroGlows.find((g) => !g.visible)
    if (!glow) glow = this.aeroGlows[0]
    this.scene.tweens.killTweensOf(glow)
    glow.setPosition(x, y)
      .setScale(h.flashScale)
      .setAlpha(h.flashAlpha)
      .setVisible(true)
    this.scene.tweens.add({
      targets: glow,
      alpha: 0,
      scale: h.flashScale * 2.2,
      duration: h.flashMs,
      ease: 'Quad.Out',
      onComplete: () => glow!.setVisible(false),
    })
  }

  // ── Glow-ореолы (шаг 10: bloom-спрайты вместо postFX) ──────────────────────

  /**
   * Зарегистрировать ореол для мягкого свечения. Раньше вешал
   * postFX.addGlow — отдельный фреймбуфер-пасс на объект, из-за чего
   * полсотни пассов за кадр роняли FPS. Теперь bloom — копия текстуры
   * чуть крупнее и тусклее, синхронизируется с целью каждый кадр.
   */
  registerGlow(target: Phaser.GameObjects.Image): void {
    // Шаг 18: если цель живёт НАД маской тьмы, блюм обязан быть тоже над
    // ней (иначе его съест вуаль полной тьмы) — но чуть ниже самой цели.
    const bloomDepth = target.depth >= LIGHT.halo.depth
      ? target.depth - 0.1
      : target.depth - 1
    const bloom = this.scene.add.image(target.x, target.y, target.texture.key)
      .setDepth(bloomDepth)
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
