/**
 * assets.ts — шаг 2: манифест ассетов.
 * Единый источник правды для загрузчика BootScene: добавил файл в assets/ —
 * добавь строку сюда, и он попадёт в preload с прогресс-баром.
 * Папка assets/ копируется в dist целиком (vite: publicDir).
 */
export interface AssetEntry {
  /** Ключ текстуры в Phaser (те же имена, что были у программных текстур). */
  key: string
  /** Имя файла в папке assets/. */
  file: string
}

export const ASSETS: AssetEntry[] = [
  // Световые пятна биолюминесценции.
  { key: 'glow-cyan', file: 'glow-cyan.png' },
  { key: 'glow-purple', file: 'glow-purple.png' },
  { key: 'glow-red', file: 'glow-red.png' },
  { key: 'glow-acid', file: 'glow-acid.png' },
  // Спрайты. Шаг 11 (переработка): герой полностью анимирован — 7 листов
  // (idle/run/glide/bite/eat/hurt/death) грузятся спрайтлистами в BootScene
  // с кадрами 68×46 (scripts/process-hero.mjs, сырьё design/raw/v3).
  // Текстуры 'hero-*' здесь НЕ перечислены — см. BootScene.preload.
  { key: 'rock', file: 'rock.png' },
  // Шаг 12: пять видов скал + лозы (лучший визуал пещеры).
  { key: 'rock-a', file: 'rock-a.png' },
  { key: 'rock-b', file: 'rock-b.png' },
  { key: 'rock-c', file: 'rock-c.png' },
  { key: 'rock-d', file: 'rock-d.png' },
  { key: 'rock-e', file: 'rock-e.png' },
  { key: 'decor-vine', file: 'decor-vine.png' },
  { key: 'mushroom', file: 'mushroom.png' },
  { key: 'spore', file: 'spore.png' },
  // Тайлы (шаг 4 — тайлмап процедурной пещеры).
  { key: 'tile-wall', file: 'tile-wall.png' },
  { key: 'tile-floor', file: 'tile-floor.png' },
  { key: 'tile-stone', file: 'tile-stone.png' },
  // Шаг 12: варианты камня (зерно/окаменелость/трещина) и земля
  // по контексту к воздуху: top (пол), side (стена), bottom (потолок).
  { key: 'tile-stone-b', file: 'tile-stone-b.png' },
  { key: 'tile-stone-c', file: 'tile-stone-c.png' },
  { key: 'tile-stone-d', file: 'tile-stone-d.png' },
  { key: 'tile-dirt', file: 'tile-dirt.png' },
  { key: 'tile-dirt-top', file: 'tile-dirt-top.png' },
  { key: 'tile-dirt-side', file: 'tile-dirt-side.png' },
  { key: 'tile-dirt-bottom', file: 'tile-dirt-bottom.png' },
  { key: 'decor-moss', file: 'decor-moss.png' },
  { key: 'decor-crystal', file: 'decor-crystal.png' },
  { key: 'decor-bone', file: 'decor-bone.png' },
  // Свет и атмосфера (шаг 5): дыра световой маски, параллакс-силуэты, мошь.
  { key: 'light-hole', file: 'light-hole.png' },
  { key: 'silhouette-far', file: 'silhouette-far.png' },
  { key: 'silhouette-near', file: 'silhouette-near.png' },
  // Шаг 12: страта-задник — самая дальняя стена пещеры (напластования).
  { key: 'bg-strata', file: 'bg-strata.png' },
  { key: 'mote', file: 'mote.png' },
  // Боёвка и поедание (шаг 6): кровь трёх слоёв, добыча, мясо, мутаген.
  { key: 'blood-drop', file: 'blood-drop.png' },
  { key: 'blood-decal', file: 'blood-decal.png' },
  { key: 'clot', file: 'clot.png' },
  { key: 'mob-slug', file: 'mob-slug.png' },
  { key: 'mob-bat', file: 'mob-bat.png' },
  { key: 'meat-chunk', file: 'meat-chunk.png' },
  { key: 'mutation-gem', file: 'mutation-gem.png' },
  // Экосистема (шаг 7): четыре новых вида, споровый снаряд, лужа огня, кольцо шума.
  { key: 'mob-reaper', file: 'mob-reaper.png' },
  { key: 'mob-bloodsucker', file: 'mob-bloodsucker.png' },
  { key: 'mob-shell', file: 'mob-shell.png' },
  { key: 'mob-lava', file: 'mob-lava.png' },
  { key: 'spore-bolt', file: 'spore-bolt.png' },
  { key: 'fire-patch', file: 'fire-patch.png' },
  { key: 'ring', file: 'ring.png' },
  // Juice (шаг 9): искры для бёрстов.
  { key: 'spark', file: 'spark.png' },
  // Шаг 13: пыль приземления (сквош-джус) и столбы света из потолочных трещин.
  { key: 'dust', file: 'dust.png' },
  { key: 'light-shaft', file: 'light-shaft.png' },
  // Нейрогенерация (шаг 5+ разрешена): splash-арт меню, палитра игры.
  { key: 'menu-splash', file: 'menu-splash.jpg' },
  // Пост-эффекты.
  { key: 'vignette', file: 'vignette.png' },
]

/**
 * URL файла ассета. publicDir='assets' в Vite кладёт PNG в корень dist,
 * поэтому путь относительный: на /Cave/ он даст /Cave/glow-cyan.png,
 * на локальном превью /game/ — /game/glow-cyan.png, в dev — /glow-cyan.png.
 */
export function assetUrl(file: string): string {
  return file
}

/** Шаг 11: размер кадра листов героя (см. scripts/process-hero.mjs). */
export const HERO_FRAME = { w: 68, h: 46 } as const
