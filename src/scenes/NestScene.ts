import Phaser from 'phaser'
import { NEST, NEST_NODES, NEST_TOTAL_COST, type NestBranch, type NestNode } from '../config/nest'
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

/**
 * NestScene — шаг 11: хаб мета-прогрессии «Гнездо».
 *
 * Экран между забегами: сюда приносится Эссенция (гайд), здесь тратится
 * в древо навыков единственного героя (5 веток × 15 узлов, узлы трёх
 * типов: статы / способности / ключевые мутации передвижения), листается
 * бестиарий съеденного, коллекция геномов с редкостями и накопительная
 * статистика. Всё живёт в versioned localStorage (NestSave).
 *
 * Ветки открываются рекордом глубины: недоступная колонка приглушена
 * с подписью «откроется на N м» — видно, КУДА стремиться (читаемость).
 * Покупка в два тапа (выбор → подтверждение) — страховка на таче.
 * Вся смена содержимого вкладок идёт через tabLayer — сцена не «зарастает».
 */
const DEPTH_BG = 0
const DEPTH_PANEL = 1
const DEPTH_UI = 2

const COL_TEXT = '#E8E6E3'
const COL_DIM = '#8A8894'
const COL_FAINT = '#5A5866'
const COL_ACCENT = '#58E6C8'

