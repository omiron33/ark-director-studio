// Grok Imagine through the Grok subscription's web app, in a real Chrome window.
//
// Cloudflare stops a browser that automation launched, so the studio starts an ordinary Chrome itself
// (no automation flags) with a local-only DevTools port and its own profile folder, and attaches to it
// over that port. Chrome does not allow the port on your everyday profile, so this window has its own:
// sign in to Grok once in it ("Open Grok" in Settings) and it stays signed in. The studio never handles
// the password. If Grok shows a human check, the job stops and says so: solve it in that window, retry.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { chromium, type Browser, type BrowserContext, type Page, type Response } from 'playwright-core';
import { config } from './config.ts';

let browser: Browser | null = null;
let ctx: BrowserContext | null = null;
let busy: Promise<unknown> = Promise.resolve();

const cdpUrl = () => `http://127.0.0.1:${config.grok.port}`;
const portUp = async () => { try { return (await fetch(`${cdpUrl()}/json/version`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; } };

// Start the real Chrome window if it is not running yet. Detached: it outlives the studio.
async function startChrome() {
  if (await portUp()) return;
  fs.mkdirSync(config.grok.profileDir, { recursive: true });
  const p = spawn(config.grok.browser, [
    `--remote-debugging-port=${config.grok.port}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${config.grok.profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--window-size=1400,1000', config.grok.imagineUrl,
  ], { detached: true, stdio: 'ignore', windowsHide: false });
  p.unref();
  for (let i = 0; i < 40 && !(await portUp()); i++) await new Promise((r) => setTimeout(r, 500));
  if (!(await portUp())) throw Error('Chrome did not open its DevTools port; is another Chrome using the Grok profile folder?');
}

async function context(): Promise<BrowserContext> {
  if (ctx && browser?.isConnected()) return ctx;
  await startChrome();
  browser = await chromium.connectOverCDP(cdpUrl());
  browser.on('disconnected', () => { browser = null; ctx = null; });
  ctx = browser.contexts()[0] ?? await browser.newContext();
  return ctx;
}

export async function grokStatus() {
  const profile = fs.existsSync(path.join(config.grok.profileDir, 'Default'));
  if (!(await portUp())) return { profile, signedIn: undefined };
  try {
    const c = await context();
    const cookies = await c.cookies('https://grok.com');
    return { profile, signedIn: cookies.some((k) => /sso|auth|session/i.test(k.name)) };
  } catch { return { profile, signedIn: undefined }; }
}

export async function openGrok() {
  const c = await context();
  const page = c.pages().find((p) => p.url().includes('grok.com')) ?? await c.newPage();
  if (!page.url().includes('grok.com')) await page.goto(config.grok.imagineUrl, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.bringToFront();
}

// Detach from the window; the window itself stays open (it is a normal Chrome window).
export async function closeGrok() {
  if (browser) { await browser.close().catch(() => {}); browser = null; ctx = null; }
}

const blocked = async (page: Page) => {
  const t = (await page.content().catch(() => '')).toLowerCase();
  return /verify you are human|captcha|cf-challenge|challenge-platform/.test(t);
};

async function promptBox(page: Page) {
  for (const sel of ['textarea', 'div[contenteditable="true"]', '[role="textbox"]']) {
    const el = page.locator(sel).last();
    if (await el.isVisible().catch(() => false)) return el;
  }
  throw Error('could not find the Grok Imagine prompt box; is the window signed in?');
}

// The picture in the post viewer: the one big image shown on a post page (gallery tiles are small).
const viewerImage = (page: Page) => page.evaluate(() => {
  const big = [...document.querySelectorAll('img')].map((i) => ({ src: i.currentSrc || i.src, w: i.getBoundingClientRect().width, n: i.naturalWidth }))
    .filter((x) => x.src && x.w >= 500 && x.n >= 700);
  return big.length ? big[big.length - 1].src : null;
});
// First result tile on the results page (opens its post).
const openFirstResult = (page: Page) => page.evaluate(() => {
  const tiles = [...document.querySelectorAll('img')].filter((i) => { const r = i.getBoundingClientRect(); return r.width >= 120 && r.width < 500 && r.top > 0 && /generated|data:/.test(i.currentSrc || i.src); });
  const t = tiles[0]?.closest('a,button,[role=button],li,div') as HTMLElement | null;
  if (t) { (tiles[0] as HTMLElement).click(); return true; }
  return false;
});

async function saveSrc(page: Page, src: string, file: string) {
  if (src.startsWith('data:')) { fs.writeFileSync(file, Buffer.from(src.slice(src.indexOf(',') + 1), 'base64')); return; }
  const res = await page.request.get(src);
  if (!res.ok()) throw Error(`Grok image download failed: ${res.status()}`);
  fs.writeFileSync(file, await res.body());
}

// Generate on Grok Imagine and save what it makes.
//  kind 'image' with `image`: Grok edits that picture (our greybox layout) into the scene the prompt describes.
//  kind 'video' with `image`: animates that image.
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
  const onResponse = async (r: Response) => {
    if (kind !== 'video') return;
    try {
      const type = r.headers()['content-type'] ?? '';
      if (!/video\/(mp4|webm)/.test(type) || seen.has(r.url()) || r.request().method() !== 'GET') return;
      const body = await r.body();
      if (body.length < 200_000) return;
      seen.add(r.url());
      const f = path.join(outDir, `grok-${Date.now()}-${saved.length}.${type.includes('webm') ? 'webm' : 'mp4'}`);
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
      await page.locator('input[type="file"]').first().setInputFiles(image, { timeout: 15000 });
      onLine?.('attached the layout image');
      await page.waitForURL(/imagine\/post\//, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2500);
    }
    if (kind === 'video') {
      const toggle = page.getByRole('button', { name: /video/i }).first();
      if (await toggle.isVisible().catch(() => false)) await toggle.click().catch(() => {});
    }
    const startUrl = page.url();
    page.on('response', onResponse);
    const box = await promptBox(page);
    await box.click();
    await box.fill(prompt).catch(async () => { await page.keyboard.type(prompt, { delay: 2 }); });
    await page.keyboard.press('Enter');
    onLine?.(`submitted to Grok Imagine (${kind}${image ? ', editing the layout' : ''})`);
    const t0 = Date.now();
    let last = '', steady = 0, opened = !!image;
    while (saved.length < count && Date.now() - t0 < timeoutMs) {
      await page.waitForTimeout(3000);
      if (await blocked(page)) throw Error('Grok is showing a human check; solve it in the Grok window, then retry');
      if (kind !== 'image') continue;
      if (!opened) { // words only: results land as a grid; open the first one to get the full picture
        if (await openFirstResult(page)) { opened = true; await page.waitForURL(/imagine\/post\//, { timeout: 15000 }).catch(() => {}); }
        continue;
      }
      if (image && page.url() === startUrl) continue; // the edit has not produced its post yet
      const src = await viewerImage(page);
      if (!src) continue;
      // wait until the viewer stops changing (it shows a blurred preview first)
      if (src === last) steady++; else { last = src; steady = 0; }
      if (steady < 2) continue;
      const f = path.join(outDir, `grok-${Date.now()}-${saved.length}.jpg`);
      try { await saveSrc(page, src, f); } catch (e: any) { onLine?.(e.message); continue; }
      if (fs.statSync(f).size < 60_000) { fs.rmSync(f, { force: true }); continue; }
      saved.push(f);
      onLine?.(`saved ${path.basename(f)} (${Math.round(fs.statSync(f).size / 1024)} KB)`);
    }
    if (!saved.length) throw Error('Grok Imagine did not return anything in time');
    return saved.slice(0, count);
  } finally {
    page.off('response', onResponse);
    await page.close().catch(() => {});
  }
}
