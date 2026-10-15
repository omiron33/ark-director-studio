// Headless check of every tab at 2560x1440: screenshots, page overflow and console errors.
//   node tests/ui-shots.mjs <studio url> <out dir> [projectId] [--sketch]
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const [base = 'http://localhost:5320', out = 'shots', projectId, flag] = process.argv.slice(2);
const exe = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: exe, headless: true });
const report = [];
try {
  const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'TOMB' : undefined));
  await page.goto(base);
  await page.evaluate((id) => { localStorage.clear(); if (id) localStorage.setItem('ads.project', JSON.stringify(id)); localStorage.setItem('ads.mode', JSON.stringify('expert')); }, projectId);
  await page.reload();
  await page.waitForTimeout(1500);
  const tabs = await page.$$eval('nav.tabs button.tab', (b) => b.map((x) => x.textContent.trim().replace(/\d+$/, '')));
  const shoot = async (name) => {
    await page.waitForTimeout(900);
    const o = await page.evaluate(() => ({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth,
      clipped: [...document.querySelectorAll('.card')].filter((c) => { const r = c.getBoundingClientRect(); return r.bottom > innerHeight + 1 || r.right > innerWidth + 1; }).length }));
    const file = path.join(out, `${String(report.length + 1).padStart(2, '0')}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`);
    await page.screenshot({ path: file });
    report.push({ name, file, overflow: o.h > o.ih || o.w > o.iw, cardsOffScreen: o.clipped, errors: errors.splice(0) });
  };
  if (flag !== '--sketch-only') for (const t of tabs) {
    await page.click(`nav.tabs button.tab:has-text("${t}")`);
    await shoot(t);
  }
  if (flag === '--sketch' || flag === '--sketch-only') {
    await page.click('nav.tabs button.tab:has-text("Sketch")');
    await page.waitForTimeout(800);
    const box = await page.locator('.paper-svg').boundingBox();
    const at = (x, y) => [box.x + box.width * x, box.y + box.height * y];
    const dragTo = async (key, a, b) => {
      await page.keyboard.press(key);
      await page.mouse.move(...at(...a)); await page.mouse.down();
      await page.mouse.move(...at(...b), { steps: 8 }); await page.mouse.up();
    };
    await page.click('.card-head h2'); // focus out of inputs
    await dragTo('l', [0.02, 0.86], [0.98, 0.86]);         // the ground
    await dragTo('b', [0.62, 0.32], [0.9, 0.86]);          // the tomb
    await dragTo('c', [0.76, 0.6], [0.76, 0.86]);          // its dark doorway
    await dragTo('f', [0.36, 0.38], [0.36, 0.86]);         // Jesus
    await dragTo('l', [0.36, 0.53], [0.52, 0.42]);         // his raised arm
    await dragTo('f', [0.16, 0.6], [0.2, 0.86]);           // Martha, smaller, behind
    await dragTo('a', [0.42, 0.45], [0.6, 0.52]);          // he calls toward the doorway
    await page.keyboard.press('t'); await page.mouse.click(...at(0.66, 0.28));
    await page.fill('textarea[placeholder^="Left figure"]', 'The tall figure in the middle is Jesus, one arm raised toward the tomb. The small figure on the left is Martha. The box is a rock-cut tomb in the hillside, the circle its dark open doorway.');
    await shoot('Sketch drawn');
    if (flag === '--sketch') {
      await page.click('button:has-text("Generate")');
      await page.waitForTimeout(1500);
      await shoot('Sketch generating');
    }
  }
} finally {
  await browser.close();
}
fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 1));
for (const r of report) console.log(`${r.name.padEnd(20)} overflow=${r.overflow} offscreen=${r.cardsOffScreen} errors=${r.errors.length}${r.errors.length ? ' ' + r.errors[0].slice(0, 160) : ''}`);
