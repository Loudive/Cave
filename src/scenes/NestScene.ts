import Phaser from 'phaser'
import {
  NEST,
  NEST_TOTAL_FULL,
  nestSpent,
  nodeRanks,
  nodeRankCost,
  nodeIcon,
  BRANCH_ICON,
  type NestBranch,
  type NestNode,
} from '../config/nest'
import { ENEMIES } from '../config/enemies'
import { GENES } from '../config/genes'
import {
  loadNestSave,
  writeNestSave,
  updateNestSave,
  rarityColor,
  type NestSave,
} from '../systems/NestSave'
import { AudioSystem } from '../systems/Audio'
import { hexInt } from '../config/light'
import { QUEEN } from '../config/queen'
import { loadPendingChallenger, challengerShareUrl } from '../systems/Reign'

/**
 * NestScene — шаг 11: хаб мета-прогрессии «Гнездо».
 * Шаг 24: РЕСТИЛИЗАЦИЯ древа по заказу игрока («стилизуй древо по норм
 * арты, иконки сгенерируй») + ПЕРЕРАБОТАННАЯ ЭКОНОМИКА:
 *  • узлы — иконки (assets/icon-*.png, scripts/process-icons.mjs),
 *    рамка формой кодирует тип (стат — скруглённый квадрат, способность —
 *    круг, ключевая мутация — шестиугольник), ветки связаны линиями;
 *  • stat-узлы качаются до 3 РАНГОВ (эффект складывается, ранг дороже
 *    в rankCostMult раз) — пипсы под иконкой;
 *  • тир 3+ требует tierReqNodes узлов предыдущего тира (строже);
 *  • прогресс древа — в Эссенции: «вложено X◈ из Y◈» (Y ≈ 8600).
 *
 * Ветки открываются рекордом глубины: недоступная колонка приглушена
 * с подписью «откроется на N м». Покупка в два тапа — страховка на таче.
 */
const DEPTH_BG = 0
const DEPTH_PANEL = 1
const DEPTH_UI = 2

const COL_TEXT = '#E8E6E3'
const COL_DIM = '#8A8894'
const COL_FAINT = '#5A5866'
const COL_ACCENT = '#58E6C8'

/** Клетка узла древа (шаг 24): иконка 40×40 + пипсы рангов внутри. */
const NODE_CELL = 40

type TabIndex = 0 | 1 | 2 | 3 | 4

/** Состояние узла (ранговое). */
type NodeState = 'maxed' | 'buyable' | 'locked-branch' | 'locked-tier' | 'no-money'

export class NestScene extends Phaser.Scene {
  private audio!: AudioSystem
  private save!: NestSave
  private tab!: TabIndex
  private tabLayer!: Phaser.GameObjects.Container
  private essenceText!: Phaser.GameObjects.Text
  private progressText!: Phaser.GameObjects.Text
  /** Выбранный (не купленный) узел — подтверждение покупки вторым тапом. */
  private selectedNode: NestNode | null = null
  private selectedMark: Phaser.GameObjects.Shape | null = null
  private tooltip!: Phaser.GameObjects.Text
  private tooltipPanel!: Phaser.GameObjects.Rectangle
  private tooltipBar!: Phaser.GameObjects.Rectangle
  private buyButton!: Phaser.GameObjects.Container
  private buyLabel!: Phaser.GameObjects.Text

  constructor() {
    super('Nest')
  }

