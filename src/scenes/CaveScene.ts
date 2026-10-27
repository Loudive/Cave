import Phaser from 'phaser'
import { MOVEMENT } from '../config/movement'
import { GEN, bandColorInt } from '../config/gen'
import { Creature, CreatureKeys } from '../entities/Creature'
import { DebugOverlay } from '../systems/DebugOverlay'
import { MiniMap } from '../systems/MiniMap'
import { buildCaveTilemap } from '../systems/TileBuilder'
import { generateCave, biomeIndexAtMeters, type CaveData } from '../gen/cave'
import { Rng, hashSeed } from '../gen/rng'

/**
 * CaveScene — шаг 4: процедурная пещера.
 * cellular automata (каверны) + drunkard's walk (туннели), три слоя тайлов,
 * вход сверху → врата глубже, биомы по глубине с шумовым дрожанием границ,
 * грибы-светильники и гнёзда мобов по правилам биома, мини-карта (M).
 * Seed в URL: ?seed=ABC123&d=2 — пещера воспроизводима и шарится ссылкой.
 *
 * Управление: A/D — бег, Space — прыжок, W — планирование,
 * R — та же пещера заново, N — новый seed, M — мини-карта,
 * F3 — debug, ESC — меню.
 */

interface SceneData {
  seed?: string
  depth?: number
}

function randomSeedStr(): string {
  const rng = new Rng((Math.random() * 0xffffffff) >>> 0)
  let s = ''
  for (let i = 0; i < GEN.seedLength; i++) s += GEN.seedAlphabet[rng.int(GEN.seedAlphabet.length)]
  return s
}

export class CaveScene extends Phaser.Scene {
  private creature!: Creature
  private creatureGlow!: Phaser.GameObjects.Image
  private debug!: DebugOverlay
  private miniMap!: MiniMap
  private hud!: Phaser.GameObjects.Text
  private cave!: CaveData
  private worldW = 0
  private worldH = 0

  private seedBase = ''
  private depth = 1
  private exiting = false

  constructor() {
    super('Cave')
  }

  init(data: SceneData): void {
    this.exiting = false
    // Приоритет: data из restart → URL → случайный seed.
    const url = new URL(window.location.href)
    this.seedBase = data.seed ?? url.searchParams.get('seed') ?? randomSeedStr()
    this.depth = data.depth ?? (Number(url.searchParams.get('d')) || 1)
    this.depth = Math.max(1, Math.floor(this.depth))

    // Seed сохраняется в URL — пещера воспроизводима и шарится.
    url.searchParams.set('seed', this.seedBase)
    url.searchParams.set('d', String(this.depth))
    window.history.replaceState(null, '', url.toString())
  }

  create(): void {
    const t0 = performance.now()

    // ── Генерация ───────────────────────────────────────────────────────────
    this.cave = generateCave(this.seedBase, this.depth)
    const { cols, rows, tile } = this.cave
    this.worldW = cols * tile
    this.worldH = rows * tile
    const genMs = Math.round(performance.now() - t0)

    this.physics.world.setBounds(0, 0, this.worldW, this.worldH, true, true, true, true)
    this.physics.world.gravity.y = MOVEMENT.gravity
    this.cameras.main.setBounds(0, 0, this.worldW, this.worldH)
    this.cameras.main.fadeIn(450, 4, 4, 8)
    this.cameras.main.setBackgroundColor('#07070b')

    // ── Тайлмап: камень + земля (коллизии), декор ──────────────────────────
    const layers = buildCaveTilemap(this, this.cave)

    // Дальние силуэты камней — только в воздухе, чтобы не прятались за стенами.
    this.buildBackgroundRocks()

    // ── Существо ────────────────────────────────────────────────────────────
    const kb = this.input.keyboard!
    const keys: CreatureKeys = {
      left: [
        kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
        kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      ],
      right: [
        kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
        kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      ],
      glide: [
        kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
        kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      ],
      jump: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
    }

    const spawnX = this.cave.entrance.x * tile + tile / 2
    const spawnY = this.cave.entrance.y * tile + tile / 2 - 6
    this.creature = new Creature(this, spawnX, spawnY, keys)
    this.physics.add.collider(this.creature, [layers.stone, layers.ground])

    this.creatureGlow = this.add.image(spawnX, spawnY, 'glow-cyan')
      .setScale(1.7)
      .setAlpha(0.5)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(3)
    this.tweens.add({
      targets: this.creatureGlow,
      scale: { from: 1.5, to: 1.9 },
      alpha: { from: 0.38, to: 0.6 },
      duration: 1600,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })
    this.cameras.main.startFollow(this.creature, true, 0.09, 0.09)

    // ── Содержимое пещеры ───────────────────────────────────────────────────
    this.buildMushrooms()
    this.buildNests()
    this.buildAmbientSpores()
    this.buildExitGate()

    // ── UI ──────────────────────────────────────────────────────────────────
    const { width, height } = this.scale
    this.add.image(width / 2, height / 2, 'vignette')
      .setDisplaySize(width * 1.15, height * 1.15)
      .setScrollFactor(0)
      .setDepth(10)

    this.hud = this.add.text(width - 10, 8, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#B9B7C4',
      align: 'right',
      lineSpacing: 4,
    })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(11)

