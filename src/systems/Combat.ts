import Phaser from 'phaser'
import { BALANCE } from '../config/balance'
import { ENEMIES } from '../config/enemies'
import type { Creature } from '../entities/Creature'
import type { Enemy } from '../entities/Enemy'
import type { BloodFx } from './BloodFx'
import type { HitStop } from './HitStop'
import type { Vitals } from './Vitals'
import type { Eating } from './Eating'

/**
 * Combat — шаг 6: укус существа.
 * Состояния: ready → windup (телеграф: существо приседает, челюсть
 * раскрывается) → active (рывок + окно хитбокса) → recover (откат =
 * «Скорость атаки» из GDD). Попадание: хитстоп 80мс, тряска 4px,
 * выброс крови + декали, число урона, отброс жертвы.
 * Кнопка укуса контекстная: рядом туша — жуём, иначе кусаем.
 *
 * Шаг 13 (Dead Cells): серия укусов — попадания без паузы windowMs
 * наращивают множитель урона (потолок maxMult). Урон по существу
 * сбрасывает серию: агрессия наказывается болью, награждается уроном.
 *
 * Шаг 24 (заказ игрока): два НОВЫХ удара —
 *  • СИЛЬНЫЙ УДАР (K/ПКМ/тач): heavy-windup (долгий телеграф-присед,
 *    рвётся от урона) → heavy-active (×урон, широкая дуга, стан,
 *    полукруг брони) → recover. Инструмент против панцирей и толпы.
 *  • УДАР С ПОЛЁТА (J в падении/плане): dive — диагональный пике-наскок
 *    по стае; попадание подбрасывает охотника (цепочки), приземление
 *    без добычи бьёт ударной волной. Все числа — balance.json heavy/dive.
 */
export type BiteState = 'ready' | 'windup' | 'active' | 'recover' | 'heavy-windup' | 'heavy-active' | 'dive'

export interface CombatMods {
  /** Стан жертвы от укуса (мутация «Электроорганы»). */
  stunMs: number
  /** Отражение урона атакующему («Токсичная шкура»). */
  thorns: number
  /** «Паразитная слюна» (шаг 8): укушенные истекают кровью. */
  parasite: { dps: number; durationMs: number } | null
  /** Шаг 11 (Гнездо): прибавка к радиусу/сектору укуса, множители выпада и замаха. */
  biteRangeBonus: number
  biteArcBonus: number
  lungeMult: number
  windupMult: number
  /** «Пасть-капкан» (шаг 11): укус кислотный (рвёт броню) и станит сильнее. */
  capJaw: boolean
  /** «Охота из тени» (шаг 11): первый укус по мобу ×2. */
  nightPounce: boolean
  /** «Удар из темноты» (шаг 11): урон ×1.25 по мобам дальше этого расстояния. */
  darkStrikeDist: number
}

export class Combat {
  stateName: BiteState = 'ready'
  private stateUntil = 0
  private hitSet = new Set<Enemy>()
  /** Приоритет укуса — направление существа. */
  private touchBiteQueued = false
  private keyJustPressed = false
  /** Шаг 24: запрос сильного удара (K / ПКМ / тач-кнопка). */
  private heavyQueued = false

  /** Модификаторы мутаций (ставит сцена при подборе) и Гнезда (шаг 11). */
  mods: CombatMods = {
    stunMs: 0,
    thorns: 0,
    parasite: null,
    biteRangeBonus: 0,
    biteArcBonus: 0,
    lungeMult: 1,
    windupMult: 1,
    capJaw: false,
    nightPounce: false,
    darkStrikeDist: 0,
  }

  /** Шаг 11: мобы, которых уже кусали хоть раз (для «Охоты из тени»). */
  private everBitten = new Set<Enemy>()

  // ── Шаг 13 (Dead Cells): серия укусов ─────────────────────────────────
  private comboHits = 0
  private comboUntil = 0
  /** Лучшая серия за забег (экран итога/debug). */
  comboBest = 0

  /** Ударов в текущей серии (окно проверяется по времени). */
  get combo(): number {
    return this.scene.time.now <= this.comboUntil ? this.comboHits : 0
  }

  /** Множитель урона от накопленной серии (1 — серии нет). */
  get comboMult(): number {
    const c = BALANCE.combo
    if (this.comboHits < c.minHits || this.scene.time.now > this.comboUntil) return 1
    return Math.min(c.maxMult, 1 + (this.comboHits - c.minHits + 1) * c.damageStep)
  }

