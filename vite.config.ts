import { defineConfig } from 'vite'

// base обязан совпадать с именем репозитория, потому что игра живёт
// на project page GitHub Pages: https://loudive.github.io/Cave/
// Для локального превью в песочнице используется --base=/game/ (npm run build:local).
export default defineConfig({
  base: '/Cave/',
  // assets/ — публичная папка игры: копируется в dist как есть и доступна
  // dev-серверу по /assets/*. Файлы генерируются скриптом scripts/generate-assets.mjs.
  publicDir: 'assets',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
  },
})
