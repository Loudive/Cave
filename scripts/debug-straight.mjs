#!/usr/bin/env node
/** Отладка: где именно прямые срезы (для починки генератора). */
import { build } from 'esbuild'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const seed = process.argv[2] ?? '9P4HXC'
const depth = Number(process.argv[3] ?? 1)

const outdir = mkdtempSync(join(tmpdir(), 'cave-dbg-'))
await build({
  entryPoints: ['src/gen/cave.ts'], bundle: true, platform: 'node', format: 'esm',
  outfile: join(outdir, 'cave.mjs'), logLevel: 'silent',
})
const { generateCave } = await import(join(outdir, 'cave.mjs'))
const cave = generateCave(seed, depth)
const W = cave.cols, H = cave.rows, solid = cave.solid

// Самый длинный пол и стена с координатами
let bestFloor = { run: 0, x: 0, y: 0 }
for (let y = 1; y < H - 1; y++) {
  let run = 0, sx = 0
  for (let x = 1; x < W - 1; x++) {
    const i = y * W + x
    const f = solid[i] === 0 && solid[i + W] === 1
    if (f) { if (run === 0) sx = x; run++ } else { if (run > bestFloor.run) bestFloor = { run, x: sx, y }; run = 0 }
  }
  if (run > bestFloor.run) bestFloor = { run, x: sx, y }
}
let bestWall = { run: 0, x: 0, y: 0 }
for (let x = 1; x < W - 1; x++) {
  let run = 0, sy = 0
  for (let y = 1; y < H - 1; y++) {
    const i = y * W + x
    const w = solid[i] === 0 && solid[i + 1] === 1
    if (w) { if (run === 0) sy = y; run++ } else { if (run > bestWall.run) bestWall = { run, x, y: sy }; run = 0 }
  }
  if (run > bestWall.run) bestWall = { run, x, y: sy }
}
console.log(`пол: run=${bestFloor.run} @(${bestFloor.x},${bestFloor.y})`)
console.log(`стена: run=${bestWall.run} @(${bestWall.x},${bestWall.y})`)

// Локальный ASCII вокруг худшей стены
const m = 24
const x0 = Math.max(1, bestWall.x - m), x1 = Math.min(W - 2, bestWall.x + m)
const y0 = Math.max(1, bestWall.y - m), y1 = Math.min(H - 2, bestWall.y + m)
for (let y = y0; y <= y1; y++) {
  let row = ''
  for (let x = x0; x <= x1; x++) {
    row += solid[y * W + x] === 0 ? ' ' : '#'
  }
  console.log(row)
}
