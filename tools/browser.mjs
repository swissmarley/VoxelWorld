// Shared headless-browser bootstrap for the capture and test tools.
import { chromium } from 'playwright';
import { startServer } from './serve.mjs';

export async function openGame({ width = 1600, height = 900, query = '', log = console.log } = {}) {
  const srv = await startServer(0);
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => { errors.push('pageerror: ' + e.message); log('[pageerror]', e.message); });
  page.on('console', (m) => { if (m.type() === 'error') { errors.push('console.error: ' + m.text()); log('[console.error]', m.text()); } });
  const url = `${srv.url}?capture=1&mute=1${query ? '&' + query : ''}`;
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__hotwire && window.__hotwire.ready, null, { timeout: 180000 });
  const api = {
    page, browser, errors, url,
    eval: (fn, arg) => page.evaluate(fn, arg),
    hw: (js) => page.evaluate(js),
    step: (s) => page.evaluate((s) => window.__hotwire.step(s), s),
    render: () => page.evaluate(() => window.__hotwire.render()),
    state: () => page.evaluate(() => window.__hotwire.getState()),
    stats: () => page.evaluate(() => window.__hotwire.stats()),
    async shot(path) { await page.evaluate(() => window.__hotwire.render()); await page.screenshot({ path }); },
    async close() { await browser.close(); await srv.close(); },
  };
  return api;
}