  /** Доля остатка окна серии (0..1) — полоска затухания в HUD. */
  get comboRatio(): number {
    const left = this.comboUntil - this.scene.time.now
    return left <= 0 ? 0 : Math.min(1, left / BALANCE.combo.windowMs)
  }

  /** Попадание засчитано в серию. */
  private bumpCombo(): void {
    const now = this.scene.time.now
    this.comboHits = now <= this.comboUntil ? this.comboHits + 1 : 1
    this.comboUntil = now + BALANCE.combo.windowMs
    this.comboBest = Math.max(this.comboBest, this.comboHits)
  }

  /** Урон существу — серия рвётся (болевой шок). */
  resetCombo(): void {
    this.comboHits = 0
    this.comboUntil = 0
  }

  constructor(
    private scene: Phaser.Scene,
    private creature: Creature,
    private vitals: Vitals,
    private enemies: () => Enemy[],
    private blood: BloodFx,
    private hitStop: HitStop,
    private eating: Eating,
  ) {}

  get busy(): boolean {
    return this.stateName !== 'ready'
  }

  /** Внешние триггеры: клавиатура (J) обрабатывается сценой, тач — кнопка. */
  queueTouchBite(): void {
    this.touchBiteQueued = true
  }

  queueKeyBite(): void {
    this.keyJustPressed = true
  }

  /** Шаг 24: сильный удар — клавиша K / ПКМ / тач-кнопка «УДАР». */
  queueHeavy(): void {
    this.heavyQueued = true
  }

  /** Вызывать из scene.update, когда мир НЕ заморожен. */
  update(time: number): void {
    const p = BALANCE.player
    const wantBite = this.keyJustPressed || this.touchBiteQueued
    const wantHeavy = this.heavyQueued
    this.keyJustPressed = false
    this.touchBiteQueued = false
    this.heavyQueued = false

    if (this.stateName === 'ready') {
      if (wantBite && this.vitals.alive) {
        // Контекст: рядом туша — едим вместо укуса (только на земле).
        const body = this.creature.body as Phaser.Physics.Arcade.Body
        const airborne = !body.blocked.down && !body.touching.down
        if (!airborne) {
          const carcass = this.eating.nearestCarcass(this.creature.x, this.creature.y, p.biteRange + 14)
          if (carcass) {
            this.eating.startChewing(carcass)
            return
          }
        }
        // Шаг 24: в падении/плане J = УДАР С ПОЛЁТА (пике-наскок).
        if (airborne && body.velocity.y >= BALANCE.dive.minVy) {
          this.beginDive(time)
          return
        }
        this.beginWindup(time)
      } else if (wantHeavy && this.vitals.alive) {
        this.beginHeavyWindup(time)
      }
      return
    }

    if (this.stateName === 'dive') {
      this.updateDive(time)
      return
    }

    if (time >= this.stateUntil) {
      if (this.stateName === 'windup') {
        this.beginActive(time)
      } else if (this.stateName === 'active') {
        this.stateName = 'recover'
        this.stateUntil = time + p.biteCooldownMs - p.biteWindupMs - p.biteActiveMs
      } else if (this.stateName === 'heavy-windup') {
        this.beginHeavyActive(time)
      } else if (this.stateName === 'heavy-active') {
        this.stateName = 'recover'
        this.stateUntil = time + BALANCE.heavy.cooldownMs - BALANCE.heavy.activeMs
      } else if (this.stateName === 'recover') {
        this.stateName = 'ready'
      }
      return
    }

    if (this.stateName === 'active' || this.stateName === 'heavy-active') {
      this.checkHits(this.stateName === 'heavy-active')
    }
  }

  private beginWindup(time: number): void {
    this.stateName = 'windup'
    this.stateUntil = time + BALANCE.player.biteWindupMs * this.mods.windupMult
    this.hitSet.clear()
    this.creature.biteWindupVisual()
  }

  // ── Шаг 24: СИЛЬНЫЙ УДАР ────────────────────────────────────────────

  private beginHeavyWindup(time: number): void {
    const h = BALANCE.heavy
    this.stateName = 'heavy-windup'
    this.stateUntil = time + h.windupMs * this.mods.windupMult
    this.hitSet.clear()
    this.creature.heavyWindupVisual(h.windupMs * this.mods.windupMult)
    this.onHeavyCharge?.()
  }