  create(): void {
    const { width, height } = this.scale
    const cx = width / 2
    const cy = height / 2

    this.cameras.main.fadeIn(360, 4, 4, 8)
    this.audio = new AudioSystem(this)
    this.save = loadNestSave()
    this.tab = 0
    this.selectedNode = null

    // ── Сцена-пещера: фон-мегаволт затемнён + вигнетка (шаг 24: гнездо
    //    живёт В пещере, а не на пустой плашке).
    this.add.rectangle(cx, cy, width, height, 0x0b0b10).setDepth(DEPTH_BG)
    const bg = this.add.image(cx, cy, 'bg-megavault')
      .setDepth(DEPTH_BG)
      .setAlpha(0.22)
      .setDisplaySize(width * 1.05, height * 1.05)
    const bgEm = this.add.image(cx, cy, 'bg-megavault-em')
      .setDepth(DEPTH_BG + 0.1)
      .setAlpha(0.1)
      .setDisplaySize(width * 1.05, height * 1.05)
      .setBlendMode(Phaser.BlendModes.ADD)
    this.tweens.add({
      targets: [bgEm],
      alpha: { from: 0.07, to: 0.14 },
      duration: 5200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })
    void bg
    this.add.image(cx, cy, 'vignette')
      .setDisplaySize(width * 1.25, height * 1.25)
      .setDepth(DEPTH_BG + 0.2)
      .setAlpha(0.75)

    // Талисман хаба — сам герой (правый нижний угол, не мешает узлам древа).
    this.add.image(width - 62, height - 52, 'hero-idle').setScale(1.4).setAlpha(0.9).setDepth(DEPTH_PANEL)

    // ── Шапка ──────────────────────────────────────────────────────────────
    this.add.text(cx, 26, 'Г Н Е З Д О', {
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontSize: '30px', fontStyle: 'bold', color: COL_ACCENT,
    }).setOrigin(0.5).setDepth(DEPTH_UI)

    this.essenceText = this.add.text(24, 22, '', {
      fontFamily: 'monospace', fontSize: '18px', fontStyle: 'bold', color: '#E8A34F',
    }).setDepth(DEPTH_UI)

    this.progressText = this.add.text(24, 44, '', {
      fontFamily: 'monospace', fontSize: '11px', color: COL_DIM,
    }).setDepth(DEPTH_UI)
    this.refreshEssence()

    // Кнопка «в пещеру» — правый верхний угол.
    const cave = this.add.text(width - 24, 22, 'В ПЕЩЕРУ ▸', {
      fontFamily: 'monospace', fontSize: '15px', color: '#0b0b10',
      backgroundColor: '#58E6C8', padding: { x: 10, y: 5 },
    }).setOrigin(1, 0).setDepth(DEPTH_UI).setInteractive({ useHandCursor: true })
    cave.on(Phaser.Input.Events.POINTER_DOWN, () => this.leave('Cave'))

    // ── Вкладки ────────────────────────────────────────────────────────────
    const tabW = 128
    const tabY = 78
    const total = NEST.tabNames.length
    const startX = cx - (total * (tabW + 6) - 6) / 2
    NEST.tabNames.forEach((name, i) => {
      const x = startX + i * (tabW + 6) + tabW / 2
      const bg = this.add.rectangle(x, tabY, tabW, 26, 0x151522).setStrokeStyle(1, 0x2a2a3a).setDepth(DEPTH_UI)
      const label = this.add.text(x, tabY, name, {
        fontFamily: 'monospace', fontSize: '13px', color: COL_DIM,
      }).setOrigin(0.5).setDepth(DEPTH_UI)
      ;(bg as unknown as { tabLabel: Phaser.GameObjects.Text }).tabLabel = label
      bg.setName(`tabbg-${i}`)
      bg.setInteractive({ useHandCursor: true })
      bg.on(Phaser.Input.Events.POINTER_DOWN, () => {
        if (this.tab === i) return
        this.audio.play('uiClick')
        this.tab = i as TabIndex
        this.rebuildTabs()
      })
    })

    // Слой содержимого вкладок — пересобирается при смене вкладки.
    this.tabLayer = this.add.container(0, 0).setDepth(DEPTH_PANEL)

    // Панель подсказки внизу (шаг 24: рамочная плашка с цветной кромкой).
    this.tooltipPanel = this.add.rectangle(cx, height - 54, 640, 46, 0x0e0e16, 0.92)
      .setStrokeStyle(1, 0x2a2a3a)
      .setDepth(DEPTH_UI)
      .setVisible(false)
    this.tooltipBar = this.add.rectangle(cx - 318, height - 54, 4, 38, 0x58e6c8)
      .setDepth(DEPTH_UI)
      .setVisible(false)
    this.tooltip = this.add.text(cx, height - 54, '', {
      fontFamily: 'monospace', fontSize: '12px', color: COL_TEXT,
      align: 'center', wordWrap: { width: 580 },
    }).setOrigin(0.5).setDepth(DEPTH_UI)

    this.buyLabel = this.add.text(0, 0, '', {
      fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: '#0b0b10',
      backgroundColor: '#E8A34F', padding: { x: 14, y: 7 },
    }).setOrigin(0.5)
    this.buyButton = this.add.container(cx, height - 20, [this.buyLabel]).setDepth(DEPTH_UI).setVisible(false)
    this.buyButton.setSize(220, 30)
    this.buyButton.setInteractive({ useHandCursor: true })
    this.buyButton.on(Phaser.Input.Events.POINTER_DOWN, () => this.confirmBuy())

    this.add.text(24, height - 16, 'ESC — в меню · узлы качаются до 3 рангов', {
      fontFamily: 'monospace', fontSize: '11px', color: COL_FAINT,
    }).setDepth(DEPTH_UI)

    this.rebuildTabs()

    this.input.keyboard?.once('keydown-ESC', () => this.leave('Menu'))
    this.input.keyboard?.on('keydown-N', () => this.leave('Cave'))
  }

