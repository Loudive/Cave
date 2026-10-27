import Phaser from 'phaser'
import { MOVEMENT } from '../config/movement'
import { GEN, bandColorInt } from '../config/gen'
import { LIGHT } from '../config/light'
import { BALANCE } from '../config/balance'
import { ENEMIES } from '../config/enemies'
import { Creature, CreatureKeys } from '../entities/Creature'
import { Enemy, type EnemyContext } from '../entities/Enemy'
import { DebugOverlay } from '../systems/DebugOverlay'
import { MiniMap } from '../systems/MiniMap'
import { DarknessMask } from '../systems/DarknessMask'
import { SilhouetteMotes } from '../systems/SilhouetteMotes'
import { HitStop } from '../systems/HitStop'
import { BloodFx } from '../systems/BloodFx'
import { Vitals } from '../systems/Vitals'
import { Eating } from '../systems/Eating'
import { Combat } from '../systems/Combat'
import { Mutations } from '../systems/Mutations'
import { Hud } from '../systems/Hud'
import { QUALITY } from '../systems/quality'
import { buildCaveTilemap } from '../systems/TileBuilder'
import { generateCave, biomeIndexAtMeters, type CaveData } from '../gen/cave'
import { Rng, hashSeed } from '../gen/rng'

/**
 * CaveScene — шаг 6: боёвка, голод и поедание поверх света шага 5.
 * Ядро фантазии (гайд): укус с телеграфом, кровь в три слоя, хитстоп
 * и тряска, туша как еда (сытость + рост + шанс мутации 25%), голод
 * тикает каждые 2 с и при нуле заставляет HP таять. Цикл «напал —
 * съел — вырос — захотел ещё». Добыча живёт у гнёзд шага 4: слизень
 * (округлый, кусается в углу) и нетопырь (синус-полёт). Вне света
 * мобы — силуэты-двойники над маской. Тумблер качества Q, тач-кнопка
 * укуса на мобилках. Числа — в balance.json / enemies.json / mutations.json.
 *
 * Управление: A/D — бег, SPACE — прыжок, W — планирование,
 * J / ЛКМ / кнопка — укус (рядом туша — съесть), R/N/M — пещера/seed/карта,
 * Q — качество, F3 — debug, ESC — меню.
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
  private hudText!: Phaser.GameObjects.Text
  private hudBars!: Hud
  private cave!: CaveData
  private worldW = 0
  private worldH = 0
  private mask!: DarknessMask
  private motes!: SilhouetteMotes
  private parallax: { ts: Phaser.GameObjects.TileSprite; factor: number }[] = []

  // Шаг 6: системы боя и еды.
  private hitStop!: HitStop
  private blood!: BloodFx
  private vitals!: Vitals
  private eating!: Eating
  private combat!: Combat
  private mutations!: Mutations
  private enemies: Enemy[] = []

  private seedBase = ''
  private depth = 1
  private exiting = false
  private dying = false
  private maxMeters = 0
  /** Модификаторы мутаций, живущие в сцене (thorns/stealth/stun). */
  private sceneMods = { thorns: 0, detectMult: 1, stunMs: 0 }

  constructor() {
    super('Cave')
  }

  init(data: SceneData): void {
    this.exiting = false
    this.dying = false
    this.enemies = []
    this.maxMeters = 0
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

    // ── Атмосфера (шаг 5) ───────────────────────────────────────────────────
    this.buildParallax()
    this.hitStop = new HitStop(this)
    this.mask = new DarknessMask(this)

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

    // ── Шаг 6: виталы, кровь, еда, мутации, бой ─────────────────────────────
    this.vitals = new Vitals()
    this.blood = new BloodFx(this, this.cave, this.hitStop, (x, y) => {
      // Сгусток подобран: немного сытости и роста, алое число.
      const c = BALANCE.clots
      this.vitals.eat(c.hunger, c.xp)
      this.vitals.heal(Math.round(BALANCE.player.hpFromChew / 2))
      this.blood.number(x, y - 10, `+${Math.round(c.hunger)}`, '#E23A4E')
    })
    this.eating = new Eating(
      this, this.vitals, this.blood,
      () => ({ x: this.creature.x, y: this.creature.y, facing: this.creature.facing }),
    )
    this.eating.onChew = () => this.creature.chewVisual()

    this.mutations = new Mutations(this, this.vitals)
    this.mutations.onApply = (def) => this.applyMutation(def)

    this.combat = new Combat(
      this, this.creature, this.vitals,
      () => this.enemies,
      this.blood, this.hitStop, this.eating,
    )

    this.hudBars = new Hud(this, this.vitals, this.mutations, () => this.combat.queueTouchBite())

    // Рост: существо visibly увеличивается, свет на миг вспыхивает.
    this.vitals.onLevelUp = (level) => {
      this.creature.applyGrowth(this.vitals.bodyScale)
      this.blood.burst(this.creature.x, this.creature.y, {
        count: 22, dirDeg: 90, spreadDeg: 360, speedMult: 0.9,
        texture: 'spore', sticky: false,
      })
      this.blood.number(this.creature.x, this.creature.y - 30, `РОСТ ${level}`, '#B36BFF', true)
      this.cameras.main.flash(180, 179, 107, 255)
    }
    // «Второе сердце»: смертельный урон погашен.
    this.vitals.onSecondHeart = () => {
      this.blood.number(this.creature.x, this.creature.y - 34, 'ВТОРОЕ СЕРДЦЕ', '#B36BFF', true)
      this.cameras.main.flash(220, 255, 138, 148)
    }
    this.creature.onAirJump = () => {
      this.blood.burst(this.creature.x, this.creature.y + 8, {
        count: 7, dirDeg: 90, spreadDeg: 70, speedMult: 0.4,
        texture: 'spore', sticky: false,
      })
    }

    this.mask.setPlayer(this.mask.add({
      x: () => this.creature.x,
      y: () => this.creature.y,
      radius: LIGHT.playerLight.radius,
      breathe: true,
    }))

    // ── Содержимое пещеры ───────────────────────────────────────────────────
    this.buildMushrooms()
    this.buildNests()
    this.buildAmbientSpores()
    this.buildExitGate()
    this.motes = new SilhouetteMotes(this, this.cave, this.mask)

    // Добыча у гнёзд шага 4 + гарантированная еда у входа.
    this.spawnEnemies(layers.stone, layers.ground)

    // ── Ввод боя: J / ЛКМ (десктоп), тач-кнопка — через Hud ─────────────────
    kb.on('keydown-J', () => this.combat.queueKeyBite())
    if (!this.sys.game.device.input.touch) {
      this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
        if (pointer.button === 0) this.combat.queueKeyBite()
      })
    }

    // ── UI ──────────────────────────────────────────────────────────────────
    const { width, height } = this.scale
    this.add.image(width / 2, height / 2, 'vignette')
      .setDisplaySize(width * LIGHT.vignette.overscan, height * LIGHT.vignette.overscan)
      .setScrollFactor(0)
      .setDepth(18)
      .setAlpha(LIGHT.vignette.alpha)

    this.hudText = this.add.text(width - 10, 8, '', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#B9B7C4',
      align: 'right',
      lineSpacing: 4,
    })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(22)

    this.add.text(12, height - 14,
      'A/D — бег · SPACE — прыжок · W — план · J/ЛКМ — укус · R — та же пещера · N — новая · M — карта · Q — качество · ESC — меню',
      { fontFamily: 'monospace', fontSize: '11px', color: '#8A8894' },
    )
      .setScrollFactor(0)
      .setOrigin(0, 1)
      .setDepth(22)
      .setAlpha(0.8)

    this.miniMap = new MiniMap(this, this.cave)

    this.debug = new DebugOverlay(this, this.creature, () => [
      `cave:   ${this.cave.cols}×${this.cave.rows}  air=${Math.round(this.cave.stats.reachableRatio * 100)}%`,
      `gen:    ${this.cave.stats.attempts} попт. ${genMs}мс  hash=${this.cave.stats.hash.toString(16).slice(0, 6)}`,
      `light:  r=${Math.round(this.mask.playerRadius(this.time.now))}  дыры=${this.mask.lastHoles}  мошь=${this.motes.visibleCount}/${this.motes.count}`,
      `vitals: hp=${Math.ceil(this.vitals.hp)}/${this.vitals.maxHp}  голод=${Math.ceil(this.vitals.hunger)}/${this.vitals.maxHunger}`,
      `рост:   ур.${this.vitals.level} xp=${Math.round(this.vitals.xp)}  мутаций=${this.mutations.ownedCount}`,
      `бой:    ${this.combat.state}  мобов=${this.enemies.length}  туш=${this.eating.list.length}`,
      `кровь:  декалей=${this.blood.activeDecals}  сгустков=${this.blood.activeClots}  кач=${QUALITY.level}`,
    ])

    // ── Клавиши сценария ────────────────────────────────────────────────────
    kb.on('keydown-R', () => {
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

    this.registerHooks(genMs)
  }

  override update(time: number, delta: number): void {
    // Хитстоп: сначала разморозка, потом гейт геймплея (мир стоит).
    this.hitStop.update()
    const frozen = this.hitStop.active

    if (!frozen && !this.dying) {
      this.creature.update(time, delta)
      this.combat.update(time)

      // Контекст добычи: свет хищника = его зрение (мутации маскируют).
      const lightR = this.mask.playerRadius(time)
      const ctx: EnemyContext = {
        playerX: this.creature.x,
        playerY: this.creature.y,
        playerLightR: lightR,
        detectMult: this.sceneMods.detectMult,
        frozen,
      }
      for (const enemy of this.enemies) {
        enemy.update(time, delta, ctx)
        enemy.updateSilhouette(this.creature.x, this.creature.y, lightR)
      }
      // Выпавшие из мира мобы исчезают тихо (гнёзда стоят на полу — редкость).
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        if (this.enemies[i].dead && !this.enemies[i].active) this.enemies.splice(i, 1)
        else if (this.enemies[i].y > this.worldH + 200) {
          this.enemies[i].destroy()
          this.enemies.splice(i, 1)
        }
      }

      this.eating.update(time, this.creature.x, this.creature.y)
      this.vitals.update(delta)
      this.blood.update(this.creature.x, this.creature.y)
      this.mutations.update(this.creature.x, this.creature.y)

      // Смерть существа: голод/уроны добили — финал забега.
      if (!this.vitals.alive) this.handleDeath()
    }

    this.debug.update(this)
    this.creatureGlow.setPosition(this.creature.x, this.creature.y)
    this.miniMap.update(this.creature.x, this.creature.y, this.cave.tile)

    const cam = this.cameras.main
    for (const p of this.parallax) {
      p.ts.tilePositionX = cam.scrollX * p.factor
      p.ts.tilePositionY = cam.scrollY * p.factor
    }
    this.mask.update(this)
    this.motes.update(this, this.creature.x, this.creature.y)

    // HUD: глубина + биом + seed (как в шаге 4).
    const meters = Math.max(0, Math.floor(this.cave.depthOffsetMeters + this.creature.y * GEN.map.metersPerPixel))
    this.maxMeters = Math.max(this.maxMeters, meters)
    const band = GEN.biomeBands[biomeIndexAtMeters(this.cave.depthOffsetMeters + this.creature.y * GEN.map.metersPerPixel)]
    this.hudText.setText([
      `ГЛУБИНА ${meters} м · ${band.name}`,
      `seed ${this.seedBase} · слой ${this.depth}`,
    ])

    // Сердцебиение света: низкий голод/HP — свет пульсирует чаще и глубже.
    const hungerRatio = this.vitals.hungerRatio
    const warnAt = BALANCE.hunger.warnBelow / 100
    const heartbeat = Math.max(
      hungerRatio < warnAt ? 1 - hungerRatio / warnAt : 0,
      this.vitals.alive && this.vitals.hpRatio < 0.35 ? 0.7 : 0,
      this.vitals.starving ? 1 : 0,
    )
    this.mask.setHeartbeat(heartbeat)

    this.hudBars.update(delta)

    // Страховка: ниже мира быть не должно.
    if (!this.dying && this.creature.y > this.worldH + 300) {
      this.creature.setPosition(
        this.cave.entrance.x * this.cave.tile + this.cave.tile / 2,
        this.cave.entrance.y * this.cave.tile,
      )
      const body = this.creature.body as Phaser.Physics.Arcade.Body
      body.velocity.set(0)
      this.cameras.main.flash(300, 88, 230, 200)
    }
  }

  // ── Шаг 6: бой и еда ──────────────────────────────────────────────────────

  /** Моб умер: взрыв крови, сгустки-еда, туша, бросок на мутацию. */
  private handleKill(enemy: Enemy): void {
    this.vitals.eatenCount++
    const b = BALANCE.blood
    this.blood.explode(enemy.x, enemy.y, b.particlesPerKill[1])
    this.blood.spawnClots(
      enemy.x, enemy.y,
      Phaser.Math.Between(b.clotsPerKill[0], b.clotsPerKill[1]),
    )
    this.eating.spawnCarcass(enemy.speciesId, enemy.x, enemy.y)
    this.mutations.rollDrop(enemy.x, enemy.y)
  }

  /** Мутация подобрана: сцена вешает хуки на Creature и свой mods. */
  private applyMutation(def: import('../config/mutations').MutationDef): void {
    const e = def.effect
    switch (e.type) {
      case 'grip':
        this.creature.mods.wallSlideMult = e.wallSlideMult
        break
      case 'doubleJump':
        this.creature.mods.airJumps = e.airJumps
        break
      case 'stealth':
        this.sceneMods.detectMult = e.detectMult
        break
      case 'thorns':
        this.sceneMods.thorns = e.damage
        break
      case 'stunBite':
        this.combat.mods.stunMs = e.stunMs
        break
      default:
        // digestion / biteDamage / secondHeart уже в Vitals.
        break
    }
  }

  /** Смерть существа: взрыв, затемнение, экран забега → новый seed. */
  private handleDeath(): void {
    if (this.dying) return
    this.dying = true
    const d = BALANCE.death
    this.hitStop.freeze(d.hitstopMs)
    this.blood.explode(
      this.creature.x, this.creature.y,
      Math.round(BALANCE.blood.particlesPerKill[1] * d.bloodMultiplier),
    )
    this.blood.spawnClots(this.creature.x, this.creature.y, 3)
    this.cameras.main.shake(d.fadeMs, BALANCE.hit.killShakePx / this.cameras.main.width)
    this.cameras.main.flash(260, 226, 58, 78)
    this.creature.setVisible(false)
    this.creatureGlow.setAlpha(0)
    this.blood.decal(this.creature.x, this.creature.y + 8, 2.6)

    const kb = this.input.keyboard!
    this.time.delayedCall(d.fadeMs * 0.6, () => this.showRunSummary(kb))
  }

  /** Экран «Итог забега» (полный экран статистики — шаг 8). */
  private showRunSummary(kb: Phaser.Input.Keyboard.KeyboardPlugin): void {
    const { width, height } = this.scale
    const cam = this.cameras.main
    const depthPx = this.cameras.main.height

    const overlay = this.add.container(0, 0).setScrollFactor(0).setDepth(40).setAlpha(0)
    const veil = this.add.rectangle(width / 2, height / 2, width, height, 0x0b0b10, 0.82)
    const title = this.add.text(width / 2, height / 2 - 96, 'ЗАБЕГ ОКОНЧЕН', {
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontSize: '44px',
      color: '#E23A4E',
      fontStyle: 'bold',
    }).setOrigin(0.5)
    const lines = [
      `съедено добычи — ${this.vitals.eatenCount}`,
      `рост существа — уровень ${this.vitals.level}`,
      `мутаций внедрено — ${this.vitals.mutationsCount}`,
      `максимальная глубина — ${this.maxMeters} м`,
    ]
    const stats = this.add.text(width / 2, height / 2 - 18, lines.join('\n'), {
      fontFamily: 'monospace',
      fontSize: '16px',
      color: '#E8E6E3',
      align: 'center',
      lineSpacing: 8,
    }).setOrigin(0.5)
    const hint = this.add.text(width / 2, height / 2 + 78, '— нажми, чтобы начать новый забег —', {
      fontFamily: 'monospace',
      fontSize: '15px',
      color: '#58E6C8',
    }).setOrigin(0.5)
    overlay.add([veil, title, stats, hint])
    this.tweens.add({ targets: overlay, alpha: 1, duration: 500 })
    this.tweens.add({
      targets: hint,
      alpha: { from: 1, to: 0.25 },
      duration: 1000,
      yoyo: true,
      repeat: -1,
    })

    const restart = (): void => {
      cam.fadeOut(320, 4, 4, 8)
      cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        kb.removeAllListeners()
        this.scene.restart({ seed: randomSeedStr(), depth: 1 })
      })
    }
    this.input.once(Phaser.Input.Events.POINTER_DOWN, restart)
    kb.once('keydown-SPACE', restart)
    kb.once('keydown-ENTER', restart)
    void depthPx
  }

  /** Расселение добычи: гнёзда шага 4 просыпаются, у входа — своя мелочь. */
  private spawnEnemies(
    stone: Phaser.Tilemaps.TilemapLayer,
    ground: Phaser.Tilemaps.TilemapLayer,
  ): void {
    const rng = new Rng(hashSeed(this.cave.seed + ':mobs'))
    const tile = this.cave.tile
    const spawnCfg = ENEMIES.spawn
    const b = BALANCE.spawn

    const pickSpecies = (): string => {
      const roll = rng.float()
      let acc = 0
      for (const w of spawnCfg.speciesWeights) {
        acc += w.weight
        if (roll < acc) return w.id
      }
      return spawnCfg.biomeFallback[0]
    }

    const addEnemy = (speciesId: string, wx: number, wy: number): void => {
      if (this.enemies.length >= b.maxAlive) return
      const enemy = new Enemy(this, wx, wy, speciesId, {
        onPlayerBitten: (damage, _x, attacker) => {
          const applied = this.combat.hurtPlayer(damage)
          if (applied > 0 && this.sceneMods.thorns > 0 && !attacker.dead) {
            this.combat.reflectThorns(attacker)
          }
        },
        onDeath: (e) => {
          const idx = this.enemies.indexOf(e)
          if (idx >= 0) this.enemies.splice(idx, 1)
          this.handleKill(e)
        },
      })
      this.physics.add.collider(enemy, [stone, ground])
      this.enemies.push(enemy)
    }

    // Гнёзда: perNest добычи каждого гнезда.
    for (const nest of this.cave.nests) {
      for (let i = 0; i < spawnCfg.perNest; i++) {
        const speciesId = pickSpecies()
        const wx = nest.tx * tile + tile / 2 + rng.range(-tile, tile)
        const wy = nest.ty * tile + tile / 2 - 8 - i * 4
        addEnemy(speciesId, wx, wy)
      }
    }

    // Стартовая еда: несколько слизней в воздушных клетках недалеко от входа.
    const entrance = this.cave.entrance
    let placed = 0
    for (let tries = 0; tries < 500 && placed < b.entrancePrey; tries++) {
      const tx = entrance.x + rng.range(12, 44) * (rng.chance(0.5) ? 1 : -1)
      const ty = entrance.y + rng.range(-10, 14)
      if (tx < 1 || ty < 1 || tx >= this.cave.cols - 1 || ty >= this.cave.rows - 1) continue
      // Нужен воздух с полом под ним.
      if (this.cave.solid[ty * this.cave.cols + tx] !== 0) continue
      if (this.cave.solid[(ty + 1) * this.cave.cols + tx] !== 1) continue
      addEnemy('slug', tx * tile + tile / 2, ty * tile + tile / 2)
      placed++
    }
  }

  /** Спуск через врата: новый слой глубже, seed тот же. */
  private descend(): void {
    if (this.exiting || this.dying) return
    this.exiting = true
    this.cameras.main.fadeOut(420, 4, 4, 8)
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ seed: this.seedBase, depth: this.depth + 1 })
    })
  }

  /** Параллакс-силуэты (шаг 5): tileSprite на весь кадр, factor из light.json. */
  private buildParallax(): void {
    this.parallax = LIGHT.parallax.map((p) => ({
      ts: this.add.tileSprite(0, 0, this.scale.width, this.scale.height, p.key)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(p.depth)
        .setAlpha(p.alpha),
      factor: p.factor,
    }))
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
      const y = (m.ty + 1) * tile - 12

      const glowTex = band?.glow ?? 'glow-cyan'
      const glow = this.add.image(x, y - 9, glowTex)
        .setAlpha(0.3)
        .setScale(0.75)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(2)
      this.mask.add({
        x: () => x,
        y: () => y - 9,
        radius: LIGHT.mushroomLight.radius,
        scaleNow: () => glow.scaleX / 0.8,
      })

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

  /** Гнёзда мобов — теперь обитаемые (шаг 6): зловещая метка остаётся. */
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
      this.mask.add({
        x: () => x,
        y: () => y - 8,
        radius: LIGHT.nestLight.radius,
        scaleNow: () => marker.scaleX / 2.4,
      })
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
    this.mask.add({
      x: () => x,
      y: () => y,
      radius: LIGHT.gateLight.radius,
      scaleNow: () => gateGlow.scaleX / 2.6,
    })
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

  /** Крючки для верификации (agent-browser) — шаг 6. */
  private registerHooks(genMs: number): void {
    ;(window as unknown as Record<string, unknown>).__CAVE__ = {
      seed: this.cave.seed,
      base: this.seedBase,
      depth: this.depth,
      cols: this.cave.cols,
      rows: this.cave.rows,
      tile: this.cave.tile,
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
      light: {
        playerR: () => Math.round(this.mask.playerRadius(performance.now())),
        holes: () => this.mask.lastHoles,
        motes: this.motes.count,
        motesVisible: () => this.motes.visibleCount,
        config: {
          radius: LIGHT.playerLight.radius,
          darknessAlpha: LIGHT.darkness.alpha,
        },
      },
      player: () => {
        const b = this.creature.body as Phaser.Physics.Arcade.Body
        return {
          x: Math.round(this.creature.x),
          y: Math.round(this.creature.y),
          vx: Math.round(b.velocity.x),
          vy: Math.round(b.velocity.y),
          state: this.creature.getState(),
          facing: this.creature.facing,
        }
      },
      teleport: (wx: number, wy: number) => {
        this.creature.setPosition(wx, wy)
        const b = this.creature.body as Phaser.Physics.Arcade.Body
        b.velocity.set(0)
        b.blocked.none = true
      },
      // ── Бой/еда/рост ──────────────────────────────────────────────────────
      combat: {
        bite: () => this.combat.queueKeyBite(),
        state: () => this.combat.state,
        damage: (n: number) => this.combat.hurtPlayer(n),
      },
      vitals: () => ({
        hp: Math.ceil(this.vitals.hp),
        maxHp: this.vitals.maxHp,
        hunger: Math.round(this.vitals.hunger),
        maxHunger: this.vitals.maxHunger,
        xp: Math.round(this.vitals.xp),
        level: this.vitals.level,
        alive: this.vitals.alive,
        starving: this.vitals.starving,
        eaten: this.vitals.eatenCount,
      }),
      setHunger: (v: number) => {
        this.vitals.hunger = Phaser.Math.Clamp(v, 0, this.vitals.maxHunger)
      },
      enemies: () => this.enemies.map((e) => ({
        id: e.speciesId,
        x: Math.round(e.x),
        y: Math.round(e.y),
        hp: e.hp,
        state: e.aiState,
      })),
      killNearest: () => {
        let best: Enemy | null = null
        let bestD = Infinity
        for (const e of this.enemies) {
          const d = Phaser.Math.Distance.Between(e.x, e.y, this.creature.x, this.creature.y)
          if (d < bestD) {
            best = e
            bestD = d
          }
        }
        if (best) best.takeDamage(9999, this.creature.facing)
        return best ? best.speciesId : null
      },
      forceWindup: () => {
        let best: Enemy | null = null
        let bestD = Infinity
        for (const e of this.enemies) {
          const d = Phaser.Math.Distance.Between(e.x, e.y, this.creature.x, this.creature.y)
          if (d < bestD) {
            best = e
            bestD = d
          }
        }
        best?.debugForceWindup()
        return best ? best.speciesId : null
      },
      eatNearest: () => {
        const c = this.eating.nearestCarcass(this.creature.x, this.creature.y, 999)
        if (c) this.eating.startChewing(c)
        return !!c
      },
      carcasses: () => this.eating.list.map((c) => ({
        x: Math.round(c.sprite.x),
        y: Math.round(c.sprite.y),
        meat: Math.round(c.meatLeft),
      })),
      blood: {
        decals: () => this.blood.activeDecals,
        clots: () => this.blood.activeClots,
        burst: (x: number, y: number) => this.blood.explode(x, y, 10),
      },
      mutations: {
        owned: () => this.mutations.ownedList.map((m) => `${m.name} (${m.rarity})`),
        dropAtPlayer: () => this.mutations.rollDrop(this.creature.x + 40, this.creature.y),
        count: () => this.mutations.ownedCount,
      },
      quality: {
        level: () => QUALITY.level,
        toggle: () => QUALITY.toggle(),
      },
      dying: () => this.dying,
    }
  }
}
