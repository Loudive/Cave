/**
 * Смоук-тест генератора пещер (шаг 14): метрики + ASCII-рендер.
 * Запуск: node scripts/smoke-cave.mjs [seed] [depth]
 */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const seed = process.argv[2] ?? 'TESTSEED'
const depth = Number(process.argv[3] ?? 1)

const outdir = mkdtempSync(join(tmpdir(), 'cave-smoke-'))
await build({
  entryPoints: ['src/gen/cave.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(outdir, 'cave.mjs'),
  external: [],
  logLevel: 'silent',
})

const { generateCave } = await import(join(outdir, 'cave.mjs'))

const cave = generateCave(seed, depth)
const s = cave.stats
console.log(`seed=${seed} depth=${depth}`)
console.log(`каверн=${s.cavernCount}  лазов=${s.crawlTunnels}  шахт=${s.shafts}  островов=${s.islands}`)
console.log(`крупнейшая=${s.largestCavernTiles} тайлов  средняя=${s.avgCavernTiles.toFixed(0)}  воздух=${s.airTiles}`)
console.log(`прямой пол макс=${s.maxFloorRun}  прямая стена макс=${s.maxWallRun}`)
console.log(`достижимо=${(s.reachableRatio * 100).toFixed(1)}%  попыток=${s.attempts}`)
console.log(`вход=(${cave.entrance.x},${cave.entrance.y})  выход=(${cave.exit.x},${cave.exit.y})`)
console.log(`грибы=${cave.mushrooms.length}  гнёзда=${cave.nests.length}`)

// ASCII-рендер: каждый 2-й столбец и каждая 2-я строка, чтобы влезло в терминал
const W = cave.cols, H = cave.rows
const lines = []
for (let y = 0; y < H; y += 2) {
  let row = ''
  for (let x = 0; x < W; x += 2) {
    const i = y * W + x
    if (x === cave.entrance.x && y === cave.entrance.y) row += '@'
    else if (x === cave.exit.x && y === cave.exit.y) row += 'X'
    else if (cave.solid[i] === 0) row += cave.ground[i] ? '~' : ' '
    else row += '#'
  }
  lines.push(row)
}
console.log(lines.join('\n'))
