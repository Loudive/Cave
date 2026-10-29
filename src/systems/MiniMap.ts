/**
 * MiniMap.ts — шаг 4: мини-карта пещеры. Шаг 13 (Hidden Deep): туман войны.
 *
 * RenderTexture 1 px = 1 тайл, масштаб ×2, правый нижний угол. Карта
 * СТРОИТСЯ по мере исследования: вокруг существа открывается круг
 * (gen.map.revealTiles), неоткрытое остаётся тьмой — как картографирование
 * в Hidden Deep: карту нельзя «подсмотреть», её надо пройти ногами.
 * Вход/выход/грибы проявляются, когда до них дошёл свет.
 *
 * Удержание M (дольше gen.map.bigMapHoldMs) — полная карта по центру экрана
 * с легендой; короткое нажатие M — вкл/выкл мини-карты, как раньше.
 */
import Phaser from 'phaser'
import type { CaveData } from '../gen/cave'
import { GEN, bandColorInt } from '../config/gen'
import { uiAttach } from './UiLayer'
import { DESIGN_W, DESIGN_H } from './RenderScale'

const COL = {
  air: 0x1b1b26,
  stone: 0x16161f,
  ground: 0x3c3a4a,
  entrance: 0xe8e6e3,
  exit: 0x58e6c8,
  you: 0xffffff,
}

/** Радиус-квадрат для круга открытия (кэш, чтобы не считать sqrt в цикле). */
function revealDisc(radius: number): { dx: number; dy: number }[] {
  const cells: { dx: number; dy: number }[] = []
  const r2 = radius * radius
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy <= r2) cells.push({ dx, dy })
    }
  }
  return cells
}

export class MiniMap {
  private readonly rt: Phaser.GameObjects.RenderTexture
  private readonly frame: Phaser.GameObjects.Rectangle
  private readonly label: Phaser.GameObjects.Text
  private readonly dot: Phaser.GameObjects.Rectangle
  private readonly left: number
  private readonly top: number
  private readonly tileScale: number
  /** Шаг 23: мини-карта СКРЫТА по умолчанию (см. конструктор). */
  private visible = false

  // ── Шаг 13: туман войны ──────────────────────────────────────────────────
  private readonly explored: Uint8Array
  private readonly revealCells: { dx: number; dy: number }[]
  private entranceShown = false
  private exitShown = false
  private readonly shownMushrooms = new Set<number>()

  // ── Шаг 13: большая карта (удержание M) ─────────────────────────────────
  private big: Phaser.GameObjects.Container | null = null
  private bigDot: Phaser.GameObjects.Rectangle | null = null
  private bigTitle: Phaser.GameObjects.Text | null = null
  private holdTimer: Phaser.Time.TimerEvent | null = null
  private bigShown = false

