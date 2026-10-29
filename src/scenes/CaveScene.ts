import Phaser from 'phaser'
import { MOVEMENT } from '../config/movement'
import { GEN, bandColorInt } from '../config/gen'
import { LIGHT } from '../config/light'
import { BALANCE } from '../config/balance'
import { ENEMIES } from '../config/enemies'
import { Creature, CreatureKeys } from '../entities/Creature'
import { Enemy, type EnemyContext, type KillerKind } from '../entities/Enemy'
import { Spores } from '../systems/Spores'
import { FireTrail } from '../systems/FireTrail'
import { Ecosystem, type NestRecord } from '../systems/Ecosystem'
import { Vfx } from '../systems/Vfx'
import { Companion } from '../entities/Companion'
import { GENES, loadGeneSave, saveGeneSave, grantGene, type GeneSave, type GeneDef } from '../config/genes'
import { NEST } from '../config/nest'
import { ANIMS } from '../config/anims'
import { applyPerks, emptyRunPerks, type RunPerks } from '../systems/NestPerks'
import { loadNestSave, updateNestSave, recordBestiary, collectGenome, type NestSave } from '../systems/NestSave'
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
import type { RunSnapshot } from '../systems/RunState'
import { Hud } from '../systems/Hud'
import { FpsGuard } from '../systems/FpsGuard'
import { AudioSystem } from '../systems/Audio'
import { QUALITY } from '../systems/quality'
import { buildCaveTilemap } from '../systems/TileBuilder'
import { paintCave, erodeCave, type PaintedCave } from '../systems/CavePainter'
import { generateCave, biomeIndexAtMeters, type CaveData } from '../gen/cave'
import { Rng, hashSeed } from '../gen/rng'
import { MUTATIONS } from '../config/mutations'
import { VFX } from '../config/vfx'
import { createUiRoot, uiAttach, uiRootSyncZoom } from '../systems/UiLayer'

/**
 * CaveScene — шаг 7: мобы и живая экосистема поверх боёвки шага 6.
 * Шесть видов с полным FSM (патруль → тревога → погоня → замах →
 * атака → отход; бегство при HP<25%, панцирь — свёртка): слизень
 * (prey, контратака в углу), нетопырь (синус-полёт, нырок на раненых),
 * споровый жнец (веер спор, китер), кровосос (пиявка HP), бронепанцирь
 * (только кислота берёт), лавовый ползун (огненный след). Экосистема:
 * мобы охотятся друг на друга и едят падаль, когда игрока нет в
 * peaceRadius; гнёзда возрождают население; шум пещеры — кольца над
 * тьмой («стоишь и слушаешь»). Кислотный укус — из мутации
 * «Кислотные железы». Все числа — в enemies.json / balance.json.
 *
 * Управление: A/D — бег, SPACE — прыжок, W — планирование,
 * J / ЛКМ / кнопка — укус (рядом туша — съесть), R/N/M — пещера/seed/карта,
 * Q — качество, F3 — debug, ESC — меню.
 */

interface SceneData {
  seed?: string
  depth?: number
  /** Шаг 12: снапшот забега с прошлого слоя (рост/диета/мутации живут дальше). */
  run?: RunSnapshot
}

function randomSeedStr(): string {
  const rng = new Rng((Math.random() * 0xffffffff) >>> 0)
  let s = ''
  for (let i = 0; i < GEN.seedLength; i++) s += GEN.seedAlphabet[rng.int(GEN.seedAlphabet.length)]
  return s
}

export class CaveScene extends Phaser.Scene {
  private creature!: Creature
  /** Шаг 18: самосветящиеся биолюм-метки героя — НАД маской тьмы. */
  private creatureLumen!: Phaser.GameObjects.Sprite
  /** Шаг 18: едва заметная биолюм-аура вокруг существа — НАД маской тьмы. */
  private creatureAura!: Phaser.GameObjects.Image
  private debug!: DebugOverlay
  private miniMap!: MiniMap
  private fpsGuard!: FpsGuard
  private audio!: AudioSystem
  private hudText!: Phaser.GameObjects.Text
  private lastHudLine = ''
  /** Шаг 11: счётчик ошибок кадра (страховка цикла — логируем первые 8). */
  private updateErrorCount = 0
  private hudBars!: Hud
  private cave!: CaveData
  private worldW = 0
  private worldH = 0
  private mask!: DarknessMask
  private motes!: SilhouetteMotes
  private parallax: {
    ts: Phaser.GameObjects.TileSprite
    factor: number
    /** Шаг 18: ADD-близнец эмиссивной выжимки над маской (null — нет эмиссивы). */
    em: Phaser.GameObjects.TileSprite | null
  }[] = []
  /** Шаг 12: текущий тон каждого параллакс-слоя (лерп к цвету биома). */
  private parallaxTints: number[] = []

  // Шаг 6: системы боя и еды.
  private hitStop!: HitStop
  private blood!: BloodFx
  private vitals!: Vitals
  private eating!: Eating
  private combat!: Combat
  private mutations!: Mutations
  private enemies: Enemy[] = []
  private spores!: Spores
  private fire!: FireTrail
  private eco!: Ecosystem
  private vfx!: Vfx
  // Шаг 8: геномы — постоянные гены, цветки, лунки, уникальные, спутник.
  private geneSave!: GeneSave
  private genesGained: string[] = []
  // ── Шаг 11: Гнездо — перки древа и Эссенция этого забега ──
  private nestProfile!: NestSave
  private perks: RunPerks = emptyRunPerks()
  /** Эссенция, заработанная в текущем забеге (сверху — бонус глубины в финале). */
  private runEssence = 0
  private dangerSenseNextAt = 0
  private dreadNextAt = 0
  private crystalHealNextAt = 0
  private essenceHud!: Phaser.GameObjects.Text
  private lastEssenceHud = ''
  private genePickups: { img: Phaser.GameObjects.Image; twin: Phaser.GameObjects.Image; geneId: string }[] = []
  private flowers: { img: Phaser.GameObjects.Image; glow: Phaser.GameObjects.Image; x: number; y: number; used: boolean }[] = []
  private genePools: { x: number; y: number; used: boolean }[] = []
  private genePoolGlow: Phaser.GameObjects.Image[] = []
  private companion: Companion | null = null
  private pendingCompanion = false
  private echoNextAt = 0
  private spikeReady = true

  private seedBase = ''
  private depth = 1
  /** Шаг 12: снапшот забега с прошлого слоя (null — свежий забег). */
  private carryRun: RunSnapshot | null = null
  /** Шаг 12: следующая волна процедурного спавна вокруг игрока (мс). */
  private roamNextAt = 0
  /** Шаг 20: аэро-джус — таймер следующей крупины шлейфа крыльев. */
  private wingTrailNextAt = 0
  /** Шаг 20: прошлое состояние существа (взмах на входе в планирование). */
  private prevAeroState = ''
  private exiting = false
  private dying = false
  private maxMeters = 0
  /** Модификаторы мутаций, живущие в сцене (thorns/stealth/stun/свет). */
  private sceneMods = { thorns: 0, detectMult: 1, stunMs: 0, lightMult: 1, sporeBreath: false, echo: false, spikeMane: 0 }
  /** Слои тайлмапа (для коллизий возрождённых мобов). */
  private tileLayers: import('../systems/TileBuilder').CaveLayers | null = null
  /** Шаг 15: запечённый органический рендер стен (чанки + куллинг). */
  private paint: PaintedCave | null = null

  constructor() {
    super('Cave')
  }

  init(data: SceneData): void {
    this.exiting = false
    this.dying = false
    this.enemies = []
    this.runEssence = 0
    this.dangerSenseNextAt = 0
    this.dreadNextAt = 0
    this.crystalHealNextAt = 0
    this.lastEssenceHud = ''
    this.maxMeters = 0
    // Приоритет: data из restart → URL → случайный seed.
    const url = new URL(window.location.href)
    this.seedBase = data.seed ?? url.searchParams.get('seed') ?? randomSeedStr()
    this.depth = data.depth ?? (Number(url.searchParams.get('d')) || 1)
    this.depth = Math.max(1, Math.floor(this.depth))
    // Шаг 12: жизнь продолжается — снапшот забега приходит с прошлым слоем.
    this.carryRun = data.run ?? null

    // Seed сохраняется в URL — пещера воспроизводима и шарится.
    url.searchParams.set('seed', this.seedBase)
    url.searchParams.set('d', String(this.depth))
    window.history.replaceState(null, '', url.toString())
  }

