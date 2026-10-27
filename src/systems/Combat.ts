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
}

export class Combat {
  stateName: BiteState = 'ready'
  private stateUntil = 0
  private hitSet = new Set<Enemy>()
  /** Приоритет укуса — направление существа. */
  private touchBiteQueued = false
  private keyJustPressed = false

  /** Модификаторы мутаций (ставит сцена при подборе). */
  mods: CombatMods = { stunMs: 0, thorns: 0 }

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
    this.stateUntil = time + BALANCE.player.biteWindupMs
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
    body.velocity.x = facing * p.biteLungeSpeed

    this.creature.biteActiveVisual()
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
      if (Math.abs(dx) > p.biteRange || Math.abs(dy) > p.biteRange * 0.75) continue
      if (dx * facing < 0) continue
      const dist = Math.hypot(dx, dy)
      if (dist > p.biteRange) continue
      const angle = Phaser.Math.RadToDeg(Math.atan2(dy, dx * facing))
      if (Math.abs(angle) > p.biteArcDeg / 2) continue

      this.hitSet.add(enemy)
      this.applyHit(enemy)
    }
  }

  private applyHit(enemy: Enemy): void {
    const hit = BALANCE.hit
    const facing = this.creature.facing
    const killed = enemy.takeDamage(this.vitals.biteDamage, facing, this.mods.stunMs)

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
      this.blood.number(enemy.x, enemy.y - 18, `${this.vitals.biteDamage}`, '#ffffff', true)
    } else {
      this.hitStop.freeze(hit.hitstopMs)
      this.shakeCamera(hit.shakePx, hit.shakeMs)
      this.blood.number(enemy.x, enemy.y - 16, `${this.vitals.biteDamage}`, '#ffffff')
    }
  }

  /** Тряска в пикселях: intensity Phaser — доля ширины кадра. */
  private shakeCamera(px: number, ms: number): void {
    const cam = this.scene.cameras.main
    cam.shake(ms, px / cam.width)
  }

  /** Урон игроку: мигание неуязвимости возвращает интервал. */
  hurtPlayer(damage: number): number {
    const p = BALANCE.player
    const now = this.scene.time.now
    if (now < this.invulnUntil) return 0
    const applied = this.vitals.damage(damage)
    if (applied >= 0 && this.vitals.alive) {
      this.invulnUntil = now + p.invulnAfterHitMs
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
    attacker.takeDamage(this.mods.thorns, Math.sign(attacker.x - this.creature.x) || 1)
    this.blood.burst(attacker.x, attacker.y, { count: 8, dirDeg: 90, spreadDeg: 360 })
    this.blood.number(attacker.x, attacker.y - 14, `${this.mods.thorns}`, '#a8e34f')
  }

  /** Текущее состояние (debug). */
  get state(): BiteState {
    return this.stateName
  }
}
