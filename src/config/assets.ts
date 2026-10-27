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
  // Тайлы (пригодятся шагу 4 — генератору пещер).
  { key: 'tile-wall', file: 'tile-wall.png' },
  { key: 'tile-floor', file: 'tile-floor.png' },
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
