/**
 * gen-step24.mjs — шаг 24: нейро-генерация артов по заказу игрока.
 *
 * 1) Два НОВЫХ хищника «как герой-монстр» (другие спрайты):
 *    stalker  «Глубинный сталкер» — сухопутная стая, быстрые рывки;
 *    devourer «Пожиратель глубин» — апекс-хищник, огромная пасть.
 *    Пайплайн тот же, что у 6 видов шага 20: master (стиль-якорь =
 *    master героя) → sheet 4 кадра (ref = master вида). Режет
 *    process-mobs.mjs (виды добавлены в его SPECIES).
 *
 * 2) Два листа UI-иконок древа навыков (4×2 = 8 иконок на лист,
 *    маджента-фон, широкие промежутки — компоненты найдёт слайсер
 *    process-icons.mjs). Стиль-якорь — тоже master героя: палитра
 *    игры #0B0B10 + биолюм-акценты.
 *
 * Сервис ai.gptml.ru, слот один — строго последовательно; reconcile
 * по видовому якорю в промпте (как gen-mobs.mjs, шаг 21/22).
 *
 * Запуск: node scripts/gen-step24.mjs [--only stalker,devourer,icons-a,icons-b]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_MOBS = join(HERE, '..', 'design', 'raw', 'mobs', 'nana-pro')
const OUT_ICONS = join(HERE, '..', 'design', 'raw', 'icons')
mkdirSync(OUT_ICONS, { recursive: true })
const TOKEN = readFileSync('/home/z/my-project/scripts/agrai_token.txt', 'utf8').trim()
const BASE = 'https://ai.gptml.ru'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const argv = process.argv.slice(2)
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null
const ONLY = new Set(onlyArg ? onlyArg.split(',') : ['stalker', 'devourer', 'icons-a', 'icons-b'])

const MODEL = 'nana-pro'
const MODEL_NAME = 'Генерация фото • Nano Banana Pro'
const HERO_MASTER = join(HERE, '..', 'design', 'raw', 'v3', 'master.png')

const STYLE = 'Dark fantasy cave creature, bioluminescent. Crisp pixel art style, clean readable silhouette, single game asset sprite. Flat solid magenta background #FF00FF. Full body, side view facing right, ground baseline near the bottom. No text, no watermark, no border.'

// ── Новые хищники: «такие же хищники, как герой-монстр, но другие спрайты» ──
const SPECIES = {
  stalker: {
    master: '2D game character sprite: sleek subterranean stalker predator, a long-limbed cave panther with translucent pale skin stretched over visible ribs and spine; oversized clawed front limbs for pouncing, small predatory head with TWO glowing red eyes #E23A4E and a wide fanged mouth, a line of dim teal bioluminescent dots running along its spine ridge #58E6C8, whip-thin tail. Lean, low, READY TO POUNCE stance; angular silhouette that reads DEADLY. ' + STYLE,
    sheet: 'prowl walk cycle: frame1 body stretched low in a long stride, head forward; frame2 body gathers, front limbs coil under the chest; frame3 compressed crouch, spine dots flare bright, head lowered; frame4 explosive extension, front limbs reaching forward. The body and head stay the SAME size in all frames — only the limbs and spine change. ',
  },
  devourer: {
    master: '2D game character sprite: massive cave devourer apex predator, a bloated armored horror the shape of a giant salamander crossed with a trap-jaw fish; an enormous mouth taking HALF its body, ringed with rows of jagged bone fangs and a deep red inner throat glow #E23A4E, thick plated charcoal hide with cracks of dim ember #E2763A, four stubby powerful legs, small deep-set glowing eyes, heavy low-slung bulk. ' + STYLE,
    sheet: 'heavy ponderous stride cycle: frame1 left legs reach forward, mouth slightly open, throat glow dim; frame2 right legs push, body rolls a hair, mouth closes; frame3 jaws part WIDE, throat glow flares bright; frame4 jaws snap shut, body settles. The bulk of the body stays the SAME size in all frames — legs and jaws do the work. ',
  },
}

// ── Иконки древа: 2 листа × 8 (4×2), маджента, «широкие промежутки» ─────────
const ICON_SHEET_PROMPT_HEAD = '2D game UI icon sheet: EXACTLY 8 distinct icons arranged in a 4x2 grid (4 columns, 2 rows), with WIDE magenta gaps between icons (icons must NOT touch or overlap). Each icon is a SINGLE centered subject that fills its cell, no text, no numbers, no border, no frame. Dark fantasy cave game style, crisp pixel art, thick readable silhouette readable at small size, very dark charcoal base #1a1a26 with bioluminescent accent colors. Flat solid magenta background #FF00FF everywhere. Top row, left to right: '

const ICONS_A = [
  '1) a pair of long predator FANGS with a drop of venom;',
  '2) an open monster JAW TRAP full of jagged teeth;',
  '3) a single glossy BLOOD DROP;',
  '4) a three-toed CLAW SCRATCH slash mark;',
  '5) a raw dark HEART with glowing veins;',
  '6) a BONE PLATE SHIELD (rib-cage armor plate);',
  '7) a coiled STOMACH organ with faint inner glow;',
  '8) a single glowing red EYE with slit pupil. Bottom row: none.',
]
const ICONS_B = [
  '1) a single spread BAT WING membrane;',
  '2) a soft PAW PRINT track;',
  '3) a cluster of small glowing teal CAVE MUSHROOMS;',
  '4) a tongue of dark ember FLAME;',
  '5) a sharp teal CRYSTAL SHARD;',
  '6) a DNA DOUBLE HELIX strand with glowing rungs;',
  '7) a wispy SHADOW GHOST wisp;',
  '8) a dark NEST with one glowing EGG inside. Bottom row: none.',
]
const ICON_TAIL = ' Keep all 8 icons in the SAME pixel art style and scale, evenly spaced, aligned to the grid.'

const cookie = () => `agrai_session=${TOKEN}`

async function api(path, opts = {}) {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: { Cookie: cookie(), 'User-Agent': UA, ...(opts.headers || {}) },
  })
  return res
}

async function listJobs() {
  const res = await api('/api/generations?limit=50&offset=0')
  if (!res.ok) throw new Error(`list ${res.status}`)
  const j = await res.json()
  return j.items || []
}

async function download(job, file) {
  const res = await api(`/api/generations/${job.id}/download`)
  if (!res.ok) throw new Error(`download ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(file, buf)
  return buf.length
}

async function uploadRef(file) {
  // Сервис иногда отдаёт 504 на reference-upload — ретраи с паузой.
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const buf = readFileSync(file)
      const isJpeg = buf[0] === 0xff && buf[1] === 0xd8
      const fd = new FormData()
      fd.append('file', new Blob([buf], { type: isJpeg ? 'image/jpeg' : 'image/png' }), `ref.${isJpeg ? 'jpg' : 'png'}`)
      const res = await api('/api/generations/reference-upload', { method: 'POST', body: fd })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(`${res.status} ${j.error || ''}`)
      return j.url
    } catch (e) {
      console.log(`  uploadRef попытка ${attempt} не удалась: ${e.message} — жду ${attempt * 8}с`)
      await sleep(attempt * 8000)
    }
  }
  throw new Error(`upload ${file}: исчерпаны попытки`)
}

async function submit(prompt, refUrl, aspect) {
  const body = {
    clientRequestId: crypto.randomUUID(),
    modelId: 'photo',
    modelName: MODEL_NAME,
    prompt: prompt + ' ',
    aspectRatio: aspect,
    photoModelVariant: MODEL,
    inputMode: refUrl ? 'IMAGE_REF' : 'TEXT',
    ...(refUrl ? { referenceImageUrl: refUrl, referenceImageUrls: [refUrl] } : {}),
  }
  const res = await api('/api/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, status: res.status, error: j.error || '' }
  return { ok: true, id: j.id }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function runJob(label, prompt, refFile, aspect, outFile, anchor) {
  if (existsSync(outFile)) {
    console.log(`✓ ${label} уже скачан — пропуск`)
    return true
  }
  const refUrl = refFile ? await uploadRef(refFile) : null
  const isMine = (j) => (j.prompt || '').includes(anchor)
    && (j.modelName || '').includes('Nano Banana')
  let jobs = await listJobs()
  let mine = jobs.find(isMine)
  if (mine && (mine.status === 'ERROR' || mine.status === 'FAILED')) mine = null
  if (!mine) {
    console.log(`→ ${label}: подаю заявку (${aspect})…`)
    const r = await submit(prompt, refUrl, aspect)
    if (!r.ok) {
      if (r.status === 409 || /already|заявок/i.test(r.error || '')) {
        console.log('  слот занят — жду 30с')
        await sleep(30000)
      } else {
        console.log(`  ошибка ${r.status}: ${r.error} — жду 15с, повтор`)
        await sleep(15000)
      }
      jobs = await listJobs()
      mine = jobs.find(isMine)
      if (!mine) {
        console.log('  не удалось подать — пропуск')
        return false
      }
    } else {
      console.log(`  заявка ${r.id}`)
      mine = { id: r.id, status: 'PROCESSING' }
    }
  } else {
    console.log(`→ ${label}: подхвачена ${mine.id} (${mine.status})`)
  }
  const deadline = Date.now() + 8 * 60 * 1000
  while (Date.now() < deadline) {
    jobs = await listJobs()
    mine = jobs.find((j) => j.id === mine.id) || mine
    if (mine.status === 'SUCCESS') break
    if (mine.status === 'ERROR' || mine.status === 'FAILED') {
      console.log(`  ✗ ошибка генерации: ${mine.errorMessage}`)
      return false
    }
    if (mine.status !== 'SUCCESS') process.stdout.write(`  ${mine.status}…\n`)
    await sleep(9000)
  }
  if (mine && mine.status === 'SUCCESS') {
    const size = await download(mine, outFile)
    console.log(`  ✓ ${label} (${(size / 1024).toFixed(0)} КБ)`)
    return true
  }
  console.log(`  ✗ таймаут для ${label}`)
  return false
}

async function main() {
  let failed = 0
  // 1) Мастера хищников (ref = master героя, стиль-якорь).
  for (const id of ['stalker', 'devourer']) {
    if (!ONLY.has(id)) continue
    const ok = await runJob(
      `${id}-master`, SPECIES[id].master, HERO_MASTER, '1:1',
      join(OUT_MOBS, `${id}-master.jpg`), SPECIES[id].master.slice(0, 80),
    )
    if (!ok) failed++
  }
  // 2) Листы 4 кадра (ref = master вида).
  for (const id of ['stalker', 'devourer']) {
    if (!ONLY.has(id)) continue
    const masterFile = join(OUT_MOBS, `${id}-master.jpg`)
    if (!existsSync(masterFile)) {
      console.log(`✗ ${id}-sheet: нет мастера`)
      failed++
      continue
    }
    const prompt = `2D game sprite sheet: EXACTLY 4 frames of the same creature from the reference image, arranged in ONE horizontal row with WIDE magenta gaps between the frames (frames must NOT touch or overlap each other), side view facing right. Keep the EXACT same creature design as the reference image — same species, same palette, same pixel-art style. ${SPECIES[id].sheet}All 4 creatures IDENTICAL in size and proportions, evenly spaced, standing on the SAME ground baseline. Dark fantasy cave creature, bioluminescent. Crisp pixel art style, clean readable silhouettes, game asset. Flat solid magenta background #FF00FF everywhere. No text, no grid, no frame numbers, no watermark, no border.`
    const ok = await runJob(`${id}-sheet`, prompt, masterFile, '16:9',
      join(OUT_MOBS, `${id}-sheet.jpg`), SPECIES[id].sheet.slice(0, 80))
    if (!ok) failed++
  }
  // 3) Листы иконок (ref = master героя как палитровый якорь).
  const sheets = [
    ['icons-a', ICONS_A, 'fangs-jaw-blood-claw'],
    ['icons-b', ICONS_B, 'wing-paw-mushroom-flame'],
  ]
  for (const [key, list, anchor] of sheets) {
    if (!ONLY.has(key)) continue
    const prompt = ICON_SHEET_PROMPT_HEAD + list.join(' ') + ICON_TAIL
    const ok = await runJob(key, prompt, HERO_MASTER, '1:1',
      join(OUT_ICONS, `${key}.jpg`), anchor)
    if (!ok) failed++
  }
  console.log(failed === 0 ? 'ГОТОВО' : `ЗАВЕРШЕНО С ОШИБКАМИ: ${failed}`)
  process.exitCode = failed === 0 ? 0 : 1
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
