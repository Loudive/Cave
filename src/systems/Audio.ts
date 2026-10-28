import Phaser from 'phaser'
import { AUDIO, loadAudioSave, saveAudioSave, type AudioSave } from '../config/audio'
import {
  renderPreset, renderHumLoop, renderDripsLoop, renderCombatLoop, renderDepthLoop,
  toWavDataUri,
} from './sfxr'

/**
 * AudioSystem — шаг 10: звук и музыка (гайд: «Звук делает половину атмосферы»).
 *
 * Все звуки СИНТЕЗИРУЮТСЯ в браузере по пресетам из audio.json
 * (jsfxr-подход) и грузятся как WAV dataURI — ноль аудиофайлов.
 *
 * Структура (по гайду):
 *  - Эмбиент: гул пещеры + капли — зациклены всегда (после первого жеста).
 *  - Музыка: слой боя (кроссфейд в драке) + слой глубины (кроссфейд
 *    глубже 600 м) — громкости плавно едут к цели каждый кадр.
 *  - SFX: укус, чавканье, боль, смерть моба, рык уникального,
 *    сердцебиение при низком HP (+ служебные: панцирь, подборы, UI).
 *  - Громкости music/sfx настраиваются в меню, живут в localStorage.
 *
 * Дешево в кадре: только присваивание volume при изменении >0.005 и
 * троттлинг однотипных звуков (minGapMs) — ноль аллокаций.
 */

/** Синтез всех пресетов → Float32 PCM (лениво, один раз за сессию). */
const pcmRegistry = new Map<string, Float32Array>()

export function generatedAudioPcm(): Map<string, Float32Array> {
  if (pcmRegistry.size > 0) return pcmRegistry
  const sr = AUDIO.sampleRate
  pcmRegistry.set(AUDIO.ambient.hum.key, renderHumLoop(AUDIO.music.hum, sr))
  pcmRegistry.set(AUDIO.ambient.drips.key, renderDripsLoop(AUDIO.music.drips, sr))
  pcmRegistry.set(AUDIO.layers.combat.key, renderCombatLoop(AUDIO.music.combat, sr))
  pcmRegistry.set(AUDIO.layers.depth.key, renderDepthLoop(AUDIO.music.depth, sr))
  // Ключи SFX = префикс sfx- + имя пресета (_doc-поле пропускаем).
  for (const [name, def] of Object.entries(AUDIO.sfx)) {
    if (name.startsWith('_')) continue
    pcmRegistry.set(`sfx-${name}`, renderPreset(def.preset, sr))
  }
  return pcmRegistry
}

/**
 * Положить синтезированные звуки в кэш (BootScene).
 * WebAudio: AudioBuffer создаётся НАПРЯМУЮ из Float32 (createBuffer +
 * copyToChannel) — синхронно и без decodeAudioData (заметка шага 10:
 * декодирование WAV, выданное в момент загрузки страницы, в части
 * браузеров зависает навсегда — промисы не разрешаются).
 * HTML5-фолбэк: WAV dataURI как src для <audio>.
 */
export function installGeneratedAudio(scene: Phaser.Scene): void {
  const cache = scene.cache.audio
  const mgr = scene.sound as Phaser.Sound.WebAudioSoundManager
  const pcm = generatedAudioPcm()
  if (mgr.context) {
    const ctx = mgr.context
    for (const [key, samples] of pcm) {
      if (cache.exists(key)) continue
      const ab = ctx.createBuffer(1, samples.length, AUDIO.sampleRate)
      // set вместо copyToChannel: без генерик-трения TS 5.7 по ArrayBufferLike.
      ab.getChannelData(0).set(samples)
      cache.add(key, ab)
    }
  } else {
    for (const [key, samples] of pcm) {
      if (!cache.exists(key)) cache.add(key, toWavDataUri(samples, AUDIO.sampleRate))
    }
  }
}

interface LoopState {
  sound: Phaser.Sound.BaseSound | null
  /** Текущая громкость (фактическая). */
  vol: number
  /** Целевая громкость (к ней едет кроссфейд). */
  target: number
  /** Базовый множитель слоя (без music-громкости). */
  gain: number
}

