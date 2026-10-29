/**
 * gen-mobs.mjs — шаг 20: нейрогенерация НОВЫХ спрайтов и анимаций мобов.
 *
 * Пожелание игрока: «Мобов надо сделать новые спрайты и анимации.
 * Доступ у тебя есть к нейронке. Кроме нана банана там есть чат имадже
 * 2.5 — может он лучше справится?» → две модели сравниваются на одном
 * и том же промпте (тест: bat-master), победитель рисует все 6 видов.
 *
 * Сервис: https://ai.gptml.ru. Аутентификация — cookie `agrai_session`
 * (как в gen-bg.mjs, шаг 17). Варианты photoModelVariant из бандла:
 * nana-pro | gpt-image-2-5 | flux-2-pro | z-image | … — сюда два первых.
 *
 * Двухстадийный пайплайн (как герой в шаге 11):
 *   1) master  — одиночный кадр вида на мадженте, стиль-якорь = master
 *      героя (та же палитра/пиксель-арт язык → вся игра визуально едина);
 *   2) sheet   — 4 кадра анимации, IMAGE_REF = master вида («the same
 *      creature from the reference image» — приём idle.txt героя).
 * Всё режет scripts/process-mobs.mjs (хромакей → компоненты → базлайн).
 *
 * Один слот на пользователя (409) — строго последовательно; reconcile
 * по префиксу промпта (ребут-устойчивость, как gen-bg.mjs).
 *
 * Запуск:
 *   node scripts/gen-mobs.mjs --model gpt-image-2-5 --stage master --only bat
 *   node scripts/gen-mobs.mjs --model nana-pro --stage sheet --only bat
 *   node scripts/gen-mobs.mjs --model gpt-image-2-5 --stage all
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, '..', 'design', 'raw', 'mobs')
const TOKEN = readFileSync('/home/z/my-project/scripts/agrai_token.txt', 'utf8').trim()
const BASE = 'https://ai.gptml.ru'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// ── CLI ───────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 ? argv[i + 1] : null
}
const MODEL = arg('model') === 'gpt-image-2-5' ? 'gpt-image-2-5' : 'nana-pro'
const MODEL_NAME = MODEL === 'gpt-image-2-5'
  ? 'Генерация фото • GPT Image 2.5'
  : 'Генерация фото • Nano Banana Pro'
const STAGE = arg('stage') || 'all' // master | sheet | all
const ONLY = (arg('only') || 'slug,bat,reaper,bloodsucker,shell,lava').split(',')
/** --text: без референса (inputMode TEXT) — для моделей, не берущих IMAGE_REF. */
const TEXTMODE = argv.includes('--text')

// Мастер героя — стиль-якорь всех видов (единый язык игры, шаг 11).
const HERO_MASTER = join(HERE, '..', 'design', 'raw', 'v3', 'master.png')

// ── Промпты видов ─────────────────────────────────────────────────────────
const STYLE = 'Dark fantasy cave creature, bioluminescent. Crisp pixel art style, clean readable silhouette, single game asset sprite. Flat solid magenta background #FF00FF. Full body, side view facing right, ground baseline near the bottom. No text, no watermark, no border.'

