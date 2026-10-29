/**
 * gen-step25.mjs — шаг 25/26: нейро-арт Матки Улья и экспедиций людей.
 *
 * 1) МАТКА УЛЬЯ — финальный босс: исполинская матка-инкубатор.
 *    В игре масштабируется ×2.4 (queen.json stats.scale), лист — тот же
 *    конвейер 4 кадра 68×46 (drawH 44 — кадр заполнен, как у героя).
 * 2) УЧЁНЫЙ экспедиции — prey: фонарь, химзащита, чемоданчик образцов.
 * 3) КОНВОИР экспедиции — hunter: броня, карабин с подствольной лампой.
 *
 * Пайплайн как в gen-step24.mjs: master (стиль-якорь = master героя) →
 * sheet 4 кадра (ref = master вида) → нарезка process-mobs.mjs
 * (SPECIES там дополнены). Сервис ai.gptml.ru, слот один — строго
 * последовательно, reconcile по видовому якорю.
 *
 * Запуск: node scripts/gen-step25.mjs [--only queen,scientist,marine]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_MOBS = join(HERE, '..', 'design', 'raw', 'mobs', 'nana-pro')
mkdirSync(OUT_MOBS, { recursive: true })
const TOKEN = readFileSync('/home/z/my-project/scripts/agrai_token.txt', 'utf8').trim()
const BASE = 'https://ai.gptml.ru'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const argv = process.argv.slice(2)
const onlyArg = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null
const ONLY = new Set(onlyArg ? onlyArg.split(',') : ['queen', 'scientist', 'marine'])

const MODEL = 'nana-pro'
const MODEL_NAME = 'Генерация фото • Nano Banana Pro'
const HERO_MASTER = join(HERE, '..', 'design', 'raw', 'v3', 'master.png')

const STYLE = 'Dark fantasy cave creature design, crisp pixel art style, clean readable silhouette, single game asset sprite. Flat solid magenta background #FF00FF. Full body, side view facing right, ground baseline near the bottom. No text, no watermark, no border.'

const SPECIES = {
  queen: {
    master: '2D game boss sprite: colossal hive queen broodmother, a pale chitinous horror the size of a small hill — a massive egg-sac abdomen with translucent membrane clutches of glowing red eggs #E23A4E, a crown of jagged bone spikes on a small armored head with a CLUSTER of many small glowing red eyes, a wide fanged maw, several small stubby legs under the bulk. Dark charcoal-violet chitin plates #1c1220 with cracks of dim crimson glow. Low-slung, anchored, heavy, regal and repulsive at once. ' + STYLE,
    sheet: 'slow breathing cycle of an anchored colossal creature (it does NOT walk): frame1 body at rest, maw closed, egg glow dim; frame2 ribcage-like plates lift as it inhales; frame3 egg-sac membrane pulse, inner red glow flares bright, maw parts slightly; frame4 plates settle back down. The body stays in the SAME place and the SAME size in all frames — only plates, maw and egg glow move. ',
  },
  scientist: {
    master: '2D game character sprite: a cave expedition SCIENTIST, a human explorer in a bulky white-orange hazmat suit with a big round helmet, a bright warm headlamp glowing amber #E8A34F on the forehead, a heavy sample case in one gloved hand. Short stout game proportions (head is large), cautious leaning-forward posture, small flashlight beam cone. Dark fantasy palette: deep charcoal suit shadows with warm amber accent light. ' + STYLE,
    sheet: 'cautious exploration walk cycle: frame1 left leg forward, sample case swings; frame2 passing pose, lamp cone dips; frame3 right leg forward, torso leans ahead; frame4 passing pose, lamp cone rises. Same character, same size all frames, evenly spaced. ',
  },
  marine: {
    master: '2D game character sprite: a cave expedition CONVOY MARINE, a human soldier in heavy dark grey-green armor plating with a tactical helmet that has a glowing red visor slit #E23A4E, holding a compact rifle with an underbarrel flashlight glowing warm amber #E8A34F. Stocky game proportions, wide armored shoulders, boots, steady combat stance. Dark fantasy palette: charcoal armor with muted warm lamp light. ' + STYLE,
    sheet: 'combat patrol walk cycle of FOUR SEPARATE figures with clear magenta space between each pair: frame1 left boot forward, rifle held low ready; frame2 passing pose, rifle tilts up slightly; frame3 right boot forward, rifle ready; frame4 passing pose, shoulders roll. Same character, same size all frames, evenly spaced, NEVER touching each other. ',
  },
}

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
  // 1) Мастера видов (ref = master героя — стиль-якорь палитры).
  for (const id of ['queen', 'scientist', 'marine']) {
    if (!ONLY.has(id)) continue
    const ok = await runJob(
      `${id}-master`, SPECIES[id].master, HERO_MASTER, '1:1',
      join(OUT_MOBS, `${id}-master.jpg`), SPECIES[id].master.slice(0, 80),
    )
    if (!ok) failed++
  }
  // 2) Листы 4 кадра (ref = master вида).
  for (const id of ['queen', 'scientist', 'marine']) {
    if (!ONLY.has(id)) continue
    const masterFile = join(OUT_MOBS, `${id}-master.jpg`)
    if (!existsSync(masterFile)) {
      console.log(`✗ ${id}-sheet: нет мастера`)
      failed++
      continue
    }
    const prompt = `2D game sprite sheet: EXACTLY 4 frames of the same creature from the reference image, arranged in ONE horizontal row with WIDE magenta gaps between the frames (frames must NOT touch or overlap each other), side view facing right. Keep the EXACT same creature design as the reference image — same species, same palette, same pixel-art style. ${SPECIES[id].sheet}All 4 creatures IDENTICAL in size and proportions, evenly spaced, standing on the SAME ground baseline. Dark fantasy cave game. Crisp pixel art style, clean readable silhouettes, game asset. Flat solid magenta background #FF00FF everywhere. No text, no grid, no frame numbers, no watermark, no border.`
    const ok = await runJob(`${id}-sheet`, prompt, masterFile, '16:9',
      join(OUT_MOBS, `${id}-sheet.jpg`), SPECIES[id].sheet.slice(0, 80))
    if (!ok) failed++
  }
  console.log(failed === 0 ? 'ГОТОВО' : `ЗАВЕРШЕНО С ОШИБКАМИ: ${failed}`)
  process.exitCode = failed === 0 ? 0 : 1
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
