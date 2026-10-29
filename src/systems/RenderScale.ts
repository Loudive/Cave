/**
 * RenderScale — шаг 23: резкий рендер под плотность экрана.
 *
 * Жалоба игрока: «общее качество картинки очень мутное, низкое. Надо
 * улучшить». КОРЕНЬ: канвас всегда был 960×540 (дизайн-разрешение), а
 * Scale.FIT растягивал его браузерным билинейным фильтром на весь экран
 * (1920×1080 и выше — каждый игровой пиксель размазывался на 2×2 и больше
 * Экранных). Плюс линейная выборка текстур в WebGL при зуме камеры.
 *
 * РЕШЕНИЕ: канвас стартует в ДИЗАЙН-РАЗРЕШЕНИИ, УМНОЖЕННОМ на целый
 * рендер-масштаб k = ceil(FIT-масштаб × devicePixelRatio), 1..4:
 *   canvas 960k×540k, зум камеры = cameraBaseZoom × k — мир показывает
 *   РОВНО те же 480×270 мировых px (геометрия игры не меняется), но
 *   каждый тексель занимает ровно 2k целых пикселей канваса.
 *   Браузер дальше только УМЕНЬШАЕТ или масштабирует 1:1 (никогда не
 *   растягивает размыто): на 1080p-мониторе k=2 → канвас 1920×1080 =
 *   попиксельно 1:1 с экраном; на «некруглых» окнах FIT даёт лёгкую
 *   супервыборку (даунскейл), что выглядит ЧЁТКО, а не мыльно.
 *
 * pixelArt: true (main.ts) выключает линейную фильтрацию текстур —
 * спрайты 68×46 при зуме 2k остаются пиксель-в-пиксель, без размытия.
 * Текстам фабрика текста ставит resolution = k (текстуры глифов рендерятся
 * в k раз плотнее — буквы HUD такие же по размеру, но резкие).
 *
 * КАК ПОЛЬЗОВАТЬСЯ (контракт модуля):
 *   - DESIGN_W / DESIGN_H — логическое разрешение интерфейса. ВСЕ
 *     экран объекты (uiRoot-дети: HUD, мини-карта, оверлеи, баннеры)
 *     позиционируются в ЭТИХ координатах, НЕ в scene.scale (который теперь
 *     960k×540k). UiLayer компенсирует: child (x,y) → экран k·(x,y).
 *   - uiZoom(base) — ЕДИНСТВЕННОЕ место умножения зума на k: везде, где
 *     камере назначается базовый зум или пульс от него (CaveScene boot,
 *     Vfx slow-mo). DarknessMask читает cam.zoom живьём — подстраивается
 *     сам (экран формулы у него в px канваса, согласованы по k).
 *   - RENDER_SCALE замораживается при загрузке модуля (до старта сцен):
 *     пересчёт по resize окна не делаем — FIT пересчитает только CSS-размер
 *     канваса, а k остаётся (некритично: ресайз окна в игре — редкость).
 */

/** Логическая ширина игрового экрана (px). */
export const DESIGN_W = 960
/** Логическая высота игрового экрана (px). */
export const DESIGN_H = 540

/**
 * Целый рендер-масштаб канваса: 1..4. Считается ОДИН раз при загрузке.
 * Округление ВВЕРХ (ceil) гарантирует, что браузеру остаётся только
 * даунскейл или 1:1 — растяжения (источника «мыла») не остаётся никогда.
 *
 * Два предохранителя:
 *  1. ?rs=1..4 в URL игры — ручное переопределение (тесты, слабые машины);
 *     лаунчер пробрасывает query окна в iframe.
 *  2. Программный WebGL (SwiftShader/llvmpipe — headless-браузеры, ВМ,
 *     заблокированный GPU): филлрейт 960k×540k для CPU-растеризации
 *     неподъёмен (замер шага 23: 9-16 FPS в софтверном headless при k=2
 *     против играбельных ~60 при k=1) — честно откатываемся на k=1,
 *     прежний вид. На реальном GPU (любой, включая встроенные) 8M px
 *     для этой сцены — копейки (шаг 10: запас ×8).
 */
export const RENDER_SCALE = (() => {
  if (typeof window === 'undefined') return 1
  // 1) Ручной override из URL (?rs=N).
  try {
    const q = Number(new URLSearchParams(window.location.search).get('rs'))
    if (Number.isFinite(q) && q >= 1) return Math.min(4, Math.round(q))
  } catch { /* ignore */ }
  // 2) Софтверный рендер — k=1 (резкость на CPU всё равно не купить).
  if (softwareWebGL()) return 1
  // dpr выше 3 не даёт пользу (тексты/арт не резче), но удваивает филлрейт.
  const dpr = Math.min(window.devicePixelRatio || 1, 3)
  const fit = Math.min(window.innerWidth / DESIGN_W, window.innerHeight / DESIGN_H)
  return Math.max(1, Math.min(4, Math.ceil(fit * dpr)))
})()

/** WebGL есть, но растеризует CPU (SwiftShader/llvmpipe/softpipe)? */
function softwareWebGL(): boolean {
  try {
    const cv = document.createElement('canvas')
    const gl = (cv.getContext('webgl') || cv.getContext('experimental-webgl')) as
      WebGLRenderingContext | null
    if (!gl) return true // WebGL нет — будет Canvas-фолбэк, не грузим филлрейт
    const ext = gl.getExtension('WEBGL_debug_renderer_info')
    const renderer = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''
    return /swiftshader|llvmpipe|softpipe|software|basic render|mesa offscreen/i.test(renderer)
  } catch {
    return true
  }
}

/**
 * Базовый зум камеры с учётом рендер-масштаба: worldView остаётся
 * 960×540 / base (px), каким и был спроектирован, при любом k.
 */
export function uiZoom(base: number): number {
  return base * RENDER_SCALE
}
