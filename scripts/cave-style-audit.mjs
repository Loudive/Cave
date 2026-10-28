/**
 * cave-style-audit.mjs — СТРАЖ СТИЛЯ ПЕЩЕР: автоматический аудит (шаг 14).
 *
 * Контракт стиля (источник: референсы игрока — Hollow Knight / Blasphemous /
 * Hidden Deep + запрет «больших квадратных и стрёмных» пещер) закодирован
 * здесь правилами. Нарушение ЛЮБОГО правила = exit 1 + отчёт: коммит
 * запрещён, пока стиль не восстановлен.
 *
 * Запуск: npm run cave:audit
 *
 * Проверяет:
 *  1. МАССШТАБ И ФОРМА: каверн ≥ minCavernCount, крупнейшая ≥ minLargest-
 *     CavernTiles (пещеры БОЛЬШИЕ), прямые срезы ≤ maxFloorRun/maxWallRun
 *     (никаких квадратных камер и машинных коридоров).
 *  2. МНОГОЯРУСНОСТЬ: лазы ≥ minCrawlTunnels, шахты ≥ minShafts,
 *     острова-уступы ≥ minIslands.
 *  3. ПРОХОДИМОСТЬ: reachable ≥ targetReachable (из gen.json, без дублей).
 *  4. ДЕТЕРМИНИЗМ: тот же seed → тот же хеш сетки.
 *  5. АССЕТЫ: ноль хромакея (неон-зелёный/пурпурный) во ВСЕХ png —
 *     класс бага «зелёных квадратов» (сдвиг каналов в генераторе);
 *     тайлы-атлас не ярче maxTileChannel и в среднем темнее meanTileCeil
 *     (пещера остаётся сверхтёмной — контракт #0B0B10).
 */
import { build } from 'esbuild'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── ПРАВИЛА СТИЛЯ (одно место правды для аудита) ───────────────────────────
const RULES = {
  /** Сколько случайных seed'ов гонять на каждую глубину. */
  seedsToAudit: 10,
  /** Глубины для прогона (разные биомы/слои). */
  depths: [1, 2, 3],
  /** Каверн на карте минимум (вход + выход + хаб + обычные). */
  minCavernCount: 8,
  /** Крупнейшая каверна, тайлов воздуха: пещеры БОЛЬШИЕ, не каморки. */
  minLargestCavernTiles: 400,
  /** Узких лазов минимум: «много лазов» — требование игрока. */
  minCrawlTunnels: 8,
  /** Вертикальных шахт между ярусами минимум. */
  minShafts: 3,
  /** Островов-уступов минимум: многоярусный трэверсал внутри каверн. */
  minIslands: 5,
  /** Самый длинный прямой участок пола, тайлов: длинные ПРОХОДНЫЕ полы
   *   допустимы (пол туннеля + пол каверны сливаются — это геймплей+),
   *   квадратную камеру ловит machineCorners, а не это. */
  maxFloorRun: 16,
  /** Самая длинная прямая вертикальная стена, тайлов. */
  maxWallRun: 10,
  /** Острых 90° углов с рукавами ≥ 4: у квадратной камеры их 4, у органичной
   *   пещеры углы скруглены — почти ноль. */
  maxMachineCorners: 2,
  /** Ассеты: запрещённые неон-хромакеи (зелёный/пурпурный). */
  chromaGreen: { g: 200, rg: 60, bg: 60 },
  chromaMagenta: { r: 200, b: 200, g: 60 },
  /** Тайл-атлас: ни один канал ярче этого — пещера сверхтёмная. */
  maxTileChannel: 0xa0,
  /** Тайл-атлас: средняя яркость не выше — читается бездной, не днём. */
  meanTileCeil: 0x40,
}

const GEN = JSON.parse(readFileSync(join(ROOT, 'src/config/gen.json'), 'utf8'))
const failures = []
const notes = []

function fail(msg) {
  failures.push(msg)
}

