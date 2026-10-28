import Phaser from 'phaser'
import { BALANCE } from '../config/balance'
import { QUALITY } from './quality'
import type { CaveData } from '../gen/cave'
import type { HitStop } from './HitStop'

/**
 * BloodFx — шаг 6: кровь трёхслойная (гайд §7 «Кровь и juice»):
 *   1. Мгновенные брызги — частицы с гравитацией, летят по дуге разлёта.
 *   2. Декали — «липкие» капли штампуются там, где частица погибла:
 *      внутри стены (кровь на камне) или на полу под частицей.
 *      Декаль медленно темнеет (decalDarkenMs) и уходит (decalLifeMs).
 *   3. Сгустки — еда на месте смерти: подбираются существом,
 *      дают немного голода и роста.
 * Плюс пул всплывающих чисел урона.
 *
 * Липкость реализована через сетку пещеры (CaveData.solid): в момент
 * смерти частицы мы знаем, попала ли она в стену — без физики частиц.
 */

const DEPTH_DECALS = 2
const DEPTH_PARTICLES = 4
const DEPTH_NUMBERS = 19

const BLOOD_FRESH = 0xe23a4e
const BLOOD_DARK = 0x5e141f

interface DecalSlot {
  img: Phaser.GameObjects.Image
  bornAt: number
  tweens: Phaser.Tweens.Tween[]
}

interface ClotSlot {
  img: Phaser.GameObjects.Image
  bornAt: number
  alive: boolean
}

interface NumberSlot {
  text: Phaser.GameObjects.Text
  busy: boolean
}

export interface BurstOptions {
  count: number
  /** Центральный угол разлёта (градусы, 0 = вправо). */
  dirDeg?: number
  /** Полный сектор разлёта вокруг dirDeg. */
  spreadDeg?: number
  /** Множитель скорости брызг. */
  speedMult?: number
  /** Текстура частицы: кровь или куски мяса. */
  texture?: string
  /** Оставлять липкие декали (мясу — не нужно). */
  sticky?: boolean
}

export class BloodFx {
  private readonly decals: DecalSlot[] = []
  private readonly clots: ClotSlot[] = []
  private readonly numbers: NumberSlot[] = []
  /** Шаг 10 (перфоманс): ПУЛ эмиттеров по ключу «текстура:липкость».
   *  Раньше каждый бёрст создавал новый ParticleEmitter и отложенно
   *  уничтожал его — аллокации и GC-паузы прямо в бою. Теперь эмиттеры
   *  живут вечно, на бёрст меняется только конфиг (setConfig) и
   *  emitParticleAt. Липкость — отдельный эмиттер, чтобы декали
   *  штамповались только у «кровяных» частиц. */
  private readonly emitters = new Map<string, Phaser.GameObjects.Particles.ParticleEmitter>()

  constructor(
    private scene: Phaser.Scene,
    private cave: CaveData,
    private hitStop: HitStop,
    private onClotEaten: (x: number, y: number) => void,
  ) {}

  // ── Сетка пещеры: где стены и пол (для «липкости» крови) ────────────────

  private solidAtPx(px: number, py: number): boolean {
    const { cols, rows, tile, solid } = this.cave
    const tx = Math.floor(px / tile)
    const ty = Math.floor(py / tile)
    if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return true
    return solid[ty * cols + tx] === 1
  }

  /** Верх пола под точкой (px) в пределах 10 клеток; null — пропасть. */
  private floorBelowPx(px: number, py: number): number | null {
    const { cols, rows, tile, solid } = this.cave
    const tx = Math.floor(px / tile)
    if (tx < 0 || tx >= cols) return null
    let ty = Math.floor(py / tile)
    for (let i = 0; i < 10 && ty < rows; i++, ty++) {
      if (solid[ty * cols + tx] === 1) return ty * tile
    }
    return null
  }

  // ── Слой 1+2: брызги и липкие декали ─────────────────────────────────────

