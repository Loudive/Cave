import Phaser from 'phaser'
import { LIGHT, hexInt } from '../config/light'

/**
 * DarknessMask — шаг 5: световая маска тьмы. Шаг 10 (перфоманс): один
 * GLSL-проход вместо RenderTexture с fill+erase на каждый источник.
 *
 * Было: каждый кадр rt.fill() (полный экран) + rt.erase(hole) на КАЖДЫЙ
 * источник света (полный экран на дыру) — 20+ полноэкранных операций
 * композитинга за кадр. Стало (WebGL): один fullscreen-квад с фрагментным
 * шейдером, который сам считает тьму по массиву источников (uniform 3fv,
 * до maxLights) — ровно ОДИН проход на кадр независимо от числа света.
 *
 * Canvas-fallback (без WebGL): прежний путь RenderTexture, но дыры
 * батчатся через beginDraw/batchDraw/endDraw — одна отсылка вместо N.
 *
 * Порядок слоёв сцены: мир (тайлы/сущности, depth 0..3) → маска (14) →
 * силуэтная мошь (16) → вигнетка (18) → HUD (22+) → debug (24) → мини-карта (30).
 */

/** Глубина маски тьмы (см. слои выше). */
const DEPTH_MASK = 14

export interface LightSource {
  /** Мировая X источника (кадра — для scrollFactor(0) объектов). */
  x: () => number
  /** Мировая Y источника. */
  y: () => number
  /** Базовый внешний радиус дыры, px. */
  radius: number
  /** Пульсация: множитель радиуса (1 = база). Например масштаб твины свечения. */
  scaleNow?: () => number
  /** Дышащий свет существа (лёгкая синусоида от breathePeriodMs). */
  breathe?: boolean
  /** Шаг 8: живой множитель радиуса (Ночное зрение / Светожорное ядро). */
  radiusMult?: () => number
  /** Шаг 13 (Hidden Deep): сид неровного мерцания (грибы-лампы «барунят»). */
  flicker?: number
  /** Шаг 13 (Hidden Deep): направление «взгляда» (±1) — свет вытягивается вперёд. */
  gazeDir?: () => 1 | -1
}

/** Фрагментный шейдер тьмы: до maxLights источников, форма дыры — как у
 * light-hole.png (плато до 45% радиуса, линейный спад к краю), света
 * перемножаются «прозрачности» — перекрытие светил ярче, как при erase.
 * Шаг 13 (Hidden Deep): свет существа (индекс uGazeIdx) вытягивается
 * ВПЕРЁД по uGazeDir — горизонтальная метрика делится на uGazeStretch,
 * и только в полупространстве «перед мордой». Свет читается как
 * направление атаки хищника, оставаясь биологическим (не фонарь —
 * железное правило проекта). */
const DARKNESS_FRAG = `
precision mediump float;
uniform vec2 resolution;
uniform vec3 uDarkColor;
uniform float uDarkAlpha;
uniform vec3 uLights[MAX_LIGHTS];
uniform float uLightCount;
uniform float uGazeIdx;
uniform float uGazeStretch;
uniform float uGazeDir;

float holeFalloff (float t)
{
    if (t >= 1.0) { return 0.0; }
    if (t < 0.45) { return 1.0 - 0.18 * (t / 0.45); }
    return 0.82 * (1.0 - (t - 0.45) / 0.55);
}

void main ()
{
    vec2 p = vec2(gl_FragCoord.x, resolution.y - gl_FragCoord.y);
    float keep = 1.0;
    for (int i = 0; i < MAX_LIGHTS; i++)
    {
        if (float(i) >= uLightCount) { break; }
        vec3 L = uLights[i];
        vec2 d = p - L.xy;
        if (uGazeIdx >= 0.0 && float(i) == uGazeIdx && d.x * uGazeDir > 0.0)
        {
            d.x /= uGazeStretch;
        }
        float t = distance(vec2(0.0, 0.0), d) / max(L.z, 1.0);
        keep *= (1.0 - holeFalloff(t));
    }
    gl_FragColor = vec4(uDarkColor, uDarkAlpha * keep);
}
`.replace(/MAX_LIGHTS/g, String(LIGHT.shader.maxLights))

export class DarknessMask {
  /** WebGL: fullscreen-шейдер. Canvas: RenderTexture + дыры (батч). */
  private readonly shader: Phaser.GameObjects.Shader | null
  private readonly rt: Phaser.GameObjects.RenderTexture | null
  private readonly hole: Phaser.GameObjects.Image | null
  private readonly colorInt: number
  private readonly darkR: number
  private readonly darkG: number
  private readonly darkB: number
  private readonly lightArr: Float32Array
  private readonly lights: LightSource[] = []
  private playerLight: LightSource | null = null
  /** Сердцебиение: 0..1 — усиливает дыхание света (низкий HP/голод, шаг 6). */
  private heartbeat = 0
  /** Число дыр, вырезанных в последнем кадре (debug). */
  public lastHoles = 0

