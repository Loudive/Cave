import Phaser from 'phaser'
import { EXPEDITION } from '../config/expedition'
import { GEN } from '../config/gen'
import { biomeIndexAtMeters } from '../gen/cave'
import type { CaveData } from '../gen/cave'
import type { DarknessMask, LightSource } from './DarknessMask'
import type { Enemy } from '../entities/Enemy'
import { hexInt } from '../config/light'
import { QUALITY } from './quality'

/**
 * Expedition — шаг 26: люди с поверхности (заказ игрока).
 *
 * «Экспедиции периодически пробираются для изучения пещер: учёные
 * убегают, военные стреляют». Директор волн: через firstAfterMs после
 * старта слоя (и дальше каждые intervalMs, пока предыдущий отряд не
 * выбит/не сбежал) у ВХОДА слоя спускается отряд. Состав — по полосе
 * биома игрока (глубже — тяжелее конвой; сами люди усиливаются
 * depthScale, как все мобы).
 *
 * Поведение людей — обычный FSM Enemy (учёный = prey → паника и бегство;
 * военный = hunter + shoot → трассеры Bullets, керит задом). Отряд
 * МАРШИРУЕТ к игроку (Enemy.marchTo), учёный, испугавшись раз,
 * возвращается ко входу и УХОДИТ на поверхность («убежал» — образцы
 * потеряны, перехватывай вовремя). Каждый человек — тёплый фонарь
 * (дыра в маске + гало над маской): экспедицию видно издали сквозь
 * мрак, и она видит тебя. Все числа — expedition.json.
 */

export interface ExpeditionHooks {
  /** Создать человека (сцена соблюдает потолки; force — мимо общего капа). */
  spawnHuman: (speciesId: string, x: number, y: number, force: boolean) => Enemy | null
  /** Баннер «экспедиция с поверхности» (uiRoot, тёплый). */
  banner: (text: string) => void
  /** Учёный сбежал через вход (кольцо «убежал»). */
  onEscape: (e: Enemy) => void
  /** Счётчики для debug/верификации. */
  onSquad: (size: number) => void
}

interface HumanSlot {
  enemy: Enemy
  light: LightSource | null
  glow: Phaser.GameObjects.Image | null
  scaredOnce: boolean
  /** Ушёл от входа вглубь (побег засчитывается только после «рейса туда-обратно»).
   *  РАКЕША ТЕСТА: без флага учёные, заспавнившись у входа рядом с игроком,
   *  мгновенно «убегали» (спавн-точка и так в зоне побега). */
  leftSpawn: boolean
}

export interface ExpeditionCounters {
  squads: number
  escaped: number
  killedByPlayer: number
}

export class Expedition {
  readonly counters: ExpeditionCounters = { squads: 0, escaped: 0, killedByPlayer: 0 }
  private squad: HumanSlot[] = []
  private nextSquadAt: number
  private retargetAt = 0

  constructor(
    private scene: Phaser.Scene,
    private cave: CaveData,
    private mask: DarknessMask,
    private hooks: ExpeditionHooks,
  ) {
    const [lo, hi] = EXPEDITION.timing.firstAfterMs
    this.nextSquadAt = scene.time.now + Phaser.Math.Between(lo, hi)
  }

  /** Тест-хук (agent-browser): немедленно спустить экспедицию. */
  forceNextIn(ms = 0): void {
    this.nextSquadAt = this.scene.time.now + ms
  }

  /** Живые люди отряда (для марша и потолка). */
  private alive(): HumanSlot[] {
    return this.squad.filter((s) => !s.enemy.dead)
  }

  /** Вызывать из scene.update, когда мир НЕ заморожен. */
  update(time: number, playerX: number, playerY: number, playerAlive: boolean): void {
    // Свет и гало следуют за людьми; мёртвых — убрать.
    for (const s of this.squad) {
      if (s.enemy.dead) {
        this.dropLight(s)
        continue
      }
      if (s.glow) s.glow.setPosition(s.enemy.x, s.enemy.y - 4)
    }
    if (this.squad.length > 0 && this.alive().length === 0) {
      this.squad = []
    }

    if (time < this.nextSquadAt) return
    const [lo, hi] = EXPEDITION.timing.intervalMs
    this.nextSquadAt = time + Phaser.Math.Between(lo, hi)
    // Одна волна за раз: пока отряд жив — новых нет (событие, не толпа).
    if (this.alive().length > 0) return
    if (!playerAlive) return
    this.spawnSquad(time, playerX, playerY)
  }