  /** Эмиттер из пула: создаётся один раз на «текстура+липкость», живёт вечно. */
  private pooledEmitter(texture: string, sticky: boolean): Phaser.GameObjects.Particles.ParticleEmitter {
    const key = `${texture}:${sticky ? 1 : 0}`
    let emitter = this.emitters.get(key)
    if (!emitter) {
      emitter = this.scene.add.particles(0, 0, texture, { emitting: false })
      emitter.setDepth(DEPTH_PARTICLES)
      this.hitStop.track(emitter)
      if (sticky) {
        // Липкость: погибшая частица оставляет декаль (стена/пол).
        emitter.onParticleDeath((p: Phaser.GameObjects.Particles.Particle) => {
          if (Math.random() < BALANCE.blood.stickyChance) {
            this.stampSticky(p.x, p.y)
          }
        })
      }
      this.emitters.set(key, emitter)
    }
    return emitter
  }

  /** Выброс крови. dirDeg: 0 = вправо, 90 = вниз; spreadDeg — сектор. */
  burst(x: number, y: number, opts: BurstOptions): void {
    const b = BALANCE.blood
    const count = Math.max(
      2,
      Math.round(opts.count * QUALITY.particleMult),
    )
    const spread = opts.spreadDeg ?? 360
    const half = spread / 2
    const dir = opts.dirDeg ?? 90
    const sticky = opts.sticky ?? true

    const emitter = this.pooledEmitter(opts.texture ?? 'blood-drop', sticky)
    emitter.setConfig({
      speed: { min: b.speedMin * (opts.speedMult ?? 1), max: b.speedMax * (opts.speedMult ?? 1) },
      angle: { min: dir - half, max: dir + half },
      gravityY: b.gravity,
      lifespan: { min: b.lifespanMin, max: b.lifespanMax },
      scale: { start: 0.9, end: 0.55 },
      alpha: { start: 1, end: 0.85 },
      rotate: { min: -90, max: 90 },
      emitting: false,
    })
    emitter.emitParticleAt(x, y, count)
  }

  /** Взрыв крови (убийство): во все стороны, вокруг головы жертвы. */
  explode(x: number, y: number, count: number): void {
    this.burst(x, y, { count, dirDeg: 90, spreadDeg: 360, speedMult: 1.15 })
  }

  /** Декаль «там, где капля встретила мир»: стена — на месте, воздух — на полу. */
  private stampSticky(px: number, py: number): void {
    if (this.solidAtPx(px, py)) {
      this.decal(px, py, Phaser.Math.FloatBetween(0.5, 0.85))
    } else {
      const floorY = this.floorBelowPx(px, py)
      if (floorY !== null) {
        this.decal(px + Phaser.Math.FloatBetween(-2, 2), floorY - 2, Phaser.Math.FloatBetween(0.65, 1.0))
      }
    }
  }

  /** Слой 2: декаль из пула — свежая алая, темнеет, уходит за 30 с (гайд). */
  decal(px: number, py: number, scale = 1): void {
    const b = BALANCE.blood
    let slot = this.decals.find((d) => d.bornAt < 0)
    if (!slot) {
      if (this.decals.length < b.maxDecals) {
        const img = this.scene.add.image(px, py, 'blood-decal')
          .setDepth(DEPTH_DECALS)
          .setVisible(false)
        slot = { img, bornAt: -1, tweens: [] }
        this.decals.push(slot)
      } else {
        // Пул полон — крадём самую старую декаль.
        slot = this.decals.reduce((a, c) => (c.bornAt < a.bornAt ? c : a))
        this.killSlot(slot)
      }
    }
    slot.bornAt = this.scene.time.now
    const img = slot.img
    img.setPosition(px, py)
      .setScale(scale * Phaser.Math.FloatBetween(0.8, 1.25))
      .setAngle(Phaser.Math.Between(0, 359))
      .setAlpha(QUALITY.level === 'high' ? 0.92 : 0.8)
      .setTint(BLOOD_FRESH)
      .setVisible(true)

    const life = QUALITY.level === 'high' ? b.decalLifeMs : Math.round(b.decalLifeMs * 0.4)
    const darken = Math.min(QUALITY.level === 'high' ? b.decalDarkenMs : b.decalDarkenMs * 0.4, life * 0.4)
    slot.tweens = [
      this.scene.tweens.addCounter({
        from: 0, to: 1, duration: darken,
        onUpdate: (t) => {
          img.setTint(this.lerpTint(BLOOD_FRESH, BLOOD_DARK, t.progress))
        },
      }),
      this.scene.tweens.add({
        targets: img,
        alpha: 0,
        delay: darken,
        duration: Math.max(400, life - darken),
        onComplete: () => this.killSlot(slot!),
      }),
    ]
  }