  constructor(
    private scene: Phaser.Scene,
    private cave: CaveData,
  ) {
    // Шаг 23: экранные координаты мини-карты — ДИЗАЙН-пиксели 960×540
    // (uiRoot × k на экране); scene.scale теперь 960k×540k.
    const width = DESIGN_W
    const height = DESIGN_H
    const M = GEN.map
    this.tileScale = M.miniTileScale
    const margin = M.miniMargin
    const mapW = cave.cols * this.tileScale
    const mapH = cave.rows * this.tileScale

    this.rt = scene.add.renderTexture(0, 0, cave.cols, cave.rows)
      .setOrigin(1, 1)
      .setPosition(width - margin, height - margin)
      .setScale(this.tileScale)
      .setScrollFactor(0)
      .setDepth(30)
      .setAlpha(0.88)
    // Шаг 20: мини-карта — экранным слоем (не зумится с камерой).
    uiAttach(scene, this.rt)

    // Шаг 21: рамка-панель + подпись — ЖАЛОБА «неизвестные тёмные фигуры»:
    // RAW RenderTexture 370×232 с заливкой тумана читалась как тёмный
    // прямоугольник-артефакт. Панель (подложка + обводка + подпись «M —
    // карта» в стиле подсказки внизу экрана) делает её узнаваемой как UI;
    // туман перекрашен в тёмно-синий (miniFogColor) — «бумага карты в
    // темноте», а не дыра. Все параметры — gen.json map.mini*.
    this.frame = scene.add.rectangle(
      width - margin - mapW / 2,
      height - margin - mapH / 2,
      mapW + M.miniFramePad * 2,
      mapH + M.miniFramePad * 2,
      0x0b0b10,
      M.miniBackingAlpha,
    )
      .setStrokeStyle(1, M.miniFrameColor, M.miniFrameAlpha)
      .setScrollFactor(0)
      .setDepth(29)
    uiAttach(scene, this.frame)
    this.label = scene.add.text(width - margin, height - margin - mapH - M.miniFramePad * 2, 'M — карта', {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: '#8A8894',
    })
      .setOrigin(1, 1)
      .setAlpha(M.miniLabelAlpha)
      .setScrollFactor(0)
      .setDepth(31)
    uiAttach(scene, this.label)

    this.left = width - margin - cave.cols * this.tileScale
    this.top = height - margin - cave.rows * this.tileScale

    // Туман войны: до исследования карта — тёмная «бумага» (не дыра).
    this.explored = new Uint8Array(cave.cols * cave.rows)
    this.revealCells = revealDisc(GEN.map.revealTiles)
    this.rt.fill(M.miniFogColor, M.miniFogAlpha)

    // Точка существа (малая карта).
    this.dot = scene.add.rectangle(0, 0, 4, 4, COL.you, 0.95)
      .setScrollFactor(0)
      .setDepth(31)
    uiAttach(scene, this.dot)

    this.buildBigMap(width, height)

    // Шаг 23 («чёрный квадрат ещё есть»): мини-карта СКРЫТА по умолчанию.
    // Панель 370×232 — треть экрана тёмно-синей заливки: даже с рамкой и
    // подписью (шаг 21) на экране игрока она читалась как ЧЁРНЫЙ КВАДРАТ
    // (скриншот игрока: «большой тёмный прямоугольник без рамки и
    // деталей» — 1px рамка и 9px подпись тонут при FIT-растяжении).
    // Карта никуда не делась: короткое M — показать/скрыть мини-карту,
    // удержание M — полная карта по центру; строка подсказок внизу
    // напоминает «M — карта». Туман войны копится и в скрытом виде —
    // открывается всегда актуальная карта.
    if (!M.miniDefaultOn) this.setVisible(false)

    const kb = scene.input.keyboard
    kb?.on('keydown-M', (e: KeyboardEvent) => {
      if (e.repeat) return
      // Удержание — большая карта; короткое нажатие — тумблер мини-карты.
      this.holdTimer = scene.time.delayedCall(GEN.map.bigMapHoldMs, () => this.showBig(true))
    })
    kb?.on('keyup-M', () => {
      this.holdTimer?.remove()
      this.holdTimer = null
      if (this.bigShown) this.showBig(false)
      else this.toggle()
    })
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.holdTimer?.remove()
    })
  }

  /** Полная карта по центру (та же RT, увеличенная; легенда + слой). */
  private buildBigMap(width: number, height: number): void {
    const c = this.scene.add.container(width / 2, height / 2).setScrollFactor(0).setDepth(38)
    // Шаг 20: большая карта — экранным слоем (по центру при любом зуме).
    uiAttach(this.scene, c)
    const veil = this.scene.add.rectangle(0, 0, width, height, 0x0b0b10, 0.86)
    const mapW = this.cave.cols * GEN.map.bigMapScale
    const mapH = this.cave.rows * GEN.map.bigMapScale
    const frame = this.scene.add.rectangle(0, 6, mapW + 12, mapH + 12, 0x0b0b10, 0.5)
      .setStrokeStyle(1, 0x3c3a4a)
    const img = this.scene.add.image(0, 6, this.rt.texture)
      .setOrigin(0.5, 0.5)
      .setScale(GEN.map.bigMapScale)
    this.bigTitle = this.scene.add.text(0, 6 - mapH / 2 - 22, '', {
      fontFamily: 'monospace',
      fontSize: '14px',
      fontStyle: 'bold',
      color: '#E8E6E3',
    }).setOrigin(0.5)
    const legend = this.scene.add.text(0, 6 + mapH / 2 + 18,
      '● ты   ▫ вход   ▪ выход вниз   • грибы   тьма = не исследовано',
      {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#8A8894',
      }).setOrigin(0.5)
    this.bigDot = this.scene.add.rectangle(0, 0, 6, 6, COL.you, 1)
    c.add([veil, frame, img, this.bigTitle, legend, this.bigDot])
    c.setVisible(false)
    this.big = c
  }

  private showBig(on: boolean): void {
    this.bigShown = on
    this.big?.setVisible(on)
    this.bigDot?.setVisible(on)
  }

  /** Слой для заголовка большой карты («слой N · глубина X м»). */
  setLayerInfo(line: string): void {
    this.bigTitle?.setText(`КАРТА ПЕЩЕРЫ · ${line}`)
  }

  toggle(): void {
    this.setVisible(!this.visible)
  }

  setVisible(v: boolean): void {
    this.visible = v
    this.rt.setVisible(v)
    this.dot.setVisible(v)
    this.frame.setVisible(v)
    this.label.setVisible(v)
  }

  /** Открыть тайл на карте (цвет по типу клетки + маяки, если нашлись). */
  private paintTile(tx: number, ty: number): void {
    const i = ty * this.cave.cols + tx
    if (this.cave.ground[i] === 1) {
      this.rt.fill(COL.ground, 1, tx, ty, 1, 1)
    } else if (this.cave.solid[i] === 1) {
      this.rt.fill(COL.stone, 1, tx, ty, 1, 1)
    } else {
      this.rt.fill(COL.air, 0.9, tx, ty, 1, 1)
    }
  }

  /** Проявить маяки (вход/выход/грибы), чьи клетки только что открыты. */
  private revealMarkers(): void {
    if (!this.entranceShown && this.explored[this.cave.entrance.y * this.cave.cols + this.cave.entrance.x]) {
      this.entranceShown = true
      this.rt.fill(COL.entrance, 1, this.cave.entrance.x - 1, this.cave.entrance.y - 1, 3, 3)
    }
    if (!this.exitShown && this.explored[this.cave.exit.y * this.cave.cols + this.cave.exit.x]) {
      this.exitShown = true
      this.rt.fill(COL.exit, 1, this.cave.exit.x - 1, this.cave.exit.y - 1, 3, 3)
    }
    for (let m = 0; m < this.cave.mushrooms.length; m++) {
      if (this.shownMushrooms.has(m)) continue
      const sh = this.cave.mushrooms[m]
      if (!this.explored[sh.ty * this.cave.cols + sh.tx]) continue
      this.shownMushrooms.add(m)
      const band = GEN.biomeBands[sh.biome]
      this.rt.fill(band ? bandColorInt(band) : 0x58e6c8, 0.9, sh.tx, sh.ty, 1, 1)
    }
  }

  /** Обновлять каждый кадр: туман войны + мировые координаты существа. */
  update(worldX: number, worldY: number, tile: number): void {
    // Туман войны: круг открытия вокруг существа (новые клетки — рисуем).
    const ptx = Math.floor(worldX / tile)
    const pty = Math.floor(worldY / tile)
    let changed = false
    for (const c of this.revealCells) {
      const tx = ptx + c.dx
      const ty = pty + c.dy
      if (tx < 0 || ty < 0 || tx >= this.cave.cols || ty >= this.cave.rows) continue
      const i = ty * this.cave.cols + tx
      if (this.explored[i]) continue
      this.explored[i] = 1
      this.paintTile(tx, ty)
      changed = true
    }
    if (changed) this.revealMarkers()

    // Точка существа на малой карте.
    if (this.visible) {
      this.dot.setPosition(
        this.left + (worldX / tile) * this.tileScale,
        this.top + (worldY / tile) * this.tileScale,
      )
    }

    // Точка на большой карте (RT имеет origin 0.5 после setScale? нет:
    // координаты считаем от левого-верхнего угла развёрнутой карты).
    if (this.bigShown && this.big) {
      const mapW = this.cave.cols * GEN.map.bigMapScale
      const mapH = this.cave.rows * GEN.map.bigMapScale
      const originX = this.big.x - mapW / 2
      const originY = this.big.y + 6 - mapH / 2
      this.bigDot!.setPosition(
        originX + (worldX / tile) * GEN.map.bigMapScale,
        originY + (worldY / tile) * GEN.map.bigMapScale,
      )
    }
  }

  /** Доля исследованной карты (0..1) — для итогового экрана/debug. */
  get exploredShare(): number {
    let n = 0
    for (const v of this.explored) n += v
    return n / this.explored.length
  }
}