export class AudioSystem {
  private scene: Phaser.Scene
  private save: AudioSave
  private loops: Record<'hum' | 'drips' | 'combat' | 'depth', LoopState>
  private heartbeat: Phaser.Sound.BaseSound | null = null
  private lastPlayed = new Map<string, number>()
  /** Слой боя активен до этого времени (гистерезис). */
  private combatUntil = 0
  /** Текущая громкость сердцебиения (меняем только при сдвиге). */
  private hbVol = -1
  private hbRate = -1

  constructor(scene: Phaser.Scene) {
    this.scene = scene
    this.save = loadAudioSave()
    const mk = (gain: number): LoopState => ({ sound: null, vol: -1, target: 0, gain })
    this.loops = {
      hum: mk(AUDIO.ambient.hum.gain),
      drips: mk(AUDIO.ambient.drips.gain),
      combat: mk(AUDIO.layers.combat.target),
      depth: mk(AUDIO.layers.depth.target),
    }
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.stopAll())
  }

  /** Громкости (для ползунков меню). */
  get volumes(): AudioSave {
    return { ...this.save }
  }

  setMusicVol(v: number): void {
    this.save.music = Phaser.Math.Clamp(v, 0, 1)
    saveAudioSave(this.save)
    // Цели пересчитаются в update(); петли уже созданы — двигаем сразу.
    if (this.loops.hum.sound) this.loops.hum.target = this.loops.hum.gain * this.save.music
    if (this.loops.drips.sound) this.loops.drips.target = this.loops.drips.gain * this.save.music
  }

  setSfxVol(v: number): void {
    this.save.sfx = Phaser.Math.Clamp(v, 0, 1)
    saveAudioSave(this.save)
  }

  /**
   * Запустить эмбиент-петли. Вызывать после пользовательского жеста
   * (автоплей-политика браузеров; Phaser сам ставит в очередь до unlock).
   */
  ensureAmbient(): void {
    if (this.loops.hum.sound) return
    const start = (key: string, st: LoopState): void => {
      if (!this.scene.cache.audio.exists(key)) return
      st.sound = this.scene.sound.add(key, { loop: true, volume: 0 })
      st.target = st.gain * this.save.music
      ;(st.sound as Phaser.Sound.WebAudioSound).play()
    }
    start(AUDIO.ambient.hum.key, this.loops.hum)
    start(AUDIO.ambient.drips.key, this.loops.drips)
  }

  /** Проиграть SFX с троттлингом и лёгким разбегом высоты. */
  play(name: string, volMult = 1): void {
    const def = AUDIO.sfx[name]
    if (!def) return
    const now = this.scene.time.now
    const last = this.lastPlayed.get(name) ?? -Infinity
    if (now - last < def.minGapMs) return
    this.lastPlayed.set(name, now)
    const key = `sfx-${name}`
    if (!this.scene.cache.audio.exists(key)) return
    const jitter = 1 + (Math.random() * 2 - 1) * AUDIO.rateJitter
    this.scene.sound.play(key, { volume: def.preset.volume * this.save.sfx * volMult, rate: jitter })
  }

  /**
   * Кадровый апдейт: кроссфейд слоёв, сердцебиение.
   * @param combatActive сейчас идёт угроза (погоня/замах/укус игрока)
   * @param depthMeters текущая глубина в метрах
   * @param heartbeat 0..1 — тревога (низкий HP/голод)
   */
  update(time: number, dtMs: number, combatActive: boolean, depthMeters: number, heartbeat: number): void {
    // Страховка: если кэш вдруг пуст (нестандартный порядок загрузки),
    // AudioBuffer создаются синхронно — можно дёргать из кадра.
    if (!this.scene.cache.audio.exists(AUDIO.ambient.hum.key)) {
      installGeneratedAudio(this.scene)
    }
    // Эмбиент стартует, как только буферы появились в кэше.
    if (!this.loops.hum.sound && this.scene.cache.audio.exists(AUDIO.ambient.hum.key)) {
      this.ensureAmbient()
    }
    // Гистерезис боя: слой держится после последней угрозы.
    if (combatActive) this.combatUntil = time + AUDIO.layers.combat.combatHoldMs
    const combatOn = time < this.combatUntil
    const depthOn = depthMeters > AUDIO.layers.depthThresholdMeters

    // Ленивый старт слоёв: боевой/глубинный петли создаются в первый
    // раз, когда нужны (до этого — ноль Cost на жанр тишины).
    const ensureLayer = (st: LoopState, key: string): void => {
      if (st.sound || !this.scene.cache.audio.exists(key)) return
      st.sound = this.scene.sound.add(key, { loop: true, volume: 0 })
      ;(st.sound as Phaser.Sound.WebAudioSound).play()
      st.vol = 0
    }
    if (combatOn) ensureLayer(this.loops.combat, AUDIO.layers.combat.key)
    if (depthOn) ensureLayer(this.loops.depth, AUDIO.layers.depth.key)

    const music = this.save.music
    const lc = AUDIO.layers
    this.loops.combat.target = combatOn ? lc.combat.target * music : 0
    this.loops.depth.target = depthOn ? lc.depth.target * music : 0
    if (this.loops.hum.sound) this.loops.hum.target = this.loops.hum.gain * music
    if (this.loops.drips.sound) this.loops.drips.target = this.loops.drips.gain * music

    // Кроссфейд: линейное движение к цели за fadeUp/fadeDown.
    const fadeLoop = (st: LoopState, upMs: number, downMs: number): void => {
      if (!st.sound) return
      const span = st.target > st.vol ? upMs : downMs
      if (span <= 0) {
        st.vol = st.target
      } else {
        const k = Math.min(1, dtMs / span)
        st.vol += (st.target - st.vol) * k
      }
      if (Math.abs(st.vol - (st.sound as Phaser.Sound.WebAudioSound).volume) > 0.005) {
        ;(st.sound as Phaser.Sound.WebAudioSound).setVolume(st.vol)
      }
    }
    fadeLoop(this.loops.hum, 400, 400)
    fadeLoop(this.loops.drips, 400, 400)
    fadeLoop(this.loops.combat, AUDIO.layers.combat.fadeUpMs, AUDIO.layers.combat.fadeDownMs)
    fadeLoop(this.loops.depth, AUDIO.layers.depth.fadeUpMs, AUDIO.layers.depth.fadeDownMs)

    // Сердцебиение: громкость и темп от уровня тревоги.
    if (heartbeat > 0.02) {
      if (!this.heartbeat && this.scene.cache.audio.exists(AUDIO.heartbeat.key)) {
        this.heartbeat = this.scene.sound.add(AUDIO.heartbeat.key, { loop: true, volume: 0 })
        ;(this.heartbeat as Phaser.Sound.WebAudioSound).play()
      }
      if (this.heartbeat) {
        const snd = this.heartbeat as Phaser.Sound.WebAudioSound
        const vol = heartbeat * AUDIO.heartbeat.gain * this.save.sfx
        const rate = 1 + heartbeat * AUDIO.heartbeat.rateGain
        if (Math.abs(vol - this.hbVol) > 0.01) {
          this.hbVol = vol
          snd.setVolume(vol)
        }
        if (Math.abs(rate - this.hbRate) > 0.01) {
          this.hbRate = rate
          snd.setRate(rate)
        }
      }
    } else if (this.heartbeat && this.hbVol > 0) {
      ;(this.heartbeat as Phaser.Sound.WebAudioSound).setVolume(0)
      this.hbVol = 0
    }
  }

  /** Состояние (debug/верификация). */
  state(): Record<string, unknown> {
    const lv = (st: LoopState): number => Math.round(st.vol * 100) / 100
    return {
      music: this.save.music,
      sfx: this.save.sfx,
      hum: lv(this.loops.hum),
      drips: lv(this.loops.drips),
      combat: lv(this.loops.combat),
      depth: lv(this.loops.depth),
      heartbeatVol: Math.round(this.hbVol * 100) / 100,
      heartbeatRate: Math.round(this.hbRate * 100) / 100,
      combatHoldLeft: Math.max(0, Math.round(this.combatUntil - this.scene.time.now)),
    }
  }

  /** Остановить всё (выход из сцены). */
  stopAll(): void {
    for (const st of Object.values(this.loops)) {
      st.sound?.destroy()
      st.sound = null
      st.vol = -1
    }
    this.heartbeat?.destroy()
    this.heartbeat = null
    this.hbVol = -1
    this.hbRate = -1
  }
}