  constructor(scene: Phaser.Scene) {
    const { width, height } = scene.scale
    const dark = LIGHT.darkness
    this.colorInt = hexInt(dark.color)
    this.darkR = ((this.colorInt >> 16) & 0xff) / 255
    this.darkG = ((this.colorInt >> 8) & 0xff) / 255
    this.darkB = (this.colorInt & 0xff) / 255
    this.lightArr = new Float32Array(LIGHT.shader.maxLights * 3)

    const isWebGL = scene.game.renderer.type === Phaser.WEBGL

    if (isWebGL) {
      const base = new Phaser.Display.BaseShader('darkness-mask', DARKNESS_FRAG, undefined, {
        uDarkColor: { type: '3f', value: { x: this.darkR, y: this.darkG, z: this.darkB } },
        uDarkAlpha: { type: '1f', value: dark.alpha },
        uLights: { type: '3fv', value: this.lightArr },
        uLightCount: { type: '1f', value: 0 },
        uGazeIdx: { type: '1f', value: -1 },
        uGazeStretch: { type: '1f', value: LIGHT.gaze.stretch },
        uGazeDir: { type: '1f', value: 1 },
      })
      this.shader = scene.add.shader(base, 0, 0, width, height)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(DEPTH_MASK)
      this.rt = null
      this.hole = null
    } else {
      this.shader = null
      this.rt = scene.add.renderTexture(0, 0, width, height)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(DEPTH_MASK)
      this.hole = scene.make.image({ key: dark.holeTexture, add: false })
      this.hole.setBlendMode(Phaser.BlendModes.ERASE)
    }

    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.hole?.destroy()
    })
  }

  /** Зарегистрировать источник света. Возвращает его же (для хранения). */
  add(src: LightSource): LightSource {
    this.lights.push(src)
    return src
  }

  /** Убрать источник (шаг 7: огненные лужи и споры живут недолго). */
  remove(src: LightSource): void {
    const i = this.lights.indexOf(src)
    if (i >= 0) this.lights.splice(i, 1)
  }

  /** Пометить источник как свет существа — на него дышит и мошь реагирует. */
  setPlayer(src: LightSource): void {
    this.playerLight = src
  }

  /** Свет игрока — радиус с дыханием; нужен мошки и (позже) ИИ незаметности. */
  playerRadius(time: number): number {
    if (!this.playerLight) return 0
    let r = this.playerLight.radius * (this.playerLight.radiusMult?.() ?? 1)
    if (this.playerLight.breathe) {
      const cfg = LIGHT.playerLight
      // Сердцебиение (шаг 6): при низком HP/голоду свет дышит чаще и глубже —
      // «свет игрока дышит вместе с сердцебиением при низком HP» (гайд §7).
      const amp = cfg.breatheAmp * (1 + this.heartbeat * 2.4)
      const period = cfg.breathePeriodMs / (1 + this.heartbeat * 1.1)
      r *= 1 + amp * Math.sin((time / period) * Math.PI * 2)
    }
    return r
  }

  /** Сила сердцебиения света 0..1 (сцена считает по HP/голоду). */
  setHeartbeat(level: number): void {
    this.heartbeat = Phaser.Math.Clamp(level, 0, 1)
  }

  /**
   * Шаг 13 (Hidden Deep): неровное мерцание лампы — две несоизмеримые
   * синусоиды по сиду источника; минимум minShare (глубокий «браун-аут»).
   * Детерминировано — один и тот же гриб мерцает одинаково каждый визит.
   */
  private flickerFactor(now: number, seed: number): number {
    const f = LIGHT.flicker
    const wave = Math.sin(now / f.speedMs + seed * 7.13) * 0.62
      + Math.sin(now / (f.speedMs * 0.373) + seed * 3.7) * 0.38
    return Math.max(f.minShare, 1 + wave * f.amp)
  }

  update(scene: Phaser.Scene): void {
    const cam = scene.cameras.main
    const t = scene.time.now
    const maxLights = LIGHT.shader.maxLights

    // Сбор экранных координат источников с отсечением за кадром.
    let count = 0
    let gazeIdx = -1
    for (const l of this.lights) {
      if (count >= maxLights) break
      let r = l.radius
      if (l.scaleNow) r *= l.scaleNow()
      if (l.flicker !== undefined) r *= this.flickerFactor(t, l.flicker)
      if (l.breathe) r = this.playerRadius(t)
      // Мировые → экранные (FIT 960×540; краткий зум слоу-мо игнорируем —
      // прежний RT-путь имел то же допущение).
      const sx = l.x() - cam.scrollX
      const sy = l.y() - cam.scrollY
      if (sx < -r || sy < -r || sx > cam.width + r || sy > cam.height + r) continue
      // Шаг 13: индекс света существа в массиве — для «взгляда хищника».
      if (l === this.playerLight) gazeIdx = count
      const o = count * 3
      this.lightArr[o] = sx
      this.lightArr[o + 1] = sy
      this.lightArr[o + 2] = r
      count++
    }
    this.lastHoles = count

    if (this.shader) {
      this.shader.setUniform('uLightCount.value', count)
      // Float32Array перезаписан на месте — Phaser зальёт его через uniform3fv.
      this.shader.setUniform('uLights.value', this.lightArr)
      // Шаг 13: «взгляд хищника» (−1 = свет существа вне кадра — выкл).
      this.shader.setUniform('uGazeIdx.value', gazeIdx)
      if (this.playerLight?.gazeDir) {
        this.shader.setUniform('uGazeDir.value', this.playerLight.gazeDir())
      }
      return
    }

    // ── Canvas-фолбэк: RT, дыры одним батчем ────────────────────────────────
    const rt = this.rt!
    const hole = this.hole!
    rt.clear()
    rt.fill(this.colorInt, LIGHT.darkness.alpha)
    if (count === 0) return
    rt.beginDraw()
    for (let i = 0; i < count; i++) {
      const sx = this.lightArr[i * 3]
      const sy = this.lightArr[i * 3 + 1]
      const r = this.lightArr[i * 3 + 2]
      hole.setPosition(sx, sy)
        .setDisplaySize(r * 2, r * 2)
        .setAlpha(1)
      rt.batchDraw(hole)
    }
    rt.endDraw()
  }
}
