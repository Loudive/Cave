import Phaser from 'phaser'
import { LIGHT, hexInt } from '../config/light'
import type { CaveData } from '../gen/cave'
import { Rng, hashSeed } from '../gen/rng'
import type { DarknessMask } from './DarknessMask'

/**
 * SilhouetteMotes — шаг 5: силуэтная мошь, «фауна тьмы».
 * Гайд: «за пределами света мобы видны как чуть более чёрные силуэты на чёрном —
 * подсознание замечает движение раньше, чем глаз понимает, что видит».
 * Мошь рендерится ПОВЕРХ маски тьмы почти чёрным tint'ом и растворяется
 * в свете игрока. На шаге 6+ тот же приём переиспользуют настоящие мобы:
 * нормальный спрайт под маской + силуэтная копия поверх, если вне света.
 */

/** Глубина моши: выше маски тьмы (14), ниже вигнетки (18). */
const DEPTH_MOTES = 16

interface Mote {
  img: Phaser.GameObjects.Image
  /** Якорь (центр дрейфа) в мировых координатах. */
  ax: number
  ay: number
  phase: number
  periodMs: number
}

export class SilhouetteMotes {
  private readonly motes: Mote[] = []

  constructor(
    scene: Phaser.Scene,
    cave: CaveData,
    private readonly mask: DarknessMask,
  ) {
    const cfg = LIGHT.motes
    const rng = new Rng(hashSeed(cave.seed + ':motes'))
    const tile = cave.tile
    let placed = 0
    for (let tries = 0; tries < 600 && placed < cfg.count; tries++) {
      const tx = rng.int(cave.cols)
      const ty = rng.int(cave.rows)
      if (cave.solid[ty * cave.cols + tx] !== 0) continue
      const img = scene.add.image(0, 0, 'mote')
        .setTint(hexInt(cfg.tint))
        .setAlpha(0)
        .setDepth(DEPTH_MOTES)
      this.motes.push({
        img,
        ax: tx * tile + tile / 2,
        ay: ty * tile + tile / 2,
        phase: rng.float() * Math.PI * 2,
        periodMs: cfg.speedMinMs + rng.float() * (cfg.speedMaxMs - cfg.speedMinMs),
      })
      placed++
    }
  }

  /** Вызывать каждый кадр: дрейф по лиссажу + фейд в свете существа. */
  update(scene: Phaser.Scene, playerX: number, playerY: number): void {
    const cfg = LIGHT.motes
    const t = scene.time.now
    const lightR = this.mask.playerRadius(t)
    const rIn = lightR * cfg.fadeInner
    const rOut = lightR * cfg.fadeOuter
    for (const m of this.motes) {
      const k = (t / m.periodMs) * Math.PI * 2 + m.phase
      const x = m.ax + Math.cos(k) * cfg.driftRadiusPx
      const y = m.ay + Math.sin(k * 1.37) * cfg.driftRadiusPx * 0.6
      m.img.setPosition(x, y)
      // В свете растворяется, во тьме — силуэт: плавный фейд между радиусами.
      const d = Math.hypot(x - playerX, y - playerY)
      let a = cfg.alpha
      if (d < rIn) a = 0
      else if (d < rOut) a = cfg.alpha * ((d - rIn) / (rOut - rIn))
      m.img.setAlpha(a)
    }
  }

  /** Сколько мошек вообще заспавнено. */
  get count(): number {
    return this.motes.length
  }

  /** Сколько сейчас видимо (вне света) — для debug и верификации. */
  get visibleCount(): number {
    let n = 0
    for (const m of this.motes) if (m.img.alpha > 0.02) n++
    return n
  }
}