  private beginHeavyActive(time: number): void {
    const h = BALANCE.heavy
    this.stateName = 'heavy-active'
    this.stateUntil = time + h.activeMs

    // Короткий шаг вперёд — вес удара чувствуется в движении.
    const body = this.creature.body as Phaser.Physics.Arcade.Body
    body.velocity.x = this.creature.facing * h.lungeSpeed * this.mods.lungeMult

    this.creature.heavyActiveVisual()
    this.onHeavyRelease?.(true)
    this.onBiteSwing?.()
    this.checkHits(true)
  }

  /** Прервать сильный удар (урон по игроку рвёт замах). */
  private cancelHeavy(): void {
    if (this.stateName !== 'heavy-windup') return
    this.stateName = 'ready'
    this.stateUntil = 0
    this.onHeavyRelease?.(false)
  }

  // ── Шаг 24: УДАР С ПОЛЁТА (пике-наскок) ────────────────────────────

  private beginDive(time: number): void {
    const d = BALANCE.dive
    this.stateName = 'dive'
    this.stateUntil = time + d.maxMs
    this.hitSet.clear()
    this.creature.forceUncling()
    const body = this.creature.body as Phaser.Physics.Arcade.Body
    body.setAllowGravity(true)
    body.velocity.x = this.creature.facing * d.vx
    body.velocity.y = d.vy
    this.creature.diveTilt = true
    this.onDiveStart?.()
  }

  private updateDive(time: number): void {
    const d = BALANCE.dive
    const body = this.creature.body as Phaser.Physics.Arcade.Body

    // Пике держит курс: ввод по горизонтали не мешает (зафиксирован).
    body.velocity.x = this.creature.facing * d.vx

    // Наскок: любой враг в радиусе — жертва.
    let struck = false
    for (const enemy of this.enemies()) {
      if (enemy.dead || this.hitSet.has(enemy)) continue
      const dx = enemy.x - this.creature.x
      const dy = enemy.y - this.creature.y
      if (Math.hypot(dx, dy) > d.hitRadius) continue
      this.hitSet.add(enemy)
      this.applyHit(enemy, 0, {
        dmgMult: d.damageMult,
        knockForce: d.knockback,
        stunMs: Math.round(d.shakeMs),
        hitstopMs: d.hitstopMs,
        shakePx: d.shakePx,
        shakeMs: d.shakeMs,
      })
      struck = true
    }
    if (struck) {
      // Подброс: охотник отскакивает от жертвы — можно цепочкой пике.
      body.velocity.y = d.bounceVy
      this.endDive(240)
      return
    }

    // Приземление без добычи — ударная волна по радиусу.
    if (body.blocked.down || body.touching.down) {
      this.diveShockwave()
      this.endDive(300)
      return
    }

    // Страховка от бесконечного пике.
    if (time >= this.stateUntil) this.endDive(200)
  }

  private endDive(recoverMs: number): void {
    this.creature.diveTilt = false
    this.stateName = 'recover'
    this.stateUntil = this.scene.time.now + recoverMs
    this.onDiveEnd?.()
  }

  /** Ударная волна приземления: круговой урон + отброс от центра. */
  private diveShockwave(): void {
    const d = BALANCE.dive
    const cx = this.creature.x
    const cy = this.creature.y
    let any = false
    for (const enemy of this.enemies()) {
      if (enemy.dead) continue
      const dx = enemy.x - cx
      const dy = enemy.y - cy
      const dist = Math.hypot(dx, dy)
      if (dist > d.shockRadius) continue
      this.applyHit(enemy, 0, {
        dmgMult: d.shockDamageMult,
        knockForce: d.shockKnockback,
        stunMs: 120,
        hitstopMs: d.hitstopMs,
        shakePx: Math.round(d.shakePx * 0.7),
        shakeMs: Math.round(d.shakeMs * 0.7),
      })
      any = true
    }
    this.hitStop.freeze(d.hitstopMs)
    this.shakeCamera(d.shakePx, d.shakeMs)
    this.onDiveLand?.(cx, cy, any)
  }