type TabIndex = 0 | 1 | 2 | 3

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

    // Полотно + мягкое дыхание глубины (как меню — узнаваемость хаба).
    this.add.rectangle(cx, cy, width, height, 0x0b0b10).setDepth(DEPTH_BG)
    const breath = this.add.image(cx, cy + 120, 'glow-purple')
      .setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.05).setScale(6, 3)
      .setDepth(DEPTH_BG)
    this.tweens.add({
      targets: breath,
      alpha: { from: 0.03, to: 0.07 },
      duration: 4200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })
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
      fontFamily: 'monospace', fontSize: '15px', color: COL_ACCENT,
      backgroundColor: '#12262b', padding: { x: 10, y: 5 },
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

    // Подсказка/описание внизу + кнопка покупки.
    this.tooltip = this.add.text(cx, height - 56, '', {
      fontFamily: 'monospace', fontSize: '13px', color: COL_TEXT,
      align: 'center', wordWrap: { width: width - 240 },
    }).setOrigin(0.5).setDepth(DEPTH_UI)

    this.buyLabel = this.add.text(0, 0, '', {
      fontFamily: 'monospace', fontSize: '14px', fontStyle: 'bold', color: '#0b0b10',
      backgroundColor: '#E8A34F', padding: { x: 14, y: 7 },
    }).setOrigin(0.5)
    this.buyButton = this.add.container(cx, height - 24, [this.buyLabel]).setDepth(DEPTH_UI).setVisible(false)
    this.buyButton.setSize(220, 30)
    this.buyButton.setInteractive({ useHandCursor: true })
    this.buyButton.on(Phaser.Input.Events.POINTER_DOWN, () => this.confirmBuy())

    this.add.text(24, height - 16, 'ESC — в меню', {
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
    this.clearSelectionMark()

    for (let i = 0; i < NEST.tabNames.length; i++) {
      const bg = this.children.getByName(`tabbg-${i}`) as (Phaser.GameObjects.Rectangle & { tabLabel?: Phaser.GameObjects.Text }) | null
      if (bg?.tabLabel) {
        const active = this.tab === i
        bg.setFillStyle(active ? 0x2a2a3a : 0x151522)
        bg.tabLabel.setColor(active ? '#ffffff' : COL_DIM)
      }
    }

    switch (this.tab) {
      case 0: this.buildTreeTab(); break
      case 1: this.buildBestiaryTab(); break
      case 2: this.buildGenomesTab(); break
      case 3: this.buildStatsTab(); break
    }
  }

  private refreshEssence(): void {
    const spent = this.save.nodes.reduce((s, id) => s + (NEST_NODES.get(id)?.cost ?? 0), 0)
    this.essenceText.setText(`◈ ${this.save.essence}`)
    this.progressText.setText(`древо ${spent}/${NEST_TOTAL_COST}`)
  }

  // ── Вкладка: древо навыков ───────────────────────────────────────────────

  private buildTreeTab(): void {
    const { width, height } = this.scale
    const colW = NEST.branchColW
    const nodeR = NEST.nodeR
    const totalW = NEST.branches.length * colW
    const startX = width / 2 - totalW / 2 + colW / 2
    const treeTop = 108
    const treeBottom = height - 84

    for (let b = 0; b < NEST.branches.length; b++) {
      const branch = NEST.branches[b]
      const colX = startX + b * colW
      const unlocked = this.save.stats.bestDepthM >= branch.unlockDepthM
      const colorInt = hexInt(branch.color)

      this.tabAdd(this.add.text(colX, treeTop - 14, branch.name.toUpperCase(), {
        fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold',
        color: unlocked ? branch.color : COL_FAINT,
      }).setOrigin(0.5))
      this.tabAdd(this.add.text(colX, treeTop + 2, unlocked
        ? `${this.branchBought(branch)}/${branch.nodes.length}`
        : `откроется на ${branch.unlockDepthM} м`, {
        fontFamily: 'monospace', fontSize: '10px', color: COL_FAINT,
      }).setOrigin(0.5))

      // 5 тиров = 5 рядов снизу вверх, по 3 узла в ряду (тир = ступень).
      const rows = 5
      const rowH = (treeBottom - treeTop - 20) / rows
      const tierCount: Record<number, number> = {}
      for (const node of branch.nodes) {
        const rowFromBottom = node.tier - 1
        const y = treeBottom - 6 - rowFromBottom * rowH
        const slotInTier = tierCount[node.tier] ?? 0
        tierCount[node.tier] = slotInTier + 1
        const x = colX + (slotInTier - 1) * (colW * 0.32)
        this.buildNode(node, x, y, nodeR, unlocked, colorInt, branch)
      }
    }
  }

  private branchBought(branch: NestBranch): number {
    return branch.nodes.filter((n) => this.save.nodes.includes(n.id)).length
  }

  /** Доступность узла: ветка открыта, предыдущий тир освоен, не куплен. */
  private nodeState(node: NestNode, branchUnlocked: boolean): 'bought' | 'available' | 'locked-branch' | 'locked-tier' | 'no-money' {
    if (this.save.nodes.includes(node.id)) return 'bought'
    if (!branchUnlocked) return 'locked-branch'
    if (node.tier > 1) {
      const branch = NEST.branches.find((b) => b.nodes.includes(node))!
      const prevBought = branch.nodes.some((n) => n.tier === node.tier - 1 && this.save.nodes.includes(n.id))
      if (!prevBought) return 'locked-tier'
    }
    return this.save.essence >= node.cost ? 'available' : 'no-money'
  }

  private buildNode(
    node: NestNode,
    x: number,
    y: number,
    r: number,
    branchUnlocked: boolean,
    colorInt: number,
    branch: NestBranch,
  ): void {
    const state = this.nodeState(node, branchUnlocked)
    const isKey = node.type === 'key'
    const isAbility = node.type === 'ability'

    let fill = 0x151522
    let alpha = 0.9
    let stroke = 0x2a2a3a
    let strokeWidth = 1
    if (state === 'bought') {
      fill = colorInt
      alpha = isKey ? 0.95 : 0.8
      stroke = colorInt
      strokeWidth = 2
    } else if (state === 'available') {
      stroke = colorInt
      strokeWidth = 1.5
    } else if (state === 'no-money') {
      stroke = colorInt
    }

    // Форма узла: ключевые мутации — шестиугольник, способности — круг
    // поменьше, статы — круг. Тип читается формой и подписью при выборе.
    let shape: Phaser.GameObjects.Shape
    if (isKey) {
      const pts: number[] = []
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6
        pts.push(x + Math.cos(a) * r, y + Math.sin(a) * r)
      }
      const poly = this.add.polygon(x, y, pts, fill, alpha)
      poly.setStrokeStyle(strokeWidth, stroke)
      shape = poly
    } else {
      const circle = this.add.arc(x, y, r)
      circle.setFillStyle(fill, alpha)
      circle.setStrokeStyle(strokeWidth, stroke)
      if (isAbility) circle.setScale(0.92, 0.92)
      shape = circle
    }
    this.tabAdd(shape)
    shape.setData('nodeId', node.id)
    shape.setData('state', state)

    if (state === 'bought') {
      this.tabAdd(this.add.circle(x, y, 3, 0x0b0b10))
    } else if (state === 'available') {
      const pulse = this.tabAdd(this.add.circle(x, y, 2.5, colorInt))
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

    if (state !== 'bought') {
      this.tabAdd(this.add.text(x, y + r + 4, `${node.cost}◈`, {
        fontFamily: 'monospace', fontSize: '9px',
        color: state === 'available' ? '#E8A34F' : COL_FAINT,
      }).setOrigin(0.5))
    }

    shape.setInteractive({ useHandCursor: state === 'available' || state === 'no-money' })
    shape.on(Phaser.Input.Events.POINTER_DOWN, () => {
      if (state === 'bought') {
        this.tooltip.setText(`${node.name} — куплено\n${node.desc}`)
        this.audio.play('uiClick')
        return
      }
      if (state === 'locked-branch') {
        this.tooltip.setText(`«${branch.name}» откроется, когда рекорд глубины достигнет ${branch.unlockDepthM} м (сейчас ${this.save.stats.bestDepthM} м)`)
        this.audio.play('clank')
        return
      }
      if (state === 'locked-tier') {
        this.tooltip.setText(`«${node.name}»: сначала купи любой узел тира ${node.tier - 1} ветки «${branch.name}»`)
        this.audio.play('clank')
        return
      }
      this.selectNode(node, x, y, colorInt)
      this.tooltip.setText(`${node.name} · [${node.type === 'stat' ? 'стат' : node.type === 'ability' ? 'способность' : 'КЛЮЧЕВАЯ мутация'}]\n${node.desc}`)
    })
    shape.on(Phaser.Input.Events.POINTER_OVER, () => {
      if (state !== 'bought' && this.selectedNode !== node) this.tooltip.setText(`${node.name} (${node.cost}◈) — ${node.desc}`)
    })
  }

  private selectNode(node: NestNode, x: number, y: number, colorInt: number): void {
    this.clearSelectionMark()
    this.selectedNode = node
    this.selectedMark = this.tabAdd(this.add.circle(x, y, NEST.nodeR + 5).setStrokeStyle(2, colorInt, 0.95))
    const afford = this.save.essence >= node.cost
    this.buyLabel.setText(afford ? `КУПИТЬ · ${node.cost}◈` : `НЕ ХВАТАЕТ · ${node.cost}◈`)
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
    if (this.save.essence < node.cost) {
      this.audio.play('clank')
      this.tooltip.setText('Не хватает Эссенции. Иди в пещеру, пожри — Гнездо подождёт.')
      return
    }
    this.save = updateNestSave((s) => {
      s.essence -= node.cost
      s.nodes.push(node.id)
    })
    this.audio.play('gene')
    this.clearSelectionMark()
    this.refreshEssence()
    this.rebuildTabs()
    this.tooltip.setText(`Внедрено: ${node.name}. Следующий забег уже сильнее.`)
  }

  // ── Вкладка: бестиарий ───────────────────────────────────────────────────

  private buildBestiaryTab(): void {
    const { width } = this.scale
    const species = Object.entries(ENEMIES.species)
    const cols = 3
    const cardW = 244
    const cardH = 150
    const startX = width / 2 - (cols * cardW + (cols - 1) * 12) / 2
    const startY = 120

    species.forEach(([id, sp], i) => {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = startX + col * (cardW + 12)
      const y = startY + row * (cardH + 12)
      const seen = (this.save.bestiary[id]?.eaten ?? 0) + (this.save.bestiary[id]?.killed ?? 0) > 0

      this.tabAdd(this.add.rectangle(x + cardW / 2, y + cardH / 2, cardW, cardH, 0x12121c, 0.92)
        .setStrokeStyle(1, seen ? 0x3a3a4c : 0x1e1e2c))
      const portrait = this.tabAdd(this.add.image(x + 34, y + 38, sp.texture).setScale(1.8))
      if (!seen) {
        portrait.setTint(0x1c1c28)
        this.tabAdd(this.add.text(x + 34, y + 38, '?', {
          fontFamily: 'Georgia, serif', fontSize: '30px', color: '#2c2c3c',
        }).setOrigin(0.5))
      }
      this.tabAdd(this.add.text(x + 66, y + 20, seen ? sp.name : '???', {
        fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold',
        color: seen ? COL_TEXT : '#3c3c4c',
      }))
      this.tabAdd(this.add.text(x + 66, y + 40, seen
        ? `съедено: ${this.save.bestiary[id]?.eaten ?? 0}\nубито: ${this.save.bestiary[id]?.killed ?? 0}`
        : 'не встречен', {
        fontFamily: 'monospace', fontSize: '11px', color: seen ? '#E8A34F' : COL_FAINT,
        lineSpacing: 4,
      }))
      this.tabAdd(this.add.text(x + 12, y + 78, seen ? (sp._flavor ?? '') : 'Пещера хранит свои тайны.', {
        fontFamily: 'monospace', fontSize: '10px', color: COL_DIM,
        wordWrap: { width: cardW - 24 }, lineSpacing: 3,
      }))
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
      '',
      `лучший забег: ${s.bestRun.essence}◈ · ${s.bestRun.depthM} м · ${s.bestRun.eaten} съедено`,
    ]
    this.tabAdd(this.add.text(width / 2, 150, lines.join('\n'), {
      fontFamily: 'monospace', fontSize: '15px', color: COL_TEXT,
      align: 'center', lineSpacing: 9,
    }).setOrigin(0.5, 0))

    this.tabAdd(this.add.text(width / 2, 420, 'Эссенция капает за каждое убийство и поедание,\nа за новый рекорд глубины — щедрым куском.', {
      fontFamily: 'monospace', fontSize: '12px', color: COL_FAINT, align: 'center',
    }).setOrigin(0.5))
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
