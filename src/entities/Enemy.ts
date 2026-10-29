import Phaser from 'phaser'
import { ENEMIES, armorResist, type AttackConfig, type DamageType, type SpeciesConfig } from '../config/enemies'
import { EXPEDITION } from '../config/expedition'
import { biomeIndexAtMeters } from '../gen/cave'
import type { Carcass } from '../systems/Eating'
import { LIGHT } from '../config/light'

/**
 * Enemy — шаг 7: мобы и живая экосистема.
 *
 * Полный FSM гайда: патруль → тревога → погоня → замах → атака →
 * отход, бегство при HP<25%. Поверх — экосистема: мобы охотятся друг
 * на друга (hunts), едят падаль (scavenge), а дерутся, только когда
 * игрока нет в радиусе (peaceRadius). Пещера живёт своей жизнью:
 * фоновый писк — кольца шума над тьмой («стоишь и слушаешь»).
 *
 * Роли: prey (слизень — бегство, контратака в углу), opportunist
 * (нетопырь — нырок на раненого), territorial (жнец/панцирь — охрана
 * гнезда), hunter (кровосос/лавовый ползун). Атаки: выпад, веер спор,
 * пиявка HP. Все числа — в enemies.json, ноль магических констант.
 *
 * Читаемость в темноте (гайд §7): у каждой атаки — замах с подстветкой
 * (0,3–0,4 с), у смерти — «мешок» отброса. Вне света моб рендерится
 * двойником-силуэтом ПОВЕРХ маски тьмы.
 */

export type EnemyState =
  | 'patrol' | 'alert' | 'pursue' | 'windup' | 'attack' | 'recover'
  | 'flee' | 'eat' | 'curl' | 'stunned' | 'dead'

export type KillerKind = 'player' | 'mob' | 'env'

export interface EnemyContext {
  playerX: number
  playerY: number
  /** Текущий радиус света игрока (детекция — на свет, не на звук). */
  playerLightR: number
  /** Множитель радиуса детекции (мутация «Хамелеонская плёнка»). */
  detectMult: number
  frozen: boolean
  /** Жив ли игрок (раненый игрок — добыча нетопыря). */
  playerAlive: boolean
  /** Доля HP игрока 0..1. */
  playerHpRatio: number
  /** Другие живые мобы (для экосистемы: охота и страх). */
  others: Enemy[]
  /** Туши на карте (падальщики). */
  corpses: readonly Carcass[]
  /** Откусить от туши; возвращает фактически съеденное. */
  eatCorpse: (carcass: Carcass, portion: number) => number
}

export interface EnemyCallbacks {
  /** Выпад/укус моба долетел до игрока (для «Токсичной шкуры»). */
  onPlayerBitten: (damage: number, fromX: number, attacker: Enemy) => void
  /** Канал пиявки по игроку (без неуязвимости — это не удар). */
  onPlayerDrain: (attacker: Enemy, amount: number) => void
  /** Моб ранил моба: сцена добавляет juice (кровь, число, счётчики). */
  onMobHitMob: (attacker: Enemy, victim: Enemy, applied: number, type: DamageType) => void
  /** Жнец выпустил веер спор в сторону цели. */
  onShootSpores: (attacker: Enemy, tx: number, ty: number) => void
  /** Лавовый ползун оставил лужу огня. */
  onSpawnFire: (enemy: Enemy, x: number, y: number) => void
  /** Шум вида: писк/замах/удар/еда/свёртка — кольцо над тьмой. */
  onNoise: (enemy: Enemy, kind: 'windup' | 'hit' | 'eat' | 'squeak' | 'curl') => void
  /** Моб умер: сцена решает кровь/тушу/мутации по тому, кто убил. */
  onDeath: (enemy: Enemy, killer: KillerKind) => void
}

const DEPTH_ENEMY = 3
/** Силуэт-двойник — над маской (14), под мошью (16). */
const DEPTH_TWIN = 15

export class Enemy extends Phaser.Physics.Arcade.Sprite {
  readonly species: SpeciesConfig
  readonly speciesId: string
  hp: number
  maxHp: number
  stateName: EnemyState = 'patrol'
  dead = false
  /** Индекс гнезда, у которого заспавнен (для восстановления экосистемы). */
  nestIndex = -1
  /** Уникальный моб (шаг 8): крупнее, живучее, несёт постоянный ген. */
  elite = false

  // ── Шаг 24: глубинное усиление («чем ниже, тем сильнее») ────────────
  /** Полоса биома спавна (0..5) — от неё взяты множители. */
  depthBand = 0
  /** Множитель урона моба (все типы атак; споры — при выстреле). */
  dmgMult = 1
  /** Множитель скорости (патруль/погоня/бегство/выпад/полёт). */
  speedMult = 1
  /** Прибавка Эссенции за убийство на глубине (Гнездо платит за риск). */
  essenceBonus = 0
  /** Багровое глубинное сияние (полоса ≥ glowFromBand) — над маской тьмы. */
  private deepGlow: Phaser.GameObjects.Image | null = null
  /**
   * Шаг 13 (Dead Cells): убит оверкиллом — убойный урон ≥ gib.overkillShare·maxHp.
   * Ставит Combat.applyHit прямо перед смертью; сцена вместо туши
   * разрывает жертву на куски (мясо + съедобные сгустки).
   */
  overkilled = false
  private eliteGlow: Phaser.GameObjects.Image | null = null
  /** Шаг 9: сцена регистрирует ауру в Glow-реестре после makeElite. */
  get eliteGlowRef(): Phaser.GameObjects.Image | null {
    return this.eliteGlow
  }
  private parasiteDps = 0
  private parasiteUntil = 0
  private parasiteNextTickAt = 0

  /** Силуэт вне света (двойник над маской). */
  readonly twin: Phaser.GameObjects.Image

  // ── Цели и память (решения — на «тиках мышления») ────────────────────────
  private anchorX = 0
  private anchorY = 0
  private targetMob: Enemy | null = null
  private targetCarcass: Carcass | null = null
  /** Шаг 26: марш-цель экспедиции — в патруле идти к точке отряда, а не блуждать. */
  marchTo: { x: number; y: number } | null = null
  private pursuingPlayer = false
  private lastAttacker: Enemy | null = null
  private lastAttackedAt = -Infinity
  /** Приём пищи: мобы, едящие туши, заметно растут (гайд: рост от еды). */
  private meals = 0
  private thinkNextAt = 0
  private squeakNextAt = 0

  // ── Таймеры состояний (мс) ────────────────────────────────────────────────
  private patrolNextChange = 0
  private patrolDir = 0
  private hopAcc = 0
  private alertUntil = 0
  private alertPoint = { x: 0, y: 0 }
  private windupUntil = 0
  private attackUntil = 0
  private attackHasHit = false
  private attackFromX = 0
  private attackFromY = 0
  private attackReadyAt = 0
  private recoverUntil = 0
  private giveUpAt = 0
  private drainNextTickAt = 0
  private drainVictimMob: Enemy | null = null
  private drainVictimPlayer = false
  private curlUntil = 0
  private curlNextHealAt = 0
  private eatNextChewAt = 0
  private corneredAcc = 0
  private trailNextAt = 0
  private stunEndsAt = 0