  /** Шаг 11: все объекты вкладок живут в tabLayer — смена вкладки их чистит. */
  private tabAdd<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.tabLayer.add(obj)
    return obj
  }

  /** Пересобрать содержимое вкладки + подсветить активную. */
  private rebuildTabs(): void {
    this.tabLayer.removeAll(true)
    this.buyButton.setVisible(false)
    this.tooltip.setText('')
    this.tooltipPanel.setVisible(false)
    this.tooltipBar.setVisible(false)
    this.clearSelectionMark()

    for (let i = 0; i < NEST.tabNames.length; i++) {
      const bg = this.children.getByName(`tabbg-${i}`) as (Phaser.GameObjects.Rectangle & { tabLabel?: Phaser.GameObjects.Text }) | null
      if (bg?.tabLabel) {
        const active = this.tab === i
        bg.setFillStyle(active ? 0x2a2a3a : 0x151522)
        bg.setStrokeStyle(active ? 1 : 1, active ? 0x58e6c8 : 0x2a2a3a)
        bg.tabLabel.setColor(active ? '#ffffff' : COL_DIM)
      }
    }

    switch (this.tab) {
      case 0: this.buildTreeTab(); break
      case 1: this.buildBestiaryTab(); break
      case 2: this.buildGenomesTab(); break
      case 3: this.buildStatsTab(); break
      case 4: this.buildThroneTab(); break
    }
  }

  private refreshEssence(): void {
    const spent = nestSpent(this.save.ranks)
    this.essenceText.setText(`◈ ${this.save.essence}`)
    // Шаг 24: прогресс — Эссенция (ранги!), не число узлов.
    this.progressText.setText(`древо ${spent}◈ / ${NEST_TOTAL_FULL}◈`)
  }

  // ── Вкладка: древо навыков ───────────────────────────────────────────────

  private buildTreeTab(): void {
    const { width, height } = this.scale
    const colW = NEST.branchColW
    const totalW = NEST.branches.length * colW
    const startX = width / 2 - totalW / 2 + colW / 2
    const treeTop = 118
    const treeBottom = height - 92

    // Один Graphics на всё древо: связи + рамки + пипсы (дёшево).
    const gfx = this.tabAdd(this.add.graphics())

    for (let b = 0; b < NEST.branches.length; b++) {
      const branch = NEST.branches[b]
      const colX = startX + b * colW
      const unlocked = this.save.stats.bestDepthM >= branch.unlockDepthM
      const colorInt = hexInt(branch.color)

      // Заголовок ветки: иконка + имя + счётчик рангов.
      const rankCount = branch.nodes.reduce((s, n) => s + (this.save.ranks[n.id] ?? 0), 0)
      const rankTotal = branch.nodes.reduce((s, n) => s + nodeRanks(n), 0)
      const iconKey = `icon-${BRANCH_ICON[branch.id] ?? 'crystal'}`
      const headIcon = this.tabAdd(this.add.image(colX - 44, treeTop - 16, iconKey)
        .setAlpha(unlocked ? 0.95 : 0.25))
      this.tabAdd(this.add.text(colX - 30, treeTop - 14, branch.name.toUpperCase(), {
        fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold',
        color: unlocked ? branch.color : COL_FAINT,
      }).setOrigin(0, 0.5))
      this.tabAdd(this.add.text(colX - 30, treeTop + 2, unlocked
        ? `${this.branchBought(branch)}/${branch.nodes.length} узлов · ${rankCount}/${rankTotal} рангов`
        : `откроется на ${branch.unlockDepthM} м`, {
        fontFamily: 'monospace', fontSize: '9px', color: unlocked ? COL_FAINT : '#46444f',
      }).setOrigin(0, 0.5))
      void headIcon

      // 5 тиров = 5 рядов снизу вверх, по 3 узла в ряду (тир = ступень).
      const rows = 5
      const rowH = (treeBottom - treeTop - 20) / rows
      const tierCount: Record<number, number> = {}
      const slotX: Record<string, number> = {}
      const slotY: Record<string, number> = {}
      for (const node of branch.nodes) {
        const rowFromBottom = node.tier - 1
        const y = treeBottom - 6 - rowFromBottom * rowH - NODE_CELL / 2
        const slotInTier = tierCount[node.tier] ?? 0
        tierCount[node.tier] = slotInTier + 1
        const x = colX + (slotInTier - 1) * (colW * 0.32)
        slotX[node.id] = x
        slotY[node.id] = y
      }

      // Связи тиров: вертикальные жилы от ряда к ряду (цвет ветки, тише фона).
      gfx.lineStyle(1.5, colorInt, unlocked ? 0.22 : 0.08)
      for (let tier = 2; tier <= 5; tier++) {
        const yAbove = treeBottom - 6 - (tier - 2) * rowH - NODE_CELL / 2 + NODE_CELL / 2 + 4
        const yBelow = treeBottom - 6 - (tier - 1) * rowH - NODE_CELL / 2 + NODE_CELL / 2 + 4
        for (let s = 0; s < 3; s++) {
          const x = colX + (s - 1) * (colW * 0.32)
          gfx.lineBetween(x, yAbove, x, yBelow)
        }
      }
      void slotY

      for (const node of branch.nodes) {
        this.buildNode(gfx, node, slotX[node.id], slotY[node.id], unlocked, colorInt, branch)
      }
    }
  }

  private branchBought(branch: NestBranch): number {
    return branch.nodes.filter((n) => (this.save.ranks[n.id] ?? 0) > 0).length
  }

  /** Ранговое состояние узла (шаг 24: экономика рангов + строгие тиры). */
  private nodeState(node: NestNode, branchUnlocked: boolean): NodeState {
    const rank = this.save.ranks[node.id] ?? 0
    if (rank >= nodeRanks(node)) return 'maxed'
    if (!branchUnlocked) return 'locked-branch'
    if (node.tier > 1) {
      const branch = NEST.branches.find((b) => b.nodes.includes(node))!
      // Тир 2 — любой один узел тира 1; тир 3+ — tierReqNodes (строже).
      const need = node.tier >= 3 ? NEST.tierReqNodes : 1
      const prevBought = branch.nodes.filter(
        (n) => n.tier === node.tier - 1 && (this.save.ranks[n.id] ?? 0) > 0,
      ).length
      if (prevBought < need) return 'locked-tier'
    }
    return this.save.essence >= nodeRankCost(node, rank + 1) ? 'buyable' : 'no-money'
  }

  private buildNode(
    gfx: Phaser.GameObjects.Graphics,
    node: NestNode,
    x: number,
    y: number,
    branchUnlocked: boolean,
    colorInt: number,
    branch: NestBranch,
  ): void {
    const state = this.nodeState(node, branchUnlocked)
    const rank = this.save.ranks[node.id] ?? 0
    const ranks = nodeRanks(node)
    const isKey = node.type === 'key'
    const isAbility = node.type === 'ability'
    const half = NODE_CELL / 2

    // ── Рамка: форма кодирует тип узла (читаемость без текста).
    const framePts = (sides: number, r: number, rot = 0): number[] => {
      const pts: number[] = []
      for (let i = 0; i < sides; i++) {
        const a = ((Math.PI * 2) / sides) * i + rot
        pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r)
      }
      return pts
    }
    let fill = 0x101018
    let alpha = 0.92
    let stroke = 0x2a2a3a
    let strokeWidth = 1
    if (state === 'maxed') {
      fill = colorInt
      alpha = 0.3
      stroke = colorInt
      strokeWidth = 2
    } else if (rank > 0) {
      // Куплен частично — рамка ветки, фон чуть теплее.
      fill = 0x181826
      stroke = colorInt
      strokeWidth = 1.5
    } else if (state === 'buyable') {
      stroke = colorInt
      strokeWidth = 1.5
    } else if (state === 'no-money') {
      stroke = colorInt
      strokeWidth = 1
    }

    if (isKey) {
      gfx.fillStyle(fill, alpha)
      gfx.fillPoints(framePts(6, half - 1, -Math.PI / 6), true)
      gfx.lineStyle(strokeWidth, stroke, 0.95)
      gfx.strokePoints(framePts(6, half - 1, -Math.PI / 6), true, true)
    } else if (isAbility) {
      gfx.fillStyle(fill, alpha)
      gfx.fillCircle(x, y, half - 1)
      gfx.lineStyle(strokeWidth, stroke, 0.95)
      gfx.strokeCircle(x, y, half - 1)
    } else {
      // Стат — квадрат со срезанными углами (гнездо-слот).
      const c = 7
      const pts = [
        x - half + c, y - half, x + half - c, y - half,
        x + half, y - half + c, x + half, y + half - c,
        x + half - c, y + half, x - half + c, y + half,
        x - half, y + half - c, x - half, y - half + c,
      ]
      gfx.fillStyle(fill, alpha)
      gfx.fillPoints(pts, true)
      gfx.lineStyle(strokeWidth, stroke, 0.95)
      gfx.strokePoints(pts, true, true)
    }

    // ── Иконка эффекта (шаг 24: «норм арты»).
    const icon = this.tabAdd(this.add.image(x, y - 3, nodeIcon(node.effect.type)))
    icon.setScale(0.72)
    if (state === 'maxed') icon.setAlpha(1)
    else if (state === 'locked-branch' || state === 'locked-tier') icon.setAlpha(0.22)
    else if (rank > 0) icon.setAlpha(0.95)
    else icon.setAlpha(state === 'buyable' ? 0.85 : 0.45)

    // ── Пипсы рангов (до 3): заполненные — куплено, контур — следующий.
    if (ranks > 1) {
      const pipY = y + half - 6
      const pipR = 2.2
      const pipStep = 8
      const pipX0 = x - ((ranks - 1) * pipStep) / 2
      for (let r = 1; r <= ranks; r++) {
        const px = pipX0 + (r - 1) * pipStep
        if (r <= rank) {
          gfx.fillStyle(colorInt, 0.95)
          gfx.fillCircle(px, pipY, pipR)
        } else if (r === rank + 1 && state !== 'locked-branch' && state !== 'locked-tier') {
          gfx.lineStyle(1, colorInt, 0.8)
          gfx.strokeCircle(px, pipY, pipR)
        } else {
          gfx.lineStyle(1, 0x3a3a4c, 0.7)
          gfx.strokeCircle(px, pipY, pipR)
        }
      }
    }

    // ── Цена следующего ранга (или МАКС).
    if (state === 'maxed') {
      this.tabAdd(this.add.text(x, y + half + 4, 'МАКС', {
        fontFamily: 'monospace', fontSize: '8px', fontStyle: 'bold', color: branch.color,
      }).setOrigin(0.5))
    } else if (state !== 'locked-branch' && state !== 'locked-tier') {
      const cost = nodeRankCost(node, rank + 1)
      this.tabAdd(this.add.text(x, y + half + 4, `${cost}◈`, {
        fontFamily: 'monospace', fontSize: '9px',
        color: state === 'buyable' ? '#E8A34F' : COL_FAINT,
      }).setOrigin(0.5))
    }

    // ── Пульс доступности (дёшево: одна точка на узел).
    if (state === 'buyable') {
      const pulse = this.tabAdd(this.add.circle(x, y - half - 5, 2.5, colorInt))
      this.tweens.add({
        targets: pulse,
        alpha: { from: 1, to: 0.2 },
        scale: { from: 0.7, to: 1.3 },
        duration: 900,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
    }

    // ── Тач/мышь: невидимая зона шире клетки (палец ≥ 44px).
    const zone = this.tabAdd(this.add.zone(x, y, NODE_CELL + 8, NODE_CELL + 14))
      .setInteractive({ useHandCursor: state === 'buyable' || state === 'no-money' })
    zone.setData('nodeId', node.id)
    zone.on(Phaser.Input.Events.POINTER_DOWN, () => {
      const typeLabel = node.type === 'stat' ? 'стат' : node.type === 'ability' ? 'способность' : 'КЛЮЧЕВАЯ'
      if (state === 'maxed') {
        this.showTooltip(`${node.name} · ${typeLabel} · ранг ${rank}/${ranks} — МАКС\n${node.desc}`, branch.color)
        this.audio.play('uiClick')
        return
      }
      if (state === 'locked-branch') {
        this.showTooltip(`«${branch.name}» откроется, когда рекорд глубины достигнет ${branch.unlockDepthM} м (сейчас ${this.save.stats.bestDepthM} м)`, branch.color)
        this.audio.play('clank')
        return
      }
      if (state === 'locked-tier') {
        const need = node.tier >= 3 ? NEST.tierReqNodes : 1
        this.showTooltip(`«${node.name}»: сначала купи ${need === 1 ? 'любой узел' : `${need} узла`} тира ${node.tier - 1} ветки «${branch.name}»`, branch.color)
        this.audio.play('clank')
        return
      }
      this.selectNode(node, x, y, colorInt)
      const cost = nodeRankCost(node, rank + 1)
      const rankLine = ranks > 1 ? ` · ранг ${rank}→${rank + 1} из ${ranks}` : ''
      this.showTooltip(`${node.name} · ${typeLabel}${rankLine} · ${cost}◈\n${node.desc}`, branch.color)
    })
    zone.on(Phaser.Input.Events.POINTER_OVER, () => {
      if (state !== 'maxed' && this.selectedNode !== node) {
        const cost = state === 'locked-branch' || state === 'locked-tier' ? '—' : `${nodeRankCost(node, rank + 1)}◈`
        this.showTooltip(`${node.name} (${cost}) — ${node.desc}`, branch.color)
      }
    })
  }

  /** Панель-подсказка внизу с цветной кромкой ветки. */
  private showTooltip(text: string, branchColor: string): void {
    this.tooltip.setText(text)
    this.tooltipPanel.setVisible(true)
    this.tooltipBar.setVisible(true)
    this.tooltipBar.setFillStyle(hexInt(branchColor))
  }

  private selectNode(node: NestNode, x: number, y: number, colorInt: number): void {
    this.clearSelectionMark()
    this.selectedNode = node
    this.selectedMark = this.tabAdd(this.add.circle(x, y, NODE_CELL / 2 + 5).setStrokeStyle(2, colorInt, 0.95))
    const rank = this.save.ranks[node.id] ?? 0
    const cost = nodeRankCost(node, rank + 1)
    const afford = this.save.essence >= cost
    const ranks = nodeRanks(node)
    const label = ranks > 1 && rank > 0
      ? `УЛУЧШИТЬ ${rank}→${rank + 1} · ${cost}◈`
      : `КУПИТЬ · ${cost}◈`
    this.buyLabel.setText(afford ? label : `НЕ ХВАТАЕТ · ${cost}◈`)
    this.buyLabel.setBackgroundColor(afford ? '#E8A34F' : '#5A5866')
    this.buyButton.setVisible(true)
  }

  private clearSelectionMark(): void {
    this.selectedMark?.destroy()
    this.selectedMark = null
    this.selectedNode = null
    this.buyButton.setVisible(false)
  }

  private confirmBuy(): void {
    const node = this.selectedNode
    if (!node) return
    const rank = this.save.ranks[node.id] ?? 0
    const ranks = nodeRanks(node)
    if (rank >= ranks) return
    const cost = nodeRankCost(node, rank + 1)
    if (this.save.essence < cost) {
      this.audio.play('clank')
      this.showTooltip('Не хватает Эссенции. Иди в пещеру, пожри — Гнездо подождёт.', '#E8A34F')
      return
    }
    this.save = updateNestSave((s) => {
      s.essence -= cost
      if (rank === 0) s.nodes.push(node.id)
      s.ranks[node.id] = rank + 1
    })
    this.audio.play('gene')
    this.clearSelectionMark()
    this.refreshEssence()
    this.rebuildTabs()
    const line = rank + 1 >= ranks
      ? `${node.name} — ранг МАКС. Следующий забег уже сильнее.`
      : `${node.name} — ранг ${rank + 1}/${ranks}. Следующий ранг дороже.`
    this.showTooltip(line, '#58E6C8')
  }

  // ── Вкладка: бестиарий ───────────────────────────────────────────────────

  private buildBestiaryTab(): void {
    const { width } = this.scale
    const species = Object.entries(ENEMIES.species)
    const cols = 3
    const cardW = 244
    const cardH = 118
    const startX = width / 2 - (cols * cardW + (cols - 1) * 12) / 2
    const startY = 118

    species.forEach(([id, sp], i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = startX + col * (cardW + 12)
      const y = startY + row * (cardH + 10)
      const seen = (this.save.bestiary[id]?.eaten ?? 0) + (this.save.bestiary[id]?.killed ?? 0) > 0

      this.tabAdd(this.add.rectangle(x + cardW / 2, y + cardH / 2, cardW, cardH, 0x12121c, 0.92)
        .setStrokeStyle(1, seen ? 0x3a3a4c : 0x1e1e2c))
      const portrait = this.tabAdd(this.add.image(x + 34, y + 34, sp.texture).setScale(1.5))
      if (!seen) {
        portrait.setTint(0x1c1c28)
        this.tabAdd(this.add.text(x + 34, y + 34, '?', {
          fontFamily: 'Georgia, serif', fontSize: '28px', color: '#2c2c3c',
        }).setOrigin(0.5))
      }
      this.tabAdd(this.add.text(x + 64, y + 16, seen ? sp.name : '???', {
        fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold',
        color: seen ? COL_TEXT : '#3c3c4c',
      }))
      this.tabAdd(this.add.text(x + 64, y + 36, seen
        ? `съедено: ${this.save.bestiary[id]?.eaten ?? 0}\nубито: ${this.save.bestiary[id]?.killed ?? 0}`
        : 'не встречен', {
        fontFamily: 'monospace', fontSize: '11px', color: seen ? '#E8A34F' : COL_FAINT,
        lineSpacing: 3,
      }))
      this.tabAdd(this.add.text(x + 12, y + 66, seen ? (sp._flavor ?? '') : 'Пещера хранит свои тайны.', {
        fontFamily: 'monospace', fontSize: '9px', color: COL_DIM,
        wordWrap: { width: cardW - 24 }, lineSpacing: 2,
      }))
      if (seen && sp.essence >= 8) {
        // Шаг 24: метка хищника — красный клык у имени (опасные виды).
        this.tabAdd(this.add.image(x + cardW - 16, y + 16, 'icon-fangs').setScale(0.4).setAlpha(0.85))
      }
    })
  }

  // ── Вкладка: геномы ──────────────────────────────────────────────────────

  private buildGenomesTab(): void {
    const { width } = this.scale
    const owned = GENES.genes.filter((g) => (this.save.genomes[g.id]?.count ?? 0) > 0)
    const total = GENES.genes.length

    this.tabAdd(this.add.text(width / 2, 112, `коллекция геномов — ${owned.length}/${total}`, {
      fontFamily: 'monospace', fontSize: '13px', color: COL_DIM,
    }).setOrigin(0.5))

    if (owned.length === 0) {
      this.tabAdd(this.add.text(width / 2, 300, 'Пусто. Уникальные мобы несут постоянные гены —\nищи золотую ауру в глубине.', {
        fontFamily: 'monospace', fontSize: '13px', color: COL_FAINT, align: 'center',
      }).setOrigin(0.5))
      return
    }

    const rowH = 54
    owned.forEach((g, i) => {
      const y = 150 + i * rowH
      const color = rarityColor(g.rarity)
      this.tabAdd(this.add.rectangle(width / 2, y + rowH / 2 - 8, 620, rowH - 8, 0x12121c, 0.92)
        .setStrokeStyle(1, hexInt(color)))
      this.tabAdd(this.add.image(width / 2 - 280, y + rowH / 2 - 8, 'mutation-gem')
        .setTint(hexInt(color)).setScale(1.3))
      this.tabAdd(this.add.text(width / 2 - 256, y + 2, g.name, {
        fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color,
      }))
      this.tabAdd(this.add.text(width / 2 - 256, y + 20, g.desc, {
        fontFamily: 'monospace', fontSize: '11px', color: COL_DIM,
      }))
      this.tabAdd(this.add.text(width / 2 + 284, y + rowH / 2 - 8, `×${this.save.genomes[g.id].count}`, {
        fontFamily: 'monospace', fontSize: '15px', fontStyle: 'bold', color,
      }).setOrigin(1, 0.5))
      this.tabAdd(this.add.text(width / 2 + 180, y + rowH / 2 - 8, g.rarity, {
        fontFamily: 'monospace', fontSize: '10px', color,
      }).setOrigin(1, 0.5))
    })
  }

  // ── Вкладка: статистика ──────────────────────────────────────────────────

  private buildStatsTab(): void {
    const { width } = this.scale
    const s = this.save.stats
    const lines = [
      `забегов совершено — ${s.runs}`,
      `погиб во тьме — ${s.deaths}`,
      `пещер посещено — ${s.cavesVisited}`,
      `максимальная глубина — ${s.bestDepthM} м`,
      `мобов сожрано (всего) — ${s.totalEaten}`,
      `лучший трапезный забег — ${s.bestEaten} добычи`,
      `Эссенции заработано — ${s.totalEssence}`,
      `Маток Улья повергнуто — ${s.queensSlain}`,
      `Узурпаторов (PvP) побеждено — ${s.challengersBeaten}`,
      '',
      `лучший забег: ${s.bestRun.essence}◈ · ${s.bestRun.depthM} м · ${s.bestRun.eaten} съедено`,
    ]
    this.tabAdd(this.add.text(width / 2, 150, lines.join('\n'), {
      fontFamily: 'monospace', fontSize: '15px', color: COL_TEXT,
      align: 'center', lineSpacing: 9,
    }).setOrigin(0.5, 0))

    this.tabAdd(this.add.text(width / 2, 420,
      'Эссенция капает за каждое убийство и поедание, щедрее — в глубине:\nбагровые мобы старых полос жирнее и опаснее сразу.', {
      fontFamily: 'monospace', fontSize: '12px', color: COL_FAINT, align: 'center',
    }).setOrigin(0.5))
  }

  // ── Вкладка: ТРОН (шаг 25 — Матка Улья, Код Матки, PvP-вызовы) ─────────

  private buildThroneTab(): void {
    const { width } = this.scale
    const reign = this.save.reign
    const s = this.save.stats
    const every = QUEEN.lair.everyNDepths

    if (!reign) {
      this.tabAdd(this.add.text(width / 2, 148, 'ТРОН ПУСТ', {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: '26px', color: '#E23A4E', fontStyle: 'bold',
      }).setOrigin(0.5, 0))
      this.tabAdd(this.add.text(width / 2, 200, [
        `Матка Улья спит в Гнездовье — на ${every}-м слое глубины.`,
        'Она — мать всего выводка этих пещер.',
        'Пожри её, и улей примет твою плоть: ты станешь новой Маткой.',
        '',
        'Глубина бесконечна: каждая следующая Матка сильнее,',
        'а экспедиции с поверхности приходят злее.',
      ].join('\n'), {
        fontFamily: 'monospace', fontSize: '14px', color: COL_TEXT,
        align: 'center', lineSpacing: 9,
      }).setOrigin(0.5, 0))
      this.tabAdd(this.add.text(width / 2, 420,
        'Цель всегда видна в правом верхнем углу пещеры — иди вниз.', {
        fontFamily: 'monospace', fontSize: '12px', color: COL_FAINT, align: 'center',
      }).setOrigin(0.5))
    } else {
      this.tabAdd(this.add.text(width / 2, 132, `ТВОЯ МАТКА — ${reign.name.toUpperCase()}`, {
        fontFamily: 'Georgia, "Times New Roman", serif',
        fontSize: '24px', color: '#E8A34F', fontStyle: 'bold',
      }).setOrigin(0.5, 0))
      this.tabAdd(this.add.text(width / 2, 178, [
        `мощь билда — ${reign.power}`,
        `первое Гнездовье пало на ${reign.depthM} м`,
        `Маток повергнуто — ${s.queensSlain} · Узурпаторов (PvP) — ${s.challengersBeaten}`,
      ].join('\n'), {
        fontFamily: 'monospace', fontSize: '14px', color: COL_TEXT,
        align: 'center', lineSpacing: 8,
      }).setOrigin(0.5, 0))

      // Код Матки — сердце PvP-связки: ссылкой его отправляют друзьям.
      this.tabAdd(this.add.text(width / 2, 268, 'КОД МАТКИ', {
        fontFamily: 'monospace', fontSize: '12px', color: COL_DIM,
      }).setOrigin(0.5, 0))
      const codeBtn = this.add.text(width / 2, 294, reign.code, {
        fontFamily: 'monospace', fontSize: '20px', color: '#58E6C8',
        backgroundColor: '#101820',
        padding: { x: 14, y: 8 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true })
      codeBtn.on(Phaser.Input.Events.POINTER_DOWN, () => {
        const url = challengerShareUrl(reign.code)
        void navigator.clipboard?.writeText(url).then(() => {
          codeBtn.setText('[ ССЫЛКА-ВЫЗОВ СКОПИРОВАНА ✓ ]')
          this.time.delayedCall(1400, () => codeBtn.setText(reign.code))
        }).catch(() => {
          codeBtn.setText(url)
          this.time.delayedCall(2600, () => codeBtn.setText(reign.code))
        })
      })
      this.tabAdd(codeBtn)
      this.tabAdd(this.add.text(width / 2, 342,
        'Тапни по коду — скопируется ссылка-вызов. Отправь её другу:\nего Маткой в Гнездовье станешь ТЫ (мощь твоего билда — его проблема).', {
        fontFamily: 'monospace', fontSize: '12px', color: COL_FAINT, align: 'center',
      }).setOrigin(0.5))
    }

    // Активный вызов Узурпатора (пришёл по чужой ссылке).
    const ch = loadPendingChallenger()
    if (ch) {
      this.tabAdd(this.add.text(width / 2, 430,
        `⚔ ВЫЗОВ ПРИНЯТ: Узурпатор «${ch.name}» (мощь ${ch.power}) ждёт в Гнездовье ${every}-го слоя`, {
        fontFamily: 'monospace', fontSize: '13px', color: '#B36BFF',
        backgroundColor: '#16121f',
        padding: { x: 10, y: 6 },
      }).setOrigin(0.5))
    }
  }

  /** Уход из Гнезда: сохранить профиль, уйти с фейдом. */
  private leave(target: string): void {
    writeNestSave(this.save)
    this.audio.ensureAmbient()
    this.cameras.main.fadeOut(240, 4, 4, 8)
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(target)
    })
  }
}