  private spawnSquad(time: number, playerX: number, playerY: number): void {
    const cfg = EXPEDITION
    if (this.alive().length >= cfg.timing.maxAliveHumans) return

    // Состав — по полосе биома ИГРОКА (пришли изучать его глубину).
    const tile = this.cave.tile
    const band = this.bandOfPlayer(playerY)
    const roster = cfg.squads.byBand[band] ?? cfg.squads.byBand[0]

    // Спавн у входа слоя (люди приходят «с поверхности»).
    const ent = this.cave.entrance
    const spawnX = ent.x * tile + tile / 2
    const spawnY = ent.y * tile + tile / 2 - 6

    let placed = 0
    for (let i = 0; i < roster.length && placed < cfg.timing.maxAliveHumans; i++) {
      const id = roster[i]
      const x = spawnX + (i - (roster.length - 1) / 2) * 18
      const e = this.hooks.spawnHuman(id, x, spawnY - 4, true)
      if (!e) continue
      // Марш-цель: позиция игрока (дрожь — не снайперы, а разведка).
      e.marchTo = { x: playerX, y: playerY }
      const slot: HumanSlot = { enemy: e, light: null, glow: null, scaredOnce: false, leftSpawn: false }
      this.attachLight(slot)
      this.squad.push(slot)
      placed++
    }

    if (placed > 0) {
      const [rlo, rhi] = cfg.march.retargetMs
      this.retargetAt = time + Phaser.Math.Between(rlo, rhi)
      this.counters.squads++
      this.hooks.banner(cfg.rewards.banner)
      this.hooks.onSquad(placed)
    }
  }

  /** Полоса биома по вертикали игрока (глубже конвой — тяжелее). */
  private bandOfPlayer(playerY: number): number {
    const meters = this.cave.depthOffsetMeters + playerY * GEN.map.metersPerPixel
    return biomeIndexAtMeters(Math.max(0, meters))
  }

  /** Тёплый фонарь: дыра в маске + гало над маской (видно издали). */
  private attachLight(slot: HumanSlot): void {
    const cfg = EXPEDITION.light
    slot.light = this.mask.add({
      x: () => slot.enemy.x,
      y: () => slot.enemy.y - 4,
      radius: cfg.radius,
    })
    if (QUALITY.level !== 'low') {
      slot.glow = this.scene.add.image(slot.enemy.x, slot.enemy.y - 4, 'glow-red')
        .setDepth(14.2)
        .setBlendMode(Phaser.BlendModes.ADD)
        .setTint(hexInt(cfg.lampColor))
        .setAlpha(cfg.glowAlpha)
        .setScale(cfg.glowScale)
    }
  }

  private dropLight(slot: HumanSlot): void {
    if (slot.light) {
      this.mask.remove(slot.light)
      slot.light = null
    }
    if (slot.glow) {
      slot.glow.destroy()
      slot.glow = null
    }
  }

  /**
   * Тик отряда (сцена вызывает после Enemy.update всех): марш-цели,
   * паника учёных, побег ко входу. Счёт «убит игроком» ведёт сцена
   * (handleEnemyDeath), здесь — только «убежал».
   */
  tick(time: number, playerX: number, playerY: number): void {
    if (this.squad.length === 0) return
    const cfg = EXPEDITION
    const tile = this.cave.tile
    const entX = this.cave.entrance.x * tile + tile / 2
    const entY = this.cave.entrance.y * tile + tile / 2
    const escapeR = cfg.panic.escapeRadiusTiles * tile

    if (time >= this.retargetAt) {
      const [rlo, rhi] = cfg.march.retargetMs
      this.retargetAt = time + Phaser.Math.Between(rlo, rhi)
      const jx = Phaser.Math.Between(-cfg.march.jitterTiles, cfg.march.jitterTiles) * tile
      for (const s of this.alive()) {
        // Испуганный учёный уже не разведчик: его маршрут — ВЫХОД.
        if (s.scaredOnce && s.enemy.speciesId === 'scientist') continue
        s.enemy.marchTo = { x: playerX + jx, y: playerY }
      }
    }

    for (const s of this.alive()) {
      const e = s.enemy
      const dEnt = Phaser.Math.Distance.Between(e.x, e.y, entX, entY)
      // «Рейс» к поверхности: сначала уйти от входа (иначе спавн у входа
      // считался бы побегом), потом вернуться — только тогда учёный ушёл.
      if (!s.leftSpawn && dEnt > escapeR * 2) s.leftSpawn = true
      // Учёный увидел угрозу → с этого момента его путь — поверхность.
      if (e.speciesId === 'scientist' && !s.scaredOnce && e.aiState === 'flee') {
        s.scaredOnce = true
      }
      if (s.scaredOnce && e.speciesId === 'scientist') {
        e.marchTo = { x: entX, y: entY }
        // Вернулся ко входу ПОСЛЕ вылазки — ушёл на поверхность.
        if (s.leftSpawn && dEnt < escapeR) {
          this.counters.escaped++
          this.dropLight(s)
          this.hooks.onEscape(e)
          e.dead = true
          e.stateName = 'dead'
          e.destroy() // тихий деспавн: спрайт неактивен → сцена вычистит из списка
        }
      }
    }
  }

  destroy(): void {
    for (const s of this.squad) this.dropLight(s)
    this.squad = []
  }
}