  private lerpTint(a: number, c: number, t: number): number {
    const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff
    const cr = (c >> 16) & 0xff, cg = (c >> 8) & 0xff, cb = c & 0xff
    const r = Math.round(ar + (cr - ar) * t)
    const g = Math.round(ag + (cg - ag) * t)
    const bl = Math.round(ab + (cb - ab) * t)
    return (r << 16) | (g << 8) | bl
  }

  private killSlot(slot: DecalSlot): void {
    for (const tw of slot.tweens) tw.remove()
    slot.tweens = []
    slot.bornAt = -1
    slot.img.setVisible(false)
  }

  // ── Слой 3: съедобные сгустки на месте смерти ────────────────────────────

  spawnClots(x: number, y: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const ox = x + Phaser.Math.FloatBetween(-18, 18)
      const floorY = this.floorBelowPx(ox, y - 6)
      const py = floorY !== null ? floorY - 4 : y + Phaser.Math.FloatBetween(-10, 10)
      const img = this.scene.add.image(ox, py, 'clot')
        .setDepth(DEPTH_DECALS)
        .setScale(Phaser.Math.FloatBetween(0.8, 1.3))
      this.scene.tweens.add({
        targets: img,
        scaleY: { from: 0.9, to: 1.15 },
        duration: 420 + i * 60,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
      this.clots.push({ img, bornAt: this.scene.time.now, alive: true })
    }
  }

  // ── Всплывающие числа урона ──────────────────────────────────────────────

  number(px: number, py: number, message: string, color: string, big = false): void {
    let slot = this.numbers.find((n) => !n.busy)
    if (!slot) {
      const text = this.scene.add.text(px, py, '', {
        fontFamily: 'monospace',
        fontSize: big ? '19px' : '13px',
        fontStyle: 'bold',
        color,
        stroke: '#0b0b10',
        strokeThickness: 3,
      }).setOrigin(0.5).setDepth(DEPTH_NUMBERS)
      slot = { text, busy: false }
      this.numbers.push(slot)
    }
    slot.busy = true
    const t = slot.text
    t.setText(message)
      .setPosition(px + Phaser.Math.FloatBetween(-6, 6), py)
      .setColor(color)
      .setAlpha(1)
      .setScale(big ? 1.25 : 1)
      .setVisible(true)

    this.scene.tweens.add({
      targets: t,
      y: py - (big ? 30 : 20),
      duration: 620,
      ease: 'Cubic.Out',
    })
    this.scene.tweens.add({
      targets: t,
      alpha: 0,
      delay: 260,
      duration: 340,
      onComplete: () => {
        t.setVisible(false)
        slot!.busy = false
      },
    })
  }

  // ── Общий апдейт: подбор сгустков и их срок ──────────────────────────────

  update(playerX: number, playerY: number): void {
    const c = BALANCE.clots
    const now = this.scene.time.now
    for (const clot of this.clots) {
      if (!clot.alive) continue
      const dx = clot.img.x - playerX
      const dy = clot.img.y - playerY
      if (dx * dx + dy * dy < c.pickupRadius * c.pickupRadius) {
        clot.alive = false
        this.scene.tweens.killTweensOf(clot.img)
        this.scene.tweens.add({
          targets: clot.img,
          y: clot.img.y - 12,
          alpha: 0,
          scale: 0.4,
          duration: 180,
          onComplete: () => clot.img.destroy(),
        })
        this.onClotEaten(clot.img.x, clot.img.y)
        continue
      }
      if (now - clot.bornAt > c.lifeMs) {
        clot.alive = false
        this.scene.tweens.killTweensOf(clot.img)
        this.scene.tweens.add({
          targets: clot.img,
          alpha: 0,
          duration: 500,
          onComplete: () => clot.img.destroy(),
        })
      }
    }
    // Чистим мёртвые записи (сами изображения уже уничтожены).
    if (this.clots.length > 64) {
      for (let i = this.clots.length - 1; i >= 0; i--) {
        if (!this.clots[i].alive) this.clots.splice(i, 1)
      }
    }
  }

  /** Сколько активных декалей (debug). */
  get activeDecals(): number {
    return this.decals.filter((d) => d.bornAt > 0).length
  }

  get activeClots(): number {
    return this.clots.filter((c) => c.alive).length
  }
}
