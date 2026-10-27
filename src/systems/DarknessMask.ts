import Phaser from 'phaser'
import { LIGHT, hexInt } from '../config/light'

/**
 * DarknessMask — шаг 5: световая маска тьмы.
 * Гайд предлагает Light2D или «более дешёвый вариант — световые маски:
 * чёрный слой с «дырками»-градиентами вокруг источников». Берём маску:
 * RenderTexture на весь кадр заливается тьмой, источники вырезают в ней
 * мягкие дыры радиальной light-hole текстурой (blend ERASE).
 * Дешевле Light2D (нет нормалмап и пайплайна), работает на Canvas-fallback,
 * радиусы читаются из light.json.
 *
 * Порядок слоёв сцены: мир (тайлы/сущности, depth 0..3) → маска (14) →
 * силуэтная мошь (16) → вигнетка (18) → HUD (22+) → debug (24) → мини-карта (30).
 */

/** Глубина RenderTexture тьмы (см. слои выше). */
const DEPTH_MASK = 14

export interface LightSource {
  /** Мировая X источника (кадра — для scrollFactor(0) объектов). */
  x: () => number
  /** Мировая Y источника. */
  y: () => number
  /** Базовый внешний радиус дыры, px. */
  radius: number
  /** Пульсация: множитель радиуса (1 = база). Например масштаб твины свечения. */
  scaleNow?: () => number
  /** Дышащий свет существа (лёгкая синусоида от breathePeriodMs). */
  breathe?: boolean
}

export class DarknessMask {
  private readonly rt: Phaser.GameObjects.RenderTexture
  private readonly hole: Phaser.GameObjects.Image
  private readonly colorInt: number
  private readonly lights: LightSource[] = []
  private playerLight: LightSource | null = null
  /** Сердцебиение: 0..1 — усиливает дыхание света (низкий HP/голод, шаг 6). */
  private heartbeat = 0
  /** Число дыр, вырезанных в последнем кадре (debug). */
  public lastHoles = 0

  constructor(scene: Phaser.Scene) {
    const { width, height } = scene.scale
    this.rt = scene.add.renderTexture(0, 0, width, height)
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH_MASK)
    this.hole = scene.make.image({ key: LIGHT.darkness.holeTexture, add: false })
    this.colorInt = hexInt(LIGHT.darkness.color)
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.hole.destroy()
    })
  }

  /** Зарегистрировать источник света. Возвращает его же (для хранения). */
  add(src: LightSource): LightSource {
    this.lights.push(src)
    return src
  }

  /** Пометить источник как свет существа — на него дышит и мошь реагирует. */
  setPlayer(src: LightSource): void {
    this.playerLight = src
  }

  /** Свет игрока — радиус с дыханием; нужен мошки и (позже) ИИ незаметности. */
  playerRadius(time: number): number {
    if (!this.playerLight) return 0
    let r = this.playerLight.radius
    if (this.playerLight.breathe) {
      const cfg = LIGHT.playerLight
      // Сердцебиение (шаг 6): при низком HP/голоду свет дышит чаще и глубже —
      // «свет игрока дышит вместе с сердцебиением при низком HP» (гайд §7).
      const amp = cfg.breatheAmp * (1 + this.heartbeat * 2.4)
      const period = cfg.breathePeriodMs / (1 + this.heartbeat * 1.1)
      r *= 1 + amp * Math.sin((time / period) * Math.PI * 2)
    }
    return r
  }

  /** Сила сердцебиения света 0..1 (сцена считает по HP/голоду). */
  setHeartbeat(level: number): void {
    this.heartbeat = Phaser.Math.Clamp(level, 0, 1)
  }

  update(scene: Phaser.Scene): void {
    const cam = scene.cameras.main
    const t = scene.time.now
    this.rt.clear()
    this.rt.fill(this.colorInt, LIGHT.darkness.alpha)

    let holes = 0
    for (const l of this.lights) {
      let r = l.radius
      if (l.scaleNow) r *= l.scaleNow()
      if (l.breathe) r = this.playerRadius(t)
      // Мировые → экранные (zoom = 1, FIT 960×540, канвас не ресайзится).
      const sx = l.x() - cam.scrollX
      const sy = l.y() - cam.scrollY
      if (sx < -r || sy < -r || sx > cam.width + r || sy > cam.height + r) continue
      this.hole.setPosition(sx, sy)
        .setDisplaySize(r * 2, r * 2)
        .setAlpha(1)
      this.rt.erase(this.hole)
      holes++
    }
    this.lastHoles = holes
  }
}
