// Grok Imagine through the Grok subscription's web app, driven in a real browser window with the
// studio's own profile (data/grok-profile). Sign in once yourself with "Open Grok" in Settings; the
// studio never handles the password. If Grok shows a check or a captcha, the job stops and says so:
// solve it in that window, then retry.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page, type Response } from 'playwright-core';
import { config } from './config.ts';

let ctx: BrowserContext | null = null;
let busy: Promise<unknown> = Promise.resolve();

async function context(): Promise<BrowserContext> {
  if (ctx) return ctx;
  fs.mkdirSync(config.grok.profileDir, { recursive: true });
  ctx = await chromium.launchPersistentContext(config.grok.profileDir, {
    executablePath: config.grok.browser,
    headless: false,
    viewport: null,
    args: ['--window-size=1400,1000', '--no-first-run', '--no-default-browser-check'],
    acceptDownloads: true,
  });
  ctx.on('close', () => { ctx = null; });
  return ctx;
}

export async function grokStatus() {
  const profile = fs.existsSync(path.join(config.grok.profileDir, 'Default'));
  if (!ctx) return { profile, signedIn: undefined };
  const cookies = await ctx.cookies('https://grok.com').catch(() => []);
  return { profile, signedIn: cookies.some((c) => /sso|auth|session/i.test(c.name)) };
}

export async function openGrok() {
  const c = await context();
  const page = c.pages()[0] ?? await c.newPage();
  await page.goto(config.grok.imagineUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.bringToFront();
}

export async function closeGrok() {
  if (ctx) { await ctx.close().catch(() => {}); ctx = null; }
}

const blocked = async (page: Page) => {
  const t = (await page.content().catch(() => '')).toLowerCase();
  return /verify you are human|captcha|cf-challenge|challenge-platform/.test(t);
};

async function promptBox(page: Page) {
  for (const sel of ['textarea', 'div[contenteditable="true"]', '[role="textbox"]']) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) return el;
  }
  throw Error('could not find the Grok Imagine prompt box; is the window signed in?');
}

// Generate on Grok Imagine and save what it makes. kind 'video' with an image animates that image.
export function grokGenerate({ prompt, kind, image, outDir, count = 1, timeoutMs = 6 * 60000, onLine }: { prompt: string; kind: 'image' | 'video'; image?: string; outDir: string; count?: number; timeoutMs?: number; onLine?: (l: string) => void }): Promise<string[]> {
  const job = busy.then(() => runGenerate({ prompt, kind, image, outDir, count, timeoutMs, onLine }));
  busy = job.catch(() => {});
  return job;
}

async function runGenerate({ prompt, kind, image, outDir, count, timeoutMs, onLine }: { prompt: string; kind: 'image' | 'video'; image?: string; outDir: string; count: number; timeoutMs: number; onLine?: (l: string) => void }) {
  const c = await context();
  const page = await c.newPage();
  const saved: string[] = [];
  const seen = new Set<string>();
  fs.mkdirSync(outDir, { recursive: true });
  const want = kind === 'video' ? /video\/(mp4|webm)/ : /image\/(png|jpe?g|webp)/;
  const onResponse = async (r: Response) => {
    try {
      const type = r.headers()['content-type'] ?? '';
      if (!want.test(type) || seen.has(r.url()) || r.request().method() !== 'GET') return;
      if (!/grok|x\.ai|imagine|assets/.test(new URL(r.url()).hostname + r.url())) return;
      const body = await r.body();
      if (body.length < (kind === 'video' ? 200_000 : 60_000)) return; // thumbnails and icons
      seen.add(r.url());
      const ext = type.includes('webm') ? 'webm' : type.includes('mp4') ? 'mp4' : type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
      const f = path.join(outDir, `grok-${Date.now()}-${saved.length}.${ext}`);
      fs.writeFileSync(f, body);
      saved.push(f);
      onLine?.(`saved ${path.basename(f)} (${Math.round(body.length / 1024)} KB)`);
    } catch {}
  };
  try {
    await page.goto(config.grok.imagineUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    if (await blocked(page)) throw Error('Grok is showing a human check; solve it in the Grok window, then retry');
    if (/login|sign-in|signin/.test(page.url())) throw Error('Grok is not signed in; use Open Grok in Settings and sign in once');
    if (image) {
      const input = page.locator('input[type="file"]').first();
      await input.setInputFiles(image, { timeout: 15000 });
      onLine?.('attached the start image');
      await page.waitForTimeout(2500);
    }
    if (kind === 'video') {
      const toggle = page.getByRole('button', { name: /video/i }).first();
      if (await toggle.isVisible().catch(() => false)) await toggle.click().catch(() => {});
    }
    page.on('response', onResponse);
    const box = await promptBox(page);
    await box.click();
    await box.fill(prompt).catch(async () => { await page.keyboard.type(prompt, { delay: 2 }); });
    await page.keyboard.press('Enter');
    onLine?.(`submitted to Grok Imagine (${kind})`);
    const t0 = Date.now();
    while (saved.length < count && Date.now() - t0 < timeoutMs) {
      await page.waitForTimeout(3000);
      if (await blocked(page)) throw Error('Grok is showing a human check; solve it in the Grok window, then retry');
    }
    // nothing caught on the wire: fall back to the largest finished media element on the page
    if (!saved.length) {
      const src = await page.evaluate((k) => {
        const els = Array.from(document.querySelectorAll(k === 'video' ? 'video' : 'img')) as any[];
        const big = els.filter((e) => (e.naturalWidth || e.videoWidth || e.clientWidth) >= 400).map((e) => e.currentSrc || e.src).filter(Boolean);
        return big[big.length - 1] ?? null;
      }, kind);
      if (src) {
        const res = await page.request.get(src);
        const f = path.join(outDir, `grok-${Date.now()}.${kind === 'video' ? 'mp4' : 'jpg'}`);
        fs.writeFileSync(f, await res.body());
        saved.push(f);
      }
    }
    if (!saved.length) throw Error('Grok Imagine did not return anything in time');
    return saved.slice(0, count);
  } finally {
    page.off('response', onResponse);
    await page.close().catch(() => {});
  }
}
