import Phaser from 'phaser'
import { BALANCE } from '../config/balance'
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
 */
export type BiteState = 'ready' | 'windup' | 'active' | 'recover'

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

  /** Вызывать из scene.update, когда мир НЕ заморожен. */
  update(time: number): void {
    const p = BALANCE.player
    const wantBite = this.keyJustPressed || this.touchBiteQueued
    this.keyJustPressed = false
    this.touchBiteQueued = false

    if (this.stateName === 'ready') {
      if (wantBite && this.vitals.alive) {
        // Контекст: рядом туша — едим вместо укуса.
        const carcass = this.eating.nearestCarcass(this.creature.x, this.creature.y, p.biteRange + 14)
        if (carcass) {
          this.eating.startChewing(carcass)
          return
        }
        this.beginWindup(time)
      }
      return
    }

    if (time >= this.stateUntil) {
      if (this.stateName === 'windup') {
        this.beginActive(time)
      } else if (this.stateName === 'active') {
        this.stateName = 'recover'
        this.stateUntil = time + p.biteCooldownMs - p.biteWindupMs - p.biteActiveMs
      } else if (this.stateName === 'recover') {
        this.stateName = 'ready'
      }
      return
    }

    if (this.stateName === 'active') {
      this.checkHits()
    }
  }

  private beginWindup(time: number): void {
    this.stateName = 'windup'
    this.stateUntil = time + BALANCE.player.biteWindupMs * this.mods.windupMult
    this.hitSet.clear()
    this.creature.biteWindupVisual()
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

  /** Дуга укуса: враги в радиусе и в секторе взгляда. */
  private checkHits(): void {
    const p = BALANCE.player
    const facing = this.creature.facing
    const px = this.creature.x
    const py = this.creature.y

    for (const enemy of this.enemies()) {
      if (enemy.dead || this.hitSet.has(enemy)) continue
      const dx = enemy.x - px
      const dy = enemy.y - py
      const range = p.biteRange + this.mods.biteRangeBonus
      if (Math.abs(dx) > range || Math.abs(dy) > range * 0.75) continue
      if (dx * facing < 0) continue
      const dist = Math.hypot(dx, dy)
      if (dist > range) continue
      const angle = Phaser.Math.RadToDeg(Math.atan2(dy, dx * facing))
      if (Math.abs(angle) > (p.biteArcDeg + this.mods.biteArcBonus) / 2) continue

      this.hitSet.add(enemy)
      this.applyHit(enemy, dist)
      // «Паразитная слюна» (шаг 8): укушенный истекает кровью.
      if (this.mods.parasite) {
        enemy.applyParasite(this.mods.parasite.dps, this.mods.parasite.durationMs)
      }
    }
  }

  private applyHit(enemy: Enemy, dist = 0): void {
    const hit = BALANCE.hit
    const facing = this.creature.facing
    // «Кислотные железы»/«Пасть-капкан» (шаг 11): укус растворяет панцири.
    const dmgType: import('../config/enemies').DamageType =
      this.vitals.biteAcid || this.mods.capJaw ? 'acid' : 'physical'
    // Гнездо (шаг 11): «Охота из тени» — первый укус ×2; «Удар из темноты»
    // — по мобам за пределами света ×1.25.
    let mult = 1
    if (this.mods.nightPounce && !this.everBitten.has(enemy)) mult *= 2
    if (this.mods.darkStrikeDist > 0 && dist > this.mods.darkStrikeDist) mult *= 1.25
    this.everBitten.add(enemy)
    const base = Math.round(this.vitals.biteDamage * mult)
    const applied = enemy.takeDamage(base, facing, this.mods.stunMs, dmgType, 'player')
    const killed = enemy.dead
    // Шаг 10: урон полностью срезан броней — металл-панцирь «кланк».
    if (applied <= 0 && !killed) this.onArmorClank?.()

    // Кровь в сторону укуса + на пол под жертвой.
    this.blood.burst(enemy.x, enemy.y, {
      count: killed ? BALANCE.blood.particlesPerKill[0] : BALANCE.blood.particlesPerHit[0],
      dirDeg: facing < 0 ? 200 : -20,
      spreadDeg: 110,
    })

    // Juice: хитстоп + тряска (гайд: 80мс / 4px).
    // Туша/кровь-взрыв/мутации ставит сцена в Enemy onDeath (единая точка —
    // чтобы «Токсичная шкура» и прочие косвенные смерти тоже оставляли добычу).
    if (killed) {
      this.hitStop.freeze(hit.killHitstopMs)
      this.shakeCamera(hit.killShakePx, hit.killShakeMs)
      this.blood.number(enemy.x, enemy.y - 18, `${Math.round(applied)}`, '#ffffff', true)
    } else {
      this.hitStop.freeze(hit.hitstopMs)
      this.shakeCamera(hit.shakePx, hit.shakeMs)
      this.blood.number(enemy.x, enemy.y - 16, `${Math.round(applied)}`, '#ffffff')
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