const SPECIES = {
  slug: {
    master: '2D game character sprite: plump mouse-like cave slug, a cross between a field mouse and a slug; round soft silhouette that reads HARMLESS; dusty gray-violet pelt #2a2a38, pale gray underbelly, two tiny dark bead eyes, small rounded ears, short whiskers, a faint teal bioluminescent speckle line along its back #58E6C8, stubby clawed feet. Timid and quiet, NOT cartoonish. ' + STYLE,
    sheet: 'slow crawl walk cycle: frame1 body extended in full stride, head forward; frame2 body compresses, head dips; frame3 fully pulled together, whiskers forward; frame4 extends again, head raised. ',
  },
  bat: {
    master: '2D game character sprite: lean small cave bat hunter, agile flier; angular blade-like wings held half-spread, sharp angular silhouette that reads DANGEROUS; near-black membranes and fur #0B0B10 with a faint violet sheen, desaturated teal wing-membrane glow #58E6C8, tiny glowing red eyes #E23A4E, jagged fangs, thin tail membrane, small clawed feet tucked in flight. Feral, NOT cute. ' + STYLE,
    sheet: 'wing flap flight cycle: frame1 wings raised high; frame2 mid-downstroke; frame3 wings fully down, body lifted; frame4 mid-upstroke returning. ',
  },
  reaper: {
    master: '2D game character sprite: gaunt fungal reaper, a thin mushroom-folk wrapped in a tattered spore mantle; hunched rounded body but angular blade-like fringe of gill-blades along the mantle; pale gray-violet flesh #1a1a26, dim purple bioluminescent gill glow #B36BFF seeping from under the mantle rim, small hollow dark eyes, thin long arms with clawed fingers, a few drifting spore motes around it. ' + STYLE,
    sheet: 'hover drift cycle: frame1 body at rest, mantle hanging; frame2 body rises slightly, fringe sways right; frame3 peak hover, gill glow brightest; frame4 sinking back, fringe sways left. ',
  },
  bloodsucker: {
    master: '2D game character sprite: gaunt leech cave hunter; semi-translucent pale gray body with faint inner organs visible through the skin, a huge circular sucker-mouth taking a THIRD of its body, ringed with small hooked teeth; dim red inner throat glow #E23A4E, thin grasping forelimbs, low predatory crouch; angular silhouette that reads DANGEROUS. ' + STYLE,
    sheet: 'slither pulse cycle: frame1 body stretched long, sucker-mouth closed; frame2 body coils, mouth opens slightly; frame3 compressed coil, mouth wide, throat glow bright; frame4 stretching out again, mouth closing. ',
  },
  shell: {
    master: '2D game character sprite: heavy dome creature encased in petrified stone armor; a massive rust-edged carapace like an ancient helmet; dull stone-gray plates #7d7a6a with rusty brown rim highlights, thick armored legs under the dome, tiny deep-set eyes glowing dim teal in the shadow under the rim, small teal crystal growths on the shell #58E6C8; immovable heavy silhouette. ' + STYLE,
    sheet: 'heavy trudge walk cycle: frame1 left legs step forward, dome tilts a hair; frame2 right legs catch up, dome levels; frame3 left again, head pokes out; frame4 settled, head tucked. The dome barely moves — the legs do the work. ',
  },
  lava: {
    master: '2D game character sprite: low-slung armored crawler; dark charcoal plates with molten amber light glowing through the cracks between plates #E2763A, blunt crushing jaws with an ember glow inside, small dark eyes, short heavy legs, faint heat shimmer above its back; angular silhouette that reads DANGEROUS. ' + STYLE,
    sheet: 'crawl cycle: frame1 full stride, plates apart, cracks bright; frame2 plates compress, cracks dim to embers; frame3 coiled, jaws part slightly; frame4 extends, cracks flare again. ',
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

/** Загрузка референса (multipart "file") → {url}. Кэш в uploads.json.
 *  Тип по МАГИЧЕСКИМ байтам (нейро-выгрузки часто лежат jpeg'ом
 *  в файле с расширением .png — сервер проверяет контент, а не имя). */
async function uploadRef(file) {
  const cacheFile = join(OUT, 'uploads.json')
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {}
  const key = file.replace(OUT, '').replace(HERE, '')
  if (cache[key]) return cache[key]
  const buf = readFileSync(file)
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8
  const ext = isJpeg ? 'jpg' : 'png'
  const mime = isJpeg ? 'image/jpeg' : 'image/png'
  const fd = new FormData()
  fd.append('file', new Blob([buf], { type: mime }), `ref.${ext}`)
  const res = await api('/api/generations/reference-upload', { method: 'POST', body: fd })
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`upload ${file}: ${res.status} ${j.error || ''}`)
  cache[key] = j.url
  writeFileSync(cacheFile, JSON.stringify(cache, null, 2))
  return j.url
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

/** Одна заявка: reconcile → submit (с ретраями 409) → поллинг → download. */
async function runJob(label, prompt, refFile, aspect, outFile) {
  if (existsSync(outFile)) {
    console.log(`✓ ${label} уже скачан — пропуск`)
    return true
  }
  const refUrl = TEXTMODE ? null : await uploadRef(refFile)
  // reconcile: промпт-префикс + МОДЕЛЬ (промпты видов одинаковы для обеих
  // моделей — без проверки modelName прогон gpt-image-2-5 подхватил бы
  // готовый результат nana-pro, что и случилось на бете скрипта).
  const isMine = (j) => (j.prompt || '').startsWith(prompt.slice(0, 90))
    && (j.modelName || '').includes(MODEL === 'gpt-image-2-5' ? 'GPT Image' : 'Nano Banana')
  let jobs = await listJobs()
  let mine = jobs.find(isMine)
  // Ошибочные заявки не реюзаем — свежий submit («Попробуйте снова»).
  if (mine && (mine.status === 'ERROR' || mine.status === 'FAILED')) mine = null
  if (!mine) {
    console.log(`→ ${label}: подаю заявку (${MODEL}, ${aspect})…`)
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
  mkdirSync(join(OUT, MODEL), { recursive: true })
  const dir = join(OUT, MODEL)
  let failed = 0
  for (const id of ONLY) {
    const sp = SPECIES[id]
    if (!sp) continue
    if (STAGE === 'master' || STAGE === 'all') {
      const ok = await runJob(
        `${id}-master`,
        sp.master,
        HERO_MASTER,
        '1:1',
        join(dir, `${id}-master.jpg`),
      )
      if (!ok) failed++
    }
  }
  for (const id of ONLY) {
    const sp = SPECIES[id]
    if (!sp) continue
    if (STAGE === 'sheet' || STAGE === 'all') {
      const masterFile = join(dir, `${id}-master.jpg`)
      if (!existsSync(masterFile)) {
        console.log(`✗ ${id}-sheet: нет мастера — сначала --stage master`)
        failed++
        continue
      }
      const prompt = `2D game sprite sheet: EXACTLY 4 frames of the same creature from the reference image, arranged in ONE horizontal row (a 2x2 grid is also acceptable), side view facing right. Keep the EXACT same creature design as the reference image — same species, same palette, same pixel-art style. ${sp.sheet}All 4 creatures IDENTICAL in size and proportions, evenly spaced, standing on the SAME ground baseline. Dark fantasy cave creature, bioluminescent. Crisp pixel art style, clean readable silhouettes, game asset. Flat solid magenta background #FF00FF everywhere. No text, no grid, no frame numbers, no watermark, no border.`
      const ok = await runJob(`${id}-sheet`, prompt, masterFile, '16:9', join(dir, `${id}-sheet.jpg`))
      if (!ok) failed++
    }
  }
  console.log(failed === 0 ? 'ГОТОВО' : `ЗАВЕРШЕНО С ОШИБКАМИ: ${failed}`)
}

main().catch((e) => { console.error('FATAL', e); process.exit(1) })
