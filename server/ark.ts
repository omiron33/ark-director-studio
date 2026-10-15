// The Ark engine adapter. The engine and its song folders stay where they are (on the machine named
// by config.ark.machine, reached over ssh); the studio only reads and writes film.json fields it owns
// (scene and take prompts, look paths) and runs the engine's own commands. Engine changes stay in the engine.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { exec } from './media.ts';
import { newSequence, newShot, uid, now, saveMedia } from './store.ts';
import type { Project, Shot } from '../shared/types.ts';

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const sshArgs = (machine: string) => ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', machine];

export async function remote(cmd: string, { signal, onLine, input, timeoutMs = 120000, machine = config.ark.machine }: { signal?: AbortSignal; onLine?: (l: string) => void; input?: string; timeoutMs?: number; machine?: string } = {}) {
  return exec('ssh', [...sshArgs(machine), cmd], { signal, onLine, input, timeoutMs });
}

export async function arkStatus() {
  if (!config.ark.engine) return { ok: false, machine: config.ark.machine, engine: '', error: 'set ark.engine in studio.config.json' };
  const r = await remote(`test -f ${q(path.posix.join(config.ark.engine, 'photoreal/film.mjs'))} && git -C ${q(config.ark.engine)} rev-parse --abbrev-ref HEAD`, { timeoutMs: 15000 }).catch((e) => ({ code: -1, out: '', err: e.message }));
  return r.code === 0
    ? { ok: true, machine: config.ark.machine, engine: `${path.posix.basename(config.ark.engine)} @ ${r.out.trim()}` }
    : { ok: false, machine: config.ark.machine, engine: config.ark.engine, error: (r.err || 'engine not found').trim().slice(0, 300) };
}

// Song folders with a film.json under config.ark.songs.
export async function listSongs() {
  const r = await remote(`cd ${q(config.ark.songs)} && for f in */film.json; do d=\${f%/film.json}; t=$(${q(config.ark.node)} -e 'try{const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.stdout.write((j.title||"")+"\\t"+(j.mode||"")+"\\t"+((j.scenes||[]).length))}catch{}' "$f"); m=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f"); printf '%s\\t%s\\t%s\\n' "$d" "$t" "$m"; done`, { timeoutMs: 30000 });
  if (r.code !== 0) throw Error(r.err.trim() || 'could not list songs');
  return r.out.trim().split('\n').filter(Boolean).map((l) => {
    const [dir, title, mode, scenes, mtime] = l.split('\t');
    return { dir, path: path.posix.join(config.ark.songs, dir), title: title || dir, mode: mode || 'lyric', scenes: Number(scenes || 0), modified: new Date(Number(mtime) * 1000).toISOString() };
  }).sort((a, b) => b.modified.localeCompare(a.modified));
}

export async function readFilm(songPath: string) {
  const r = await remote(`cat ${q(path.posix.join(songPath, 'film.json'))}`);
  if (r.code !== 0) throw Error(`no film.json in ${songPath}`);
  return JSON.parse(r.out);
}

async function fetchFile(remotePath: string, local: string) {
  fs.mkdirSync(path.dirname(local), { recursive: true });
  const r = await exec('scp', ['-q', '-o', 'BatchMode=yes', `${config.ark.machine}:${remotePath}`, local], { timeoutMs: 600000 });
  if (r.code !== 0) throw Error(`copying ${remotePath} failed: ${r.err.trim()}`);
  return local;
}

// A project from an Ark song folder: takes become sequences (one continuity plan each), scenes become shots.
export async function importSong(p: Project, songPath: string, { withAudio = true } = {}) {
  const film = await readFilm(songPath);
  const scenes: any[] = film.scenes ?? [];
  const pr = film.photorealistic ?? {};
  p.title = film.title ?? p.title;
  p.fps = film.fps === 60 ? 24 : (film.fps ?? 24);
  p.style = pr.style ?? p.style;
  p.kind = film.mode === 'musicvideo' ? 'musicvideo' : film.mode === 'story' ? 'story' : 'song';
  p.ark = { machine: config.ark.machine, songPath, lastPull: now() };

  const toShot = (sc: any): Shot => newShot({
    title: sc.title ?? `Scene ${sc.id}`,
    action: sc.photorealistic?.prompt ?? sc.hold ?? '',
    prompt: sc.photorealistic?.prompt ?? '',
    duration: Math.max(1, Number(((sc.to ?? 0) - (sc.from ?? 0)).toFixed(2))),
    from: sc.from,
    source: sc.source === 'h3' || sc.photorealistic ? 'h3' : 'code',
    arkScene: sc.id,
    chainFromPrevious: true,
  });

  const looks = new Map<string, string>();
  const lookFor = async (rel?: string) => {
    if (!rel) return undefined;
    if (looks.has(rel)) return looks.get(rel);
    const id = uid('l');
    const local = path.join('looks', path.posix.basename(rel));
    try { await fetchFile(path.posix.join(songPath, rel), path.join(p.id ? mediaRoot(p.id) : '', local)); } catch { return undefined; }
    p.looks.push({ id, name: path.posix.basename(rel, path.posix.extname(rel)), prompt: '', image: local.replace(/\\/g, '/') });
    looks.set(rel, id);
    return id;
  };

  p.sequences = [];
  const used = new Set<string>();
  for (const t of pr.takes ?? []) {
    const seq = newSequence(t.id);
    seq.summary = t.prompt ?? '';
    seq.continuity.plan = t.prompt ?? '';
    seq.continuity.lookId = await lookFor(t.look);
    for (const sid of t.scenes ?? []) {
      const sc = scenes.find((s) => s.id === sid);
      if (sc) { seq.shots.push(toShot(sc)); used.add(sid); }
    }
    if (seq.shots.length) p.sequences.push(seq);
  }
  const rest = scenes.filter((s) => !used.has(s.id));
  if (rest.length) {
    const seq = newSequence(pr.takes?.length ? 'Other scenes' : 'Film');
    seq.shots = rest.map(toShot);
    p.sequences.push(seq);
  }
  if (withAudio) {
    for (const a of ['media/song.wav', 'media/song.mp3', 'media/narration.wav']) {
      try { await fetchFile(path.posix.join(songPath, a), path.join(mediaRoot(p.id), 'audio', path.posix.basename(a))); p.audio = `audio/${path.posix.basename(a)}`; break; } catch {}
    }
  }
  return p;
}
const mediaRoot = (id: string) => path.join(config.dataDir, 'projects', id, 'media');

