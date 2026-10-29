import Phaser from 'phaser'
import { BALANCE } from '../config/balance'
import { LIGHT } from '../config/light'
import { VFX } from '../config/vfx'
import { QUALITY } from './quality'
import type { BloodFx } from './BloodFx'
import type { HitStop } from './HitStop'
import type { Vfx } from './Vfx'

/**
 * MeleeFx — шаг 27: «визуальная отдача ближнего боя». Презентационный слой
 * ПОВЕРХ существующих атак и событий попадания: ни урона, ни хитбоксов,
 * ни ФСМ не трогает. Всё событийно — эффект существует только потому, что
 * произошло реальное событие боя:
 *
 *  • СЛЕД АТАКИ (swing): пунктир из коротких штрихов (bullet.png, ADD)
 *    РОВНО ПО ГРАНИЦЕ ХИТБОКСА — точки снимает Combat.swingGeometry()
 *    той же формулой, что checkHits. След не может «не совпасть с
 *    хитбоксом»: он и есть хитбокс. Возникает на onBiteSwing (старт
 *    выпада — и на промахе, потому что это замах, а не контакт).
 *    Укус — биолюм-циан (контракт существа), сильный удар — янтарь
 *    (семейство тяжёлого урона: числа/кольца). Живёт trailMs и гаснет
 *    В НУЛЬ — никаких постоянных полос.
 *
 *  • ШТРИХИ ПИКЕ (diveStreak): пара резких черточек против траектории,
 *    пока Combat в состоянии dive (тише следа укуса — пике читается
 *    скоростью). Стартует сцена из updateAero по таймеру dive.everyMs.
 *
 *  • ВСПЫШКА ПОПАДАНИЯ (impact → Vfx.hitSplash boost): один вызов на
 *    подтверждённое попадание (applied>0 или killed) — двойных вспышек
 *    нет по построению. Сила различается по виду удара: укус 1 /
 *    пике 1.15 / сильный 1.2 / убийство 1.35, поверх flashIntensity.
 *    Промах и «кланк» по свёрнутому панцирю вспышки не дают —
 *    на броне только искры отскока (onArmorClank → Vfx.sparks).
 *
 *  • ОСКОЛКИ И ПЫЛЬ: пиксельные костяные осколки (shard.png, свой
 *    пул-эмиттер) — только значимые удары: сильный/пике/убийство;
 *    направление наследует удар (вперёд от атакующего / диагональ
 *    пике из atan2(dive.vy, dive.vx)), разброс ±spreadDeg/2, гравитация.
 *    Пыль веса сильного удара — переиспользованный BloodFx.burst
 *    (текстура dust, как при приземлении). Равномерных взрывов на 360°
 *    нет: все выбросы направленные и малочисленные.
 *
 * Выключение: vfx.json meleeFx.enabled=0 (или window.__MFX__(false) в
 * рантайме) — слой молчит, базовая боёвка и эффекты шагов 6-24 живут
 * как раньше (splash возвращается к boost=1, Combat — к масштабам 1).
 *
 * Пулы: dash-пул bullet.png (dashPoolSize, round-robin — как flashPool
 * у вспышек); debris-эмиттер один на все вызовы (конфиг на вызов —
 * паттерн aeroEmitter). Всё создано в create() сцены → рестарт слоя
 * даёт чистые пулы и нулевые счётчики.
 */

/** Геометрия взмаха от Combat.swingGeometry() — структурный тип (без импорта Combat). */
export interface SwingGeo {
  heavy: boolean
  points: ReadonlyArray<{ x: number; y: number; rotDeg: number; edgeT: number }>
}

/** Вид удара для импакта (сцена выводит из combat.state в onBiteHit). */
export type ImpactKind = 'bite' | 'heavy' | 'dive'

export class MeleeFx {
  private readonly dashPool: Phaser.GameObjects.Image[] = []
  private dashCursor = 0
  private readonly debrisEmitter: Phaser.GameObjects.Particles.ParticleEmitter

