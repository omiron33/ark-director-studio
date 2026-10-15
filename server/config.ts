// Settings come from studio.config.json beside package.json (never committed), over these defaults.
// Defaults assume the studio runs on the same machine as ComfyUI and its GPU queue dashboard.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export interface AgentCommand { cmd: string; args: string[]; ssh?: string }
export interface Config {
  port: number;
  dataDir: string;
  comfyUrl: string;
  gpuDashboard: string | null;   // the GPU queue dashboard; null runs GPU jobs unqueued (not recommended)
  ffmpeg: string;
  ffprobe: string;
  blender: string;
  ark: { machine: string; engine: string; songs: string; node: string };
  agents: { claude: AgentCommand; codex: AgentCommand; grok: AgentCommand };
  grok: { browser: string; profileDir: string; imagineUrl: string };
  workflows: { image: string; h3: string };
}

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const findFfmpeg = (name: string) => {
  const appdata = process.env.APPDATA ?? '';
  const imageio = path.join(appdata, 'Python', 'Python311', 'site-packages', 'imageio_ffmpeg', 'binaries', `${name}.exe`);
  return fs.existsSync(imageio) ? imageio : name;
};
const findBlender = () => {
  for (const v of ['5.0', '4.3']) {
    const p = `C:\\Program Files\\Blender Foundation\\Blender ${v}\\blender.exe`;
    if (fs.existsSync(p)) return p;
  }
  return process.platform === 'darwin' ? '/Applications/Blender.app/Contents/MacOS/Blender' : 'blender';
};
const findBrowser = () => {
  for (const p of ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']) {
    if (fs.existsSync(p)) return p;
  }
  return 'chrome';
};

// npm .cmd shims cannot be spawned without a shell on Windows; run their script with node instead.
const npmBin = (name: string, script: string): { cmd: string; pre: string[] } => {
  const js = path.join(process.env.APPDATA ?? '', '..', '..', '.npm-global', 'node_modules', ...script.split('/'));
  const alt = path.join(os.homedir(), '.npm-global', 'node_modules', ...script.split('/'));
  for (const f of [alt, js]) if (process.platform === 'win32' && fs.existsSync(f)) return { cmd: process.execPath, pre: [f] };
  return { cmd: name, pre: [] };
};
const codexBin = npmBin('codex', '@openai/codex/bin/codex.js');

const defaults = (): Config => ({
  port: Number(process.env.STUDIO_PORT ?? 5320),
  dataDir: path.join(ROOT, 'data'),
  comfyUrl: 'http://127.0.0.1:8188',
  gpuDashboard: 'http://127.0.0.1:5299',
  ffmpeg: findFfmpeg('ffmpeg'),
  ffprobe: findFfmpeg('ffprobe'),
  blender: findBlender(),
  // The Ark engine runs where its song folders live, reached over ssh by host alias.
  ark: { machine: 'macmini', engine: '', songs: '', node: 'node' },
  agents: {
    claude: { cmd: 'claude', args: ['-p', '--output-format', 'text'], ...(process.platform === 'win32' ? { ssh: 'macmini' } : {}) },
    codex: { cmd: codexBin.cmd, args: [...codexBin.pre, 'exec', '--skip-git-repo-check'] },
    grok: { cmd: 'grok', args: ['-p'] },
  },
  grok: { browser: findBrowser(), profileDir: path.join(ROOT, 'data', 'grok-profile'), imagineUrl: 'https://grok.com/imagine' },
  workflows: { image: 'qwen-image', h3: 'h3-ref2va' },
});

function merge<T>(base: T, over: any): T {
  if (!over || typeof over !== 'object') return base;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' ? merge(out[k], v) : v;
  }
  return out;
}

export const CONFIG_FILE = path.join(ROOT, 'studio.config.json');
export function loadConfig(): Config {
  let over = {};
  try { over = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch {}
  const c = merge(defaults(), over);
  fs.mkdirSync(c.dataDir, { recursive: true });
  return c;
}
export const config = loadConfig();
export const home = os.homedir();
