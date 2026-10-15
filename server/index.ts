// Ark Director Studio server: the API, media files, live events, and the built client.
import express, { type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { config, ROOT } from './config.ts';
import * as store from './store.ts';
import * as jobs from './jobs.ts';
import { comfyStatus } from './comfy.ts';
import { gpuState } from './gpuq.ts';
import { arkStatus, listSongs, importSong, pushPrompts, ARK_STAGES } from './ark.ts';
import { agentStatus } from './agents.ts';
import { grokStatus, openGrok, closeGrok } from './grok.ts';
import { applyOps, type Op } from './ops.ts';
import { waveform } from './media.ts';
import type { AgentId, StudioStatus } from '../shared/types.ts';

const app = express();
app.use(express.json({ limit: '20mb' }));

const wrap = (fn: (req: Request, res: Response) => Promise<unknown> | unknown) => async (req: Request, res: Response, next: NextFunction) => {
  try { const out = await fn(req, res); if (!res.headersSent) res.json(out ?? { ok: true }); } catch (e) { next(e); }
};

let statusCache: { at: number; value: StudioStatus } | null = null;
app.get('/api/status', wrap(async (req) => {
  if (statusCache && Date.now() - statusCache.at < (req.query.fresh ? 0 : 8000)) return statusCache.value;
  const [comfy, gpu, ark, grok, claude, codex, grokCli] = await Promise.all([
    comfyStatus(), gpuState(), arkStatus(), grokStatus(), agentStatus('claude'), agentStatus('codex'), agentStatus('grok'),
  ]);
  const value: StudioStatus = { comfy, gpu, ark, blender: { ok: fs.existsSync(config.blender), path: path.basename(path.dirname(config.blender)) }, grok, agents: { claude, codex, grok: grokCli } };
  statusCache = { at: Date.now(), value };
  return value;
}));
app.get('/api/gpu', wrap(() => gpuState()));

app.get('/api/projects', wrap(() => store.listProjects().map((p) => ({
  id: p.id, title: p.title, kind: p.kind, updated: p.updated, ark: p.ark?.songPath,
  sequences: p.sequences.length, shots: p.sequences.reduce((n, s) => n + s.shots.length, 0),
  takes: p.sequences.reduce((n, s) => n + s.shots.reduce((m, sh) => m + sh.takes.filter((t) => t.status === 'done').length, 0), 0),
  cover: p.sequences.flatMap((s) => s.shots).flatMap((s) => s.storyboard)[0]?.file,
}))));
app.post('/api/projects', wrap((req) => store.createProject(req.body)));
app.get('/api/projects/:id', wrap((req) => store.readProject(req.params.id)));
app.patch('/api/projects/:id', wrap(async (req) => {
  const p = await store.mutate(req.params.id, (p) => applyOps(p, req.body.ops as Op[]));
  jobs.projectChanged(p.id);
  return p;
}));
app.delete('/api/projects/:id', wrap((req) => { store.deleteProject(req.params.id); return { ok: true }; }));

// Raw uploads: audio, look images, character sheets, reference frames.
app.post('/api/projects/:id/upload', express.raw({ type: '*/*', limit: '2gb' }), wrap(async (req) => {
  const sub = String(req.query.sub ?? 'uploads').replace(/[^a-z0-9-]/gi, '');
  const name = `${Date.now()}-${String(req.query.name ?? 'file').replace(/[^\w.-]/g, '_')}`;
  const rel = store.saveMedia(req.params.id, sub, name, req.body as Buffer);
  if (sub === 'audio') {
    await store.mutate(req.params.id, (p) => { p.audio = rel; });
    await waveform(store.mediaPath(req.params.id, rel), store.mediaPath(req.params.id, rel + '.wave.png')).catch(() => {});
    jobs.projectChanged(req.params.id);
  }
  return { file: rel };
}));

const P = (req: Request) => req.params.id;
app.post('/api/projects/:id/storyboard', wrap((req) => {
  const { shotId, engine = 'comfy', prompt } = req.body;
  const p = store.readProject(P(req));
  const { shot, seq } = store.findShot(p, shotId);
  return jobs.enqueue('storyboard', `${p.title}: ${shot.title} storyboard frame`, { projectId: p.id, shotId, engine, prompt }, { projectId: p.id, gpu: engine !== 'grok', ref: { shotId, sequenceId: seq.id } });
}));
app.post('/api/projects/:id/storyboard-all', wrap((req) => {
  const { sequenceId, engine = 'comfy', missingOnly = true } = req.body;
  const p = store.readProject(P(req));
  const out = [];
  for (const q of p.sequences) if (!sequenceId || q.id === sequenceId) for (const s of q.shots) {
    if (missingOnly && s.storyboard.length) continue;
    out.push(jobs.enqueue('storyboard', `${p.title}: ${s.title} storyboard frame`, { projectId: p.id, shotId: s.id, engine }, { projectId: p.id, gpu: engine !== 'grok', ref: { shotId: s.id, sequenceId: q.id } }));
  }
  return { queued: out.length };
}));
// Hand sketches: shapes plus the PNG the model sees. Saving an existing sketch id replaces it.
app.post('/api/projects/:id/sketch', wrap(async (req) => {
  const { shotId, sketchId, shapes = [], png, note } = req.body as { shotId: string; sketchId?: string; shapes: any[]; png?: string; note?: string };
  const id = sketchId || store.uid('k');
  const image = png ? store.saveMedia(P(req), 'sketches', `${id}-${Date.now()}.png`, Buffer.from(png.replace(/^data:image\/png;base64,/, ''), 'base64')) : undefined;
  let out: any;
  await store.mutate(P(req), (p) => {
    const s = store.findShot(p, shotId).shot;
    s.sketches = s.sketches ?? [];
    const old = s.sketches.find((k) => k.id === id);
    out = { id, shapes, note: note ?? old?.note, image: image ?? old?.image, at: store.now() };
    s.sketches = [out, ...s.sketches.filter((k) => k.id !== id)].slice(0, 40);
  });
  jobs.projectChanged(P(req));
  return out;
}));
app.post('/api/projects/:id/sketch-frames', wrap((req) => {
  const { shotId, sketchId, count = 1, prompt, follow = 'exact', engine = 'comfy' } = req.body;
  const p = store.readProject(P(req));
  const { shot, seq } = store.findShot(p, shotId);
  if (!shot.sketches?.some((k) => k.id === sketchId)) throw Error('save the sketch first');
  const n = Math.min(4, Math.max(1, Number(count) || 1));
  for (let i = 0; i < n; i++) jobs.enqueue('storyboard', `${p.title}: ${shot.title} frame from sketch`, { projectId: p.id, shotId, engine, prompt, sketchId, follow }, { projectId: p.id, gpu: engine !== 'grok', ref: { shotId, sequenceId: seq.id } });
  return { queued: n };
}));
app.post('/api/projects/:id/take', wrap((req) => jobs.startTake(P(req), req.body.shotId, req.body.opts ?? {})));
app.post('/api/projects/:id/takes-sequence', wrap(async (req) => {
  // queued in film order; each take reads the previous take's last frame when it starts
  const p = store.readProject(P(req));
  const q = p.sequences.find((s) => s.id === req.body.sequenceId);
  if (!q) throw Error('no such sequence');
  let n = 0;
  for (const s of q.shots) {
    if (req.body.missingOnly && s.takes.some((t) => t.status === 'done')) continue;
    if (s.source === 'code') continue;
    await jobs.startTake(p.id, s.id, req.body.opts ?? {});
    n++;
  }
  return { queued: n };
}));
app.get('/api/projects/:id/take-inputs/:shotId', wrap((req) => {
  const p = store.readProject(P(req));
  return jobs.resolveTakeInputs(p, store.findShot(p, req.params.shotId).shot, req.query);
}));
app.post('/api/projects/:id/sheet', wrap((req) => {
  const p = store.readProject(P(req));
  const c = p.cast.find((x) => x.id === req.body.castId);
  return jobs.enqueue('sheet', `${p.title}: ${c?.name ?? 'character'} sheet`, { projectId: p.id, castId: req.body.castId, engine: req.body.engine }, { projectId: p.id, gpu: req.body.engine !== 'grok', ref: { castId: req.body.castId } });
}));
app.post('/api/projects/:id/look', wrap((req) => {
  const p = store.readProject(P(req));
  return jobs.enqueue('look', `${p.title}: look image`, { projectId: p.id, lookId: req.body.lookId, engine: req.body.engine }, { projectId: p.id, gpu: req.body.engine !== 'grok', ref: { lookId: req.body.lookId } });
}));
app.post('/api/projects/:id/greybox', wrap((req) => {
  const p = store.readProject(P(req));
  const { shot } = store.findShot(p, req.body.shotId);
  return jobs.enqueue('greybox', `${p.title}: ${shot.title} Blender greybox`, { projectId: p.id, shotId: shot.id }, { projectId: p.id, gpu: true, ref: { shotId: shot.id } });
}));
app.post('/api/projects/:id/agent', wrap((req) => {
  const p = store.readProject(P(req));
  const { agent = 'claude', task = 'parse', mode = 'basic', sequenceId, replace = true } = req.body as { agent: AgentId; task: string; mode: string; sequenceId?: string; replace?: boolean };
  const label = task === 'review' ? `review of ${p.sequences.find((s) => s.id === sequenceId)?.title}` : 'story breakdown';
  return jobs.enqueue('agent', `${p.title}: ${label} (${agent})`, { projectId: p.id, agent, task, mode, sequenceId, replace }, { projectId: p.id, gpu: false, ref: { sequenceId } });
}));
app.post('/api/projects/:id/assemble', wrap((req) => {
  const p = store.readProject(P(req));
  const q = p.sequences.find((s) => s.id === req.body.sequenceId);
  return jobs.enqueue('assemble', `${p.title}: assemble ${q?.title ?? 'film'}`, { projectId: p.id, sequenceId: req.body.sequenceId }, { projectId: p.id, gpu: false, ref: { sequenceId: req.body.sequenceId } });
}));

app.get('/api/ark/stages', wrap(() => Object.fromEntries(Object.entries(ARK_STAGES).map(([k, v]) => [k, { label: v.label, expert: !!v.expert, gpu: !!v.gpu, looks: v.looks, kinds: v.kinds }]))));
app.get('/api/ark/songs', wrap(() => listSongs()));
app.post('/api/ark/import', wrap(async (req) => {
  const { songPath, title } = req.body;
  const p = store.createProject({ title: title ?? path.posix.basename(songPath), kind: 'song' });
  await importSong(p, songPath);
  store.writeProject(p);
  return p;
}));
app.post('/api/projects/:id/ark/pull', wrap(async (req) => {
  const p = store.readProject(P(req));
  if (!p.ark) throw Error('not linked to an Ark song');
  const fresh = await importSong({ ...p, sequences: [], looks: [] }, p.ark.songPath, { withAudio: !p.audio });
  // keep studio-only work (storyboards, takes, cast) on shots that still exist
  const old = new Map(p.sequences.flatMap((q) => q.shots).filter((s) => s.arkScene).map((s) => [s.arkScene!, s]));
  for (const q of fresh.sequences) q.shots = q.shots.map((s) => { const o = old.get(s.arkScene!); return o ? { ...o, prompt: s.prompt, duration: s.duration, from: s.from } : s; });
  const merged = await store.mutate(p.id, (pp) => { pp.sequences = fresh.sequences; pp.looks = [...pp.looks, ...fresh.looks.filter((l) => !pp.looks.some((x) => x.image === l.image))]; pp.style = fresh.style; pp.ark = fresh.ark; if (fresh.audio) pp.audio = fresh.audio; });
  jobs.projectChanged(p.id);
  return merged;
}));
app.post('/api/projects/:id/ark/push', wrap(async (req) => {
  const p = store.readProject(P(req));
  const changed = await pushPrompts(p);
  await store.mutate(p.id, (pp) => { pp.ark = p.ark; });
  return { changed };
}));
app.post('/api/projects/:id/ark/stage', wrap((req) => {
  const p = store.readProject(P(req));
  const { stage, opts = {}, shotId } = req.body;
  const st = ARK_STAGES[stage];
  if (!st) throw Error('unknown stage');
  return jobs.enqueue('ark', `${p.title}: Ark ${st.label}${opts.only ? ` (${opts.only})` : ''}`, { projectId: p.id, stage, opts, shotId }, { projectId: p.id, gpu: false, ref: { shotId } });
}));

app.get('/api/jobs', wrap(() => jobs.listJobs()));
app.get('/api/jobs/:jid', wrap((req) => jobs.getJob(req.params.jid)));
app.post('/api/jobs/:jid/cancel', wrap((req) => ({ cancelled: jobs.cancelJob(req.params.jid) })));

app.post('/api/grok/open', wrap(async () => { await openGrok(); return { ok: true }; }));
app.post('/api/grok/close', wrap(async () => { await closeGrok(); return { ok: true }; }));

// Project media, read-only.
app.get('/media/:id/*', (req, res) => {
  try {
    const file = store.mediaPath(req.params.id, (req.params as any)[0]);
    if (!fs.existsSync(file)) return res.status(404).end();
    res.sendFile(file, { maxAge: 0 });
  } catch { res.status(400).end(); }
});

const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|media|ws).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  res.status(400).json({ error: err?.message ?? String(err) });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
jobs.onEvent((e) => {
  const msg = JSON.stringify(e);
  for (const c of wss.clients) if (c.readyState === 1) c.send(msg);
});
server.listen(config.port, '0.0.0.0', () => console.log(`Ark Director Studio on port ${config.port}`));