  // Счётчики для тестов шага 27 (событийность, очистка, отсутствие дублей).
  private stSwings = 0
  private stImpacts = 0
  private stDebris = 0
  private stStreaks = 0
  private stDust = 0
  private lastBoost = 1

  constructor(
    private scene: Phaser.Scene,
    private vfx: Vfx,
    private blood: BloodFx,
    private hitStop: HitStop,
  ) {
    // Штрихи следов: bullet.png (тёплый трассер — tint задаёт семейство:
    // циан укуса / янтарь сильного / циан пике). ADD, над маской тьмы.
    for (let i = 0; i < VFX.meleeFx.trail.dashPoolSize; i++) {
      this.dashPool.push(scene.add.image(0, 0, 'bullet')
        .setDepth(LIGHT.halo.lumenDepth + 0.25)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setVisible(false))
    }
    // Осколки: один пул-эмиттер на все вызовы (конфиг меняется на бёрст — паттерн
    // aeroEmitter у Vfx). Материя, не свет: обычный бленд, глубина у кольца всплеска.
    this.debrisEmitter = scene.add.particles(0, 0, 'shard', { emitting: false })
      .setDepth(LIGHT.halo.lumenDepth + 0.15)
    this.hitStop.track(this.debrisEmitter)

    // Рантайм-тумблер шага 27 (тесты agent-browser / любопытные игроки):
    // __MFX__() — переключить, __MFX__(false|true) — выставить.
    ;(window as unknown as { __MFX__?: (on?: boolean) => number }).__MFX__ = (on) => {
      VFX.meleeFx.enabled = on === undefined
        ? (VFX.meleeFx.enabled ? 0 : 1)
        : (on ? 1 : 0)
      return VFX.meleeFx.enabled
    }
  }

  private on(): boolean {
    return VFX.meleeFx.enabled !== 0
  }

  private nextDash(): Phaser.GameObjects.Image {
    const img = this.dashPool[this.dashCursor]
    this.dashCursor = (this.dashCursor + 1) % this.dashPool.length
    return img
  }

  // ── СЛЕД АТАКИ ──────────────────────────────────────────────────────────

  /** Пунктир по границе хитбокса текущего взмаха (bite/heavy из Combat). */
  swing(geo: SwingGeo): void {
    if (!this.on()) return
    const t = VFX.meleeFx.trail
    const life = VFX.meleeFx.trailMs * (geo.heavy ? t.heavyLifeK : 1)
    const tint = geo.heavy ? t.tintHeavy : t.tintBite
    for (const p of geo.points) {
      const img = this.nextDash()
      this.scene.tweens.killTweensOf(img)
      img.setPosition(p.x, p.y)
        .setRotation(Phaser.Math.DegToRad(p.rotDeg))
        .setScale(t.scale)
        .setTint(tint)
        // Центр дуги (edgeT=0) — ярче; к краям (edgeT=1) — ×edgeAlphaK.
        .setAlpha(Math.min(1, t.alpha * (1 - (1 - t.edgeAlphaK) * p.edgeT)))
        .setVisible(true)
      this.scene.tweens.add({
        targets: img,
        alpha: 0,
        duration: life,
        ease: 'Quad.Out',
        onComplete: () => img.setVisible(false),
      })
    }
    this.stSwings++
  }