  private beginActive(time: number): void {
    const p = BALANCE.player
    this.stateName = 'active'
    this.stateUntil = time + p.biteActiveMs

    // Рывок в сторону взгляда (в воздухе не гасим вертикаль).
    const body = this.creature.body as Phaser.Physics.Arcade.Body
    const facing = this.creature.facing
    body.velocity.x = facing * p.biteLungeSpeed * this.mods.lungeMult

    this.creature.biteActiveVisual()
    this.onBiteSwing?.()
    this.checkHits()
  }

  /** Дуга укуса: враги в радиусе и в секторе взгляда (heavy — шире). */
  private checkHits(heavy = false): void {
    const p = BALANCE.player
    const h = BALANCE.heavy
    const facing = this.creature.facing
    const px = this.creature.x
    const py = this.creature.y
    const range = (p.biteRange + this.mods.biteRangeBonus) * (heavy ? h.rangeMult : 1)
    const arc = heavy ? h.arcDeg : p.biteArcDeg + this.mods.biteArcBonus

    for (const enemy of this.enemies()) {
      if (enemy.dead || this.hitSet.has(enemy)) continue
      const dx = enemy.x - px
      const dy = enemy.y - py
      if (Math.abs(dx) > range || Math.abs(dy) > range * 0.75) continue
      if (dx * facing < 0) continue
      const dist = Math.hypot(dx, dy)
      if (dist > range) continue
      const angle = Phaser.Math.RadToDeg(Math.atan2(dy, dx * facing))
      if (Math.abs(angle) > arc / 2) continue

      this.hitSet.add(enemy)
      if (heavy) {
        this.applyHit(enemy, dist, {
          dmgMult: h.damageMult,
          knockForce: Math.round(p.biteKnockback * h.knockbackMult),
          stunMs: h.stunMs + this.mods.stunMs,
          resistMult: 1 - h.armorPierce,
          hitstopMs: h.hitstopMs,
          shakePx: h.shakePx,
          shakeMs: h.shakeMs,
          heavy: true,
        })
      } else {
        this.applyHit(enemy, dist)
      }
      // «Паразитная слюна» (шаг 8): укушенный истекает кровью.
      if (this.mods.parasite) {
        enemy.applyParasite(this.mods.parasite.dps, this.mods.parasite.durationMs)
      }
    }
  }

  /** Параметры удара (шаг 24): обычный укус — по умолчанию, сильный
   *  удар/пике переопределяют урон/отброс/стан/броню/джус. */
  private applyHit(
    enemy: Enemy,
    dist = 0,
    o: {
      dmgMult?: number
      knockForce?: number
      stunMs?: number
      /** Множитель на сопротивление брони (1 — как есть). */
      resistMult?: number
      hitstopMs?: number
      shakePx?: number
      shakeMs?: number
      heavy?: boolean
    } = {},
  ): void {
    const hit = BALANCE.hit
    const facing = this.creature.facing
    // «Кислотные железы»/«Пасть-капкан» (шаг 11): укус растворяет панцири.
    const dmgType: import('../config/enemies').DamageType =
      this.vitals.biteAcid || this.mods.capJaw ? 'acid' : 'physical'
    // Гнездо (шаг 11): «Охота из тени» — первый укус ×2; «Удар из темноты»
    // — по мобам за пределами света ×1.25.
    let mult = o.dmgMult ?? 1
    if (this.mods.nightPounce && !this.everBitten.has(enemy)) mult *= 2
    if (this.mods.darkStrikeDist > 0 && dist > this.mods.darkStrikeDist) mult *= 1.25
    this.everBitten.add(enemy)
    // Шаг 13 (Dead Cells): серия укусов накачивает урон.
    mult *= this.comboMult
    const base = Math.round(this.vitals.biteDamage * mult)
    const applied = enemy.takeDamage(
      base, facing, o.stunMs ?? this.mods.stunMs, dmgType, 'player', undefined,
      o.knockForce != null ? { knockForce: o.knockForce, resistMult: o.resistMult ?? 1 } : undefined,
    )
    const killed = enemy.dead
    // Попадание (не срезанное бронёй) — серия растёт; убийство — тоже.
    if (applied > 0) this.bumpCombo()
    // Шаг 13 (Dead Cells): оверкилл — убойный урон рвёт жертву на куски.
    if (killed && applied >= enemy.maxHp * ENEMIES.gib.overkillShare) {
      enemy.overkilled = true
    }
    // Шаг 10: урон полностью срезан броней — металл-панцирь «кланк».
    if (applied <= 0 && !killed) this.onArmorClank?.()

    // Кровь в сторону укуса + на пол под жертвой.
    this.blood.burst(enemy.x, enemy.y, {
      count: killed
        ? BALANCE.blood.particlesPerKill[0]
        : Math.min(BALANCE.blood.particlesPerHit[1], BALANCE.blood.particlesPerHit[0] + (o.heavy ? 12 : 0)),
      dirDeg: facing < 0 ? 200 : -20,
      spreadDeg: 110,
    })

    // Шаг 20: всплеск удара — сцена вешает аэро-джус (кольцо/искры/вспышка
    // НАД маской тьмы — «ауры ударов, сплеши» из пожелания игрока).
    if (applied > 0 || killed) this.onBiteHit?.(enemy.x, enemy.y, facing, killed)
    if (o.heavy && (applied > 0 || killed)) this.onHeavyStrike?.(enemy.x, enemy.y, facing)

    // Juice: хитстоп + тряска (гайд: 80мс / 4px).
    // Туша/кровь-взрыв/мутации ставит сцена в Enemy onDeath (единая точка —
    // чтобы «Токсичная шкура» и прочие косвенные смерти тоже оставляли добычу).
    if (killed) {
      this.hitStop.freeze(hit.killHitstopMs)
      this.shakeCamera(hit.killShakePx, hit.killShakeMs)
      this.blood.number(enemy.x, enemy.y - 18, `${Math.round(applied)}`, '#ffffff', true)
    } else {
      this.hitStop.freeze(o.hitstopMs ?? hit.hitstopMs)
      this.shakeCamera(o.shakePx ?? hit.shakePx, o.shakeMs ?? hit.shakeMs)
      this.blood.number(enemy.x, enemy.y - 16, `${Math.round(applied)}`, o.heavy ? '#E8A34F' : '#ffffff')
    }
  }

