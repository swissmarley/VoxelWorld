// Plays a scripted session in headless Chromium and writes a screenshot set + contact sheet
// to screenshots/. Deterministic for a given seed (physics runs in fixed steps; no wall clock).
//   node tools/capture.mjs [--seed 7] [--out screenshots] [--w 1600 --h 900]
import { mkdirSync, writeFileSync, existsSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { openGame } from './browser.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const seed = Number(opt('seed', 7));
const outDir = resolve(opt('out', 'screenshots'));
const width = Number(opt('w', 1600)), height = Number(opt('h', 900));
mkdirSync(outDir, { recursive: true });
for (const f of readdirSync(outDir)) if (/^\d\d-.*\.png$/.test(f)) unlinkSync(join(outDir, f));

const t0 = Date.now();
const game = await openGame({ width, height, query: `seed=${seed}` });
const shots = [];
async function shot(name, caption) {
  const file = join(outDir, name);
  await game.shot(file);
  shots.push({ name, caption });
  console.log(`  ${name}  ${caption}`);
}

console.log(`capturing seed ${seed} at ${width}x${height} ...`);
// 1. title screen over the cinematic flyover
await game.hw('__hotwire.cine(14)');
await shot('01-title.png', 'Title screen over the slow flyover of downtown');

// 2. on foot, next to a tempting car
await game.hw('__hotwire.start(); __hotwire.step(1.2)');
await shot('02-on-foot.png', 'On foot on the plaza sidewalk, a Marlin parked at the curb');

// 3. steal it
await game.hw('__hotwire.enterNearestCar(); __hotwire.step(1.0)');
await shot('03-stolen.png', 'Just stolen: the card slides in, the engine is running');

// 4. drive fast down the street
await game.hw('__hotwire.setInput({forward:1}); __hotwire.step(4.6)');
await shot('04-speed.png', 'Flat out down the avenue, chase camera widening with speed');

// 5. handbrake slide
await game.hw('__hotwire.setInput({back:1}); __hotwire.step(0.5); __hotwire.setInput({forward:1, left:1, handbrake:1}); __hotwire.step(0.55); __hotwire.setInput({forward:1, left:0.5}); __hotwire.step(0.35)');
await shot('05-drift.png', 'Handbrake through the intersection, skid marks and tire smoke');

// 6. hand over to the autopilot and wait for a hard crash, then shoot the exact frame
await game.hw('__hotwire.setInput({}); __hotwire.demo(true)');
let crashed = false;
for (let i = 0; i < 60 * 40 && !crashed; i++) {
  const st = await game.hw('(() => { __hotwire.step(1/60); const s = __hotwire.getState(); return s.car ? { t: s.simTime, dv: s.car.lastImpact.dv, it: s.car.lastImpact.t } : null; })()');
  if (st && st.dv > 7 && st.t - st.it < 0.03) crashed = true;
}
await game.hw('__hotwire.step(0.12)');
await shot('06-crash.png', 'The moment of impact: sparks, debris, the body dents');

// 7. keep going until wrecked, then shoot the burning wreck half a second later
let wrecked = false;
for (let i = 0; i < 60 * 120 && !wrecked; i++) {
  const st = await game.hw('(() => { __hotwire.step(1/60); const s = __hotwire.getState(); return s.car ? s.car.wrecked : false; })()');
  if (st) wrecked = true;
}
await game.hw('__hotwire.step(0.55)');
await shot('07-wrecked.png', 'Wrecked: charred body, fire and smoke, time to find another ride');

// 8. ejected, walking away from the wreck toward the next car
let onFoot = false;
for (let i = 0; i < 60 * 6 && !onFoot; i++) {
  const st = await game.hw('(() => { __hotwire.step(1/60); return __hotwire.getState().player.state === "walk"; })()');
  if (st) onFoot = true;
}
await game.hw('__hotwire.cameraMode(1); __hotwire.step(0.9)');
await shot('08-walk-away.png', 'Back on foot, the wreck still burning, hunting for the next car');

// 9. the next car, driving again
let stolenAgain = false;
for (let i = 0; i < 60 * 40 && !stolenAgain; i++) {
  const st = await game.hw('(() => { __hotwire.step(1/60); const s = __hotwire.getState(); return s.player.state === "car" && s.car && !s.car.wrecked; })()');
  if (st) stolenAgain = true;
}
await game.hw('__hotwire.cameraMode(0); __hotwire.step(3.0)');
await shot('09-next-ride.png', 'A new ride through traffic, the loop continues');

// 10. overview with traffic flowing
await game.hw('__hotwire.demo(false); __hotwire.setInput({}); __hotwire.freeCamera(-150, 130, 230, 10, 10, -40); __hotwire.step(2)');
await shot('10-overview.png', 'Downtown from above: the grid, the towers, the traffic');

// 11. the beach
await game.hw('__hotwire.freeCamera(40, 7, 404, -30, 5, 300); __hotwire.step(0.5)');
await shot('11-beach.png', 'The waterfront: promenade, palms, pier and the sea');

// 12. golden-hour street level with long shadows
await game.hw('__hotwire.freeCamera(-28, 2.4, -92, 20, 3, -40); __hotwire.step(0.5)');
await shot('12-street.png', 'Street level at golden hour: long shadows, flat color, clean silhouettes');

const stats = await game.stats();
const state = await game.state();
await game.close();

// contact sheet: a grid page rendered by the same headless browser
let sheet = null;
try {
  const { chromium } = await import('playwright');
  const { startServer } = await import('./serve.mjs');
  const srv = await startServer(0);
  const rel = outDir.replace(resolve('.'), '').replace(/\\/g, '/');
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#1b1727;font-family:Helvetica,Arial,sans-serif}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:8px;width:1920px;box-sizing:border-box}
    figure{margin:0;position:relative}img{width:100%;display:block;border-radius:6px}
    figcaption{position:absolute;left:0;right:0;bottom:0;padding:6px 10px;background:rgba(27,23,39,.75);color:#fff4e3;font-size:13px;letter-spacing:.02em;border-radius:0 0 6px 6px}
    h1{color:#fff4e3;font-size:22px;margin:14px 16px 4px;letter-spacing:.2em}h1 span{color:#ff8a3d}</style>
    <h1>HOT<span>WIRE</span> — seed ${seed}</h1><div class="grid">${shots.map((s) => `<figure><img src="${rel}/${s.name}"><figcaption>${s.name.replace(/^\d\d-/, '').replace('.png', '')} — ${s.caption}</figcaption></figure>`).join('')}</div>`;
  writeFileSync(join(outDir, '_sheet.html'), html);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
  await page.goto(`${srv.url}${rel.replace(/^\//, '')}/_sheet.html`, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(outDir, 'contact-sheet.jpg'), fullPage: true, type: 'jpeg', quality: 82 });
  await browser.close(); await srv.close();
  unlinkSync(join(outDir, '_sheet.html'));
  sheet = 'contact-sheet.jpg';
  console.log('  contact-sheet.jpg');
} catch (e) { console.log('contact sheet failed:', e.message); }

const md = [`# HOTWIRE screenshots`, ``, `Captured automatically by \`npm run capture\` (seed ${seed}, ${width}×${height}, headless Chromium + SwiftShader).`, ``,
  ...(sheet ? [`![contact sheet](${sheet})`, ``] : []),
  ...shots.map((s) => `## ${s.name}\n\n${s.caption}\n\n![${s.caption}](${s.name})\n`),
  `## Session stats`, '', '```json', JSON.stringify({ ...stats, finalState: state.player.state, errors: game.errors }, null, 2), '```', ''].join('\n');
writeFileSync(join(outDir, 'README.md'), md);
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s — ${shots.length} shots, stats:`, JSON.stringify(stats));
if (game.errors.length) { console.log('ERRORS:', game.errors); process.exit(1); }
