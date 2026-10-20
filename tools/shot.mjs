// Dev tool: take one screenshot of the game in headless Chromium.
//   node tools/shot.mjs --out shots/a.png [--query "seed=7"] [--eval "__hotwire.cine(12)"] [--w 1600 --h 900]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { startServer } from './serve.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const out = resolve(opt('out', 'shots/shot.png'));
const query = opt('query', '');
const evalJs = opt('eval', '');
const width = Number(opt('w', 1600)), height = Number(opt('h', 900));
mkdirSync(dirname(out), { recursive: true });

const srv = await startServer(0);
const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width, height } });
const logs = [];
page.on('console', (m) => { const t = `[${m.type()}] ${m.text()}`; logs.push(t); if (m.type() === 'error' || m.type() === 'warning') console.log(t); });
page.on('pageerror', (e) => { console.log('[pageerror]', e.message); logs.push('PAGEERROR ' + e.message); });
const url = `${srv.url}?capture=1${query ? '&' + query : ''}`;
const t0 = Date.now();
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__hotwire && window.__hotwire.ready, null, { timeout: 120000 });
console.log(`ready in ${Date.now() - t0} ms`);
if (evalJs) { const r = await page.evaluate(evalJs); if (r !== undefined) console.log('eval', JSON.stringify(r)); }
const t1 = Date.now();
await page.evaluate(() => window.__hotwire.render());
console.log(`render ${Date.now() - t1} ms`);
const stats = await page.evaluate(() => window.__hotwire.stats());
console.log('stats', JSON.stringify(stats));
console.log('state', JSON.stringify(await page.evaluate(() => window.__hotwire.getState())));
await page.screenshot({ path: out });
console.log('saved', out);
await browser.close();
await srv.close();
