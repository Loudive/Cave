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
  // Спрайты.
  { key: 'player', file: 'player.png' },
  { key: 'rock', file: 'rock.png' },
  { key: 'mushroom', file: 'mushroom.png' },
  { key: 'spore', file: 'spore.png' },
  // Тайлы (шаг 4 — тайлмап процедурной пещеры).
  { key: 'tile-wall', file: 'tile-wall.png' },
  { key: 'tile-floor', file: 'tile-floor.png' },
  { key: 'tile-stone', file: 'tile-stone.png' },
  { key: 'tile-dirt', file: 'tile-dirt.png' },
  { key: 'decor-moss', file: 'decor-moss.png' },
  { key: 'decor-crystal', file: 'decor-crystal.png' },
  { key: 'decor-bone', file: 'decor-bone.png' },
  // Свет и атмосфера (шаг 5): дыра световой маски, параллакс-силуэты, мошь.
  { key: 'light-hole', file: 'light-hole.png' },
  { key: 'silhouette-far', file: 'silhouette-far.png' },
  { key: 'silhouette-near', file: 'silhouette-near.png' },
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