  /** Тряска в пикселях: intensity Phaser — доля ширины кадра. */
  private shakeCamera(px: number, ms: number): void {
    const cam = this.scene.cameras.main
    cam.shake(ms, px / cam.width)
  }

  /** Причина последнего удара (для экрана итога, шаг 8). */
  lastHitCause = 'пещера'

  /** Шаг 9: тяжёлый урон — сцена включает хроматику. */
  onHeavyHit: ((damage: number) => void) | null = null
  /** Шаг 24: хук джуса сильного удара/пике (кольцо + вспышка). */
  onHeavyStrike: ((x: number, y: number, facing: number) => void) | null = null
  /** Шаг 24: замах сильного удара — сцена рисует заряд-сияние. */
  onHeavyCharge: (() => void) | null = null
  /** Шаг 24: замах закончился (fired — ударом, иначе — прерван уроном). */
  onHeavyRelease: ((fired: boolean) => void) | null = null
  /** Шаг 24: старт пике — сцена включает шлейф. */
  onDiveStart: (() => void) | null = null
  /** Шаг 24: конец пике (любой исход). */
  onDiveEnd: (() => void) | null = null
  /** Шаг 24: приземление пике — пыль + ударная волна (any — задел ли кого-то). */
  onDiveLand: ((x: number, y: number, any: boolean) => void) | null = null
  /** Шаг 20: попадание укуса по жертве — сцена вешает всплеск-джус. */
  onBiteHit: ((x: number, y: number, facing: number, killed: boolean) => void) | null = null
  /** Шаг 10: начало выпада укуса (сцена играет звук). */
  onBiteSwing: (() => void) | null = null
  /** Шаг 10: урон полностью поглощен броней (панцирь — «кланк»). */
  onArmorClank: (() => void) | null = null

