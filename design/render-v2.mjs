// Renders every [data-shot] in setup-v2.html to shots-v2/<name>.png at 2x.
// Usage: node render-v2.mjs [name-prefix]   (needs playwright-core + a Chromium; set PW_CORE / CHROME to override)
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
const here = path.dirname(fileURLToPath(import.meta.url));
const core = process.env.PW_CORE || path.join(os.homedir(), '.npm/_npx/a78846c3c5730f70/node_modules/playwright-core/index.js');
const pw = await import(pathToFileURL(core).href);
const chromium = pw.chromium || pw.default.chromium;
const exe = process.env.CHROME || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const prefix = process.argv[2] || '';
const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(path.join(here, 'setup-v2.html')).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
for (const el of await page.$$('[data-shot]')) {
  const name = await el.getAttribute('data-shot');
  if (!name.startsWith(prefix)) continue;
  await el.screenshot({ path: path.join(here, 'shots-v2', name + '.png') });
  console.log('shot', name);
}
await browser.close();