    this.add.text(12, height - 14,
      'A/D — бег · SPACE — прыжок · W — планирование · R — та же пещера · N — новая · M — карта · ESC — меню',
      { fontFamily: 'monospace', fontSize: '12px', color: '#8A8894' },
    )
      .setScrollFactor(0)
      .setOrigin(0, 1)
      .setDepth(11)
      .setAlpha(0.8)

    this.miniMap = new MiniMap(this, this.cave)

    this.debug = new DebugOverlay(this, this.creature, () => [
      `cave:   ${this.cave.cols}×${this.cave.rows}  air=${Math.round(this.cave.stats.reachableRatio * 100)}%`,
      `gen:    ${this.cave.stats.attempts} попт. ${genMs}мс  hash=${this.cave.stats.hash.toString(16).slice(0, 6)}`,
    ])

    // ── Клавиши сценария ────────────────────────────────────────────────────
    kb.on('keydown-R', () => {
      // Та же пещера: детерминизм — тот же seed → тот же hash сетки.
      this.scene.restart({ seed: this.seedBase, depth: this.depth })
    })
    kb.on('keydown-N', () => {
      this.scene.restart({ seed: randomSeedStr(), depth: 1 })
    })
    kb.on('keydown-ESC', () => {
      this.cameras.main.fadeOut(220, 4, 4, 8)
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start('Menu')
      })
    })

    // ── Крючок для верификации (agent-browser) ──────────────────────────────
    ;(window as unknown as Record<string, unknown>).__CAVE__ = {
      seed: this.cave.seed,
      base: this.seedBase,
      depth: this.depth,
      cols,
      rows,
      tile,
      entrance: this.cave.entrance,
      exit: this.cave.exit,
      mushrooms: this.cave.mushrooms.length,
      nests: this.cave.nests.length,
      stats: this.cave.stats,
      genMs,
      biomeAtPlayer: () => {
        const meters = this.cave.depthOffsetMeters + this.creature.y * GEN.map.metersPerPixel
        return GEN.biomeBands[biomeIndexAtMeters(meters)].name
      },
      player: () => {
        const b = this.creature.body as Phaser.Physics.Arcade.Body
        return {
          x: Math.round(this.creature.x),
          y: Math.round(this.creature.y),
          vx: Math.round(b.velocity.x),
          vy: Math.round(b.velocity.y),
          state: this.creature.getState(),
        }
      },
      teleport: (wx: number, wy: number) => {
        this.creature.setPosition(wx, wy)
        const b = this.creature.body as Phaser.Physics.Arcade.Body
        b.velocity.set(0)
        b.blocked.none = true
      },
    }
  }

  override update(_time: number, delta: number): void {
    this.creature.update(_time, delta)
    this.debug.update(this)
    this.creatureGlow.setPosition(this.creature.x, this.creature.y)
    this.miniMap.update(this.creature.x, this.creature.y, this.cave.tile)

    // HUD: глобальная глубина забега + биом + seed.
    const meters = Math.max(0, Math.floor(this.cave.depthOffsetMeters + this.creature.y * GEN.map.metersPerPixel))
    const band = GEN.biomeBands[biomeIndexAtMeters(this.cave.depthOffsetMeters + this.creature.y * GEN.map.metersPerPixel)]
    this.hud.setText([
      `ГЛУБИНА ${meters} м · ${band.name}`,
      `seed ${this.seedBase} · слой ${this.depth}`,
    ])

    // Страховка: ниже мира быть не должно (карта закрыта).
    if (this.creature.y > this.worldH + 300) {
      this.creature.setPosition(
        this.cave.entrance.x * this.cave.tile + this.cave.tile / 2,
        this.cave.entrance.y * this.cave.tile,
      )
      const body = this.creature.body as Phaser.Physics.Arcade.Body
      body.velocity.set(0)
      this.cameras.main.flash(300, 88, 230, 200)
    }
  }

  /** Спуск через врата: новый слой глубже, seed тот же. */
  private descend(): void {
    if (this.exiting) return
    this.exiting = true
    this.cameras.main.fadeOut(420, 4, 4, 8)
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ seed: this.seedBase, depth: this.depth + 1 })
    })
  }

  /** Дальние силуэты камней в воздушных карманах (параллакс-настроение). */
  private buildBackgroundRocks(): void {
    const rng = new Rng(hashSeed(this.cave.seed + ':rocks'))
    const tile = this.cave.tile
    let placed = 0
    for (let tries = 0; tries < 400 && placed < 34; tries++) {
      const x = rng.int(this.cave.cols)
      const y = rng.int(this.cave.rows)
      const i = y * this.cave.cols + x
      if (this.cave.solid[i] !== 0) continue
      this.add.image(x * tile + tile / 2, y * tile + tile / 2, 'rock')
        .setAlpha(0.12 + rng.float() * 0.16)
        .setAngle(rng.int(360))
        .setScale(0.8 + rng.float() * 1.8)
        .setDepth(0)
      placed++
    }
  }

  /** Грибы-светильники: спрайт + свечение в цвете биома, мерцание. */
  private buildMushrooms(): void {
    const tile = this.cave.tile
    for (let i = 0; i < this.cave.mushrooms.length; i++) {
      const m = this.cave.mushrooms[i]
      const band = GEN.biomeBands[m.biome]
      const x = m.tx * tile + tile / 2
      // Низ гриба стоит на полу клетки: центр = низ клетки − половина высоты.
      const y = (m.ty + 1) * tile - 12

      const glowTex = band?.glow ?? 'glow-cyan'
      const glow = this.add.image(x, y - 9, glowTex)
        .setAlpha(0.3)
        .setScale(0.75)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(2)

      const sprite = this.add.image(x, y, 'mushroom')
        .setScale(1.4)
        .setTint(band ? bandColorInt(band) : 0x58e6c8)
        .setDepth(2)

      this.tweens.add({
        targets: glow,
        alpha: { from: 0.18, to: 0.42 },
        scale: { from: 0.65, to: 0.95 },
        duration: 1700 + ((i * 137) % 1400),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
      this.tweens.add({
        targets: sprite,
        scaleY: { from: 1.36, to: 1.46 },
        duration: 2100 + ((i * 89) % 1100),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
    }
  }

  /** Гнёзда мобов (шаг 5 оживит их) — мерцающие метки. */
  private buildNests(): void {
    const tile = this.cave.tile
    for (const n of this.cave.nests) {
      const band = GEN.biomeBands[n.biome]
      const x = n.tx * tile + tile / 2
      const y = (n.ty + 1) * tile - 6
      const marker = this.add.image(x, y - 8, 'spore')
        .setTint(band ? bandColorInt(band) : 0xe23a4e)
        .setAlpha(0.28)
        .setScale(2.4)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(1)
      this.tweens.add({
        targets: marker,
        alpha: { from: 0.14, to: 0.34 },
        scale: { from: 2.0, to: 2.8 },
        duration: 2400,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
    }
  }

  /** Дрейфующие споры в воздухе — пещера дышит. */
  private buildAmbientSpores(): void {
    const rng = new Rng(hashSeed(this.cave.seed + ':spores'))
    const tile = this.cave.tile
    let placed = 0
    for (let tries = 0; tries < 300 && placed < 22; tries++) {
      const x = rng.int(this.cave.cols)
      const y = rng.int(this.cave.rows)
      if (this.cave.solid[y * this.cave.cols + x] !== 0) continue
      const px = x * tile + tile / 2
      const py = y * tile + tile / 2
      const spore = this.add.image(px, py, 'spore')
        .setAlpha(0.22)
        .setScale(0.7)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(2)
      this.tweens.add({
        targets: spore,
        y: py + (rng.float() - 0.5) * 60,
        x: px + (rng.float() - 0.5) * 44,
        duration: 4200 + rng.float() * 3800,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
      this.tweens.add({
        targets: spore,
        alpha: { from: 0.1, to: 0.34 },
        duration: 1900 + rng.float() * 1500,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
      placed++
    }
  }

  /** Врата вглубь: пульсирующее цианное свечение в выходной камере. */
  private buildExitGate(): void {
    const tile = this.cave.tile
    const x = this.cave.exit.x * tile + tile / 2
    const y = this.cave.exit.y * tile + tile / 2

    const gateGlow = this.add.image(x, y, 'glow-cyan')
      .setScale(2.6)
      .setAlpha(0.4)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(1)
    this.tweens.add({
      targets: gateGlow,
      alpha: { from: 0.28, to: 0.52 },
      scale: { from: 2.3, to: 2.9 },
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })

    this.add.text(x, y - 34, '▼ глубже', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#58E6C8',
    })
      .setOrigin(0.5)
      .setDepth(3)
      .setAlpha(0.85)

    const zone = this.add.zone(x, y, tile * 3, tile * 4)
    this.physics.add.existing(zone, true)

    this.physics.add.overlap(this.creature, zone, () => this.descend())
  }
}