  /** Урон игроку: мигание неуязвимости возвращает интервал. */
  hurtPlayer(damage: number, cause = 'пещера'): number {
    const p = BALANCE.player
    const now = this.scene.time.now
    this.lastHitCause = cause
    if (now < this.invulnUntil) return 0
    this.vitals.lastDamageCause = this.lastHitCause
    const applied = this.vitals.damageWithMult(damage)
    if (applied >= 0 && this.vitals.alive) {
      // Шаг 9: тяжёлый удар (≥12 или до половины HP) — рывок хроматики.
      if (damage >= 12 || this.vitals.hpRatio < 0.5) this.onHeavyHit?.(damage)
      this.invulnUntil = now + p.invulnAfterHitMs
      // Шаг 13: боль рвёт серию укусов.
      this.resetCombo()
      // Шаг 24: боль рвёт и замах сильного удара — телеграф наказуем.
      this.cancelHeavy()
      // Шаг 12: удар сбивает со стены — сцеп теряется (гравитация назад).
      this.creature.forceUncling()
      this.creature.hurtVisual(p.invulnAfterHitMs)
      this.blood.burst(this.creature.x, this.creature.y, {
        count: BALANCE.blood.particlesPerHit[0],
        dirDeg: 90,
        spreadDeg: 360,
      })
      this.blood.number(this.creature.x, this.creature.y - 22, `−${damage}`, '#E23A4E', true)
      this.hitStop.freeze(BALANCE.hit.hitstopMs)
      this.shakeCamera(BALANCE.hit.shakePx + 2, BALANCE.hit.shakeMs + 40)
    }
    return applied
  }

  private invulnUntil = 0

  get isInvulnerable(): boolean {
    return this.scene.time.now < this.invulnUntil
  }

  /** Отражение «Токсичной шкуры» — вызывает сцена после урона игроку. */
  reflectThorns(attacker: Enemy): void {
    if (this.mods.thorns <= 0 || attacker.dead) return
    attacker.takeDamage(this.mods.thorns, Math.sign(attacker.x - this.creature.x) || 1, 0, 'physical', 'player')
    this.blood.burst(attacker.x, attacker.y, { count: 8, dirDeg: 90, spreadDeg: 360 })
    this.blood.number(attacker.x, attacker.y - 14, `${this.mods.thorns}`, '#a8e34f')
  }

  // ── Каналы непрерывного урона шага 7 (экосистема атакует и без укусов).
  // Не расходуют неуязвимость после удара (это не удар, а среда/канал),
  // но уважают смерть и «Второе сердце» в Vitals.

  /** Пиявка кровососа: малые порции без отброса и хитстопа. */
  hurtPlayerDrain(amount: number, cause = 'кровосос'): number {
    if (!this.vitals.alive) return 0
    this.vitals.lastDamageCause = cause
    const applied = this.vitals.damageWithMult(amount)
    if (applied > 0) {
      this.blood.number(this.creature.x + Phaser.Math.Between(-8, 8), this.creature.y - 26, `−${Math.round(applied)}`, '#E23A4E')
    }
    return applied
  }

  /** Огонь лавового следа: тикает по tickMs, пока цель в луже. */
  hurtPlayerFire(amount: number, cause = 'огненный след'): number {
    if (!this.vitals.alive) return 0
    this.vitals.lastDamageCause = cause
    const applied = this.vitals.damageWithMult(amount)
    if (applied > 0) {
      this.blood.number(this.creature.x + Phaser.Math.Between(-10, 10), this.creature.y - 24, `−${Math.round(applied)}`, '#E2763A')
      this.creature.hurtVisual(240)
    }
    return applied
  }

  /** Спора жнеца: снаряд — как урон по игроку, с неуязвимостью и juice. */
  hurtPlayerSpore(damage: number, cause = 'споры жнеца'): number {
    if (!this.vitals.alive) return 0
    const now = this.scene.time.now
    if (now < this.invulnUntil) return 0
    this.vitals.lastDamageCause = cause
    const applied = this.vitals.damageWithMult(damage)
    if (applied >= 0 && this.vitals.alive) {
      this.invulnUntil = now + BALANCE.player.invulnAfterHitMs
      this.creature.hurtVisual(BALANCE.player.invulnAfterHitMs)
      // Споровая пыль: фиолетовый выброс + замедление существа.
      this.blood.burst(this.creature.x, this.creature.y, {
        count: 10, dirDeg: 90, spreadDeg: 360, texture: 'spore', sticky: false,
      })
      this.blood.number(this.creature.x, this.creature.y - 24, `−${damage}`, '#B36BFF', true)
      this.creature.slowUntil = now + BALANCE.spore.slowMs
      this.hitStop.freeze(BALANCE.hit.hitstopMs)
      this.shakeCamera(BALANCE.hit.shakePx, BALANCE.hit.shakeMs)
    }
    return applied
  }

  /** Текущее состояние (debug). */
  get state(): BiteState {
    return this.stateName
  }
}