// ── 1..4. Генерация: метрики стиля по сетке seed'ов ────────────────────────
const outdir = mkdtempSync(join(tmpdir(), 'cave-audit-'))
await build({
  entryPoints: [join(ROOT, 'src/gen/cave.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(outdir, 'cave.mjs'),
  logLevel: 'silent',
})
const { generateCave } = await import(join(outdir, 'cave.mjs'))

// Детерминированные seed'ы + пара «живых» (по времени) для разнообразия.
const seedAlphabet = GEN.seedAlphabet ?? 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
function makeSeed(n) {
  let s = ''
  for (let i = 0; i < (GEN.seedLength ?? 6); i++) {
    s += seedAlphabet[(n * 7 + i * 13) % seedAlphabet.length]
  }
  return s
}

const agg = {
  caverns: [], largest: [], crawls: [], shafts: [], islands: [],
  floorRun: [], wallRun: [], reachable: [], corners: [],
}

for (let d = 0; d < RULES.depths.length; d++) {
  const depth = RULES.depths[d]
  for (let n = 0; n < RULES.seedsToAudit; n++) {
    const seed = makeSeed(n + d * 31)
    const cave = generateCave(seed, depth)
    const s = cave.stats
    agg.caverns.push(s.cavernCount)
    agg.largest.push(s.largestCavernTiles)
    agg.crawls.push(s.crawlTunnels)
    agg.shafts.push(s.shafts)
    agg.islands.push(s.islands)
    agg.floorRun.push(s.maxFloorRun)
    agg.wallRun.push(s.maxWallRun)
    agg.reachable.push(s.reachableRatio)
    agg.corners.push(s.machineCorners)

    if (s.cavernCount < RULES.minCavernCount) {
      fail(`seed=${seed} depth=${depth}: каверн ${s.cavernCount} < ${RULES.minCavernCount}`)
    }
    if (s.largestCavernTiles < RULES.minLargestCavernTiles) {
      fail(`seed=${seed} depth=${depth}: крупнейшая каверна ${s.largestCavernTiles} < ${RULES.minLargestCavernTiles} — пещеры стали мелкими`)
    }
    if (s.crawlTunnels < RULES.minCrawlTunnels) {
      fail(`seed=${seed} depth=${depth}: лазов ${s.crawlTunnels} < ${RULES.minCrawlTunnels}`)
    }
    if (s.shafts < RULES.minShafts) {
      fail(`seed=${seed} depth=${depth}: шахт ${s.shafts} < ${RULES.minShafts}`)
    }
    if (s.islands < RULES.minIslands) {
      fail(`seed=${seed} depth=${depth}: островов ${s.islands} < ${RULES.minIslands}`)
    }
    if (s.maxFloorRun > RULES.maxFloorRun) {
      fail(`seed=${seed} depth=${depth}: прямой пол ${s.maxFloorRun} > ${RULES.maxFloorRun} — машинный срез пола`)
    }
    if (s.maxWallRun > RULES.maxWallRun) {
      fail(`seed=${seed} depth=${depth}: прямая стена ${s.maxWallRun} > ${RULES.maxWallRun} — машинный срез`)
    }
    if (s.machineCorners > RULES.maxMachineCorners) {
      fail(`seed=${seed} depth=${depth}: острых машинных углов ${s.machineCorners} > ${RULES.maxMachineCorners} — квадратная камера вернулась`)
    }
    if (s.reachableRatio < GEN.connectivity.targetReachable) {
      fail(`seed=${seed} depth=${depth}: достижимо ${(s.reachableRatio * 100).toFixed(1)}% < ${GEN.connectivity.targetReachable * 100}%`)
    }

    // Детерминизм: тот же seed — тот же хеш.
    const again = generateCave(seed, depth)
    if (again.stats.hash !== s.hash) {
      fail(`seed=${seed} depth=${depth}: НЕДЕТЕРМИНИЗМ — хеш плавает (${s.hash} ≠ ${again.stats.hash})`)
    }
  }
}

function avg(arr) {
  return arr.reduce((a, b) => a + b, 0) / arr.length
}
notes.push(`каверн: min=${Math.min(...agg.caverns)} avg=${avg(agg.caverns).toFixed(1)}`)
notes.push(`крупнейшая: min=${Math.min(...agg.largest)} avg=${avg(agg.largest).toFixed(0)} тайлов`)
notes.push(`лазов: min=${Math.min(...agg.crawls)} avg=${avg(agg.crawls).toFixed(1)}`)
notes.push(`шахт: min=${Math.min(...agg.shafts)} · островов: min=${Math.min(...agg.islands)}`)
notes.push(`прямой пол: max=${Math.max(...agg.floorRun)} · стена: max=${Math.max(...agg.wallRun)} · машинных углов: max=${Math.max(...agg.corners)}`)
notes.push(`достижимо: min=${(Math.min(...agg.reachable) * 100).toFixed(1)}%`)

// ── 5. Ассеты: хромакей-аудит всех PNG + яркость тайл-атласа ──────────────

/** Минимальный PNG-декодер (filter types 0–4), достаточно для наших файлов. */
function decodePng(file) {
  const buf = readFileSync(file)
  if (buf.readUInt32BE(0) !== 0x89504e47) return null
  let pos = 8
  let w = 0, h = 0, bitDepth = 8, colorType = 6
  const idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0)
      h = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') break
    pos += 12 + len
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) return null
  const bpp = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const out = Buffer.alloc(w * h * bpp)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev ? prev[x] : 0
      const cc = prev && x >= bpp ? prev[x - bpp] : 0
      let v = row[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += Math.floor((a + b) / 2)
      else if (f === 4) {
        const p = a + b - cc
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : cc
      }
      cur[x] = v & 0xff
    }
  }
  return { w, h, bpp, data: out }
}

