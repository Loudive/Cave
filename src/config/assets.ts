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
  // Шаг 26: трассеры военных экспедиций + кладки Гнездовья Матки.
  { key: 'bullet', file: 'bullet.png' },
  { key: 'queen-egg', file: 'queen-egg.png' },
  // Juice (шаг 9): искры для бёрстов.
  { key: 'spark', file: 'spark.png' },
  // Шаг 27 (MeleeFx): костяной осколок — debris значимых ударов (tint в коде).
  { key: 'shard', file: 'shard.png' },
  // Шаг 13: пыль приземления (сквош-джус) и столбы света из потолочных трещин.
  { key: 'dust', file: 'dust.png' },
  { key: 'light-shaft', file: 'light-shaft.png' },
  // Нейрогенерация (шаг 5+ разрешена): splash-арт меню, палитра игры.
  { key: 'menu-splash', file: 'menu-splash.jpg' },
  // Шаг 24: иконки древа навыков (16 образов, scripts/process-icons.mjs,
  // нейро-листы scripts/gen-step24.mjs) — узлы Гнезда и заголовки веток.
  { key: 'icon-fangs', file: 'icon-fangs.png' },
  { key: 'icon-jaw', file: 'icon-jaw.png' },
  { key: 'icon-blood', file: 'icon-blood.png' },
  { key: 'icon-claw', file: 'icon-claw.png' },
  { key: 'icon-heart', file: 'icon-heart.png' },
  { key: 'icon-shield', file: 'icon-shield.png' },
  { key: 'icon-stomach', file: 'icon-stomach.png' },
  { key: 'icon-eye', file: 'icon-eye.png' },
  { key: 'icon-wing', file: 'icon-wing.png' },
  { key: 'icon-paw', file: 'icon-paw.png' },
  { key: 'icon-mushroom', file: 'icon-mushroom.png' },
  { key: 'icon-flame', file: 'icon-flame.png' },
  { key: 'icon-crystal', file: 'icon-crystal.png' },
  { key: 'icon-dna', file: 'icon-dna.png' },
  { key: 'icon-ghost', file: 'icon-ghost.png' },
  { key: 'icon-egg', file: 'icon-egg.png' },
  // Пост-эффекты.
  { key: 'vignette', file: 'vignette.png' },
]

/**
 * Версия ассетов для cache-busting (шаг 23, рейк): URL файлов не менялся
 * между деплоями — браузер игрока (и наш тестовый agent-browser) подавал
 * СТАРЫЕ mob-*.png из кэша после обновления игры на сервере («белый
 * обломок никуда не делся», а на диске файл уже чистый). Поднимай версию
 * при КАЖДОМ изменении файлов в assets/ (мобы, герой, фоны, glows).
 */
const ASSET_VERSION = 's27'

/**
 * URL файла ассета. publicDir='assets' в Vite кладёт PNG в корень dist,
 * поэтому путь относительный: на /Cave/ он даст /Cave/glow-cyan.png,
 * на локальном превью /game/ — /game/glow-cyan.png, в dev — /glow-cyan.png.
 * ?v= — гарантия, что после деплоя игрок увидит НОВЫЕ файлы, а не кэш.
 */
export function assetUrl(file: string): string {
  return `${file}?v=${ASSET_VERSION}`
}

/** Шаг 11: размер кадра листов героя (см. scripts/process-hero.mjs). */
export const HERO_FRAME = { w: 68, h: 46 } as const
