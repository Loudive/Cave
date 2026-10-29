// measure-hero.mjs — замер alpha-bbox каждого кадра всех листов героя
// и расчёт фактического видимого размера с учётом per-anim scale из anims.json.
import { loadImage } from 'node:canvas';
import fs from 'node:fs';

const ANIMS = ['idle', 'run', 'glide', 'bite', 'eat', 'hurt', 'death'];
const FW = 68, FH = 46;
const cfg = JSON.parse(fs.readFileSync('src/config/anims.json', 'utf8'));
const unwrap = (o) => (o && typeof o === 'object' && '_doc' in o && 'value' in o ? o.value : o);

function bboxOfImageData(ctx, x0, y0, w, h) {
  const data = ctx.getImageData(x0, y0, w, h).data;
  let minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, mass = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = data[(y * w + x) * 4 + 3];
      if (a > 24) {
        mass++;
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: x0 + minX, y: y0 + minY, w: maxX - minX + 1, h: maxY - minY + 1, mass };
}

const rows = [];
for (const name of ANIMS) {
  const img = await loadImage(`assets/hero-${name}.png`);
  const { createCanvas } = await import('node:canvas');
  const cv = createCanvas(img.width, img.height);
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const cols = Math.floor(img.width / FW);
  const rowsN = Math.floor(img.height / FH);
  const spec = cfg[name];
  const frames = unwrap(spec.frames);
  const scale = unwrap(spec.scale ?? { value: 1 });
  const order = unwrap(spec.order) ?? null;
  // перебираем все клетки листа
  for (let r = 0; r < rowsN; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx >= frames) continue;
      const b = bboxOfImageData(ctx, c * FW, r * FH, FW, FH);
      if (!b) { rows.push([name, idx, 'EMPTY', 0, 0, 0, scale]); continue; }
      rows.push([name, idx, b.w + 'x' + b.h, b.w, b.h, b.mass, scale]);
    }
  }
  // какие кадры реально в игре
  if (order) console.log(`  ${name}: order=${JSON.stringify(order)} scale=${scale}`);
  else console.log(`  ${name}: frames=0..${frames - 1} scale=${scale}`);
}

console.log('\nanim   frame  bbox    w*h   mass   scale  effective(w x h)');
const perAnim = {};
for (const [name, idx, bb, w, h, mass, scale] of rows) {
  if (bb === 'EMPTY') continue;
  const effW = (w * scale).toFixed(1), effH = (h * scale).toFixed(1);
  console.log(`${name.padEnd(7)} ${String(idx).padStart(3)}  ${String(bb).padEnd(7)} ${String(w * h).padStart(5)} ${String(mass).padStart(6)}  ${scale.toFixed(2)}  ${effW} x ${effH}`);
  (perAnim[name] ??= []).push({ w: w * scale, h: h * scale, mass: mass * scale * scale });
}
console.log('\n=== средний видимый размер по анимации (после scale) ===');
for (const [name, arr] of Object.entries(perAnim)) {
  const avg = (k) => arr.reduce((s, o) => s + o[k], 0) / arr.length;
  console.log(`${name.padEnd(7)} avgW=${avg('w').toFixed(1)} avgH=${avg('h').toFixed(1)} avgMass=${avg('mass').toFixed(0)} spreadW=${(Math.max(...arr.map(o=>o.w))-Math.min(...arr.map(o=>o.w))).toFixed(1)} spreadH=${(Math.max(...arr.map(o=>o.h))-Math.min(...arr.map(o=>o.h))).toFixed(1)}`);
}