  // ── Полёт и визуал ────────────────────────────────────────────────────────
  private batAnchor: { x: number; y: number } | null = null
  private windupFx: Phaser.GameObjects.Graphics
  private drainBeamGfx: Phaser.GameObjects.Graphics | null = null

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    speciesId: string,
    private callbacks: EnemyCallbacks,
  ) {
    super(scene, x, y, ENEMIES.species[speciesId].texture)
    const sp = ENEMIES.species[speciesId]
    this.species = sp
    this.speciesId = speciesId
    this.hp = sp.hp
    this.maxHp = sp.hp

    this.anchorX = x
    this.anchorY = y

    scene.add.existing(this)
    scene.physics.add.existing(this)
    this.setDepth(DEPTH_ENEMY)
    const [w, h] = sp.size
    this.body!.setSize(w, h)
    this.setOffset((this.width - w) / 2, this.height - h)
    if (!sp.fly) {
      this.setCollideWorldBounds(false)
      // Мобы слегка пружинят от стен, чтобы не залипали в них.
      this.setBounce(0.15, 0)
    } else {
      const body = this.body as Phaser.Physics.Arcade.Body
      body.allowGravity = false
    }

    this.twin = scene.add.image(x, y, sp.texture)
      .setDepth(DEPTH_TWIN)
      .setTint(0x0d0d13)
      .setAlpha(0)
      .setFlipX(this.flipX)

    this.windupFx = scene.add.graphics().setDepth(DEPTH_ENEMY + 1)

    // Фазы мышления и писка разнесены по мобам — пещера живёт неровно.
    const eco = ENEMIES.eco
    this.thinkNextAt = scene.time.now + Phaser.Math.Between(eco.thinkEveryMs[0], eco.thinkEveryMs[1])
    this.squeakNextAt = scene.time.now + Phaser.Math.Between(eco.squeakEveryMs[0], eco.squeakEveryMs[1])
    this.patrolNextChange = scene.time.now + Phaser.Math.Between(400, 1200)
  }

  get aiState(): EnemyState {
    return this.stateName
  }

  /** Кого преследует (для debug): 'player' | вид моба | 'падаль' | null. */
  get targetLabel(): string | null {
    if (this.pursuingPlayer) return 'player'
    if (this.targetMob) return this.targetMob.speciesId
    if (this.targetCarcass) return 'падаль'
    return null
  }

  /** Слизень прижат к стене (для отладки и контратаки). */
  get isCornered(): boolean {
    return this.corneredAcc > 0
  }

  /** Тест-хук: форсировать замах (agent-browser верификация). */
  debugForceWindup(): void {
    const c = this.species.counter ?? this.species.attack
    if (!c || this.dead) return
    this.stateName = 'windup'
    this.windupUntil = this.scene.time.now + c.windupMs
    const body = this.body as Phaser.Physics.Arcade.Body
    body.velocity.x = 0
    this.tweenInflate(1.28, c.windupMs)
  }

  /** Тест-хук: мгновенно ранить (для проверки бегства/свёртки). */
  debugWound(ratio: number): void {
    if (this.dead) return
    this.hp = Math.max(1, Math.round(this.maxHp * ratio))
  }

  /**
   * Шаг 11 (Гнездо): напугать моба — обращает в бегство на ~0.8с.
   * Используют узлы «Дрожь тьмы» и «Паника стаи». Панцирь не пугается.
   */
  scare(now: number): void {
    if (this.dead || !this.species.flee) return
    this.setFlee(now)
  }

  /**
   * Сделать моба УНИКАЛЬНЫМ (шаг 8): ×3 живучести, крупнее, споровая
   * аура. Из него падает постоянный ген — то, ради чего рискуют.
   */
  makeElite(): void {
    this.elite = true
    this.maxHp = Math.round(this.maxHp * 3)
    this.hp = this.maxHp
    this.setScale(this.scaleX * 1.35, this.scaleY * 1.35)
    this.eliteGlow = this.scene.add.image(this.x, this.y, 'glow-purple')
      // Шаг 18: аура элиты НАД маской тьмы — угроза видна издали
      // в полной темноте (сияние не съедается вуалью).
      .setDepth(LIGHT.halo.depth)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(LIGHT.halo.elite)
      .setScale(1.4)
    this.scene.tweens.add({
      targets: this.eliteGlow,
      alpha: { from: LIGHT.halo.elite * 0.6, to: LIGHT.halo.elite * 1.3 },
      scale: { from: 1.2, to: 1.6 },
      duration: 1400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })
  }

  /** «Паразитная слюна» (шаг 8): укушенный истекает кровью. */
  applyParasite(dps: number, durationMs: number): void {
    if (this.dead) return
    this.parasiteDps = dps
    this.parasiteUntil = this.scene.time.now + durationMs
    this.parasiteNextTickAt = this.scene.time.now + 1000
  }

  /**
   * Шаг 24: глубинное усиление. Сцена вызывает СРАЗУ после создания
   * (до makeElite): множители живучести/урона/скорости по полосе
   * биома спавна + бонус Эссенции + багровое сияние на глубоких полосах.
   * Глубина — в метрах (depthOffsetMeters + y·metersPerPixel, как в HUD).
   */
  applyDepthScale(depthMeters: number): void {
    const ds = ENEMIES.eco.depthScale
    this.depthBand = Phaser.Math.Clamp(biomeIndexAtMeters(Math.max(0, depthMeters)), 0, ds.bandHp.length - 1)
    const b = this.depthBand
    this.maxHp = Math.round(this.maxHp * (ds.bandHp[b] ?? 1))
    this.hp = this.maxHp
    this.dmgMult = ds.bandDmg[b] ?? 1
    this.speedMult = ds.bandSpeed[b] ?? 1
    this.essenceBonus = ds.bandEssence[b] ?? 0
    if (b >= ds.glowFromBand) this.spawnDeepGlow()
  }

  /** Багровое тление глубины: слабая пульсирующая аура над маской тьмы. */
  private spawnDeepGlow(): void {
    const ds = ENEMIES.eco.depthScale
    this.deepGlow = this.scene.add.image(this.x, this.y, 'glow-red')
      .setDepth(LIGHT.halo.depth)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(ds.glowAlpha)
      .setScale(1)
    this.scene.tweens.add({
      targets: this.deepGlow,
      alpha: { from: ds.glowAlpha * 0.6, to: ds.glowAlpha * 1.5 },
      scale: { from: 0.9, to: 1.2 },
      duration: 1100,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })
  }

  // ── Главная точка входа: вызывается из scene.update, когда мир не заморожен

  override update(time: number, delta: number, ctx: EnemyContext): void {
    if (this.dead) return
    const now = time

    // Решения принимаются на «тиках мышления» — пещера не думает хором.
    if (now >= this.thinkNextAt) {
      this.thinkNextAt = now + Phaser.Math.Between(ENEMIES.eco.thinkEveryMs[0], ENEMIES.eco.thinkEveryMs[1])
      this.think(now, ctx)
    }

    // Фоновый писк: даже сытый и спокойный моб выдаёт себя кольцом шума.
    if (now >= this.squeakNextAt) {
      this.squeakNextAt = now + Phaser.Math.Between(ENEMIES.eco.squeakEveryMs[0], ENEMIES.eco.squeakEveryMs[1])
      if (this.stateName === 'patrol' || this.stateName === 'eat') this.callbacks.onNoise(this, 'squeak')
    }

    // Огненный след лавового ползуна.
    if (this.species.trail) this.updateTrail(now)

    // «Паразитная слюна» (шаг 8): кровотечение тикает раз в секунду.
    if (this.parasiteDps > 0 && now < this.parasiteUntil) {
      if (now >= this.parasiteNextTickAt) {
        this.parasiteNextTickAt = now + 1000
        this.takeDamage(this.parasiteDps, 0, 0, 'physical', 'player')
      }
    } else if (this.parasiteDps > 0) {
      this.parasiteDps = 0
    }

    // Шаг 20: живая анимация вида (лист 4 кадра, fps из species.anim).
    // Раньше полёт нетопыря изображался кодовым сквошем wingFlapMs — теперь
    // настоящий мах кадрами; пауза при остановке (anims.pause).
    this.updateAnim()

    switch (this.stateName) {
      case 'stunned': this.updateStunned(now); break
      case 'curl': this.updateCurl(now); break
      case 'windup': this.updateWindup(now, ctx); break
      case 'attack': this.updateAttack(now, ctx); break
      case 'recover': this.updateRecover(now); break
      case 'eat': this.updateEat(now, ctx); break
      case 'flee': this.updateFlee(now, delta, ctx); break
      case 'pursue': this.updatePursue(now, delta, ctx); break
      case 'alert': this.updateAlert(now, delta); break
      default: this.updatePatrol(now, delta); break
    }

    this.syncTwin()
  }

  // ── Мышление: выбор цели и состояния ───────────────────────────────────────

  private think(now: number, ctx: EnemyContext): void {
    // Свёртка/замах/атака/стан — решения не принимаются, состояние доигрывает.
    if (this.stateName === 'windup' || this.stateName === 'attack' || this.stateName === 'stunned' || this.stateName === 'curl') return

    const dx = ctx.playerX - this.x
    const dy = ctx.playerY - this.y
    const playerDist = Math.hypot(dx, dy)
    const detect = this.species.detectRadius * ctx.detectMult
    const eco = ENEMIES.eco

    // 1) Свёртка панциря вместо бегства (тяжёлому не убежать).
    const curl = this.species.curl
    if (curl && this.hp / this.maxHp <= curl.threshold) {
      this.enterCurl(now)
      return
    }

    // 2) Бегство при HP<25% (гайд) или при недавней боли.
    if (this.species.flee && this.hp / this.maxHp <= 0.25) {
      this.setFlee(now)
      return
    }

    // 3) Страх: охотник моего вида рядом — ноги сами несут.
    if (this.species.flee && this.species.fears.length > 0) {
      const feared = this.nearestOf(ctx.others, (e) => this.species.fears.includes(e.speciesId), detect)
      if (feared) {
        this.setFlee(now)
        return
      }
    }

    // 4) Игрок в поле «зрения» (на его свет): реакция по роли вида.
    if (ctx.playerAlive && playerDist < detect) {
      const role = this.species.role
      if (role === 'prey') {
        this.setFlee(now)
        return
      }
      if (role === 'opportunist') {
        const p = this.species.pursue
        if (p && ctx.playerHpRatio <= (p.playerHpBelowPct ?? 0.35)) {
          this.pursuingPlayer = true
          this.targetMob = null
          this.targetCarcass = null
          this.stateName = 'pursue'
          this.giveUpAt = now + eco.huntGiveUpMs
          return
        }
      }
      if (role === 'territorial') {
        const p = this.species.pursue
        if (p && playerDist < (p.aggroRadius ?? detect)) {
          this.pursuingPlayer = true
          this.targetMob = null
          this.targetCarcass = null
          this.stateName = 'pursue'
          this.giveUpAt = now + eco.huntGiveUpMs
          return
        }
      }
      if (role === 'hunter') {
        this.pursuingPlayer = true
        this.targetMob = null
        this.targetCarcass = null
        this.stateName = 'pursue'
        this.giveUpAt = now + eco.huntGiveUpMs
        return
      }
    }

    // 5) Экосистема: охота на других мобов — только когда игрока нет в радиусе
    // (гайд: «мобы дерутся между собой, когда игрока нет рядом»).
    if (playerDist > eco.peaceRadius && this.species.hunts.length > 0) {
      const prey = this.nearestOf(ctx.others, (e) => this.species.hunts.includes(e.speciesId), detect)
      if (prey) {
        this.pursuingPlayer = false
        this.targetMob = prey
        this.targetCarcass = null
        this.stateName = 'pursue'
        this.giveUpAt = now + eco.huntGiveUpMs
        return
      }
    }

    // 5б) Территориальный вид разбирается и с чужими мобами, забредшими к гнезду.
    if (playerDist > eco.peaceRadius && this.species.role === 'territorial') {
      const aggro = this.species.pursue?.aggroRadius ?? this.species.detectRadius
      const intruder = this.nearestOf(
        ctx.others,
        (e) => e.speciesId !== this.speciesId && Phaser.Math.Distance.Between(e.x, e.y, this.anchorX, this.anchorY) < aggro,
        detect,
      )
      if (intruder) {
        this.pursuingPlayer = false
        this.targetMob = intruder
        this.targetCarcass = null
        this.stateName = 'pursue'
        this.giveUpAt = now + eco.huntGiveUpMs
        return
      }
    }

    // 6) Падальщик: туши зовут сами (еда сама зовёт — гайд).
    const sc = this.species.scavenge
    if (sc) {
      if (this.targetCarcass && this.targetCarcass.meatLeft > 0
        && Phaser.Math.Distance.Between(this.x, this.y, this.targetCarcass.sprite.x, this.targetCarcass.sprite.y) < sc.corpseSense * 1.4) {
        this.pursuingPlayer = false
        this.targetMob = null
        this.stateName = 'pursue'
        return
      }
      let best: Carcass | null = null
      let bestD = sc.corpseSense
      for (const c of ctx.corpses) {
        const d = Phaser.Math.Distance.Between(this.x, this.y, c.sprite.x, c.sprite.y)
        if (d < bestD) {
          best = c
          bestD = d
        }
      }
      if (best) {
        this.pursuingPlayer = false
        this.targetMob = null
        this.targetCarcass = best
        this.stateName = 'pursue'
        return
      }
    }

    // 7) Ничего не найдено — патруль (погоня выдыхается).
    if (this.stateName === 'pursue') {
      this.targetMob = null
      this.pursuingPlayer = false
      this.targetCarcass = null
    }
    if (this.stateName !== 'eat') this.stateName = 'patrol'
  }

  private nearestOf(others: Enemy[], filter: (e: Enemy) => boolean, radius: number): Enemy | null {
    let best: Enemy | null = null
    let bestD = radius
    for (const e of others) {
      if (e.dead || e === this || !filter(e)) continue
      const d = Phaser.Math.Distance.Between(this.x, this.y, e.x, e.y)
      if (d < bestD) {
        best = e
        bestD = d
      }
    }
    return best
  }

  /** Слух: чужой шум рядом — обернуться и подойти (пещера живёт). */
  hearNoise(x: number, y: number, now: number): void {
    if (this.dead || this.stateName !== 'patrol') return
    if (Phaser.Math.Distance.Between(this.x, this.y, x, y) > ENEMIES.eco.leashRadius * 1.2) return
    this.stateName = 'alert'
    this.alertPoint = { x, y }
    this.alertUntil = now + Phaser.Math.Between(700, 1500)
    this.setFlipX(x < this.x)
  }

  // ── Состояния ──────────────────────────────────────────────────────────────

  private updateStunned(now: number): void {
    if (this.stunEndsAt > 0 && now >= this.stunEndsAt) {
      this.stunEndsAt = 0
      this.stateName = this.species.flee ? 'flee' : 'patrol'
      this.thinkNextAt = now + 300
      this.setTintFill(0xffffff)
      this.scene.time.delayedCall(60, () => !this.dead && this.clearTint())
    }
  }

  private updateCurl(now: number): void {
    const curl = this.species.curl!
    const body = this.body as Phaser.Physics.Arcade.Body
    body.velocity.x = Phaser.Math.Linear(body.velocity.x, 0, 0.2)
    if (now >= this.curlNextHealAt) {
      this.curlNextHealAt = now + 1000
      this.hp = Math.min(this.maxHp, this.hp + curl.healPerSec)
    }
    if (now >= this.curlUntil) {
      this.stateName = this.species.flee ? 'flee' : 'patrol'
      this.thinkNextAt = now + 260
      this.clearTint()
      this.tweenInflate(1, 220)
    }
  }

  private updateWindup(now: number, ctx: EnemyContext): void {
    const body = this.body as Phaser.Physics.Arcade.Body
    // Замах: тело замирает (телеграф честный).
    if (!this.species.fly) body.velocity.x = 0
    else {
      body.velocity.x *= 0.9
      body.velocity.y *= 0.9
    }

    if (now >= this.windupUntil) {
      this.executeAttack(now, ctx)
    } else {
      this.drawWindup(now)
    }
    this.syncTwin()
  }

  private executeAttack(now: number, ctx: EnemyContext): void {
    const atk = this.species.attack ?? this.species.counter
    if (!atk) {
      this.stateName = 'patrol'
      return
    }
    const body = this.body as Phaser.Physics.Arcade.Body
    this.windupFx.clear()

    if (atk.type === 'shoot') {
      // Цель — куда смотрел при замахе: игрок или моб.
      const tx = this.pursuingPlayer ? ctx.playerX : this.targetMob?.x ?? ctx.playerX
      const ty = this.pursuingPlayer ? ctx.playerY : this.targetMob?.y ?? ctx.playerY
      this.callbacks.onShootSpores(this, tx, ty)
      this.attackReadyAt = now + atk.cooldownMs
      this.stateName = 'recover'
      this.recoverUntil = now + 260
      return
    }

    if (atk.type === 'drain') {
      // Присасывание: цель должна быть в радиусе канала.
      const victimDist = this.pursuingPlayer
        ? Phaser.Math.Distance.Between(this.x, this.y, ctx.playerX, ctx.playerY)
        : this.targetMob
          ? Phaser.Math.Distance.Between(this.x, this.y, this.targetMob.x, this.targetMob.y)
          : Infinity
      if (victimDist <= atk.drainRange) {
        this.drainVictimPlayer = this.pursuingPlayer
        this.drainVictimMob = this.pursuingPlayer ? null : this.targetMob
        this.attackUntil = now + atk.maxMs
        this.drainNextTickAt = now + atk.tickMs
        this.attackHasHit = false
        this.stateName = 'attack'
        this.callbacks.onNoise(this, 'windup')
        return
      }
      this.attackReadyAt = now + atk.cooldownMs
      this.stateName = 'recover'
      this.recoverUntil = now + 240
      return
    }

    // Выпад (lunge): рывок в сторону цели.
    const dirX = Math.sign((this.pursuingPlayer ? ctx.playerX : this.targetMob?.x ?? ctx.playerX) - this.x) || (this.flipX ? -1 : 1)
    body.velocity.x = dirX * atk.lungeSpeed * this.speedMult
    if (body.blocked.down) body.velocity.y = -140
    if (this.species.fly) body.velocity.y = Math.sign((this.pursuingPlayer ? ctx.playerY : this.targetMob?.y ?? ctx.playerY) - this.y) * atk.lungeSpeed * this.speedMult * 0.6
    this.stateName = 'attack'
    this.attackUntil = now + atk.activeMs
    this.attackHasHit = false
    this.attackFromX = this.x
    this.attackFromY = this.y
    this.setFlipX(dirX < 0)
    this.tweenInflate(1, 120)
  }

  private updateAttack(now: number, ctx: EnemyContext): void {
    const atk = this.species.attack ?? this.species.counter
    if (!atk) {
      this.stateName = 'patrol'
      return
    }
    const body = this.body as Phaser.Physics.Arcade.Body
    const face = Math.sign(body.velocity.x) || (this.flipX ? -1 : 1)

    if (atk.type === 'drain') {
      this.updateDrain(now, ctx, atk)
      this.syncTwin()
      return
    }

    // Выпад: контакт-укус по «носу» (игрок или моб).
    const tx = this.pursuingPlayer ? ctx.playerX : this.targetMob?.x
    const ty = this.pursuingPlayer ? ctx.playerY : this.targetMob?.y
    if (tx !== undefined && ty !== undefined && !this.attackHasHit) {
      const biteDx = tx - this.x
      const biteDy = ty - this.y
      if (
        Math.abs(biteDy) < 20
        && biteDx * face > 0
        && Math.abs(biteDx) < 26
        && now < this.attackUntil
      ) {
        this.attackHasHit = true
        this.landHit(atk, biteDx)
      }
    }

    if (now >= this.attackUntil) {
      // Свип-проверка: выпад — размах, укус засчитывается, если цель
      // была в коридоре выпада (важно и на низком fps).
      if (!this.attackHasHit && tx !== undefined && ty !== undefined) {
        const minX = Math.min(this.attackFromX, this.x) - 26
        const maxX = Math.max(this.attackFromX, this.x) + 26
        const minY = Math.min(this.attackFromY, this.y) - 20
        const maxY = Math.max(this.attackFromY, this.y) + 20
        if (
          tx > minX && tx < maxX && ty > minY && ty < maxY
          && (tx - this.attackFromX) * face > -26
        ) {
          this.attackHasHit = true
          this.landHit(atk, tx - this.x)
        }
      }
      this.attackReadyAt = now + atk.cooldownMs
      this.stateName = 'recover'
      this.recoverUntil = now + 240
    }
  }

  /** Нанести урон из выпада: игроку — через сцену, мобу — напрямую.
   *  Шаг 24: глубинный множитель урона применяется ко всем атакам. */
  private landHit(atk: { damage: number; damageType: DamageType }, dx: number): void {
    const damage = Math.max(1, Math.round(atk.damage * this.dmgMult))
    if (this.pursuingPlayer) {
      this.callbacks.onPlayerBitten(damage, this.x, this)
    } else if (this.targetMob && !this.targetMob.dead) {
      const applied = this.targetMob.takeDamage(damage, Math.sign(dx) || 1, 0, atk.damageType, 'mob', this)
      if (applied > 0) this.callbacks.onMobHitMob(this, this.targetMob, applied, atk.damageType)
    }
    this.callbacks.onNoise(this, 'hit')
  }

  private updateDrain(now: number, ctx: EnemyContext, atk: Extract<AttackConfig, { type: 'drain' }>): void {
    const body = this.body as Phaser.Physics.Arcade.Body
    body.velocity.x = Phaser.Math.Linear(body.velocity.x, 0, 0.3)
    if (!this.species.fly) body.velocity.y = 0

    const vx = this.drainVictimPlayer ? ctx.playerX : this.drainVictimMob?.x
    const vy = this.drainVictimPlayer ? ctx.playerY : this.drainVictimMob?.y

    // Жертва умерла или вырвалась — канал рвётся.
    const victimGone = this.drainVictimPlayer
      ? !ctx.playerAlive
      : !this.drainVictimMob || this.drainVictimMob.dead
    const escaped = vx === undefined || vy === undefined
      || Phaser.Math.Distance.Between(this.x, this.y, vx, vy) > atk.drainRange * 1.7

    if (victimGone || escaped || now >= this.attackUntil) {
      this.attackReadyAt = now + atk.cooldownMs
      this.stateName = 'recover'
      this.recoverUntil = now + 300
      this.drainVictimMob = null
      this.drawDrainBeam(null)
      return
    }

    if (now >= this.drainNextTickAt) {
      this.drainNextTickAt = now + atk.tickMs
      const tick = Math.max(1, Math.round(atk.drainPerTick * this.dmgMult))
      if (this.drainVictimPlayer) {
        this.callbacks.onPlayerDrain(this, tick)
      } else if (this.drainVictimMob) {
        const applied = this.drainVictimMob.drainHp(tick, 'mob', this)
        if (applied > 0) this.callbacks.onMobHitMob(this, this.drainVictimMob, applied, atk.damageType)
      }
      // Кровосос лечится выпитым.
      this.hp = Math.min(this.maxHp, this.hp + tick * atk.healRatio)
      this.callbacks.onNoise(this, 'hit')
    }
    this.drawDrainBeam({ x: vx!, y: vy! })
  }

  private updateRecover(now: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body
    if (this.species.fly) {
      // После атаки нетопырь уходит вверх — читаемый ритм нырка.
      body.velocity.y = Phaser.Math.Linear(body.velocity.y, -110, 0.12)
      body.velocity.x = Phaser.Math.Linear(body.velocity.x, body.velocity.x * 0.9, 0.1)
    } else {
      body.velocity.x = Phaser.Math.Linear(body.velocity.x, 0, 0.12)
    }
    if (now >= this.recoverUntil) {
      this.stateName = 'pursue'
      this.thinkNextAt = Math.min(this.thinkNextAt, now + 60)
    }
  }

  private updateEat(now: number, ctx: EnemyContext): void {
    const sc = this.species.scavenge
    const c = this.targetCarcass
    const body = this.body as Phaser.Physics.Arcade.Body
    body.velocity.x = Phaser.Math.Linear(body.velocity.x, 0, 0.25)

    if (!sc || !c || c.meatLeft <= 0 || !ctx.corpses.includes(c)) {
      this.targetCarcass = null
      this.stateName = 'patrol'
      this.thinkNextAt = now + 200
      return
    }

    const d = Phaser.Math.Distance.Between(this.x, this.y, c.sprite.x, c.sprite.y)
    if (d > sc.corpseSense * 1.6) {
      // Тушу увели из-под носа — искать снова.
      this.targetCarcass = null
      this.stateName = 'patrol'
      this.thinkNextAt = now + 150
      return
    }

    if (now >= this.eatNextChewAt) {
      this.eatNextChewAt = now + sc.chewMs
      const bitten = ctx.eatCorpse(c, sc.portion)
      if (bitten > 0) {
        this.hp = Math.min(this.maxHp, this.hp + sc.healPerChew)
        this.growByMeal()
        this.callbacks.onNoise(this, 'eat')
        this.tweenSquish(1.12, 0.9, 160)
      }
    }
  }

  private setFlee(now: number): void {
    this.stateName = 'flee'
    this.targetMob = null
    this.pursuingPlayer = false
    this.targetCarcass = null
    this.thinkNextAt = now + Phaser.Math.Between(500, 900)
  }

  private updateFlee(now: number, delta: number, ctx: EnemyContext): void {
    const body = this.body as Phaser.Physics.Arcade.Body
    const sp = this.species

    // Источник страха: игрок, недавний обидчик или ближайший «fears».
    let threatX = ctx.playerX
    const feared = this.nearestOf(ctx.others, (e) => sp.fears.includes(e.speciesId), sp.detectRadius * 1.1)
    if (feared) threatX = feared.x
    if (this.lastAttacker && !this.lastAttacker.dead && now - this.lastAttackedAt < 2200) {
      threatX = this.lastAttacker.x
    }

    if (sp.fly) {
      this.flyFlee(ctx, threatX)
    } else {
      const f = sp.flee!
      const awayDir = Math.sign(this.x - threatX) || 1
      body.velocity.x = Phaser.Math.Linear(body.velocity.x, awayDir * f.speed, 0.2)
      // Панические прыжки: добыча так и лезет в стены.
      if (body.blocked.down && Math.random() < (f.hopChance ?? 0.4) * (delta / 16.7)) {
        body.velocity.y = -(f.hopVelocityY ?? 180)
      }
      this.setFlipX(body.velocity.x < 0)
      this.hopAcc += delta
      if (this.hopAcc > 150) {
        this.hopAcc = 0
        this.tweenSquish(0.82, 1.12, 130)
      }
      // Прижатая к стене добыча контратакует (только у prey с counter).
      this.updateCornered(now, delta, ctx)
    }

    // Выдох паники: тихо вокруг — вернуться к делам.
    if (now >= this.thinkNextAt) {
      const calm = Phaser.Math.Distance.Between(this.x, this.y, ctx.playerX, ctx.playerY) > sp.detectRadius
        && !feared
      if (calm) {
        this.stateName = 'patrol'
        this.thinkNextAt = now + 200
      } else {
        this.thinkNextAt = now + 400
      }
    }
  }

  /** Контратака прижатой добычи (шаг 6, сохранён для слизня). */
  private updateCornered(now: number, delta: number, ctx: EnemyContext): void {
    const c = this.species.counter
    if (!c || this.stateName !== 'flee') return
    const body = this.body as Phaser.Physics.Arcade.Body
    const pressed = body.blocked.left || body.blocked.right
    // Давление копится по кадрам: панические прыжки размывают блокировку.
    this.corneredAcc = pressed ? this.corneredAcc + delta : Math.max(0, this.corneredAcc - delta * 2)
    const dx = ctx.playerX - this.x
    const dy = ctx.playerY - this.y
    if (
      now >= this.attackReadyAt
      && this.corneredAcc >= c.stuckMs
      && Math.hypot(dx, dy) < c.triggerRange
    ) {
      this.corneredAcc = 0
      this.stateName = 'windup'
      this.windupUntil = now + c.windupMs
      this.pursuingPlayer = true
      this.targetMob = null
      body.velocity.x = 0
      this.tweenInflate(1.28, c.windupMs)
      this.setFlipX(dx < 0)
    }
  }

  private updatePursue(now: number, delta: number, ctx: EnemyContext): void {
    const body = this.body as Phaser.Physics.Arcade.Body
    const atk = this.species.attack

    // Цель: игрок или моб или туша.
    let tx: number
    let ty: number
    if (this.pursuingPlayer) {
      tx = ctx.playerX
      ty = ctx.playerY
    } else if (this.targetCarcass) {
      tx = this.targetCarcass.sprite.x
      ty = this.targetCarcass.sprite.y
    } else if (this.targetMob && !this.targetMob.dead) {
      tx = this.targetMob.x
      ty = this.targetMob.y
    } else {
      this.stateName = 'patrol'
      this.thinkNextAt = now + 120
      return
    }

    const dist = Phaser.Math.Distance.Between(this.x, this.y, tx, ty)

    // Туша — не атакуем, доходим и едим.
    if (this.targetCarcass && dist < 26) {
      this.stateName = 'eat'
      this.eatNextChewAt = now
      return
    }

    // Погоня выдыхается: время или дистанция.
    const giveUp = this.species.pursue?.giveUpRange ?? this.species.detectRadius * 1.5
    if (now >= this.giveUpAt || dist > giveUp * 1.4) {
      this.targetMob = null
      this.pursuingPlayer = false
      this.targetCarcass = null
      this.stateName = 'patrol'
      this.thinkNextAt = now + 200
      return
    }

    // Атака по готовности (для туш — не нужно).
    if (!this.targetCarcass && atk && now >= this.attackReadyAt) {
      const inTrigger = atk.type === 'lunge' ? dist < atk.triggerRange
        : atk.type === 'shoot' ? dist < atk.shotRange
        : dist < atk.drainRange
      if (inTrigger) {
        this.stateName = 'windup'
        this.windupUntil = now + atk.windupMs
        if (!this.species.fly) body.velocity.x = 0
        this.tweenInflate(1.24, atk.windupMs)
        this.setFlipX(tx < this.x)
        this.callbacks.onNoise(this, 'windup')
        return
      }
    }

    // Китер-жнец: держит дистанцию.
    if (atk?.type === 'shoot' && dist < atk.retreatRange) {
      const away = Math.sign(this.x - tx) || 1
      this.moveGround(body, away * this.species.pursue!.speed, delta)
      this.setFlipX(tx < this.x)
      return
    }

    if (this.species.fly) {
      const f = this.species.fly!
      const speed = this.targetCarcass ? f.speed : f.pursueSpeed
      this.flyToward(tx, ty, speed)
    } else {
      const speed = this.species.pursue?.speed ?? this.species.patrol?.speed ?? 60
      const dirX = Math.sign(tx - this.x) || 1
      this.moveGround(body, dirX * speed, delta)
      // Цель выше — маленький прыжок (перепрыгнуть уступ).
      if (body.blocked.down && (body.blocked.left || body.blocked.right) && ty < this.y - 10) {
        body.velocity.y = -180
      }
      if (ty < this.y - 30 && body.blocked.down && Math.random() < 0.06 * (delta / 16.7)) {
        body.velocity.y = -190
      }
    }
    this.setFlipX(tx < this.x)
  }

  private updateAlert(now: number, delta: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body
    const d = Phaser.Math.Distance.Between(this.x, this.y, this.alertPoint.x, this.alertPoint.y)
    if (d > 34) {
      const sp = this.species.patrol?.speed ?? 40
      const dirX = Math.sign(this.alertPoint.x - this.x) || 1
      this.moveGround(body, dirX * sp * 1.4, delta)
      this.setFlipX(dirX < 0)
    } else {
      body.velocity.x = Phaser.Math.Linear(body.velocity.x, 0, 0.2)
    }
    if (now >= this.alertUntil) {
      this.stateName = 'patrol'
      this.thinkNextAt = now + 80
    }
  }

  private updatePatrol(now: number, delta: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body
    const sp = this.species

    if (sp.fly) {
      this.flyPatrol()
      return
    }

    const w = sp.patrol
    if (!w) {
      body.velocity.x = Phaser.Math.Linear(body.velocity.x, 0, 0.1)
      return
    }

    // Шаг 26: марш экспедиции — вместо блуждания: отряд идёт к цели
    // (люди с поверхности), с паузами «снять показания» и прыжком через уступ.
    if (this.marchTo) {
      this.updateMarch(now)
      return
    }

    // Патруль: пауза → направление → ходьба; поводок тянет к гнезду.
    if (now >= this.patrolNextChange) {
      if (this.patrolDir !== 0) {
        this.patrolDir = 0
        this.patrolNextChange = now + Phaser.Math.Between(w.pauseMs[0], w.pauseMs[1])
      } else {
        this.patrolDir = Math.random() < 0.5 ? -1 : 1
        this.patrolNextChange = now + Phaser.Math.Between(w.moveMs[0], w.moveMs[1])
      }
    }
    // Поводок: ушёл от гнезда дальше leashRadius — разворот к дому.
    if (this.patrolDir !== 0 && Math.abs(this.x - this.anchorX) > w.leashRadius) {
      this.patrolDir = Math.sign(this.anchorX - this.x) || this.patrolDir
    }
    body.velocity.x = this.patrolDir * w.speed * this.speedMult
    if (body.blocked.left) this.patrolDir = 1
    if (body.blocked.right) this.patrolDir = -1
    this.setFlipX(this.patrolDir < 0)

    // Ленивое подпрыгивание (слизень «течёт»); тяжёлые виды (hopEveryMs=0) не прыгают.
    this.hopAcc += delta
    if (this.patrolDir !== 0 && w.hopEveryMs > 0 && this.hopAcc > w.hopEveryMs) {
      this.hopAcc = 0
      this.tweenSquish(1.06, 0.92, 260)
    }
  }

  /** Шаг 26: марш к точке отряда (экспедиции): идти, паузить «измерения», прыгать через уступы. */
  private updateMarch(now: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body
    const w = this.species.patrol!
    const t = this.marchTo!
    const dx = t.x - this.x
    const dy = t.y - this.y

    // Ритм: пауза «снять показания» ↔ шаг (таймер патруля переиспользуется).
    if (this.patrolDir === 0) {
      if (now < this.patrolNextChange) {
        body.velocity.x = Phaser.Math.Linear(body.velocity.x, 0, 0.2)
        return
      }
      this.patrolDir = 1
      this.patrolNextChange = now + Phaser.Math.Between(w.moveMs[0], w.moveMs[1])
    } else if (now >= this.patrolNextChange) {
      if (Math.random() < EXPEDITION.march.marchPauseChance) {
        this.patrolDir = 0
        this.patrolNextChange = now + Phaser.Math.Between(w.pauseMs[0], w.pauseMs[1])
      } else {
        this.patrolNextChange = now + Phaser.Math.Between(w.moveMs[0], w.moveMs[1])
      }
    }

    // На точке — стоим и светим фонарём (марш-цель обновит Expedition).
    if (Math.abs(dx) < 12 && Math.abs(dy) < 72) {
      body.velocity.x = Phaser.Math.Linear(body.velocity.x, 0, 0.2)
      return
    }

    const dirX = Math.sign(dx) || 1
    body.velocity.x = Phaser.Math.Linear(body.velocity.x, dirX * w.speed * this.speedMult, 0.16)
    // Уступ выше цели — прыжок (как в погоне, но спокойнее).
    if (body.blocked.down && (body.blocked.left || body.blocked.right) && dy < -10) {
      body.velocity.y = EXPEDITION.march.hopVelocityY
    }
    this.setFlipX(dirX < 0)
  }

  // ── Локомоция ──────────────────────────────────────────────────────────────

  private moveGround(body: Phaser.Physics.Arcade.Body, targetVx: number, delta: number): void {
    void delta
    // Шаг 24: глубинная скорость — единая точка наземной локомоции.
    body.velocity.x = Phaser.Math.Linear(body.velocity.x, targetVx * this.speedMult, 0.16)
  }

  private flyPatrol(): void {
    const f = this.species.fly!

    if (!this.batAnchor || Phaser.Math.Distance.Between(this.x, this.y, this.batAnchor.x, this.batAnchor.y) < 14) {
      const base = this.batAnchor ?? { x: this.x, y: this.y }
      const ang = Math.random() * Math.PI * 2
      const r = Math.random() * f.anchorRadius
      this.batAnchor = {
        x: base.x + Math.cos(ang) * r,
        y: base.y - Phaser.Math.Between(f.anchorYMin, f.anchorYMax),
      }
      this.batAnchor.y -= f.anchorYMin
    }
    const now = this.scene.time.now
    const t = now / f.sinePeriodMs * Math.PI * 2
    const targetX = this.batAnchor.x + Math.cos(t) * f.sineAmplitudePx
    const targetY = this.batAnchor.y + Math.sin(t * 2) * f.sineAmplitudePx * 0.6
    this.flyToward(targetX, targetY, f.speed)
  }

  private flyFlee(ctx: EnemyContext, threatX: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body
    const f = this.species.flee!
    const awayX = Math.sign(this.x - threatX) || 1
    const upY = Math.sign(this.y - ctx.playerY) * (f.climbBias ?? 0.5) || -0.5
    const len = Math.hypot(awayX, upY) || 1
    body.velocity.x = Phaser.Math.Linear(body.velocity.x, (awayX / len) * f.speed, 0.12)
    body.velocity.y = Phaser.Math.Linear(body.velocity.y, (upY / len) * f.speed, 0.12)
    this.setFlipX(body.velocity.x < 0)
  }

  private flyToward(tx: number, ty: number, speed: number): void {
    const body = this.body as Phaser.Physics.Arcade.Body
    const toX = tx - this.x
    const toY = ty - this.y
    const len = Math.hypot(toX, toY) || 1
    // Шаг 24: глубинная скорость — единая точка воздушной локомоции.
    const v = speed * this.speedMult
    body.velocity.x = Phaser.Math.Linear(body.velocity.x, (toX / len) * v, 0.08)
    body.velocity.y = Phaser.Math.Linear(body.velocity.y, (toY / len) * v, 0.08)
    this.setFlipX(body.velocity.x < 0)
  }

  private updateTrail(now: number): void {
    const tr = this.species.trail!
    if (tr.onlyWhenMoving) {
      const body = this.body as Phaser.Physics.Arcade.Body
      if (Math.abs(body.velocity.x) < 12) return
      if (!body.blocked.down) return
    }
    if (now >= this.trailNextAt) {
      this.trailNextAt = now + tr.everyMs
      this.callbacks.onSpawnFire(this, this.x, this.y + this.species.size[1] / 2)
    }
  }

  // ── Урон, страх, смерть ────────────────────────────────────────────────────

  /**
   * Урон по мобу. Возвращает фактически применённый урон (после брони).
   * dmgType: physical/acid/fire (панцирь боится только кислоту).
   * killer — кто бьёт (для памяти страха и туш).
   * opts (шаг 24): knockForce — сила отброса (сильный удар/пике),
   * resistMult — множитель на сопротивление брони (armorPierce).
   */
  takeDamage(
    amount: number,
    knockDirX: number,
    stunMs = 0,
    dmgType: DamageType = 'physical',
    killer: KillerKind = 'player',
    from?: Enemy,
    opts?: { knockForce?: number; resistMult?: number },
  ): number {
    if (this.dead) return 0

    // Свёртка: панцирь глух к урону («кланк»).
    if (this.stateName === 'curl') {
      this.callbacks.onNoise(this, 'curl')
      return 0
    }

    const resist = Math.max(0, armorResist(this.species, dmgType) * (opts?.resistMult ?? 1))
    const applied = Math.max(1, Math.round(amount * (1 - resist)))
    this.hp -= applied
    this.windupFx.clear()
    this.lastAttackedAt = this.scene.time.now
    if (killer === 'mob' && from) this.lastAttacker = from

    if (this.hp <= 0) {
      this.die(knockDirX, killer)
      return applied
    }

    const body = this.body as Phaser.Physics.Arcade.Body
    const kr = this.species.knockbackResist
    const knockForce = opts?.knockForce ?? 260
    body.velocity.x += knockDirX * knockForce * (1 - kr)
    if (this.species.fly) body.velocity.y -= 60 * (1 - kr)
    else body.velocity.y = Math.min(body.velocity.y, -120 * (1 - kr))

    if (stunMs > 0) {
      this.stateName = 'stunned'
      this.stunEndsAt = this.scene.time.now + stunMs
      body.velocity.x = 0
      this.setTintFill(0xbfefff)
      this.scene.time.delayedCall(80, () => !this.dead && this.setTintFill(0x6ecfe8))
    } else {
      // Испуг и бегство после урона (панцирь вместо бегства свёртывается).
      if (this.species.curl && this.hp / this.maxHp <= this.species.curl.threshold) {
        this.enterCurl(this.scene.time.now)
      } else if (this.species.flee) {
        this.stateName = 'flee'
        this.thinkNextAt = this.scene.time.now + 700
      }
      this.flashHurt()
    }
    return applied
  }

  /** Канал пиявки: без отброса и паники — жертву держат. */
  drainHp(amount: number, killer: KillerKind, from?: Enemy): number {
    if (this.dead) return 0
    if (this.stateName === 'curl') return 0
    this.hp -= amount
    this.lastAttackedAt = this.scene.time.now
    if (killer === 'mob' && from) this.lastAttacker = from
    this.flashHurt()
    if (this.hp <= 0) {
      this.die(0, killer)
      return amount
    }
    // Вырывающаяся жертва дёргается прочь.
    if (from) {
      const body = this.body as Phaser.Physics.Arcade.Body
      body.velocity.x = Math.sign(this.x - from.x) * 90
    }
    return amount
  }

  private flashHurt(): void {
    this.setTintFill(0xffffff)
    this.scene.time.delayedCall(70, () => {
      if (!this.dead && this.stateName !== 'curl') this.clearTint()
    })
  }

  private enterCurl(now: number): void {
    const curl = this.species.curl
    if (!curl) return
    this.stateName = 'curl'
    this.curlUntil = now + curl.durationMs
    this.curlNextHealAt = now + 1000
    const body = this.body as Phaser.Physics.Arcade.Body
    body.velocity.x = 0
    this.clearTint()
    this.setTintFill(0x4e5a66)
    this.tweenInflate(0.8, 260)
    this.callbacks.onNoise(this, 'curl')
  }

  private die(knockDirX: number, killer: KillerKind): void {
    this.dead = true
    this.stateName = 'dead'
    const body = this.body as Phaser.Physics.Arcade.Body
    body.velocity.set(knockDirX * 120, -160)
    this.clearTint()
    this.setTintFill(0xff8a94)
    this.callbacks.onDeath(this, killer)
    this.scene.tweens.killTweensOf(this)
    this.scene.time.delayedCall(140, () => {
      this.windupFx.destroy()
      this.twin.destroy()
      this.destroy()
    })
  }

  /** Рост от падали: сытый моб заметно крупнее (до потолка экосистемы). */
  private growByMeal(): void {
    const eco = ENEMIES.eco
    if (this.meals >= eco.maxMealsGrow) return
    this.meals++
    const s = Math.min(eco.maxMobScale, 1 + this.meals * eco.growPerMeal)
    this.setScale(s)
  }

  // ── Телеграфы замаха (гайд: «замах 0,3–0,4 с с подстветкой») ──────────────

  private drawWindup(now: number): void {
    const atk = this.species.attack ?? this.species.counter
    if (!atk) return
    const progress = Phaser.Math.Clamp(1 - (this.windupUntil - now) / atk.windupMs, 0, 1)
    const g = this.windupFx
    g.clear()
    const pulse = 0.45 + 0.55 * Math.abs(Math.sin(now / 70))
    const r = 13 + progress * 8

    if (atk.type === 'shoot') {
      // Споровый телеграф: фиолетовые кольца собираются к пасти.
      const col = 0xb36bff
      g.lineStyle(1.6, col, 0.35 + pulse * 0.5)
      g.strokeCircle(this.x, this.y, r)
      g.lineStyle(1, col, 0.25)
      g.strokeCircle(this.x, this.y, r + 4 + progress * 5)
      g.fillStyle(col, 0.4 * pulse)
      g.fillCircle(this.x, this.y - 4, 3 + progress * 4)
      return
    }

    if (atk.type === 'drain') {
      // Пиявка: алые кольца вокруг присоски — видно, ЧТО сейчас схватит.
      const col = 0xe23a4e
      g.lineStyle(1.4, col, 0.3 + pulse * 0.4)
      g.strokeCircle(this.x, this.y, r)
      g.fillStyle(col, 0.3 * pulse)
      g.fillCircle(this.x, this.y, 3)
      return
    }

    // Выпад: алая пульсация.
    const col = 0xe23a4e
    g.lineStyle(1.6, col, 0.35 + pulse * 0.5)
    g.strokeCircle(this.x, this.y, r)
    g.lineStyle(1, col, 0.25)
    g.strokeCircle(this.x, this.y, r + 4 + progress * 5)
  }

  /** Луч присоски во время канала. */
  private drawDrainBeam(to: { x: number; y: number } | null): void {
    const atk = this.species.attack
    if (!atk || atk.type !== 'drain') return
    if (!to) {
      this.drainBeamGfx?.destroy()
      this.drainBeamGfx = null
      return
    }
    if (!this.drainBeamGfx) {
      this.drainBeamGfx = this.scene.add.graphics().setDepth(DEPTH_ENEMY + 1)
    }
    const g = this.drainBeamGfx
    const pulse = 0.5 + 0.5 * Math.abs(Math.sin(this.scene.time.now / 60))
    g.clear()
    g.lineStyle(2.4, 0xe23a4e, 0.35 + pulse * 0.45)
    g.beginPath()
    g.moveTo(this.x, this.y)
    g.lineTo(to.x, to.y)
    g.strokePath()
    g.lineStyle(1, 0xff8a94, 0.3 + pulse * 0.3)
    g.beginPath()
    g.moveTo(this.x, this.y - 2)
    g.lineTo(to.x, to.y - 2)
    g.strokePath()
  }

  // ── Силуэт и утилиты ───────────────────────────────────────────────────────

  /**
   * Шаг 20: живая анимация вида. Walk-цикл (4 кадра 68×46, fps из
   * species.anim) играется всегда для летающих (мах — часть полёта) и
   * для идущих по земле; при остановке — пауза (кадр замирает, «стоит
   * и дышит» — потом ещё и присед-сквош твинами поверж).
   */
  /** Шаг 25: публично для Queen (босс переиспользует анимацию вида). */
  updateAnim(): void {
    if (this.dead) return
    const key = `mob-${this.speciesId}-walk`
    if (this.anims.currentAnim?.key !== key) {
      this.play(key)
    }
    const body = this.body as Phaser.Physics.Arcade.Body
    const moving = !!this.species.fly || Math.abs(body.velocity.x) > 8
    if (moving) {
      if (!this.anims.isPlaying) this.anims.resume()
    } else {
      this.anims.pause()
    }
  }

  /** Шаг 25: публично для Queen (босс синхронит силуэт сам). */
  syncTwin(): void {
    this.twin.setPosition(this.x, this.y)
    this.twin.setFlipX(this.flipX)
    this.twin.setScale(this.scaleX, this.scaleY)
    // Шаг 20: листы анимаций — силуэт обязан повторять КАДР основного
    // спрайта (раньше текстура была статичной и кадра не было).
    if (this.twin.frame && this.twin.frame.name !== this.frame.name) {
      this.twin.setFrame(this.frame.name)
    }
    if (this.eliteGlow) this.eliteGlow.setPosition(this.x, this.y)
    // Шаг 24: глубинное тление держится на мобе.
    if (this.deepGlow) this.deepGlow.setPosition(this.x, this.y)
  }

  /** Обновить видимость силуэта (сцена знает радиус света). */
  updateSilhouette(playerX: number, playerY: number, lightR: number): void {
    if (this.dead) return
    const d = Phaser.Math.Distance.Between(this.x, this.y, playerX, playerY)
    const inner = lightR * 0.92
    const outer = lightR * 1.3
    const t = Phaser.Math.Clamp((d - inner) / (outer - inner), 0, 1)
    this.twin.setAlpha(t * this.species.twinAlpha)
  }

  clearWindupFx(): void {
    this.windupFx.clear()
    this.drawDrainBeam(null)
  }

  private tweenInflate(target: number, ms: number): void {
    this.scene.tweens.add({
      targets: this,
      scaleX: target,
      scaleY: target,
      duration: ms,
      ease: 'Sine.InOut',
    })
  }

  /** Шаг 20: сквош-твин оставлен — юзают замахи/выпады/приземления мобов. */
  private tweenSquish(sx: number, sy: number, ms: number): void {
    this.scene.tweens.killTweensOf(this)
    this.scene.tweens.add({
      targets: this,
      scaleX: sx,
      scaleY: sy,
      duration: ms,
      yoyo: true,
      ease: 'Sine.InOut',
    })
  }

  override destroy(fromScene?: boolean): void {
    this.twin?.destroy()
    this.windupFx?.destroy()
    this.drainBeamGfx?.destroy()
    this.eliteGlow?.destroy()
    this.deepGlow?.destroy()
    super.destroy(fromScene)
  }
}