// Write the prompts the studio owns back into film.json. The previous file is kept as film.json.studio-bak.
export async function pushPrompts(p: Project) {
  if (!p.ark) throw Error('this project is not linked to an Ark song');
  const film = await readFilm(p.ark.songPath);
  let changed = 0;
  for (const seq of p.sequences) for (const s of seq.shots) {
    if (!s.arkScene) continue;
    const sc = (film.scenes ?? []).find((x: any) => x.id === s.arkScene);
    if (!sc || !s.prompt.trim()) continue;
    sc.photorealistic = { ...(sc.photorealistic ?? {}), prompt: s.prompt.trim() };
    changed++;
  }
  for (const seq of p.sequences) {
    const t = (film.photorealistic?.takes ?? []).find((x: any) => x.id === seq.title);
    if (t && seq.continuity.plan.trim() && t.prompt !== seq.continuity.plan.trim()) { t.prompt = seq.continuity.plan.trim(); changed++; }
  }
  const file = path.posix.join(p.ark.songPath, 'film.json');
  const r = await remote(`cp ${q(file)} ${q(file + '.studio-bak')} && cat > ${q(file + '.tmp')} && mv ${q(file + '.tmp')} ${q(file)}`, { input: JSON.stringify(film, null, 1) + '\n' });
  if (r.code !== 0) throw Error(`writing film.json failed: ${r.err.trim()}`);
  p.ark.lastPush = now();
  return changed;
}

// The engine's own commands, by name. Each runs in the engine folder with --song pointing at the song.
export const ARK_STAGES: Record<string, { label: string; args: (song: string, o: any) => string[]; gpu?: boolean; expert?: boolean }> = {
  'storyboard-draft': { label: 'Draft the storyboard', args: (s) => ['photoreal/storyboard.mjs', 'draft', '--song', s] },
  'storyboard-check': { label: 'Check the storyboard', args: (s) => ['photoreal/storyboard.mjs', 'check', '--song', s] },
  'draft': { label: 'Code draft render', args: (s, o) => ['photoreal/film.mjs', '--song', s, '--draft', ...(o.local ? ['--local'] : [])] },
  'check': { label: 'Pre-render check', args: (s) => ['photoreal/check.mjs', '--song', s, '--label', 'draft'] },
  'stills': { label: 'Key stills', args: (s, o) => ['photoreal/film.mjs', '--song', s, '--stills', ...(o.local ? ['--local'] : [])] },
  'critic-stills': { label: 'Critic on the stills', args: (s, o) => ['photoreal/critic.mjs', 'stills', '--song', s, '--agent', o.agent ?? 'claude'] },
  'film': { label: 'Full code render', args: (s, o) => ['photoreal/film.mjs', '--song', s, ...(o.only ? ['--only', o.only] : []), ...(o.local ? ['--local'] : [])], expert: true },
  'photoreal': { label: 'Photoreal takes (H3)', args: (s, o) => ['photoreal/photorealistic.mjs', '--song', s, ...(o.only ? ['--only', o.only] : []), '--chain', o.chain ?? 'bridges'], gpu: true },
  'final-check': { label: 'Final check', args: (s) => ['photoreal/check.mjs', '--song', s, '--label', 'final'] },
  'critic-film': { label: 'Critic on the film', args: (s, o) => ['photoreal/critic.mjs', 'film', '--song', s, '--agent', o.agent ?? 'claude'] },
};

export async function runStage(p: Project, stage: string, opts: any, { signal, onLine }: { signal?: AbortSignal; onLine?: (l: string) => void }) {
  if (!p.ark) throw Error('this project is not linked to an Ark song');
  const st = ARK_STAGES[stage];
  if (!st) throw Error(`unknown Ark stage ${stage}`);
  const cmd = `cd ${q(config.ark.engine)} && ${q(config.ark.node)} ${st.args(p.ark.songPath, opts).map(q).join(' ')}`;
  onLine?.(`$ ${cmd}`);
  const r = await remote(cmd, { signal, onLine, timeoutMs: 24 * 3600000 });
  if (r.code !== 0) throw Error(`${st.label} exited ${r.code}: ${(r.err || r.out).trim().slice(-800)}`);
  return r.out.trim().slice(-4000);
}

// Bring a finished photoreal scene clip back as a take on its shot.
export async function pullSceneClip(p: Project, shot: Shot) {
  if (!p.ark || !shot.arkScene) throw Error('shot is not linked to an Ark scene');
  const name = `${shot.arkScene}-${Date.now()}.mp4`;
  const local = path.join(mediaRoot(p.id), 'takes', name);
  await fetchFile(path.posix.join(p.ark.songPath, 'out', 'photorealistic', `${shot.arkScene}.mp4`), local);
  return `takes/${name}`;
}

export { saveMedia };