  create(): void {
    const t0 = performance.now()

    // Шаг 20: экран-слой HUD. Камера теперь живёт с базовым зумом
    // (cameraBaseZoom = 2, «приблизь в два раза»), а зум в Phaser
    // масштабирует вообще всё, включая scrollFactor(0)-объекты — HUD
    // уезжал бы к краям и рос. Всё экранное кладётся в uiRoot с
    // контр-трансформацией каждый кадр (см. systems/UiLayer.ts).
    // Должен существовать ДО создания любых HUD-объектов ниже.
    createUiRoot(this)

    // ── Генерация ───────────────────────────────────────────────────────────
    this.cave = generateCave(this.seedBase, this.depth)
    // Шаг 15: шумовая эрозия границы — ДО всех систем (физика/спавны/декор
    // видят эродированный мир). Лечит «террасы» тайловой сетки: осевые
    // участки границы размываются изолиниями шума, детерминировано.
    erodeCave(this.cave)
    const { cols, rows, tile } = this.cave
    this.worldW = cols * tile
    this.worldH = rows * tile
    const genMs = Math.round(performance.now() - t0)

    this.physics.world.setBounds(0, 0, this.worldW, this.worldH, true, true, true, true)
    this.physics.world.gravity.y = MOVEMENT.gravity
    this.cameras.main.setBounds(0, 0, this.worldW, this.worldH)
    // Шаг 20: «приблизь камеру в два раза — хочу ближе видеть персонажа».
    // Базовый зум из vfx.json (ноль магических чисел). Свет/мошь/частицы
    // мировые — масштабируются автоматически; DarknessMask умножает
    // координаты дыр на cam.zoom (правка там же, шаг 20).
    this.cameras.main.setZoom(VFX.cameraBaseZoom)
    this.cameras.main.fadeIn(450, 4, 4, 8)
    this.cameras.main.setBackgroundColor('#07070b')

    // ── Тайлмап: камень + земля (коллизии), декор ──────────────────────────
    const layers = buildCaveTilemap(this, this.cave)
    this.tileLayers = layers

    // ── Шаг 15: органическая запечёнка стен (marching squares, без сетки) ──
    // Слой 0.5: выше дальних скал (0), ниже декора (2) и существ (3+).
    this.paint = paintCave(this, this.cave, 0.5)
    // Текстуры живут в глобальном менеджере — чистим при шатдауне сцены
    // (каждый следующий слой глубины = новый старт CaveScene).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.paint?.destroy()
      this.paint = null
    })

    // ── Атмосфера (шаг 5) ───────────────────────────────────────────────────
    this.buildParallax()
    this.hitStop = new HitStop(this)
    // Шаг 10: звук и музыка. Пещера открывается кликом из меню —
    // WebAudio уже разблокирован жестом, эмбиент можно запускать сразу.
    this.audio = new AudioSystem(this)
    this.audio.ensureAmbient()
    this.mask = new DarknessMask(this)

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
      // Шаг 12: вниз по стене (S + стрелка вниз) — ползание на сцепе.
      down: [
        kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
        kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      ],
      jump: kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
    }

    const spawnX = this.cave.entrance.x * tile + tile / 2
    const spawnY = this.cave.entrance.y * tile + tile / 2 - 6
    this.creature = new Creature(this, spawnX, spawnY, keys)
    this.physics.add.collider(this.creature, layers.solid)

    // Шаг 18 (глобальная переработка света): существо — ИСТОЧНИК света
    // (референсы self-emissive). Старый creatureGlow — большой ADD-диск
    // (alpha 0.38-0.6) ПОД телом — «затмевал» монстра (жалоба игрока):
    // тёмный мех превращался в силуэт-пятно на выжженном циановом фоне.
    // Теперь: (1) lumen-двойник — только биолюм-метки (hero-*-lumen),
    // рендерится НАД маской тьмы и светится в полной темноте сам;
    // (2) едва заметная аура вокруг (не под!) телом — свет «исходит из
    // существа», а не накрывает его. Кадр/флип/масштаб/поворот копируются
    // из основного спрайта каждый кадр (update).
    this.creatureLumen = this.add.sprite(spawnX, spawnY, 'hero-idle-lumen', this.creature.frame.name)
      .setDepth(LIGHT.halo.lumenDepth)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(LIGHT.halo.lumenAlpha)
    this.creatureAura = this.add.image(spawnX, spawnY, 'glow-cyan')
      .setScale(LIGHT.halo.aura.scale)
      .setAlpha(LIGHT.halo.aura.alpha)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(LIGHT.halo.lumenDepth - 1)
    this.tweens.add({
      targets: this.creatureAura,
      scale: {
        from: LIGHT.halo.aura.scale * (1 - LIGHT.halo.aura.pulseAmp),
        to: LIGHT.halo.aura.scale * (1 + LIGHT.halo.aura.pulseAmp),
      },
      duration: LIGHT.halo.aura.pulseMs,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })
    this.cameras.main.startFollow(this.creature, true, VFX.cameraFollowLerp, VFX.cameraFollowLerp)

    // ── Шаг 6: виталы, кровь, еда, мутации, бой ─────────────────────────────
    this.vitals = new Vitals()

    // Шаг 8: постоянные гены применяются к стартам каждого забега.
    this.geneSave = loadGeneSave()
    this.applyGenes()
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
    this.eating.onChew = () => {
      this.creature.chewVisual()
      // Шаг 10: чавканье — «вызывает удовольствие, а не раздражение».
      this.audio.play('chew')
      // Шаг 9: вспышка поедания у пасти.
      this.vfx.eatFlash(
        this.creature.x + this.creature.facing * 10,
        this.creature.y - 4,
        0.4,
      )
      // Шаг 11: узел «Сытость лечит».
      if (this.perks.healOnEat > 0) this.vitals.heal(this.perks.healOnEat)
    }
    this.eating.onCarcassFinished = (x, y, speciesId) => {
      // Туша доедена: тёплый всплеск сытости (гайд: «вспышка света при поедании»). 
      this.audio.play('gulp')
      this.vfx.eatFlash(x, y, 0.9)
      this.cameras.main.flash(140, 120, 62, 46)
      // Шаг 11: поедание кормит Гнездо — Эссенция + бестиарий «съедено».
      const gain = Math.max(1, Math.round(NEST.essencePerEaten * this.perks.essenceEatMult))
      this.addEssence(gain, x, y)
      recordBestiary(speciesId, true)
    }

    this.mutations = new Mutations(this, this.vitals)
    this.mutations.onApply = (def, silent) => this.applyMutation(def, silent)

    this.combat = new Combat(
      this, this.creature, this.vitals,
      () => this.enemies,
      this.blood, this.hitStop, this.eating,
    )

    // Шаг 7: споры жнеца, огненный след ползуна, режиссёр экосистемы.
    this.spores = new Spores(this, this.cave, this.mask, this.blood, {
      onHitPlayer: (damage) => {
        // Шаг 11: «Грибной доктор» — споры лечат; «Споровый иммунитет» — без замедления.
        if (this.perks.sporeHeal) {
          this.vitals.heal(2)
          this.blood.number(this.creature.x, this.creature.y - 22, '+2', '#B36BFF')
          return
        }
        const applied = this.combat.hurtPlayerSpore(damage)
        if (applied > 0 && this.perks.sporeImmune) this.creature.slowUntil = 0
      },
      onHitMob: (victim, applied) => {
        this.blood.burst(victim.x, victim.y, {
          count: 8, dirDeg: 90, spreadDeg: 360, texture: 'spore', sticky: false,
        })
        this.blood.number(victim.x, victim.y - 14, `${applied}`, '#B36BFF')
      },
    })
    this.fire = new FireTrail(this, this.cave, this.mask, {
      // Шаг 11: «Тёплая шерсть»/«Пламя-друг» — множитель урона огня.
      onBurnPlayer: (amount) => this.combat.hurtPlayerFire(Math.round(amount * this.perks.fireResist)),
    })
    this.eco = new Ecosystem(this, {
      spawnAtNest: (nest) => this.spawnEnemyAtNest(nest),
    })

    // Шаг 9: juice-слой (вспышки, хроматика, слоу-мо, Glow, искры).
    this.vfx = new Vfx(this, this.blood, this.hitStop)
    QUALITY.onChange(() => this.vfx.refreshForQuality())

    // Шаг 12: скалы (5 видов, биомный тон) и лозы с потолков — здесь,
    // потому что редкие плиты-жилы регистрируют свечение через this.vfx.
    this.buildBackgroundRocks()
    this.buildVines()

    // Шаг 11: перки Гнезда применяются после генов — древо усиливает героя.
    this.nestProfile = loadNestSave()
    this.perks = applyPerks(this.nestProfile.nodes, {
      vitals: this.vitals,
      creature: this.creature,
      combat: this.combat,
      mutations: this.mutations,
      sceneMods: this.sceneMods,
    })
    this.mutations.slots = this.vitals.mutationSlots

    this.combat.onHeavyHit = (damage) => this.vfx.chromaticHit(damage >= 20 ? 1.5 : 1)
    // Шаг 20: всплеск попадания укуса («ауры ударов, сплеши») — кольцо
    // + конус биолюм-искр + циановая вспышка над маской тьмы.
    this.combat.onBiteHit = (x, y, facing, killed) =>
      this.vfx.hitSplash(x, y, facing, killed)

    this.hudBars = new Hud(this, this.vitals, this.mutations, () => this.combat.queueTouchBite())

    // Рост: существо visibly увеличивается, свет на миг вспыхивает.
    this.vitals.onLevelUp = (level) => {
      this.creature.applyGrowth(this.vitals.bodyScale)
      this.audio.play('levelup')
      this.blood.burst(this.creature.x, this.creature.y, {
        count: 22, dirDeg: 90, spreadDeg: 360, speedMult: 0.9,
        texture: 'spore', sticky: false,
      })
      this.blood.number(this.creature.x, this.creature.y - 30, `РОСТ ${level}`, '#B36BFF', true)
      this.cameras.main.flash(180, 179, 107, 255)
    }
    // «Второе сердце»: смертельный урон погашен.
    this.vitals.onSecondHeart = () => {
      this.audio.play('gene')
      this.blood.number(this.creature.x, this.creature.y - 34, 'ВТОРОЕ СЕРДЦЕ', '#B36BFF', true)
      this.cameras.main.flash(220, 255, 138, 148)
    }
    this.creature.onAirJump = () => {
      this.blood.burst(this.creature.x, this.creature.y + 8, {
        count: 7, dirDeg: 90, spreadDeg: 70, speedMult: 0.4,
        texture: 'spore', sticky: false,
      })
      // Шаг 20: взмах крыльев при воздушном прыжке — сноп биолюм-пыли вниз.
      this.vfx.wingSweep(this.creature.x, this.creature.y + 6, 1)
    }
    // Шаг 13 (Carrion/Dead Cells): сквош приземления + пыль, стретч отрыва.
    // Шаг 16: база твинов — creature.baseScale (рост × масштаб анимации):
    // голой bodyScale приземление сбрасывало анимационный множитель.
    this.creature.onHardLand = (impactVy) => {
      const j = MOVEMENT.juice
      const k = Math.min(1, Math.max(0, (impactVy - j.landMinVy) / (j.landMaxVy - j.landMinVy)))
      // Шаг 20: масштабный твин живёт в существе (stopScaleTween атомарно
      // заменяет его) — прежний killTweensOf(this.creature) убивал здесь
      // мигание неуязвимости на полпути (альфа застревала < 1).
      this.creature.landVisual(k)
      this.blood.burst(this.creature.x, this.creature.y + 10, {
        count: Math.round(j.landDustCount * (0.6 + k * 0.6)),
        dirDeg: 90,
        spreadDeg: 150,
        speedMult: 0.45,
        texture: 'dust',
        sticky: false,
      })
    }
    this.creature.onTakeoff = () => {
      // Шаг 20: тот же перенос — стретч отрыва из существа.
      this.creature.takeoffVisual()
      // Взмах крыльев при отрыве от земли.
      this.vfx.wingSweep(this.creature.x, this.creature.y + 8, 1)
    }

    this.mask.setPlayer(this.mask.add({
      x: () => this.creature.x,
      y: () => this.creature.y,
      // Шаг 8: живой множитель света (Ночное зрение / Светожорное ядро / ген свечения).
      radius: LIGHT.playerLight.radius,
      radiusMult: () => this.sceneMods.lightMult,
      breathe: true,
      // Шаг 13 (Hidden Deep): «взгляд хищника» — свет длиннее вперёд по морде.
      gazeDir: () => this.creature.facing,
    }))

    // ── Содержимое пещеры ───────────────────────────────────────────────────
    this.buildMushrooms()
    this.buildNests()
    this.buildAmbientSpores()
    this.buildExitGate()
    // Шаг 13 (Dead Cells): столбы света из потолочных трещин (верхняя полоса).
    this.buildLightShafts()
    this.motes = new SilhouetteMotes(this, this.cave, this.mask)

    // Добыча у гнёзд шага 4 + гарантированная еда у входа.
    this.spawnEnemies()
    // Шаг 8: мутагенные цветки, ген-лунки в глубине, уникальные мобы.
    this.buildMutagenFlowers()
    this.buildGenePools()
    this.spawnElites()

    // Шаг 12: забег с прошлого слоя — рост, диета, мутации, спутник
    // (после генов и перков: мутации вешают свои SET-модификаторы поверх).
    this.restoreRun()

    // «Кровавый напор»: после трапезы — рывок скорости.
    this.vitals.onEat = () => {
      const br = this.mutations.ownedList.find((m) => m.effect.type === 'bloodRush')
      if (br && br.effect.type === 'bloodRush') {
        this.creature.speedBuffMult = br.effect.speedMult
        this.creature.speedBuffUntil = this.time.now + br.effect.boostMs
      }
    }

    // ── Ввод боя: J / ЛКМ (десктоп), тач-кнопка — через Hud ─────────────────
    kb.on('keydown-J', () => this.combat.queueKeyBite())
    if (!this.sys.game.device.input.touch) {
      this.input.on(Phaser.Input.Events.POINTER_DOWN, (pointer: Phaser.Input.Pointer) => {
        if (pointer.button === 0) this.combat.queueKeyBite()
      })
    }

    // ── UI ──────────────────────────────────────────────────────────────────
    const { width, height } = this.scale
    const vignette = this.add.image(width / 2, height / 2, 'vignette')
      .setDisplaySize(width * LIGHT.vignette.overscan, height * LIGHT.vignette.overscan)
      .setScrollFactor(0)
      .setDepth(18)
      .setAlpha(LIGHT.vignette.alpha)
    // Шаг 20: весь экран (вигнетка/HUD/карта/оверлеи) — в uiRoot,
    // контр-трансформация гасит зум камеры (systems/UiLayer.ts).
    uiAttach(this, vignette)

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
    uiAttach(this, this.hudText)

    // Шаг 11: счётчик Эссенции этого забега (обновляется только сменой строки).
    this.essenceHud = this.add.text(width - 10, 52, '', {
      fontFamily: 'monospace',
      fontSize: '13px',
      fontStyle: 'bold',
      color: '#E8A34F',
      align: 'right',
    })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(22)
    uiAttach(this, this.essenceHud)

    const controlsHint = this.add.text(12, height - 14,
      'A/D — бег · SPACE — прыжок · W — план · J/ЛКМ — укус · R — та же пещера · N — новая · M — карта · Q — качество · ESC — меню',
      { fontFamily: 'monospace', fontSize: '11px', color: '#8A8894' },
    )
      .setScrollFactor(0)
      .setOrigin(0, 1)
      .setDepth(22)
      .setAlpha(0.8)
    uiAttach(this, controlsHint)

    this.miniMap = new MiniMap(this, this.cave)
    // Шаг 13: заголовок большой карты — слой и seed.
    this.miniMap.setLayerInfo(`слой ${this.depth} · seed ${this.seedBase}`)
    // Шаг 10: наблюдатель FPS — на слабых устройствах сам включает «низкое».
    this.fpsGuard = new FpsGuard(this)

    this.debug = new DebugOverlay(this, this.creature, () => [
      `cave:   ${this.cave.cols}×${this.cave.rows}  air=${Math.round(this.cave.stats.reachableRatio * 100)}%`,
      `gen:    ${this.cave.stats.attempts} попт. ${genMs}мс  hash=${this.cave.stats.hash.toString(16).slice(0, 6)}`,
      `light:  r=${Math.round(this.mask.playerRadius(this.time.now))}  дыры=${this.mask.lastHoles}  мошь=${this.motes.visibleCount}/${this.motes.count}`,
      `vitals: hp=${Math.ceil(this.vitals.hp)}/${this.vitals.maxHp}  голод=${Math.ceil(this.vitals.hunger)}/${this.vitals.maxHunger}`,
      `рост:   ур.${this.vitals.level} xp=${Math.round(this.vitals.xp)}  мутаций=${this.mutations.ownedCount}`,
      `бой:    ${this.combat.state}  мобов=${this.enemies.length}  туш=${this.eating.list.length}`,
      `экосистема: ${this.ecoPopulation()}  ${this.eco.stats()}`,
      `шаг7:   спор=${this.spores.activeCount}  огня=${this.fire.activeCount}  кислота=${this.vitals.biteAcid ? 'да' : 'нет'}  кач=${QUALITY.level}`,
      `кровь:  декалей=${this.blood.activeDecals}  сгустков=${this.blood.activeClots}`,
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
    // Разморозка — ВНЕ страховки: даже после ошибочного кадра мир обязан ожить.
    this.hitStop.update()
    try {
      // Шаг 20: контр-трансформация экран-слоя против зума камеры —
      // каждый кадр (пульс слоу-мо меняет зум во времени, HUD не должен
      // «дышать» вместе с ним). Вне страховки не нужно: это чистые
      // присваивания, но пусть живут рядом с остальным апдейтом.
      uiRootSyncZoom(this)
      // Отладочный godmode для скриншот-тестов (агент ставит window.__GOD__).
      if ((window as unknown as { __GOD__?: boolean }).__GOD__) {
        this.vitals.hp = this.vitals.maxHp
        this.vitals.hunger = Math.max(this.vitals.hunger, this.vitals.maxHunger * 0.5)
        this.dying = false
      }
      const frozen = this.hitStop.active

      if (!frozen && !this.dying) {
        this.creature.update(time, delta)
        this.combat.update(time)

        // Контекст мобов: свет хищника = его зрение (мутации маскируют);
        // экосистема видит соседей и туши (шаг 7).
        // Шаг 15: свет стал шире (340) ради ВИДИМОСТИ пещеры — но мобы
        // замечают существо по-прежнему в прежнем радиусе (баланс не тронут).
        const lightR = this.mask.playerRadius(time) * LIGHT.playerLight.detectionShare
        const ctx: EnemyContext = {
          playerX: this.creature.x,
          playerY: this.creature.y,
          playerLightR: lightR,
          detectMult: this.sceneMods.detectMult,
          frozen,
          playerAlive: this.vitals.alive,
          playerHpRatio: this.vitals.hpRatio,
          others: this.enemies,
          corpses: this.eating.list,
          eatCorpse: (carcass, portion) => this.eating.mobBite(carcass, portion),
        }
        for (const enemy of this.enemies) {
          enemy.update(time, delta, ctx)
          enemy.updateSilhouette(this.creature.x, this.creature.y, lightR)
        }
        // Выпавшие из мира мобы исчезают тихо, но гнездо их возродит (шаг 7).
        for (let i = this.enemies.length - 1; i >= 0; i--) {
          const e = this.enemies[i]
          if (e.dead && !e.active) this.enemies.splice(i, 1)
          else if (e.y > this.worldH + 200) {
            if (e.nestIndex >= 0) this.eco.onMobDeath(e.nestIndex)
            e.destroy()
            this.enemies.splice(i, 1)
          }
        }

        this.vfx.update()
        this.spores.update(time, this.creature.x, this.creature.y, this.vitals.alive, this.enemies)
        this.fire.update(time, this.creature.x, this.creature.y, this.vitals.alive, this.enemies)
        this.eco.update(time)
        // Шаг 12: жизнь сама находит игрока — процедурный спавн вне экрана.
        this.roamSpawnTick(time)

        // Шаг 8: «Споровый вдох» — зона Грибных полян.
        const biomeIdx = biomeIndexAtMeters(this.cave.depthOffsetMeters + this.creature.y * GEN.map.metersPerPixel)
        this.creature.sporeBreathZone = this.sceneMods.sporeBreath && biomeIdx === 0

        // Шаг 8: «Эхо-камера» — пульс каждые 10с подсвечивает живое сквозь стены.
        if (this.sceneMods.echo && this.vitals.alive && time >= this.echoNextAt) {
          this.echoNextAt = time + 10000
          for (const e of this.enemies) {
            if (e.dead) continue
            this.eco.ring(e.x, e.y, '#58e6c8', 0.45)
            e.updateSilhouette(e.x, e.y, 99999)
          }
        }

        // Шаг 8: «Грива шипов» — падение сверху жалит.
        if (this.sceneMods.spikeMane > 0 && this.vitals.alive) {
          const pBody = this.creature.body as Phaser.Physics.Arcade.Body
          if (pBody.blocked.down) this.spikeReady = true
          if (this.spikeReady && pBody.velocity.y > 160) {
            for (const e of this.enemies) {
              if (e.dead) continue
              if (Math.abs(e.x - this.creature.x) < 20 && this.creature.y < e.y - 8 && pBody.velocity.y > 0) {
                this.spikeReady = false
                const applied = e.takeDamage(Math.round(this.vitals.biteDamage * this.sceneMods.spikeMane), 0, 0, 'physical', 'player')
                if (applied > 0) this.blood.number(e.x, e.y - 16, `${applied}`, '#E8A34F')
                pBody.velocity.y = -240
                this.hitStop.freeze(60)
                this.blood.burst(e.x, e.y, { count: 10, dirDeg: 90, spreadDeg: 360 })
                break
              }
            }
          }
        }

        // Шаг 8: цветки, ген-лунки, геном-кристаллы, спутник.
        this.updateGenomes(time)

        this.eating.update(time, this.creature.x, this.creature.y)
        // Шаг 11 (переработка): существо жуёт тушу — на земле играет
        // анимация hero-eat вместо idle/run (см. Creature.updateVisuals).
        this.creature.isEating = this.eating.isChewing
        this.vitals.update(delta)
        this.blood.update(this.creature.x, this.creature.y)
        this.mutations.update(this.creature.x, this.creature.y)

        // Смерть существа: голод/уроны добили — финал забега.
        if (!this.vitals.alive) this.handleDeath()
      }

      this.debug.update(this)
      this.fpsGuard.update()
      // Шаг 18: синхронизация lumen-двойника (метки героя над маской тьмы)
      // с основным спрайтом — текстура (hero-X → hero-X-lumen), кадр, флип,
      // трансформы, видимость. Листы 1:1 по сетке кадров.
      {
        const lumen = this.creatureLumen
        if (lumen) {
          const texKey = `${this.creature.texture.key}-lumen`
          lumen.setPosition(this.creature.x, this.creature.y)
          lumen.setScale(this.creature.scaleX, this.creature.scaleY)
          lumen.setRotation(this.creature.rotation)
          lumen.setFlipX(this.creature.flipX)
          if (lumen.texture.key !== texKey) {
            lumen.setTexture(texKey, this.creature.frame.name)
          } else if (lumen.frame.name !== this.creature.frame.name) {
            lumen.setFrame(this.creature.frame.name)
          }
          lumen.setAlpha(LIGHT.halo.lumenAlpha * this.creature.alpha)
          lumen.setVisible(this.creature.visible)
          this.creatureAura.setPosition(this.creature.x, this.creature.y)
        }
      }
      this.miniMap.update(this.creature.x, this.creature.y, this.cave.tile)

      const cam = this.cameras.main
      // Шаг 12: тон параллакса — плавный лерп к цвету биома (глубина
      // ощущается цветом: красные жилы, кислотные гроты, лавовые бездны).
      const tintBand = GEN.biomeBands[biomeIndexAtMeters(this.cave.depthOffsetMeters + this.creature.y * GEN.map.metersPerPixel)]
      if (tintBand) {
        const bandCol = bandColorInt(tintBand)
        for (let li = 0; li < this.parallax.length; li++) {
          const strength = LIGHT.parallax[li].tintStrength
          const target = mixWhiteToward(0xffffff, bandCol, strength)
          const next = lerpColorInt(this.parallaxTints[li], target, 0.03)
          if (next !== this.parallaxTints[li]) {
            this.parallaxTints[li] = next
            this.parallax[li].ts.setTint(next)
          }
        }
      }
      for (const p of this.parallax) {
        p.ts.tilePositionX = cam.scrollX * p.factor
        p.ts.tilePositionY = cam.scrollY * p.factor
        if (p.em) {
          p.em.tilePositionX = p.ts.tilePositionX
          p.em.tilePositionY = p.ts.tilePositionY
        }
      }
      // Шаг 15: куллинг чанков запечёнки — рисуем только видимые.
      if (this.paint) {
        const view = cam.worldView
        for (let i = 0; i < this.paint.chunks.length; i++) {
          const r = this.paint.rects[i]
          const visible = view.x < r.right && view.right > r.x && view.y < r.bottom && view.bottom > r.y
          this.paint.chunks[i].setVisible(visible)
        }
      }
      this.mask.update(this)
      this.motes.update(this, this.creature.x, this.creature.y)
      // Шаг 20: аэро-джус существа — шлейф крыльев + взмахи (см. ниже).
      this.updateAero(time)

      // HUD: глубина + биом + seed (как в шаге 4).
      const meters = Math.max(0, Math.floor(this.cave.depthOffsetMeters + this.creature.y * GEN.map.metersPerPixel))
      this.maxMeters = Math.max(this.maxMeters, meters)
      const band = GEN.biomeBands[biomeIndexAtMeters(this.cave.depthOffsetMeters + this.creature.y * GEN.map.metersPerPixel)]
      // Шаг 10: setText перерисовывает канву-текстуру — обновляем только сменой строки.
      const hudLine = `ГЛУБИНА ${meters} м · ${band.name}\nseed ${this.seedBase} · слой ${this.depth}`
      if (hudLine !== this.lastHudLine) {
        this.lastHudLine = hudLine
        this.hudText.setText(hudLine)
      }
      // Шаг 11: Эссенция забега в HUD (обновляется только сменой строки).
      const essenceLine = `◈ +${this.runEssence}`
      if (essenceLine !== this.lastEssenceHud) {
        this.lastEssenceHud = essenceLine
        this.essenceHud.setText(essenceLine)
      }
      // Шаг 11: тиковые перки (нюх/дрожь/кристаллы).
      this.updateNestPerks(time)

      // Сердцебиение света: низкий голод/HP — свет пульсирует чаще и глубже.
      const hungerRatio = this.vitals.hungerRatio
      const warnAt = BALANCE.hunger.warnBelow / 100
      const heartbeat = Math.max(
        hungerRatio < warnAt ? 1 - hungerRatio / warnAt : 0,
        this.vitals.alive && this.vitals.hpRatio < 0.35 ? 0.7 : 0,
        this.vitals.starving ? 1 : 0,
      )
      this.mask.setHeartbeat(heartbeat)

      // Шаг 10: кроссфейд музыки (бой/глубина) + сердцебиение при тревоге.
      // Угроза = игрок атакует или кто-то целится/преследует/замахивается.
      let combatActive = this.combat.state !== 'ready'
      for (const e of this.enemies) {
        if (e.dead) continue
        const st = e.aiState
        if (st === 'pursue' || st === 'windup' || st === 'attack') {
          combatActive = true
          break
        }
      }
      const metersNow = Math.max(0, Math.floor(this.cave.depthOffsetMeters + this.creature.y * GEN.map.metersPerPixel))
      this.audio.update(time, this.game.loop.delta, combatActive, metersNow, heartbeat)

      this.hudBars.update(delta)
      // Шаг 13 (Dead Cells): серия укусов — счётчик и полоска окна.
      this.hudBars.updateCombo(this.combat.combo, this.combat.comboMult, this.combat.comboRatio)
      // Шаг 13 (Carrion): раненое существо кровоточит на ходу.
      this.updateWoundDrip(time)

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
    } catch (err) {
      this.updateErrorCount++
      if (this.updateErrorCount <= 8) {
        const msg = `CaveScene.update #${this.updateErrorCount}: ${err instanceof Error ? err.message : String(err)}`
        console.error(msg, err)
        ;(window as unknown as { __ERRS__?: string[] }).__ERRS__?.push(`game-loop: ${msg}`)
      }
    }
  }

  /** Шаг 11: Эссенция забега — накопление, всплывающее число, HUD. */
  private addEssence(amount: number, x: number, y: number): void {
    this.runEssence += amount
    this.blood.number(x, y - 26, `+${amount}◈`, '#E8A34F')
  }

  /** Шаг 13: следующая капля раненого существа (мс сцены). */
  private woundDripNextAt = 0

  /**
   * Шаг 13 (Carrion): горе видно на слух и на полу — ниже woundDrip.hpBelow
   * HP существо капает кровью на ходу (изредка оставляя декаль). Не в
   * статике: раненый хищник, который бежит, — метит тоннель кровью.
   */
  private updateWoundDrip(time: number): void {
    const w = BALANCE.woundDrip
    if (time < this.woundDripNextAt) return
    this.woundDripNextAt = time + w.intervalMs
    if (!this.vitals.alive || this.vitals.hpRatio >= w.hpBelow) return
    const body = this.creature.body as Phaser.Physics.Arcade.Body
    if (Math.hypot(body.velocity.x, body.velocity.y) < w.minSpeed) return
    this.blood.burst(this.creature.x, this.creature.y + 6, {
      count: 2, dirDeg: 90, spreadDeg: 60, speedMult: 0.5,
    })
    if (Math.random() < w.decalChance) {
      this.blood.decal(this.creature.x + Phaser.Math.Between(-6, 6), this.creature.y + 12, 0.7)
    }
  }

  /** Шаг 11: поведенческие перки Гнезда (тиковая логика — из update). */
  private updateNestPerks(time: number): void {
    // «Кровавый нюх»: охотящиеся на игрока подсвечиваются сквозь тьму.
    if (this.perks.dangerSense && time >= this.dangerSenseNextAt) {
      this.dangerSenseNextAt = time + 1600
      for (const e of this.enemies) {
        if (e.dead) continue
        if (e.aiState === 'pursue' || e.aiState === 'windup' || e.aiState === 'attack') {
          this.eco.ring(e.x, e.y, '#E23A4E', 0.5)
          e.updateSilhouette(e.x, e.y, 99999)
        }
      }
    }
    // «Дрожь тьмы»: мобы слишком близко к хищнику паникуют.
    if (this.perks.dreadAura && time >= this.dreadNextAt) {
      this.dreadNextAt = time + 900
      for (const e of this.enemies) {
        if (e.dead) continue
        const d = Phaser.Math.Distance.Between(e.x, e.y, this.creature.x, this.creature.y)
        if (d < 110 && Math.random() < 0.22) e.scare(time)
      }
    }
    // «Кристальный покров»: кристаллы пещеры (decor=2) лечат при касании.
    if (this.perks.crystalHeal && time >= this.crystalHealNextAt && this.vitals.alive) {
      this.crystalHealNextAt = time + 700
      const tile = this.cave.tile
      const tx = Math.floor(this.creature.x / tile)
      const ty = Math.floor(this.creature.y / tile)
      let onCrystal = false
      for (let dy = -1; dy <= 1 && !onCrystal; dy++) {
        for (let dx = -1; dx <= 1 && !onCrystal; dx++) {
          const cx2 = tx + dx
          const cy2 = ty + dy
          if (cx2 < 0 || cy2 < 0 || cx2 >= this.cave.cols || cy2 >= this.cave.rows) continue
          if (this.cave.decor[cy2 * this.cave.cols + cx2] === 2) onCrystal = true
        }
      }
      if (onCrystal && this.vitals.hp < this.vitals.maxHp) {
        this.vitals.heal(1)
        if (Math.random() < 0.25) this.blood.number(this.creature.x, this.creature.y - 20, '+1', '#7DB8FF')
      }
    }
  }

  // ── Шаг 6/7: бой, еда и экосистема ────────────────────────────────────────

  /**
   * Моб умер (убийца — игрок, другой моб или среда). Туша и сгустки
   * появляются всегда — пещера утилизирует своих. Мутации и счётчик
   * «съедено» — только за игроком: добыча должна чувствовать своё.
   */
  private handleEnemyDeath(enemy: Enemy, killer: KillerKind): void {
    const idx = this.enemies.indexOf(enemy)
    if (idx >= 0) this.enemies.splice(idx, 1)

    // Шаг 11: бестиарий — «убито» засчитывается за любую смерть от игрока.
    if (killer === 'player') recordBestiary(enemy.speciesId, false)

    // Шаг 10: смерть моба (гайд: «смерть моба» в списке SFX); уникальный —
    // уходит под собственный рык.
    this.audio.play('mobDeath')
    if (enemy.elite) this.audio.play('eliteRoar')

    const b = BALANCE.blood
    const mult = killer === 'player' ? 1 : 0.7
    this.blood.explode(enemy.x, enemy.y, Math.round(b.particlesPerKill[1] * mult))
    this.blood.spawnClots(
      enemy.x, enemy.y,
      Phaser.Math.Between(b.clotsPerKill[0], b.clotsPerKill[1]),
    )
    // «Корона Матки» (шаг 8): побеждённый мелкий моб становится спутником.
    if (this.pendingCompanion && killer === 'player'
      && (enemy.speciesId === 'slug' || enemy.speciesId === 'bat')) {
      this.pendingCompanion = false
      this.spawnCompanion(enemy.x, enemy.y)
      this.eco.ring(enemy.x, enemy.y, '#e8a34f', 0.8)
      this.eco.onMobDeath(enemy.nestIndex)
      if (killer === 'player') this.vitals.eatenCount++
      return
    }

    // Шаг 13 (Dead Cells): оверкилл — жертву РАЗРЫВАЕТ: туши нет, вместо
    // неё фонтан мяса + большая декаль + съедобные сгустки. На высоких
    // уровнях роста укус рвёт добычу сразу — темп боя не падает на жевание.
    if (enemy.overkilled) {
      const gib = ENEMIES.gib
      this.blood.explode(enemy.x, enemy.y, Math.round(gib.chunkCount * 1.4))
      this.blood.burst(enemy.x, enemy.y, {
        count: gib.chunkCount,
        dirDeg: 90,
        spreadDeg: 360,
        speedMult: 1.2,
        texture: 'meat-chunk',
        sticky: false,
      })
      this.blood.spawnClots(
        enemy.x, enemy.y,
        Phaser.Math.Between(gib.clotsPerGib[0], gib.clotsPerGib[1]),
      )
      this.blood.decal(enemy.x, enemy.y + 8, gib.decalScale)
      this.vfx.eatFlash(enemy.x, enemy.y, 1.1)
    } else {
      this.eating.spawnCarcass(enemy.speciesId, enemy.x, enemy.y)
    }
    this.eco.ring(enemy.x, enemy.y, enemy.species.noiseColor, 0.6)
    this.eco.onMobDeath(enemy.nestIndex)
    if (killer === 'player') {
      this.vitals.eatenCount++
      // Шаг 11: Эссенция Гнезда за убийство (элита ценнее, узлы усиливают).
      const sp = ENEMIES.species[enemy.speciesId]
      const essenceGain = Math.round(
        sp.essence * (enemy.elite ? NEST.eliteEssenceMult : 1) * this.perks.essenceKillMult,
      ) + this.perks.essenceOnKill
      this.addEssence(Math.max(1, essenceGain), enemy.x, enemy.y)
      // Шаг 11: «Жир регенерации» — убийство лечит.
      if (this.perks.hpOnKill > 0) this.vitals.heal(this.perks.hpOnKill)
      // Уникальный моб несёт ПОСТОЯННЫЙ ген (шаг 8) и заслуживает slow-mo (шаг 9).
      if (enemy.elite) {
        this.vfx.uniqueKillSlowMo()
        this.vfx.sparks(enemy.x, enemy.y, 18, true)
        this.blood.explode(enemy.x, enemy.y, 24)
        this.dropGenePickup(enemy.x, enemy.y)
        this.mutations.rollDrop(enemy.x, enemy.y, { guaranteed: this.perks.eliteGuarantee })
      } else {
        this.mutations.rollDrop(enemy.x, enemy.y)
      }
      // Шаг 11: «Паника стаи» — соседи жертвы разбегаются.
      if (this.perks.panicKill) {
        for (const other of this.enemies) {
          if (other.dead || other === enemy) continue
          if (Phaser.Math.Distance.Between(other.x, other.y, enemy.x, enemy.y) < 150) other.scare(this.time.now)
        }
      }
    }
  }

  /** Мутация подобрана: сцена вешает хуки на Creature и свой mods. */
  private applyMutation(def: import('../config/mutations').MutationDef, silent = false): void {
    // Шаг 10: подбор кристалла-мутации (тихий режим — перенос между слоями, шаг 12).
    if (!silent) this.audio.play(def.rarity === 'legendary' ? 'gene' : 'pickup')
    const e = def.effect
    switch (e.type) {
      case 'grip':
        this.creature.mods.wallSlideMult = e.wallSlideMult
        break
      case 'doubleJump':
        this.creature.mods.airJumps = e.airJumps
        break
      case 'stealth':
        // Мультипликативно: проклятие «Прозрачной кожи» усиливает маскировку.
        this.sceneMods.detectMult *= e.detectMult
        break
      case 'thorns':
        this.sceneMods.thorns = e.damage
        break
      case 'stunBite':
        this.combat.mods.stunMs = e.stunMs
        break
      // ── Шаг 8: расширенный пул ──
      case 'sporeBreath':
        this.sceneMods.sporeBreath = true
        break
      case 'echoPulse':
        this.sceneMods.echo = true
        break
      case 'bloodRush':
        break // бафф вешается в vitals.onEat при трапезе
      case 'parasiteSaliva':
        this.combat.mods.parasite = { dps: e.dps, durationMs: e.durationMs }
        break
      case 'nightVision':
        this.sceneMods.lightMult *= e.lightMult
        break
      case 'spikeMane':
        this.sceneMods.spikeMane = e.damageMult
        break
      case 'motherCrown':
        this.pendingCompanion = true
        break
      case 'lightHungerCore':
        this.sceneMods.lightMult *= e.lightMult
        break
      default:
        // digestion / biteDamage / secondHeart / gluttonMaw / bonePlate /
        // lightHungerCore-урон / проклятия — уже в Vitals.applyEffect.
        break
    }
    // Свет — живой множитель: пересобирать дыру не нужно, radius читается каждый кадр.
    void this.sceneMods
  }

  /** Смерть существа: взрыв, затемнение, экран итога → Гнездо (шаг 11). */
  private handleDeath(): void {
    if (this.dying) return
    this.dying = true
    // Накопительная статистика между забегами (localStorage, шаг 8).
    this.geneSave.stats.deaths++
    this.geneSave.stats.runs++
    this.geneSave.stats.bestDepthM = Math.max(this.geneSave.stats.bestDepthM, this.maxMeters)
    this.geneSave.stats.bestEaten = Math.max(this.geneSave.stats.bestEaten, this.vitals.eatenCount)
    saveGeneSave(this.geneSave)
    // Шаг 11: забег завершён смертью — Эссенция падает в профиль Гнезда.
    this.bankRunToNest('death')
    const d = BALANCE.death
    this.hitStop.freeze(d.hitstopMs)
    this.blood.explode(
      this.creature.x, this.creature.y,
      Math.round(BALANCE.blood.particlesPerKill[1] * d.bloodMultiplier),
    )
    this.blood.spawnClots(this.creature.x, this.creature.y, 3)
    this.cameras.main.shake(d.fadeMs, BALANCE.hit.killShakePx / this.cameras.main.width)
    this.cameras.main.flash(260, 226, 58, 78)
    // Шаг 11 (переработка): вместо мгновенного исчезновения — анимация
    // смерти (6 кадров, последний замирает), спрайт скрывается через
    // ANIMS.death.hideAfterMs; физтело гасим сразу, чтобы труп не сползал.
    this.creature.playDeathVisual()
    const corpse = this.creature.body as Phaser.Physics.Arcade.Body
    corpse.velocity.set(0, 0)
    corpse.enable = false
    this.time.delayedCall(ANIMS.death.hideAfterMs ?? 600, () => {
      this.creature.setVisible(false)
    })
    // Шаг 18: метки и аура гаснут вместе с существом.
    this.creatureLumen.setAlpha(0)
    this.creatureAura.setAlpha(0)
    this.blood.decal(this.creature.x, this.creature.y + 8, 2.6)

    const kb = this.input.keyboard!
    this.time.delayedCall(d.fadeMs * 0.6, () => this.showRunSummary(kb))
  }

  /**
   * Шаг 11: сдать забег в Гнездо — Эссенция (трофеи + бонус глубины),
   * накопительная статистика, рекорды. 'death' — финал забега, 'descend'
   * — спуск глубже (жизнь та же, счётчики забегов не трогаем).
   */
  private bankRunToNest(kind: 'death' | 'descend'): void {
    const depthBonus = Math.floor(this.maxMeters / NEST.depthMetersPerEssence * this.perks.depthBonusMult)
    const total = this.runEssence + depthBonus
    this.nestProfile = updateNestSave((s) => {
      s.essence += total
      s.stats.totalEssence += total
      if (kind === 'death') s.stats.runs++
      if (kind === 'death') s.stats.deaths++
      s.stats.bestDepthM = Math.max(s.stats.bestDepthM, this.maxMeters)
      // Шаг 12: счётчики еды и рекорды забега — только на смерти.
      // Раньше totalEaten += добавлялся и на каждом спуске, а забег
      // теперь живёт сквозь слои — было бы задвоение на каждом переходе.
      if (kind === 'death') {
        s.stats.bestEaten = Math.max(s.stats.bestEaten, this.vitals.eatenCount)
        s.stats.totalEaten += this.vitals.eatenCount
      }
      // Пещеры: уникальные сиды (шаг 11 — «пещеры посещено»). Кап — память.
      if (!s.seenSeeds.includes(this.seedBase)) {
        s.seenSeeds.push(this.seedBase)
        if (s.seenSeeds.length > 300) s.seenSeeds.splice(0, s.seenSeeds.length - 300)
      }
      s.stats.cavesVisited = s.seenSeeds.length
      // Лучший забег — по Эссенции, тай-брейк по глубине (тоже только финал).
      if (kind === 'death') {
        const better = total > s.stats.bestRun.essence
          || (total === s.stats.bestRun.essence && this.maxMeters > s.stats.bestRun.depthM)
        if (better) {
          s.stats.bestRun = { essence: total, depthM: this.maxMeters, eaten: this.vitals.eatenCount }
        }
      }
    })
    this.lastDepthBonus = depthBonus
    this.lastRunEssence = total
  }

  /** Бонус глубины и итог забега (заполняются в bankRunToNest, читает итоговый экран). */
  private lastDepthBonus = 0
  private lastRunEssence = 0
  private showRunSummary(kb: Phaser.Input.Keyboard.KeyboardPlugin): void {
    const { width, height } = this.scale
    const cam = this.cameras.main
    const depthPx = this.cameras.main.height

    const overlay = this.add.container(0, 0).setScrollFactor(0).setDepth(40).setAlpha(0)
    // Шаг 20: оверлей итогов — экранным слоем (поверх всего мира в uiRoot).
    uiAttach(this, overlay)
    const veil = this.add.rectangle(width / 2, height / 2, width, height, 0x0b0b10, 0.82)
    const title = this.add.text(width / 2, height / 2 - 138, 'ЗАБЕГ ОКОНЧЕН', {
      fontFamily: 'Georgia, "Times New Roman", serif',
      fontSize: '44px',
      color: '#E23A4E',
      fontStyle: 'bold',
    }).setOrigin(0.5)
    // Что съел (по видам) — истории забегов рождаются здесь.
    const eatenParts = Object.entries(this.eating.eatenBySpecies)
      .sort((a, b) => b[1] - a[1])
      .map(([id, n]) => `${ENEMIES.species[id].name} ×${n}`)
    const eatenLine = eatenParts.length > 0 ? eatenParts.join(' · ') : 'ничего — пещера победила'
    const genesLine = this.genesGained.length > 0
      ? this.genesGained.map((id) => GENES.genes.find((g) => g.id === id)?.name ?? id).join(' · ')
      : null
    const lines = [
      `съедено добычи — ${this.vitals.eatenCount}`,
      `рацион: ${eatenLine}`,
      `рост существа — уровень ${this.vitals.level}`,
      `мутаций внедрено — ${this.vitals.mutationsCount}`,
      `лучшая серия укусов — ×${this.combat.comboBest}`,
      `максимальная глубина — ${this.maxMeters} м`,
      `на чём погиб: ${this.vitals.lastDamageCause}`,
      '',
      `ЭССЕНЦИЯ В ГНЕЗДО: +${this.lastRunEssence}◈ (из них за глубину +${this.lastDepthBonus}◈)`,
    ]
    if (genesLine) lines.push(`постоянные гены: ${genesLine} (переживут смерть)`)
    const stats = this.add.text(width / 2, height / 2 - 10, lines.join('\n'), {
      fontFamily: 'monospace',
      fontSize: '15px',
      color: '#E8E6E3',
      align: 'center',
      lineSpacing: 7,
    }).setOrigin(0.5)
    const hint = this.add.text(width / 2, height / 2 + 128, '— нажми, чтобы вернуться в Гнездо —', {
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

    // Смерть возвращает в Гнездо (шаг 11): трофеи сданы, древо ждёт.
    const restart = (): void => {
      cam.fadeOut(320, 4, 4, 8)
      cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        kb.removeAllListeners()
        this.scene.start('Nest')
      })
    }
    this.input.once(Phaser.Input.Events.POINTER_DOWN, restart)
    kb.once('keydown-SPACE', restart)
    kb.once('keydown-ENTER', restart)
    void depthPx
  }

  /**
   * Расселение экосистемы (шаг 7): гнёзда шага 4 просыпаются со своим
   * составом по биому (ENEMIES.spawn.byBiome), у входа — своя мелочь.
   * Состав гнезда — детерминированный rng от seed.
   */
  private spawnEnemies(): void {
    const rng = new Rng(hashSeed(this.cave.seed + ':mobs'))
    const tile = this.cave.tile
    const spawnCfg = ENEMIES.spawn

    const addEnemy = (speciesId: string, wx: number, wy: number, nestIndex = -1): void => {
      this.addEnemyAt(speciesId, wx, wy, nestIndex)
    }

    // Гнёзда: [мин, макс] мобов, вид — по полосе биома гнезда.
    this.cave.nests.forEach((nest, index) => {
      this.eco.registerNest(index, nest.tx, nest.ty, nest.biome)
      const count = Phaser.Math.Between(spawnCfg.perNest[0], spawnCfg.perNest[1])
      for (let i = 0; i < count; i++) {
        const speciesId = this.pickSpeciesForBiome(nest.biome, rng)
        const wx = nest.tx * tile + tile / 2 + rng.range(-tile, tile)
        const wy = nest.ty * tile + tile / 2 - 8 - i * 4
        addEnemy(speciesId, wx, wy, index)
      }
    })

    // Стартовая еда: несколько слизней в воздушных клетках недалеко от входа.
    const entrance = this.cave.entrance
    let placed = 0
    for (let tries = 0; tries < 500 && placed < BALANCE.spawn.entrancePrey; tries++) {
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

  /** Вид для биома по весам ENEMIES.spawn.byBiome (с капом вида). */
  private pickSpeciesForBiome(biome: number, rng: Rng): string {
    const spawnCfg = ENEMIES.spawn
    const table = spawnCfg.byBiome[biome] ?? null
    const entries = table ?? spawnCfg.byBiome.flatMap((t) => t)
    const allowed = entries.filter((w) => this.speciesCount(w.id) < spawnCfg.maxPerSpecies)
    const pool = allowed.length > 0 ? allowed : entries
    const roll = rng.float() * pool.reduce((s, w) => s + w.weight, 0)
    let acc = 0
    for (const w of pool) {
      acc += w.weight
      if (roll < acc) return w.id
    }
    return pool[0]?.id ?? spawnCfg.biomeFallback[0]
  }

  private speciesCount(id: string): number {
    let n = 0
    for (const e of this.enemies) if (!e.dead && e.speciesId === id) n++
    return n
  }

  /**
   * Шаг 12: процедурный спавн вокруг игрока — каждые roamIntervalMs
   * вне экрана, в кольце roamRingTiles, до roamMaxBatch мобов вида по
   * биому этой точки. Пещера не пустует, пока игрок исследует: жизнь
   * приходит сама (гнёзда остаются главным источником населения).
   */
  private roamSpawnTick(time: number): void {
    if (time < this.roamNextAt) return
    const [lo, hi] = ENEMIES.spawn.roamIntervalMs
    this.roamNextAt = time + Phaser.Math.Between(lo, hi)
    if (this.enemies.length >= BALANCE.spawn.maxAlive) return

    const rng = new Rng(hashSeed(`${this.cave.seed}:roam:${Math.floor(time / 1000)}`))
    const tile = this.cave.tile
    const px = this.creature.x / tile
    const py = this.creature.y / tile
    const [rMin, rMax] = ENEMIES.spawn.roamRingTiles
    const view = this.cameras.main.worldView
    let spawned = 0

    for (let tries = 0; tries < 80 && spawned < ENEMIES.spawn.roamMaxBatch; tries++) {
      if (this.enemies.length >= BALANCE.spawn.maxAlive) break
      const angle = rng.float() * Math.PI * 2
      const dist = rMin + rng.float() * (rMax - rMin)
      const tx = Math.round(px + Math.cos(angle) * dist)
      const ty = Math.round(py + Math.sin(angle) * dist)
      if (tx < 1 || ty < 1 || tx >= this.cave.cols - 1 || ty >= this.cave.rows - 1) continue
      const i = ty * this.cave.cols + tx
      // Воздух с полом под ним.
      if (this.cave.solid[i] !== 0) continue
      if (this.cave.solid[i + this.cave.cols] !== 1) continue
      // Строго вне экрана (с запасом) — никакого «поп-ин» на глазах.
      const wx = tx * tile + tile / 2
      const wy = ty * tile + tile / 2
      if (wx > view.x - 48 && wx < view.right + 48 && wy > view.y - 48 && wy < view.bottom + 48) continue
      const speciesId = this.pickSpeciesForBiome(this.cave.biomes[i], rng)
      if (this.speciesCount(speciesId) >= ENEMIES.spawn.maxPerSpecies) continue
      if (this.addEnemyAt(speciesId, wx, wy)) spawned++
    }
  }

  /** Возрождение у гнезда (вызывает Ecosystem): капы, потолок, вид по биому. */
  private spawnEnemyAtNest(nest: NestRecord): boolean {
    if (this.enemies.length >= BALANCE.spawn.maxAlive) return false
    const rng = new Rng(hashSeed(`${this.cave.seed}:respawn:${nest.index}:${this.eco.counters.respawns}`))
    const speciesId = this.pickSpeciesForBiome(nest.biome, rng)
    if (this.speciesCount(speciesId) >= ENEMIES.spawn.maxPerSpecies) return false
    const tile = this.cave.tile
    const wx = nest.tx * tile + tile / 2 + rng.range(-tile, tile)
    const wy = nest.ty * tile + tile / 2 - 8
    this.addEnemyAt(speciesId, wx, wy, nest.index)
    return true
  }

  /** Тест-хук и возрождение: создать моба вида у точки. */
  private addEnemyAt(speciesId: string, wx: number, wy: number, nestIndex = -1): Enemy | null {
    if (this.enemies.length >= BALANCE.spawn.maxAlive) return null
    const enemy = new Enemy(this, wx, wy, speciesId, this.enemyCallbacks())
    enemy.nestIndex = nestIndex
    if (this.tileLayers) {
      this.physics.add.collider(enemy, this.tileLayers.solid)
    }
    this.enemies.push(enemy)
    return enemy
  }

  /**
   * Единый набор коллбеков мобов: сцена — единственная точка, где моб
   * касается игрока, крови, спор, огня и экосистемы.
   */
  private enemyCallbacks(): import('../entities/Enemy').EnemyCallbacks {
    return {
      onPlayerBitten: (damage, _x, attacker) => {
        const applied = this.combat.hurtPlayer(damage)
        // Шаг 10: боль игрока (гайд: «боль» в списке SFX).
        if (applied > 0) this.audio.play('pain')
        if (applied > 0 && this.sceneMods.thorns > 0 && !attacker.dead) {
          this.combat.reflectThorns(attacker)
        }
      },
      onPlayerDrain: (attacker, amount) => {
        const applied = this.combat.hurtPlayerDrain(amount)
        // Кровосос лечится выпитым (в Enemy считает только для мобов).
        if (applied > 0) attacker.hp = Math.min(attacker.maxHp, attacker.hp + amount)
      },
      onMobHitMob: (attacker, victim, applied, type) => {
        this.eco.counters.mobHits++
        const bloodCol = type === 'fire' ? '#E2763A' : type === 'acid' ? '#a8e34f' : '#E23A4E'
        this.blood.burst(victim.x, victim.y, {
          count: 10, dirDeg: 90, spreadDeg: 360,
        })
        this.blood.number(victim.x, victim.y - 14, `${applied}`, bloodCol)
        void attacker
      },
      onShootSpores: (attacker, tx, ty) => {
        // Шаг 10: шипение спор (гайд: «шипение»).
        this.audio.play('hiss')
        this.spores.fireFrom(attacker, tx, ty)
      },
      onSpawnFire: (_enemy, x, y) => {
        this.audio.play('fire')
        this.fire.spawn(x, y)
      },
      onNoise: (enemy, kind) => {
        if (kind === 'eat') this.eco.counters.mobMeals++
        if (kind === 'curl') this.vfx.sparks(enemy.x, enemy.y, 6)
        // Шаг 10: уникальный рычит на замахе (гайд: «рык уникального»).
        if (kind === 'windup' && enemy.elite) this.audio.play('eliteRoar')
        this.eco.emitNoise(enemy, kind, this.enemies)
      },
      onDeath: (e, killer) => this.handleEnemyDeath(e, killer),
    }
  }

  /** Спуск через врата: новый слой глубже, seed тот же. */
  private descend(): void {
    if (this.exiting || this.dying) return
    this.exiting = true
    // Шаг 11: спуск глубже — Эссенция и рекорды уровня падают в Гнездо.
    this.bankRunToNest('descend')
    // Шаг 12: жизнь продолжается — рост, диета, мутации и спутник
    // переходят на следующий слой (раньше обнулялись — рака пользователя).
    const snapshot = this.snapshotRun()
    this.cameras.main.fadeOut(420, 4, 4, 8)
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.restart({ seed: this.seedBase, depth: this.depth + 1, run: snapshot })
    })
  }

  /** Шаг 12: снять снапшот забега для переноса на следующий слой. */
  private snapshotRun(): RunSnapshot {
    return {
      vitals: {
        hp: this.vitals.hp,
        maxHp: this.vitals.maxHp,
        hunger: this.vitals.hunger,
        maxHunger: this.vitals.maxHunger,
        xp: this.vitals.xp,
        level: this.vitals.level,
        eatenCount: this.vitals.eatenCount,
        mutationsCount: this.vitals.mutationsCount,
      },
      mutationIds: [...this.mutations.ownedList.map((m) => m.id)],
      eatenBySpecies: { ...this.eating.eatenBySpecies },
      genesGained: [...this.genesGained],
      companion: !!this.companion,
    }
  }

  /** Шаг 12: восстановить забег со снапшота прошлого слоя (тихо, без фанфар). */
  private restoreRun(): void {
    const run = this.carryRun
    if (!run) return
    const v = this.vitals
    v.hp = run.vitals.hp
    v.maxHp = run.vitals.maxHp
    v.hunger = run.vitals.hunger
    v.maxHunger = run.vitals.maxHunger
    v.xp = run.vitals.xp
    v.level = run.vitals.level
    v.eatenCount = run.vitals.eatenCount
    v.mutationsCount = run.vitals.mutationsCount
    Object.assign(this.eating.eatenBySpecies, run.eatenBySpecies)
    this.genesGained.push(...run.genesGained)
    // Мутации переигрываются тихо: эффекты — да, баннеры и звук — нет.
    this.mutations.restore(run.mutationIds)
    // Спутник возвращается при первой же добыче (тот же «Мать-корона»).
    this.pendingCompanion = run.companion
    // Визуальный рост уровня применяется заново к спрайту.
    this.creature.applyGrowth(v.bodyScale)
  }

  /** Параллакс-силуэты (шаг 5): tileSprite на весь кадр, factor из light.json.
   * Шаг 18: каждому слою с эмиссивой (emissiveAlpha > 0) ставится
   * ADD-близнец НАД маской тьмы (bg-X-em — выжимка ярких пикселей):
   * в полной тьме глубину держат дальние огни, а не серая дымка. */
  private buildParallax(): void {
    this.parallax = LIGHT.parallax.map((p) => {
      const ts = this.add.tileSprite(0, 0, this.scale.width, this.scale.height, p.key)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(p.depth)
        .setAlpha(p.alpha)
      const em = p.emissiveAlpha > 0
        ? this.add.tileSprite(0, 0, this.scale.width, this.scale.height, `${p.key}-em`)
            .setOrigin(0, 0)
            .setScrollFactor(0)
            .setDepth(LIGHT.halo.depth - 0.2)
            .setBlendMode(Phaser.BlendModes.ADD)
            .setAlpha(p.emissiveAlpha)
        : null
      return { ts, factor: p.factor, em }
    })
    this.parallaxTints = LIGHT.parallax.map(() => 0xffffff)
  }

  /** Дальние силуэты камней в воздушных карманах (параллакс-настроение). */
  private buildBackgroundRocks(): void {
    // Шаг 12: пять видов скал вместо одной текстуры — валун/глыба/россыпь/
    // шпиль/плита со светящейся жилой (редкая, ~7%, даёт glow-близнец).
    // Скалы тонируются цветом биома — глубина ощущается без света.
    const rng = new Rng(hashSeed(this.cave.seed + ':rocks'))
    const tile = this.cave.tile
    const variants = ['rock-a', 'rock-b', 'rock-c', 'rock-d'] as const
    let placed = 0
    for (let tries = 0; tries < 700 && placed < 64; tries++) {
      const x = rng.int(this.cave.cols)
      const y = rng.int(this.cave.rows)
      const i = y * this.cave.cols + x
      if (this.cave.solid[i] !== 0) continue
      const band = GEN.biomeBands[this.cave.biomes[i]]
      const rare = rng.float() < 0.07
      const tex = rare ? 'rock-e' : variants[rng.int(variants.length)]
      const wx = x * tile + tile / 2
      const wy = y * tile + tile / 2
      const img = this.add.image(wx, wy, tex)
        .setAlpha(0.14 + rng.float() * 0.2)
        .setAngle(rng.int(360))
        .setScale(0.7 + rng.float() * 1.6)
        .setDepth(0)
      if (rare) {
        // Жила светится в темноте: слабое биолюм-пятно НАД плитой — шаг 18:
        // гало перенесено НАД маску тьмы (полная тьма не съедает рудные
        // огни — они читаются как дальние маячки глубины).
        const glow = this.add.image(wx, wy, band?.glow ?? 'glow-cyan')
          .setAlpha(LIGHT.halo.vein)
          .setScale(0.5)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(LIGHT.halo.depth)
        this.vfx?.registerGlow(glow)
      } else if (band) {
        // Скала несёт оттенок биома — красные жилы, кислотные гроты, лавы.
        const col = Phaser.Display.Color.IntegerToColor(bandColorInt(band)).darken(62)
        img.setTint(col.color)
      }
      placed++
    }

    // Шаг 12: ЯВНЫЕ скалы на полу — валун/глыба/россыпь/шпиль стоят
    // на земле в воздушных карманах (не силуэты: видны без света рядом).
    let nearPlaced = 0
    for (let tries = 0; tries < 900 && nearPlaced < 26; tries++) {
      const x = rng.int(this.cave.cols)
      const y = rng.int(this.cave.rows)
      const i = y * this.cave.cols + x
      if (this.cave.solid[i] !== 0) continue
      if (this.cave.solid[i + this.cave.cols] !== 1) continue
      // Не прямо у входа — стартовая площадка чистая.
      if (Math.abs(x - this.cave.entrance.x) < 8 && Math.abs(y - this.cave.entrance.y) < 6) continue
      const band = GEN.biomeBands[this.cave.biomes[i]]
      const tex = rng.float() < 0.1 ? 'rock-e' : variants[rng.int(variants.length)]
      const wx = x * tile + tile / 2 + rng.range(-4, 4)
      const scale = tex === 'rock-d' ? 0.55 + rng.float() * 0.5 : 0.8 + rng.float() * 0.9
      const img = this.add.image(wx, (y + 1) * tile, tex)
        .setOrigin(0.5, 1)
        .setScale(scale)
        .setAlpha(0.72 + rng.float() * 0.2)
        .setDepth(2)
        // Шпили не вращаем, валуны — чуть наклоняем.
        .setAngle(tex === 'rock-d' || tex === 'rock-e' ? 0 : rng.range(-8, 8))
      if (tex !== 'rock-e' && band) {
        const col = Phaser.Display.Color.IntegerToColor(bandColorInt(band)).darken(45)
        img.setTint(col.color)
      }
      nearPlaced++
    }
  }

  /** Шаг 12: лозы с потолков — дышат (sway-твин), плотность по биому. */
  private buildVines(): void {
    const rng = new Rng(hashSeed(this.cave.seed + ':vines'))
    const tile = this.cave.tile
    let placed = 0
    for (let tries = 0; tries < 1600 && placed < 90; tries++) {
      const x = rng.int(this.cave.cols)
      const y = rng.int(this.cave.rows)
      const i = y * this.cave.cols + x
      // Воздух с потолком над ним.
      if (this.cave.solid[i] !== 0) continue
      if (this.cave.solid[i - this.cave.cols] !== 1) continue
      const band = GEN.biomeBands[this.cave.biomes[i]]
      if (!band || rng.float() >= band.vine) continue
      const wx = x * tile + tile / 2 + rng.range(-3, 3)
      const wy = y * tile
      const vine = this.add.image(wx, wy, 'decor-vine')
        .setOrigin(0.5, 0)
        .setDepth(2)
        .setScale(0.8 + rng.float() * 0.7)
      // Покачивание: у каждой лозы своя фаза и амплитуда — пещера дышит.
      const amp = 0.04 + rng.float() * 0.05
      this.tweens.add({
        targets: vine,
        rotation: { from: -amp, to: amp },
        duration: 2200 + rng.int(1800),
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
        delay: rng.int(1800),
      })
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
      // Шаг 18: гало гриба НАД маской тьмы — сияние источника не съедается
      // вуалью: в полной тьме пещеры видны живые огни (еда/путь, гайд §7).
      const glow = this.add.image(x, y - 9, glowTex)
        .setAlpha(LIGHT.halo.mushroom)
        .setScale(0.75)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(LIGHT.halo.depth)
      // Шаг 9: Glow-фильтр на биолюминесценции (высокое качество).
      this.vfx.registerGlow(glow)
      this.mask.add({
        x: () => x,
        y: () => y - 9,
        radius: LIGHT.mushroomLight.radius,
        scaleNow: () => glow.scaleX / 0.8,
        // Шаг 13 (Hidden Deep): каждая лампа мерцает по-своему (детерминировано).
        flicker: (i + 1) * 0.618,
      })

      const sprite = this.add.image(x, y, 'mushroom')
        .setScale(1.4)
        .setTint(band ? bandColorInt(band) : 0x58e6c8)
        .setDepth(2)

      this.tweens.add({
        targets: glow,
        alpha: { from: LIGHT.halo.mushroom * 0.6, to: LIGHT.halo.mushroom * 1.25 },
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
        .setAlpha(LIGHT.halo.nest)
        .setScale(2.4)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setDepth(LIGHT.halo.depth)
      this.mask.add({
        x: () => x,
        y: () => y - 8,
        radius: LIGHT.nestLight.radius,
        scaleNow: () => marker.scaleX / 2.4,
      })
      this.tweens.add({
        targets: marker,
        alpha: { from: LIGHT.halo.nest * 0.55, to: LIGHT.halo.nest * 1.2 },
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
      .setAlpha(LIGHT.halo.gate)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setDepth(LIGHT.halo.depth)
    this.vfx.registerGlow(gateGlow)
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

  /**
   * Шаг 13 (Dead Cells + Hidden Deep): столбы света из трещин в потолке
   * верхней полосы биома. Ищем колонны воздуха с потолком над ними
   * (searchTries попыток), ставим до shafts.count лучей: ADD-спрайт
   * поверх маски тьмы (луч «прорезает» мрак), мягкий свет у пола и
   * медленное покачивание — пещера дышит. Маяк «здесь безопасно».
   */
  private buildLightShafts(): void {
    const cfg = LIGHT.shafts
    const rng = new Rng(hashSeed(this.cave.seed + ':shafts'))
    const tile = this.cave.tile
    const bandCol = bandColorInt(GEN.biomeBands[0])

    let placed = 0
    for (let tries = 0; tries < cfg.searchTries && placed < cfg.count; tries++) {
      const tx = 1 + rng.int(this.cave.cols - 2)
      // Верхняя треть карты — биом 0 (там свет «сверху» ещё логичен).
      const ty = 1 + rng.int(Math.floor(this.cave.rows / 3))
      const i = ty * this.cave.cols + tx
      // Воздух с потолком над ним.
      if (this.cave.solid[i] !== 0) continue
      if (this.cave.solid[i - this.cave.cols] !== 1) continue

      // Меряем высоту воздушной колонны вниз до пола.
      let depth = 0
      while (depth < 20 && this.cave.solid[(ty + depth) * this.cave.cols + tx] === 0) depth++
      if (depth < 6) continue

      const px = tx * tile + tile / 2
      const pyTop = ty * tile
      const heightPx = depth * tile
      const shaft = this.add.image(px, pyTop, 'light-shaft')
        .setOrigin(0.5, 0)
        .setDepth(15)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(bandCol)
        .setAlpha(cfg.alpha)
        // Текстура 96×320: ширина 1:1, высота — по колонне.
        .setScale(1, heightPx / 320)
      // Медленное покачивание луча — свет «льётся», а не приклеен.
      this.tweens.add({
        targets: shaft,
        angle: { from: -cfg.swayDeg, to: cfg.swayDeg },
        duration: cfg.swayMs,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
      // Мягкий свет у пола под лучом (маяк пути) — тоже неровно дышит.
      this.mask.add({
        x: () => px,
        y: () => pyTop + heightPx - 10,
        radius: cfg.lightRadius,
        flicker: (placed + 3) * 1.41,
      })
      placed++
    }
  }

  // ── Шаг 8: геномы — гены, цветки, лунки, уникальные, спутник ──────────────

  /** Постоянные гены (localStorage) применяются к старту каждого забега. */
  private applyGenes(): void {
    for (const id of this.geneSave.genes) {
      const def = GENES.genes.find((g) => g.id === id)
      if (!def) continue
      const e = def.effect
      switch (e.type) {
        case 'maxHp':
          this.vitals.geneMaxHpBonus += e.bonus
          this.vitals.maxHp += e.bonus
          this.vitals.hp += e.bonus
          break
        case 'bite':
          this.vitals.geneBiteBonus += e.bonus
          break
        case 'hungerMax':
          this.vitals.geneHungerMaxBonus += e.bonus
          this.vitals.maxHunger += e.bonus
          this.vitals.hunger += e.bonus
          break
        case 'grip':
          this.creature.mods.wallSlideMult *= e.wallSlideMult
          break
        case 'glow':
          this.sceneMods.lightMult *= e.lightMult
          break
        case 'digest':
          this.vitals.geneDigestMult *= e.mult
          break
        case 'socket':
          this.vitals.mutationSlots += 1
          break
      }
    }
  }

  /** Взвешенный выбор постоянного гена (уже собранные исключаются). */
  private pickWeightedGene(): GeneDef | null {
    const left = GENES.genes.filter((g) => !this.geneSave.genes.includes(g.id))
    if (left.length === 0) return null
    const total = left.reduce((s, g) => s + g.weight, 0)
    let roll = Math.random() * total
    for (const g of left) {
      roll -= g.weight
      if (roll <= 0) return g
    }
    return left[0]
  }

  /** Мутагенные цветки: трогаешь — бросок на забеговую мутацию. */
  private buildMutagenFlowers(): void {
    const rng = new Rng(hashSeed(this.cave.seed + ':flowers'))
    const tile = this.cave.tile
    let placed = 0
    for (let tries = 0; tries < 900 && placed < 6; tries++) {
      const tx = rng.int(this.cave.cols)
      const ty = rng.int(this.cave.rows)
      if (this.cave.solid[ty * this.cave.cols + tx] !== 0) continue
      if (this.cave.solid[(ty + 1) * this.cave.cols + tx] !== 1) continue
      // Цветок растёт на полу, не рядом со входом.
      if (Math.abs(tx - this.cave.entrance.x) < 8 && Math.abs(ty - this.cave.entrance.y) < 8) continue
      const x = tx * tile + tile / 2
      const y = (ty + 1) * tile - 8
      const glow = this.add.image(x, y - 6, 'glow-purple')
        .setDepth(LIGHT.halo.depth)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(LIGHT.halo.flower)
        .setScale(0.7)
      const img = this.add.image(x, y, 'mutation-gem')
        .setDepth(2)
        .setTint(0xa8e34f)
        .setScale(0.8)
      this.tweens.add({
        targets: glow,
        alpha: { from: LIGHT.halo.flower * 0.55, to: LIGHT.halo.flower * 1.25 },
        scale: { from: 0.6, to: 0.85 },
        duration: 1500 + placed * 130,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
      this.flowers.push({ img, glow, x, y, used: false })
      placed++
    }
  }

  /** Ген-лунки (шаг 8): глубокие биомы — постоянные гены. */
  private buildGenePools(): void {
    const rng = new Rng(hashSeed(this.cave.seed + ':pools'))
    const tile = this.cave.tile
    const deepTy = Math.floor(this.cave.rows * 0.55)
    let placed = 0
    for (let tries = 0; tries < 1200 && placed < 2; tries++) {
      const tx = rng.int(this.cave.cols)
      const ty = deepTy + rng.int(this.cave.rows - deepTy)
      if (ty >= this.cave.rows - 1) continue
      if (this.cave.solid[ty * this.cave.cols + tx] !== 0) continue
      if (this.cave.solid[(ty + 1) * this.cave.cols + tx] !== 1) continue
      const x = tx * tile + tile / 2
      const y = (ty + 1) * tile - 10
      for (let k = 0; k < 3; k++) {
        const gem = this.add.image(x + (k - 1) * 7, y - (k % 2) * 4, 'mutation-gem')
          .setDepth(2)
          .setTint(0xe8a34f)
          .setScale(0.9 + (k === 1 ? 0.25 : 0))
        this.tweens.add({
          targets: gem,
          scaleY: { from: 1.0, to: 1.12 },
          duration: 1100 + k * 240,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.InOut',
        })
      }
      const glow = this.add.image(x, y - 4, 'glow-purple')
        .setDepth(LIGHT.halo.depth)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setAlpha(LIGHT.halo.pool)
        .setScale(1.2)
      this.tweens.add({
        targets: glow,
        alpha: { from: LIGHT.halo.pool * 0.55, to: LIGHT.halo.pool * 1.25 },
        scale: { from: 1.05, to: 1.4 },
        duration: 1600,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.InOut',
      })
      this.genePoolGlow.push(glow)
      this.genePools.push({ x, y, used: false })
      placed++
    }
  }

  /** Уникальные мобы: элита у глубоких гнёзд — несёт постоянный ген. */
  private spawnElites(): void {
    const rng = new Rng(hashSeed(this.cave.seed + ':elites'))
    const deepNests = this.cave.nests.filter((n) => n.biome >= 2)
    let elites = 0
    for (const nest of deepNests) {
      if (elites >= 2) break
      if (!rng.chance(0.45)) continue
      const tile = this.cave.tile
      const wx = nest.tx * tile + tile / 2
      const wy = nest.ty * tile + tile / 2 - 10
      const enemy = this.addEnemyAt(this.pickSpeciesForBiome(nest.biome, rng), wx, wy)
      if (!enemy) continue
      enemy.makeElite()
      if (enemy.eliteGlowRef) this.vfx.registerGlow(enemy.eliteGlowRef)
      elites++
    }
  }

  /** Геном-кристалл из уникального моба: подбери — ген навсегда. */
  private dropGenePickup(x: number, y: number): void {
    const def = this.pickWeightedGene()
    if (!def) return
    const color = 0xe8a34f
    const img = this.add.image(x, y - 4, 'mutation-gem')
      .setDepth(3)
      .setTint(color)
      .setScale(1.5)
    const twin = this.add.image(x, y - 4, 'mutation-gem')
      .setDepth(15)
      .setTint(color)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.2)
      .setScale(1.5)
    this.tweens.add({
      targets: [img, twin],
      scaleX: { from: 1.3, to: 1.7 },
      scaleY: { from: 1.7, to: 1.3 },
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.InOut',
    })
    this.genePickups.push({ img, twin, geneId: def.id })
  }

  /** Трогаешь геном-кристалл/лунку — ген записывается в localStorage. */
  private grantGeneAt(def: GeneDef, x: number, y: number): void {
    if (!grantGene(def.id, this.geneSave)) return
    // Шаг 11: геном попадает и в коллекцию Гнезда (счётчик копий).
    collectGenome(def.id)
    // Шаг 10: золотой геном — свой звук (гайд: «легендарный геном — событие»).
    this.audio.play('gene')
    this.genesGained.push(def.id)
    if (def.effect.type === 'socket') this.vitals.mutationSlots += 1
    this.mutations.slots = this.vitals.mutationSlots
    const color = '#e8a34f'
    const flash = this.add.image(x, y, 'glow-purple')
      .setDepth(16)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(0.5)
      .setAlpha(0.85)
    this.tweens.add({
      targets: flash,
      scale: 2.4,
      alpha: 0,
      duration: 460,
      onComplete: () => flash.destroy(),
    })
    this.showGeneBanner(def, color)
    this.cameras.main.flash(220, 232, 163, 79)
  }

  /** Баннер постоянного гена (отдельный от мутаций — золотой). */
  private showGeneBanner(def: GeneDef, color: string): void {
    const { width } = this.scale
    const c = this.add.container(width / 2, 64).setDepth(26)
    // Шаг 20: баннеры — экранным слоем (твин y:78 внутри uiRoot = экранные px).
    uiAttach(this, c)
    const bg = this.add.rectangle(0, 0, 360, 56, 0x0b0b10, 0.86)
      .setStrokeStyle(1, 0xe8a34f)
    const title = this.add.text(0, -14, `ПОСТОЯННЫЙ ГЕН · ${def.name.toUpperCase()}`, {
      fontFamily: 'monospace',
      fontSize: '14px',
      fontStyle: 'bold',
      color,
    }).setOrigin(0.5)
    const desc = this.add.text(0, 10, `${def.desc} — переживёт смерть`, {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#E8E6E3',
    }).setOrigin(0.5)
    c.add([bg, title, desc])
    c.setAlpha(0)
    this.tweens.add({ targets: c, alpha: 1, y: 78, duration: 260, ease: 'Cubic.Out' })
    this.time.delayedCall(2800, () => {
      this.tweens.add({
        targets: c,
        alpha: 0,
        y: 60,
        duration: 300,
        onComplete: () => c.destroy(),
      })
    })
  }

    /**
   * Шаг 20: аэро-джус существа (пожелание игрока: «тонкий иллюминесцентный
   * шлейф от крыльев, прям пару частиц + взмахи»).
   *
   * (1) Вход в планирование — один мягкий взмах вниз.
   * (2) В полёте при заметной скорости — крупица биолюм-пыли раз в
   *     aero.wingTrail.everyMs за спиной: на экране одновременно ~5
   *     крупинок 3px — ТОНКО, не поток (шаг 19 научил: крылья не должны
   *     читатья «слишком яркими»).
   * На земле и на сцепе — тишина: пыль только у ЛЕТЯЩЕГО существа.
   */
  private updateAero(time: number): void {
    if (this.dying || !this.vitals.alive) return
    const st = this.creature.getState()
    if (st === 'glide' && this.prevAeroState !== 'glide') {
      this.vfx.wingSweep(this.creature.x, this.creature.y + 4, 0.8)
    }
    this.prevAeroState = st
    if (st === 'ground' || st === 'wall-cling') return
    const body = this.creature.body as Phaser.Physics.Arcade.Body
    const fast = st === 'glide'
      || Math.abs(body.velocity.x) > 30
      || Math.abs(body.velocity.y) > 40
    if (!fast || time < this.wingTrailNextAt) return
    this.wingTrailNextAt = time + VFX.aero.wingTrail.everyMs
    this.vfx.wingTrailTick(this.creature.x - this.creature.facing * 12, this.creature.y + 2)
  }

  /** Спутник «Короны Матки»: побеждённый мелкий моб встаёт в свиту. */
  private spawnCompanion(x: number, y: number): void {
    if (this.companion) return
    this.companion = new Companion(this, x, y, {
      playerX: () => this.creature.x,
      playerY: () => this.creature.y,
      enemies: () => this.enemies,
      onCompanionBite: (victim, applied) => {
        this.blood.burst(victim.x, victim.y, { count: 8, dirDeg: 90, spreadDeg: 360 })
        this.blood.number(victim.x, victim.y - 14, `${applied}`, '#D8B4FF')
      },
    })
    this.physics.add.collider(this.companion, this.tileLayers!.solid)
  }

  /** Обновление цветков/лунок/кристаллов/спутника (шаг 8). */
  private updateGenomes(time: number): void {
    const px = this.creature.x
    const py = this.creature.y

    for (const f of this.flowers) {
      if (f.used) continue
      if (Math.abs(f.x - px) < 22 && Math.abs(f.y - py) < 26) {
        f.used = true
        this.mutations.rollDrop(f.x, f.y - 6)
        this.tweens.add({ targets: [f.img, f.glow], alpha: 0.12, scale: 0.6, duration: 500 })
        this.eco.ring(f.x, f.y, '#a8e34f', 0.5)
      }
    }

    for (let i = this.genePools.length - 1; i >= 0; i--) {
      const p = this.genePools[i]
      if (p.used) continue
      if (Math.abs(p.x - px) < 24 && Math.abs(p.y - py) < 30) {
        const def = this.pickWeightedGene()
        p.used = true
        if (def) this.grantGeneAt(def, p.x, p.y)
        this.tweens.add({ targets: this.genePoolGlow[i], alpha: 0.08, duration: 600 })
      }
    }

    for (let i = this.genePickups.length - 1; i >= 0; i--) {
      const g = this.genePickups[i]
      if (Math.abs(g.img.x - px) < 22 && Math.abs(g.img.y - py) < 26) {
        const def = GENES.genes.find((gn) => gn.id === g.geneId)
        if (def) this.grantGeneAt(def, g.img.x, g.img.y)
        g.img.destroy()
        g.twin.destroy()
        this.genePickups.splice(i, 1)
      }
    }
    void time

    if (this.companion) {
      this.companion.update(this.time.now, this.game.loop.delta, this.mask.playerRadius(this.time.now))
    }
  }

  /** Телепорт существа (хук верификации и геномные переходы). */
  private teleportPlayer(x: number, y: number): void {
    // Шаг 12: телепорт сбрасывает сцеп со стены (гравитация назад).
    this.creature.forceUncling()
    // body.reset — каноничный телепорт Arcade-тела: setPosition двигает
    // только спрайт, а postUpdate возвращал тело на старое место
    // (грабля поймана в верификации карабканья, шаг 12).
    const b = this.creature.body as Phaser.Physics.Arcade.Body
    b.reset(x, y)
  }

  /** Состав популяции «вид×N» для debug-оверлея. */
  private ecoPopulation(): string {
    const counts = new Map<string, number>()
    for (const e of this.enemies) {
      if (e.dead) continue
      counts.set(e.speciesId, (counts.get(e.speciesId) ?? 0) + 1)
    }
    return [...counts.entries()].map(([id, n]) => `${id}×${n}`).join(' ') || '—'
  }

  /** Крючки для верификации (agent-browser) — шаг 6+7. */
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
        target: e.targetLabel,
        nest: e.nestIndex,
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
        if (best) best.takeDamage(9999, this.creature.facing, 0, 'physical', 'player')
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
        grant: (id: string) => {
          const def = MUTATIONS.pool.find((m) => m.id === id)
          if (!def) return false
          this.mutations.grantForTest(def)
          return true
        },
      },
      // ── Экосистема шага 7 ─────────────────────────────────────────────
      eco: {
        stats: () => ({ ...this.eco.counters }),
        population: () => this.ecoPopulation(),
        nests: () => this.eco.nests.map((n) => ({ index: n.index, tx: n.tx, ty: n.ty, biome: n.biome, respawnAt: n.respawnAt })),
        /** Заспавнить вид рядом с игроком (верификация ролей/атак). */
        spawnAt: (speciesId: string, dx = 90, dy = -20) => {
          const e = this.addEnemyAt(speciesId, this.creature.x + dx, this.creature.y + dy)
          return e ? { x: Math.round(e.x), y: Math.round(e.y) } : null
        },
        /** Проверка брони: урон по ближайшему мобу заданным типом. */
        hitNearest: (amount: number, type: 'physical' | 'acid' | 'fire') => {
          let best: Enemy | null = null
          let bestD = Infinity
          for (const e of this.enemies) {
            const d = Phaser.Math.Distance.Between(e.x, e.y, this.creature.x, this.creature.y)
            if (d < bestD) {
              best = e
              bestD = d
            }
          }
          if (!best) return null
          const applied = best.takeDamage(amount, 1, 0, type, 'player')
          return { id: best.speciesId, applied, dead: best.dead }
        },
        /** Ранить ближайшего моба до доли HP (проверка бегства/свёртки). */
        woundNearest: (ratio: number) => {
          let best: Enemy | null = null
          let bestD = Infinity
          for (const e of this.enemies) {
            const d = Phaser.Math.Distance.Between(e.x, e.y, this.creature.x, this.creature.y)
            if (d < bestD) {
              best = e
              bestD = d
            }
          }
          best?.debugWound(ratio)
          return best ? { id: best.speciesId, hp: best.hp, state: best.aiState } : null
        },
        /** Огненная лужа под ногами игрока (проверка горения без ожидания ползуна). */
        fireAtPlayer: () => {
          this.fire.spawn(this.creature.x + 12, this.creature.y)
          return this.fire.activeCount
        },
        flowers: () => this.flowers.map((f) => ({ x: Math.round(f.x), y: Math.round(f.y), used: f.used })),
        pools: () => this.genePools.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), used: p.used })),
        elites: () => this.enemies.filter((e) => e.elite && !e.dead).map((e) => ({ id: e.speciesId, x: Math.round(e.x), y: Math.round(e.y), hp: e.hp })),
        genePickups: () => this.genePickups.map((g) => ({ id: g.geneId, x: Math.round(g.img.x) })),
        genesSave: () => this.geneSave,
        /** Телепорт к цветку (верификация подбора мутации). */
        gotoFlower: () => {
          const f = this.flowers.find((q) => !q.used)
          if (!f) return null
          this.teleportPlayer(f.x, f.y - 10)
          return { x: f.x, y: f.y }
        },
        /** Телепорт к ген-лунке (верификация постоянного гена). */
        gotoPool: () => {
          const p = this.genePools.find((q) => !q.used)
          if (!p) return null
          this.teleportPlayer(p.x, p.y - 10)
          return { x: p.x, y: p.y }
        },
        /** Телепорт к уникальному мобу. */
        gotoElite: () => {
          const e = this.enemies.find((q) => q.elite && !q.dead)
          if (!e) return null
          this.teleportPlayer(e.x - 40, e.y)
          return { id: e.speciesId, hp: e.hp }
        },
        /** Выстрел жнеца у игрока (проверка спор без ожидания). */
        sporesAtPlayer: () => {
          const reaper = this.addEnemyAt('reaper', this.creature.x + 150, this.creature.y - 40)
          if (!reaper) return false
          this.spores.fireFrom(reaper, this.creature.x, this.creature.y)
          return true
        },
      },
      quality: {
        level: () => QUALITY.level,
        toggle: () => QUALITY.toggle(),
      },
      // Шаг 10: верификация звука.
      audio: {
        state: () => this.audio.state(),
        play: (name: string) => this.audio.play(name),
        setMusic: (v: number) => this.audio.setMusicVol(v),
        setSfx: (v: number) => this.audio.setSfxVol(v),
      },
      // ── Шаг 12: верификация переноса забега и карабканья ──────────────
      /** Твёрдая ли клетка (для поиска стены в тесте цепляния). */
      solidAt: (tx: number, ty: number) => this.cave.solid[ty * this.cave.cols + tx] === 1,
      /** Телепорт к вратам (проверка переноса роста/съеденных на слой ниже). */
      gotoExit: () => {
        const t = this.cave.tile
        const x = this.cave.exit.x * t + t / 2
        const y = this.cave.exit.y * t + t / 2
        this.teleportPlayer(x, y - 20)
        return { x, y }
      },
      /** Выдать мутацию по id (проверка тихого восстановления на новом слое). */
      grantMutation: (id: string) => {
        const def = MUTATIONS.pool.find((m) => m.id === id)
        if (!def) return null
        this.mutations.grantForTest(def)
        return { id: def.id, owned: this.mutations.ownedCount }
      },
      /** Список id мутаций забега. */
      mutationIds: () => [...this.mutations.ownedList.map((m) => m.id)],
      /** Мобов живых сейчас (проверка плотности шага 12). */
      aliveEnemies: () => this.enemies.length,
      dying: () => this.dying,
    }
  }
}

// ── Шаг 12: цветовые хелперы тонировки параллакса ─────────────────────────

/** Смешать белый с цветом биома: доля strength цвета в результате. */
function mixWhiteToward(white: number, color: number, strength: number): number {
  const wr = (white >> 16) & 0xff, wg = (white >> 8) & 0xff, wb = white & 0xff
  const cr = (color >> 16) & 0xff, cg = (color >> 8) & 0xff, cb = color & 0xff
  const r = Math.round(wr + (cr - wr) * strength)
  const g = Math.round(wg + (cg - wg) * strength)
  const b = Math.round(wb + (cb - wb) * strength)
  return (r << 16) | (g << 8) | b
}

/** Плавный переход цвета: k — доля пути за кадр (0..1). */
function lerpColorInt(from: number, to: number, k: number): number {
  if (from === to) return from
  const fr = (from >> 16) & 0xff, fg = (from >> 8) & 0xff, fb = from & 0xff
  const tr = (to >> 16) & 0xff, tg = (to >> 8) & 0xff, tb = to & 0xff
  const r = Math.round(fr + (tr - fr) * k)
  const g = Math.round(fg + (tg - fg) * k)
  const b = Math.round(fb + (tb - fb) * k)
  return (r << 16) | (g << 8) | b
}
