// The Ark engine adapter. The engine and its song folders stay where they are (on the machine named
// by config.ark.machine, reached over ssh); the studio only reads and writes film.json fields it owns
// (scene and take prompts, look paths) and runs the engine's own commands. Engine changes stay in the engine.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { exec } from './media.ts';
import { newSequence, newShot, uid, now, saveMedia } from './store.ts';
import { withRender, type Project, type Shot, type RenderSetup } from '../shared/types.ts';

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
  p.render = renderFromFilm(film, p.render);

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
// The film's video type, read from film.json: mode, tier, resolution and whether scenes are repainted by H3.
export function renderFromFilm(film: any, prev?: Partial<RenderSetup>): RenderSetup {
  const r = withRender(prev);
  const scenes: any[] = film.scenes ?? [];
  const painted = scenes.some((s) => s.photorealistic || s.source === 'h3');
  r.look = film.mode === 'musicvideo' ? 'mixed' : painted ? 'photoreal' : 'code';
  if (['fast', 'standard', 'premium', 'ultra'].includes(film.tier)) r.tier = film.tier;
  if (film.resolution === '3840x2160') r.resolution = '3840x2160';
  if (film.photorealistic?.tuck === false) r.photoreal.tuck = false;
  if (film.popcam === false) r.popcam = false;
  r.words = film.mode === 'story' ? 'none' : scenes.some((s) => s.overlay) ? 'overlay' : 'in-scene';
  return r;
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
  // the video type the studio owns: tier and resolution (both change what the next render makes)
  const rs = withRender(p.render);
  if (film.tier !== rs.tier) { film.tier = rs.tier; changed++; }
  if ((film.resolution ?? '1920x1080') !== rs.resolution) { if (rs.resolution === '1920x1080') delete film.resolution; else film.resolution = rs.resolution; changed++; }
  const file = path.posix.join(p.ark.songPath, 'film.json');
  const r = await remote(`cp ${q(file)} ${q(file + '.studio-bak')} && cat > ${q(file + '.tmp')} && mv ${q(file + '.tmp')} ${q(file)}`, { input: JSON.stringify(film, null, 1) + '\n' });
  if (r.code !== 0) throw Error(`writing film.json failed: ${r.err.trim()}`);
  p.ark.lastPush = now();
  return changed;
}

// The engine's own commands, by name. Each runs in the engine folder with --song pointing at the song.
// `r` is the film's render setup, so every video type's flags reach the engine: the tier and resolution
// for code renders, and chain, style reference, tuck, keep, steps and proxy blur for H3 repaints.
type StageOpts = { only?: string; local?: boolean; agent?: string; r: RenderSetup };
const local = (o: StageOpts) => (o.local ?? o.r.local) ? ['--local'] : [];
const only = (o: StageOpts) => o.only ? ['--only', o.only] : [];
const tier = (o: StageOpts) => ['--tier', o.r.tier, ...(o.r.resolution !== '1920x1080' && o.r.tier !== 'fast' ? ['--res', o.r.resolution] : [])];
const paint = (o: StageOpts) => {
  const pr = o.r.photoreal;
  return ['--chain', pr.chain, '--look', pr.styleRef, '--keep', String(pr.keep), '--steps', String(pr.steps),
    ...(pr.tuck ? [] : ['--no-tuck']), ...(pr.proxyBlur ? ['--proxy-blur', String(pr.proxyBlur)] : [])];
};
// looks: which video types a stage belongs to (Basic shows only the film's own pipeline)
export const ARK_STAGES: Record<string, { label: string; args: (song: string, o: StageOpts) => string[]; gpu?: boolean; expert?: boolean; looks: string[]; kinds?: string[] }> = {
  'story-prepare': { label: 'Align the narration and build the mix', args: (s) => ['photoreal/story.mjs', 'prepare', '--song', s], looks: ['code', 'photoreal'], kinds: ['story'] },
  'storyboard-draft': { label: 'Draft the storyboard', args: (s) => ['photoreal/storyboard.mjs', 'draft', '--song', s], looks: ['code', 'photoreal', 'mixed'] },
  'storyboard-check': { label: 'Check the storyboard', args: (s) => ['photoreal/storyboard.mjs', 'check', '--song', s], looks: ['code', 'photoreal', 'mixed'], expert: true },
  'critic-storyboard': { label: 'Critic on the storyboard', args: (s, o) => ['photoreal/critic.mjs', 'storyboard', '--song', s, '--agent', o.agent ?? 'claude'], looks: ['code', 'photoreal', 'mixed'], expert: true },
  'draft': { label: 'Code draft render', args: (s, o) => ['photoreal/film.mjs', '--song', s, '--draft', ...local(o)], looks: ['code', 'photoreal', 'mixed'] },
  'check': { label: 'Pre-render check', args: (s) => ['photoreal/check.mjs', '--song', s, '--label', 'draft'], looks: ['code', 'photoreal', 'mixed'] },
  'stills': { label: 'Key stills', args: (s, o) => ['photoreal/film.mjs', '--song', s, '--stills', ...tier(o), ...local(o)], looks: ['code', 'photoreal', 'mixed'] },
  'critic-stills': { label: 'Critic on the stills', args: (s, o) => ['photoreal/critic.mjs', 'stills', '--song', s, '--agent', o.agent ?? 'claude'], looks: ['code', 'photoreal', 'mixed'] },
  'estimate': { label: 'Estimate every tier', args: (s, o) => ['photoreal/film.mjs', '--song', s, '--estimate', ...local(o)], looks: ['code', 'photoreal', 'mixed'], expert: true },
  'film': { label: 'Full code render at the film\'s tier', args: (s, o) => ['photoreal/film.mjs', '--song', s, ...tier(o), ...only(o), ...local(o)], looks: ['code', 'photoreal'] },
  'photoreal': { label: 'Photoreal repaint (H3)', args: (s, o) => ['photoreal/photorealistic.mjs', '--song', s, ...only(o), ...paint(o)], gpu: true, looks: ['photoreal'] },
  'musicvideo': { label: 'Music video: code, H3 and join', args: (s, o) => ['photoreal/musicvideo.mjs', '--song', s, '--tier', o.r.tier, ...(o.r.popcam ? [] : ['--no-popcam']), ...(o.r.photoreal.tuck ? [] : ['--no-tuck'])], gpu: true, looks: ['mixed'] },
  'final-check': { label: 'Final check', args: (s) => ['photoreal/check.mjs', '--song', s, '--label', 'final'], looks: ['code', 'photoreal', 'mixed'] },
  'critic-film': { label: 'Critic on the film', args: (s, o) => ['photoreal/critic.mjs', 'film', '--song', s, '--agent', o.agent ?? 'claude'], looks: ['code', 'photoreal', 'mixed'] },
};

export async function runStage(p: Project, stage: string, opts: any, { signal, onLine }: { signal?: AbortSignal; onLine?: (l: string) => void }) {
  if (!p.ark) throw Error('this project is not linked to an Ark song');
  const st = ARK_STAGES[stage];
  if (!st) throw Error(`unknown Ark stage ${stage}`);
  const cmd = `cd ${q(config.ark.engine)} && ${q(config.ark.node)} ${st.args(p.ark.songPath, { ...opts, r: withRender({ ...p.render, ...(opts.render ?? {}) }) }).map(q).join(' ')}`;
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
