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
  // Шаг 20: текстуры 'mob-*' тоже — анимированные листы 4×68×46 там же
  // (scripts/process-mobs.mjs; раньше были статичными 22×14 здесь).
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
  // Шаг 14: атлас пещерных тайлов — автотайлинг края (битмаска N/E/S/W,
  // 16 контекстов: rim-light пола, градиент стен, потолок со сталактитиками)
  // + 4 страты глубины камня (BFS от воздуха: толща читается 3D-массой).
  // Заменил россыпь tile-stone*/tile-dirt* (шаг 4/12).
  { key: 'tiles-cave', file: 'tiles-cave.png' },
  { key: 'decor-moss', file: 'decor-moss.png' },
  { key: 'decor-crystal', file: 'decor-crystal.png' },
  { key: 'decor-bone', file: 'decor-bone.png' },
  // Свет и атмосфера (шаг 5): дыра световой маски, мошь.
  { key: 'light-hole', file: 'light-hole.png' },
  // Шаг 16: фон-система глубины — 5 параллакс-слоёв (см. light.json parallax
  // и секцию ФОН-СИСТЕМА ГЛУБИНЫ в scripts/generate-assets.mjs):
  // бездна -> мегаволт (арки/череп левиафана) -> средняя стена с окнами ->
  // ближние формации -> валуны-рамки. Старые bg-strata/silhouette-far
  // удалены («фоны — просто полоски», жалоба игрока).
  { key: 'bg-void', file: 'bg-void.png' },
  { key: 'bg-megavault', file: 'bg-megavault.png' },
  { key: 'bg-midwall', file: 'bg-midwall.png' },
  { key: 'bg-formations', file: 'bg-formations.png' },
  { key: 'silhouette-near', file: 'silhouette-near.png' },
  // Шаг 18: эмиссивные выжимки (scripts/make-bg-emissive.mjs) — ADD-близнецы
  // НАД маской тьмы: дальние огни прорезают полную тьму (глубина без дымки).
  { key: 'bg-void-em', file: 'bg-void-em.png' },
  { key: 'bg-megavault-em', file: 'bg-megavault-em.png' },
  { key: 'bg-formations-em', file: 'bg-formations-em.png' },
  { key: 'mote', file: 'mote.png' },
  // Боёвка и поедание (шаг 6): кровь трёх слоёв, добыча, мясо, мутаген.
  { key: 'blood-drop', file: 'blood-drop.png' },
  { key: 'blood-decal', file: 'blood-decal.png' },
  { key: 'clot', file: 'clot.png' },
  // Шаг 20: mob-slug/mob-bat/… перенесены в BootScene.preload (листы 4×68×46).
  { key: 'meat-chunk', file: 'meat-chunk.png' },
  { key: 'mutation-gem', file: 'mutation-gem.png' },
  // Экосистема (шаг 7): споровый снаряд, лужа огня, кольцо шума.
  // (мобы slug/bat/reaper/bloodsucker/shell/lava — листы в BootScene, шаг 20)
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