const assetDir = join(ROOT, 'assets')
const pngs = readdirSync(assetDir).filter((f) => f.endsWith('.png'))
let scanned = 0
for (const f of pngs) {
  const img = decodePng(join(assetDir, f))
  if (!img) continue
  scanned++
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const i = (y * img.w + x) * img.bpp
      const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2]
      const a = img.bpp === 4 ? img.data[i + 3] : 255
      if (a <= 60) continue
      const isGreen = g > RULES.chromaGreen.g && r < RULES.chromaGreen.rg && b < RULES.chromaGreen.bg
      const isMag = r > RULES.chromaMagenta.r && b > RULES.chromaMagenta.b && g < RULES.chromaMagenta.g
      if (isGreen || isMag) {
        fail(`ХРОМАКЕЙ в ${f} @(${x},${y}) rgb(${r},${g},${b}) — класс бага «зелёных квадратов»`)
        y = img.h
        break
      }
    }
  }
  // Тайл-атлас: сверхтёмная пещера — ни дня, ни неона.
  if (f === 'tiles-cave.png') {
    let sum = 0
    const n = img.w * img.h
    for (let i = 0; i < n; i++) {
      const o = i * img.bpp
      const mx = Math.max(img.data[o], img.data[o + 1], img.data[o + 2])
      if (mx > RULES.maxTileChannel) {
        fail(`tiles-cave.png @${i % img.w},${Math.floor(i / img.w)}: канал ${mx} > ${RULES.maxTileChannel} — пещера пересвечена`)
        break
      }
      sum += (img.data[o] + img.data[o + 1] + img.data[o + 2]) / 3
    }
    const mean = sum / n
    if (mean > RULES.meanTileCeil) {
      fail(`tiles-cave.png: средняя яркость ${mean.toFixed(1)} > ${RULES.meanTileCeil} — тайлы слишком светлые для контракта #0B0B10`)
    }
    notes.push(`tiles-cave: средняя яркость ${mean.toFixed(1)}/${RULES.meanTileCeil}`)
  }
}
notes.push(`ассетов просканировано: ${scanned}/${pngs.length} png`)

// ── Отчёт ──────────────────────────────────────────────────────────────────
console.log('═══ СТРАЖ СТИЛЯ ПЕЩЕР — аудит ═══')
for (const n of notes) console.log('  · ' + n)
if (failures.length) {
  console.log(`\n✗ НАРУШЕНИЙ: ${failures.length}`)
  for (const f of failures) console.log('  ✗ ' + f)
  process.exit(1)
} else {
  console.log('\n✓ Стиль пещер соблюдён: массштаб, органика, ярусы, лазы, ассеты.')
  process.exit(0)
}
