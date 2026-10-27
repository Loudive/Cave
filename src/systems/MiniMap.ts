/**
 * MiniMap.ts — шаг 4: мини-карта пещеры.
 * RenderTexture 1 px = 1 тайл, масштаб ×2, правый нижний угол.
 * Рисуется один раз после генерации; точка существа обновляется каждый кадр.
 * Переключение — M.
 */
import Phaser from 'phaser'
import type { CaveData } from '../gen/cave'
import { GEN, bandColorInt } from '../config/gen'

const COL = {
  air: 0x0b0b10,
  stone: 0x16161f,
  ground: 0x3c3a4a,
  entrance: 0xe8e6e3,
  exit: 0x58e6c8,
}

export class MiniMap {
  private readonly rt: Phaser.GameObjects.RenderTexture
  private readonly dot: Phaser.GameObjects.Rectangle
  private readonly left: number
  private readonly top: number
  private readonly tileScale: number
  private visible = true

  constructor(scene: Phaser.Scene, cave: CaveData) {
    const { width, height } = scene.scale
    this.tileScale = 2

    this.rt = scene.add.renderTexture(0, 0, cave.cols, cave.rows)
      .setOrigin(1, 1)
      .setPosition(width - 8, height - 8)
      .setScale(this.tileScale)
      .setScrollFactor(0)
      .setDepth(30)
      .setAlpha(0.88)

    this.left = width - 8 - cave.cols * this.tileScale
    this.top = height - 8 - cave.rows * this.tileScale

    // ── Отрисовка карты (один раз) ─────────────────────────────────────────
    this.rt.fill(COL.air, 0.85)
    for (let y = 0; y < cave.rows; y++) {
      for (let x = 0; x < cave.cols; x++) {
        const i = y * cave.cols + x
        if (cave.ground[i] === 1) {
          this.rt.fill(COL.ground, 1, x, y, 1, 1)
        } else if (cave.solid[i] === 1) {
          this.rt.fill(COL.stone, 1, x, y, 1, 1)
        }
      }
    }
    // Грибы — цветными точками биома.
    for (const m of cave.mushrooms) {
      const band = GEN.biomeBands[m.biome]
      this.rt.fill(band ? bandColorInt(band) : 0x58e6c8, 0.9, m.tx, m.ty, 1, 1)
    }
    // Вход (белый) и выход (циан) — заметные маяки.
    this.rt.fill(COL.entrance, 1, cave.entrance.x - 1, cave.entrance.y - 1, 3, 3)
    this.rt.fill(COL.exit, 1, cave.exit.x - 1, cave.exit.y - 1, 3, 3)

    // Точка существа.
    this.dot = scene.add.rectangle(0, 0, 4, 4, 0xffffff, 0.95)
      .setScrollFactor(0)
      .setDepth(31)

    scene.input.keyboard?.on('keydown-M', () => this.toggle())
  }

  toggle(): void {
    this.setVisible(!this.visible)
  }

  setVisible(v: boolean): void {
    this.visible = v
    this.rt.setVisible(v)
    this.dot.setVisible(v)
  }

  /** Обновлять каждый кадр: мировые координаты существа. */
  update(worldX: number, worldY: number, tile: number): void {
    if (!this.visible) return
    this.dot.setPosition(
      this.left + (worldX / tile) * this.tileScale,
      this.top + (worldY / tile) * this.tileScale,
    )
  }
}