  /** Штрих пике: пара черточек веером вокруг оси движения (зад на траектории). */
  diveStreak(x: number, y: number, angleDeg: number): void {
    if (!this.on()) return
    const d = VFX.meleeFx.dive
    const life = VFX.meleeFx.trailMs * d.lifeK
    const n = Math.max(1, Math.round(d.streaks))
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * (d.spreadDeg / Math.max(1, n - 1))
      const img = this.nextDash()
      this.scene.tweens.killTweensOf(img)
      img.setPosition(x, y)
        .setRotation(Phaser.Math.DegToRad(angleDeg + off))
        .setScale(d.scale)
        .setTint(d.tint)
        .setAlpha(d.alpha)
        .setVisible(true)
      this.scene.tweens.add({
        targets: img,
        alpha: 0,
        duration: life,
        ease: 'Quad.Out',
        onComplete: () => img.setVisible(false),
      })
    }
    this.stStreaks += n
  }

  // ── ИМПАКТ: вспышка + осколки + пыль ────────────────────────────────────

  /**
   * Подтверждённое попадание (onBiteHit). Один вызов = одна вспышка:
   * силой по виду удара, осколки только значимым, пыль — сильному
   * без убийства. Слой выключен → базовый сплеш шага 20 как раньше.
   */
  impact(x: number, y: number, facing: number, killed: boolean, kind: ImpactKind): void {
    this.stImpacts++
    const m = VFX.meleeFx
    if (!this.on()) {
      this.lastBoost = 1
      this.vfx.hitSplash(x, y, facing, killed)
      return
    }
    const power = killed ? m.boost.kill : kind === 'heavy' ? m.boost.heavy : kind === 'dive' ? m.boost.dive : 1
    const boost = Math.max(0, m.flashIntensity * power)
    this.lastBoost = boost
    this.vfx.hitSplash(x, y, facing, killed, boost)

    // Осколки: значимые удары (не простой укус — у него кровь и искры).
    const db = m.debris
    const count = killed ? db.countKill : kind === 'heavy' ? db.countHeavy : kind === 'dive' ? db.countDive : 0
    if (count > 0) {
      const dirDeg = kind === 'dive'
        ? (facing > 0 ? this.diveDirDeg() : 180 - this.diveDirDeg())
        : (facing > 0 ? db.dirDeg : 180 - db.dirDeg)
      this.debrisBurst(x, y, dirDeg, count)
    }

    // Пыль веса: только сильный удар без убийства (на убийстве — фонтан крови).
    if (kind === 'heavy' && !killed) {
      this.stDust++
      this.blood.burst(x, y + 6, {
        count: Math.max(2, Math.round(db.dustCount * m.particleCount * QUALITY.particleMult)),
        dirDeg: 90,
        spreadDeg: db.dustSpreadDeg,
        speedMult: db.dustSpeedMult,
        texture: 'dust',
        sticky: false,
      })
    }
  }

  /** Направление осколков пике — диагональ наскока из balance.json dive. */
  private diveDirDeg(): number {
    return Math.round(Phaser.Math.RadToDeg(Math.atan2(BALANCE.dive.vy, BALANCE.dive.vx)))
  }

  private debrisBurst(x: number, y: number, dirDeg: number, baseCount: number): void {
    const d = VFX.meleeFx.debris
    const count = Math.max(2, Math.round(baseCount * VFX.meleeFx.particleCount * QUALITY.particleMult))
    this.debrisEmitter.setConfig({
      speed: { min: d.speedMin, max: d.speedMax },
      angle: { min: dirDeg - d.spreadDeg / 2, max: dirDeg + d.spreadDeg / 2 },
      gravityY: d.gravity,
      lifespan: { min: d.lifeMin, max: d.lifeMax },
      scale: { start: d.scaleStart, end: d.scaleEnd },
      alpha: { start: d.alphaStart, end: 0 },
      rotate: { min: d.rotateMin, max: d.rotateMax },
      tint: d.tint,
      emitting: false,
    })
    this.debrisEmitter.emitParticleAt(x, y, count)
    this.stDebris += count
  }

  // ── Диагностика (тесты шага 27) ─────────────────────────────────────────

  /** Живых штрихов сейчас (после гашения должно возвращаться к нулю). */
  get dashActive(): number {
    let n = 0
    for (const d of this.dashPool) if (d.visible) n++
    return n
  }

  get stats(): Record<string, number> {
    return {
      swings: this.stSwings,
      impacts: this.stImpacts,
      debris: this.stDebris,
      streaks: this.stStreaks,
      dust: this.stDust,
      dashActive: this.dashActive,
      lastBoost: this.lastBoost,
      enabled: this.on() ? 1 : 0,
      // Шаг 27: множитель качества в той же точке, что и бёрсты — тесты
      // считают ожидаемые количества частиц без дублирования формулы.
      particleMult: QUALITY.particleMult,
    }
  }
}
