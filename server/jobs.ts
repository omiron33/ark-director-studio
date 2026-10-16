// The studio's job queue. GPU jobs (storyboard frames, sheets, looks, H3 takes, greybox renders) run
// one at a time here AND wait for the machine's GPU queue dashboard, so they never overlap another
// agent's render. Agent, Ark and Grok jobs run alongside (they use no local GPU).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';
import { uid, now, mutate, readProject, findShot, mediaPath, mediaDir, previousShot, newSequence, newShot, shotDefaults } from './store.ts';
import { claimGpu, type GpuLease } from './gpuq.ts';
import * as comfy from './comfy.ts';
import { h3Graph, h3Len, imageGraph, kleinGraph, ASPECTS } from './workflows.ts';
import { shotPrompt, sheetPrompt, portraitPrompt, lookPrompt, storyParsePrompt, sequenceReviewPrompt, sketchPrompt, refsPrompt, endFramePrompt } from './prompts.ts';
import { lastFrame, assemble, probe } from './media.ts';
import { renderGreybox, defaultGreybox, renderModel } from './blender.ts';
import { grokGenerate } from './grok.ts';
import { runAgent, extractJson } from './agents.ts';
import { runStage, pullSceneClip, ARK_STAGES } from './ark.ts';
import type { Job, JobKind, Project, Take, AgentId, Shot, StillModel, Character } from '../shared/types.ts';
import { CAMERA_PRESETS, cohesionOn, stillModelOf, localStillModel, STILL_MODELS } from '../shared/types.ts';

const FILE = path.join(config.dataDir, 'jobs.json');
const jobs: Job[] = (() => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; } })();
// anything that was running when the studio stopped did not finish
for (const j of jobs) if (['queued', 'waiting-gpu', 'running'].includes(j.status)) { j.status = 'failed'; j.error = 'the studio restarted before this job finished'; j.ended = now(); }

const controllers = new Map<string, AbortController>();
let listeners: ((e: { type: string; job?: Job; projectId?: string }) => void)[] = [];
export const onEvent = (fn: (e: any) => void) => { listeners.push(fn); return () => { listeners = listeners.filter((f) => f !== fn); }; };
const emit = (e: any) => { for (const f of listeners) f(e); };

let saveTimer: NodeJS.Timeout | null = null;
const save = () => {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; fs.writeFileSync(FILE, JSON.stringify(jobs.slice(-300), null, 1)); }, 500);
};
const update = (j: Job, patch: Partial<Job> = {}) => { Object.assign(j, patch); save(); emit({ type: 'job', job: j }); };
const log = (j: Job, line: string) => { j.log.push(`${new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago', hour12: false })} ${line}`); if (j.log.length > 400) j.log.splice(0, j.log.length - 400); update(j); };
export const projectChanged = (projectId: string) => emit({ type: 'project', projectId });

export const listJobs = () => jobs.slice(-200).reverse();
export const getJob = (id: string) => jobs.find((j) => j.id === id);

let gpuChain: Promise<unknown> = Promise.resolve();

export function enqueue(kind: JobKind, title: string, payload: any, { projectId, gpu, ref }: { projectId?: string; gpu: boolean; ref?: Job['ref'] }) {
  const j: Job = { id: uid('j'), kind, projectId, title, status: 'queued', gpu, log: [], created: now(), ref };
  jobs.push(j);
  update(j);
  const ac = new AbortController();
  controllers.set(j.id, ac);
  const go = async () => {
    if (ac.signal.aborted) return;
    let lease: GpuLease | null = null;
    try {
      if (gpu) {
        update(j, { status: 'waiting-gpu', note: 'waiting for the GPU queue' });
        lease = await claimGpu({ tool: `Ark Director Studio: ${kind}`, description: title, project: projectId, expectMinutes: kind === 'take' ? 15 : 3, signal: ac.signal, onWait: (n) => update(j, { note: n }) });
      }
      update(j, { status: 'running', started: now(), note: 'running' });
      const result = await HANDLERS[kind](j, payload, { signal: ac.signal, lease, log: (l: string) => log(j, l) });
      await lease?.end('done');
      update(j, { status: 'done', ended: now(), result, note: 'done' });
    } catch (e: any) {
      const cancelled = ac.signal.aborted;
      await lease?.end(cancelled ? 'cancelled' : 'failed');
      update(j, { status: cancelled ? 'cancelled' : 'failed', ended: now(), error: e.message, note: cancelled ? 'cancelled' : 'failed' });
      await HANDLERS_FAIL[kind]?.(j, payload, e.message).catch(() => {});
    } finally {
      controllers.delete(j.id);
      if (projectId) projectChanged(projectId);
    }
  };
  if (gpu) { gpuChain = gpuChain.then(go, go); } else { go(); }
  return j;
}

export function cancelJob(id: string) {
  const ac = controllers.get(id);
  if (!ac) return false;
  ac.abort();
  // a job still waiting its turn never starts, so mark it here rather than leave it 'queued' forever
  const j = getJob(id);
  if (j?.status === 'queued') { update(j, { status: 'cancelled', ended: now(), note: 'cancelled' }); controllers.delete(id); }
  return true;
}

type Ctx = { signal: AbortSignal; lease: GpuLease | null; log: (l: string) => void };

const seed = () => Math.floor(Math.random() * 2 ** 31);
const rel = (projectId: string, abs: string) => path.relative(mediaDir(projectId), abs).split(path.sep).join('/');

async function comfyStill(projectId: string, prompt: string, sub: string, ctx: Ctx, aspect = '16:9', refFiles: string[] = [], stillsIn: StillModel = 'quality') {
  const stills = localStillModel(stillsIn);
  const [width, height] = ASPECTS[aspect] ?? ASPECTS['16:9'];
  const s = seed();
  const refs = await Promise.all(refFiles.map((f, i) => comfy.upload(mediaPath(projectId, f), `ads-${projectId}-ref${i}-${path.basename(f)}`)));
  const model = STILL_MODELS[stills].model;
  ctx.log(`${model} ${width}x${height}, seed ${s}${refs.length ? `, with ${refs.length} reference image${refs.length > 1 ? 's' : ''}` : ''}`);
  const graph = stills === 'speed' ? imageGraph({ prompt, seed: s, width, height, prefix: `ark-studio/${projectId}`, refs }) : kleinGraph({ prompt, seed: s, width, height, prefix: `ark-studio/${projectId}`, refs });
  const r = await comfy.run(graph, { signal: ctx.signal, onBeat: (sec) => ctx.lease?.progress(`${sec}s`) });
  const o = r.outputs.find((x) => /\.(png|jpe?g|webp)$/i.test(x.filename));
  if (!o) throw Error('ComfyUI returned no image');
  const dest = mediaPath(projectId, `${sub}/${Date.now()}-${s}.png`);
  await comfy.download(o, dest);
  ctx.log(`saved ${path.basename(dest)} in ${r.seconds}s`);
  return { file: rel(projectId, dest), seed: s, model };
}

// Grok Imagine still. With a layout (the shot's greybox frame) Grok edits that picture into the scene,
// so the planned camera and blocking hold; without one it works from the words alone.
// With people, their portraits ride along too, so faces, hair, build and costume hold from shot to shot.
// A still from words: drop the film-grain and grit wording the film's look carries (Grok paints it as noise),
// and the quoted spoken lines (Grok writes them into the picture as subtitles).
export function stillWords(prompt: string) {
  return prompt
    .replace(/,?\s*\b(rough|heavy|fine|light)?\s*(16|35)?(mm)?\s*film grain\b/gi, '')
    .replace(/\bgritty\s+/gi, '')
    .replace(/\b(the words?|his line|her line|the line)\s*:\s*[^\n]*/gi, '$1, acted, not written');
}
const ORD = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth'];
async function grokStill(projectId: string, prompt: string, sub: string, ctx: Ctx, layout?: string, people: { name: string; file: string; prop?: boolean; note?: string }[] = []) {
  const lay = layout && fs.existsSync(mediaPath(projectId, layout)) ? mediaPath(projectId, layout) : undefined;
  const cast = people.filter((x) => fs.existsSync(mediaPath(projectId, x.file))).slice(0, lay ? 5 : 6);
  const refs = [...(lay ? [lay] : []), ...cast.map((x) => mediaPath(projectId, x.file))];
  const lines: string[] = [];
  if (lay) lines.push('The first attached image is a grey 3D layout of this shot: use it for the exact camera angle, framing and where each figure and structure stands, and paint it as a real photographic film still, never grey mannequins or boxes.');
  cast.forEach((x, i) => lines.push(x.prop
    ? `The ${ORD[i + (lay ? 1 : 0)]} attached image is a reference picture of ${x.name}, a place, not a person: keep its design, material and scale exactly (${x.note ?? ''}).`
    : `The ${ORD[i + (lay ? 1 : 0)]} attached image is a reference sheet of ${x.name} (several views of the same person plus a face close-up): keep that face, hair, build and clothing exactly; ${x.name} appears exactly once in the picture.`));
  if (cast.some((x) => !x.prop)) lines.push('Take only who each person is from their picture (face, hair, beard, build, clothing), never its skin texture, grain or lighting.');
  lines.push('A clean, smooth cinematic photograph: no film grain, no noise, no oversharpening, no HDR crunch, no crackle, mottling or cracked-paint texture on faces, skin or cloth; natural skin. Keep the world’s light, colour and mood exactly as described, and add no fire where none is described. No blood and no wounds on anyone.');
  lines.push('No text anywhere: no captions, subtitles, words, letters, signs or watermarks. Spoken or sung lines are acted on the faces, never written in the picture.');
  if (people.some((x) => /christ|jesus/i.test(x.name))) lines.push("Christ is solemn and grave, never smiling, and his robe is spotless pure white; there is exactly one Christ in the picture.");
  if (people.some((x) => /satan/i.test(x.name))) lines.push('Satan shows only fearful anger: he never kneels, prays, bows, folds or lifts his hands in reverence, and never lies down unless the shot says he is thrown down.');
  const [f] = await grokGenerate({ prompt: [...lines, stillWords(prompt)].join(' '), kind: 'image', refs, outDir: mediaPath(projectId, sub), onLine: ctx.log });
  return { file: rel(projectId, f), seed: undefined, model: 'Grok Imagine' };
}

const HANDLERS: Record<JobKind, (j: Job, payload: any, ctx: Ctx) => Promise<unknown>> = {
  async storyboard(j, { projectId, shotId, engine = 'comfy', prompt, sketchId, follow, refs: useRefs = true, at, fix, refFiles, stills }: any, ctx) {
    const p = readProject(projectId);
    const { seq, shot } = findShot(p, shotId);
    // the job's own choice, else the shot's override, else the film's setting (quality by default)
    const sm: StillModel = stills === 'speed' || stills === 'quality' || stills === 'premium' ? stills : stillModelOf(p, shot);
    // Premium is Grok Imagine; a blend always paints locally from its pictures
    if (sm === 'premium' && !(Array.isArray(refFiles) && refFiles.length) && !sketchId) engine = 'grok';
    if (Array.isArray(refFiles) && refFiles.length) {
      // a frame painted from chosen pictures (a blend): the prompt says what each image is for
      const r = await comfyStill(projectId, String(prompt ?? ''), 'storyboard', ctx, p.aspect, refFiles.slice(0, 8), sm);
      await mutate(projectId, (pp) => {
        const s = findShot(pp, shotId).shot;
        const fr = { id: uid('f'), file: r.file, prompt: String(prompt ?? ''), engine: 'comfy+blend', model: r.model, seed: r.seed, at: now(), refs: refFiles };
        s.storyboard.unshift(fr);
        s.selectedFrame = fr.id;
      });
      return r;
    }
    // a reviewer's correction rides on top of the shot's own prompt for this one frame
    if (fix) prompt = `${prompt?.trim() || shotPrompt(p, seq, shot, { forStill: true })}\nCorrection for this frame: ${fix}`;
    if (at === 'end') {
      // the end of a moving shot: follow the greybox's last frame, and the start frame for continuity
      if (engine === 'grok') {
        // Grok Imagine sees words only: the shot's prompt, told it is the end of the move
        const text = endFramePrompt(prompt?.trim() || shotPrompt(p, seq, shot, { forStill: true }), shot.camera.move);
        const r = await grokStill(projectId, text, 'storyboard', ctx, shot.greybox?.still?.replace(/\.png$/, '-end.png'), stillRefs(p, shot, true, true).sheets);
        await mutate(projectId, (pp) => {
          const s = findShot(pp, shotId).shot;
          const fr = { id: uid('f'), file: r.file, prompt: text, engine: 'grok+end', model: r.model, at: now(), fix };
          s.endFrames = [fr, ...(s.endFrames ?? [])].slice(0, 12);
          s.selectedEnd = fr.id;
        });
        return r;
      }
      const endLayout = shot.greybox?.still?.replace(/\.png$/, '-end.png');
      if (!endLayout || !fs.existsSync(mediaPath(projectId, endLayout))) throw Error('render the greybox first: its last frame is the layout for the end frame');
      const start = shot.storyboard.find((f) => f.id === shot.selectedFrame) ?? shot.storyboard[0];
      const refs = { ...stillRefs(p, shot, true), layout: endLayout };
      let text = endFramePrompt(refsPrompt(prompt?.trim() || shotPrompt(p, seq, shot, { forStill: true }), refs), shot.camera.move);
      const files = [endLayout, ...refs.sheets.map((x) => x.file)];
      // the first frame is not passed as an image: it pins the composition and the move disappears. Its words carry the continuity.
      if (start) text += `\nKeep the same place, light, colours and people as the shot's first frame, but seen from where the camera has moved to (Image 1), with the framing clearly different from the start.`;
      const r = await comfyStill(projectId, text, 'storyboard', ctx, p.aspect, files, sm);
      await mutate(projectId, (pp) => {
        const s = findShot(pp, shotId).shot;
        const fr = { id: uid('f'), file: r.file, prompt: text, engine: 'comfy+end', model: r.model, seed: r.seed, at: now(), refs: files, fix };
        s.endFrames = [fr, ...(s.endFrames ?? [])].slice(0, 12);
        s.selectedEnd = fr.id;
      });
      return r;
    }
    const sk = sketchId ? shot.sketches?.find((x) => x.id === sketchId) : undefined;
    if (sketchId && !sk?.image) throw Error('that sketch has no saved picture; save the sketch first');
    const base = prompt?.trim() || shotPrompt(p, seq, shot, { forStill: true });
    // Without a sketch, the frame follows the shot's greybox (layout and camera) and its characters' sheets.
    const refs = sk ? { layout: undefined, sheets: [] as { name: string; file: string }[] } : stillRefs(p, shot, useRefs !== false);
    // Grok Imagine gets words only (it sees no reference images), so no 'Image N is…' lines
    const text = sk ? sketchPrompt(base, sk, follow) : engine === 'grok' ? base : refsPrompt(base, refs);
    const files = sk?.image ? [sk.image] : [refs.layout, ...refs.sheets.map((x) => x.file)].filter(Boolean) as string[];
    const r = engine === 'grok'
      ? await grokStill(projectId, text, 'storyboard', ctx, sk ? undefined : shot.greybox?.still, sk ? [] : stillRefs(p, shot, true, true).sheets)
      : await comfyStill(projectId, text, 'storyboard', ctx, p.aspect, files, sm);
    await mutate(projectId, (pp) => {
      const s = findShot(pp, shotId).shot;
      const fr = { id: uid('f'), file: r.file, prompt: text, engine: sk ? `${engine}+sketch` : files.length ? `${engine}+refs` : engine, model: r.model, seed: r.seed, at: now(), sketchId: sk?.id, refs: engine === 'grok' ? undefined : files, fix };
      s.storyboard.unshift(fr);
      s.selectedFrame = fr.id;
    });
    return r;
  },

  async sheet(j, { projectId, castId, engine = 'comfy', portrait }: any, ctx) {
    const p = readProject(projectId);
    const c = p.cast.find((x) => x.id === castId);
    if (!c) throw Error('no such character');
    if (portrait) {
      if (!c.sheet) throw Error('make the sheet first');
      const r = await comfyStill(projectId, portraitPrompt(p, c.name, c.description), 'cast', ctx, '9:16', [c.sheet], stillModelOf(p));
      await mutate(projectId, (pp) => { pp.cast.find((x) => x.id === castId)!.portrait = r.file; });
      return r;
    }
    const text = sheetPrompt(p, c.name, c.description);
    const r = engine === 'grok' ? await grokStill(projectId, text, 'cast', ctx) : await comfyStill(projectId, text, 'cast', ctx, '16:9', [], stillModelOf(p));
    await mutate(projectId, (pp) => {
      const cc = pp.cast.find((x) => x.id === castId)!;
      if (cc.sheet) cc.sheets = [cc.sheet, ...(cc.sheets ?? [])].slice(0, 12);
      cc.sheet = r.file;
    });
    return r;
  },

  async look(j, { projectId, lookId, engine = 'comfy' }: any, ctx) {
    const p = readProject(projectId);
    const l = p.looks.find((x) => x.id === lookId);
    if (!l) throw Error('no such look');
    const r = engine === 'grok' ? await grokStill(projectId, lookPrompt(p, l.prompt), 'looks', ctx) : await comfyStill(projectId, lookPrompt(p, l.prompt), 'looks', ctx, p.aspect, [], stillModelOf(p));
    await mutate(projectId, (pp) => { pp.looks.find((x) => x.id === lookId)!.image = r.file; });
    return r;
  },

  async model(j, { projectId, castId }: any, ctx) {
    const p = readProject(projectId);
    const c = p.cast.find((x) => x.id === castId);
    if (!c) throw Error('no such character');
    ctx.log(`Blender model turnaround of ${c.name}`);
    const file = await renderModel(c, mediaPath(projectId, 'models'), { signal: ctx.signal, onLine: (l) => { if (/Saved|error/i.test(l)) ctx.log(l.slice(0, 160)); } });
    await mutate(projectId, (pp) => {
      const cc = pp.cast.find((x) => x.id === castId)!;
      const m = cc.model ?? (cc.model = {} as any);
      if (m.render) m.renders = [m.render, ...(m.renders ?? [])].slice(0, 8);
      m.render = rel(projectId, file);
    });
    return { file: rel(projectId, file) };
  },

  async greybox(j, { projectId, shotId }: any, ctx) {
    const p = readProject(projectId);
    const { seq, shot } = findShot(p, shotId);
    const gb = shot.greybox ?? defaultGreybox(shot);
    ctx.log(`Blender greybox: ${gb.actors.length} figures, ${gb.props.length + (gb.useSet !== false ? seq.set?.length ?? 0 : 0)} set pieces, ${h3Len(shot.duration)} frames`);
    const r = await renderGreybox(p, seq, shot, gb, mediaPath(projectId, 'greybox'), { signal: ctx.signal, onLine: (l) => { if (/Fra:|Saved|error/i.test(l)) ctx.log(l.slice(0, 160)); } });
    await mutate(projectId, (pp) => {
      const s = findShot(pp, shotId).shot;
      s.greybox = { ...(s.greybox ?? gb), video: rel(projectId, r.video), still: rel(projectId, r.still) };
    });
    return { frames: r.frames };
  },

  async take(j, { projectId, shotId, takeId, opts = {} }: any, ctx) {
    const p = readProject(projectId);
    const { seq, shot } = findShot(p, shotId);
    const take = shot.takes.find((t) => t.id === takeId)!;
    const inputs = resolveTakeInputs(p, shot, opts);
    const tag = `${projectId}-${shotId}-${takeId}`;
    const up = async (file: string | undefined, name: string) => file ? comfy.upload(mediaPath(projectId, file), `ads-${tag}-${name}${path.extname(file)}`) : null;
    const frames = h3Len(opts.duration ?? shot.duration);
    const graph = h3Graph({
      prompt: take.prompt,
      frames,
      seed: take.seed!,
      steps: opts.steps ?? 20,
      keep: opts.keep ?? 5,
      guideVideo: inputs.guide ? await up(inputs.guide, 'guide') : null,
      look: inputs.look ? await up(inputs.look, 'look') : null,
      characters: (await Promise.all(inputs.sheets.map((s, i) => up(s, `cast${i}`)))).filter(Boolean) as string[],
      startFrame: inputs.start ? await up(inputs.start, 'start') : null,
      endFrame: inputs.end ? await up(inputs.end, 'end') : null,
      prefix: `ark-studio/${tag}`,
    });
    ctx.log(`H3 ${frames} frames, seed ${take.seed}; start ${inputs.start ? 'yes' : 'no'}, end ${inputs.end ? 'yes' : 'no'}, guide ${inputs.guide ? 'greybox' : 'none'}, look ${inputs.look ? 'yes' : 'no'}, ${inputs.sheets.length} character sheets`);
    await setTake(projectId, shotId, takeId, { status: 'running', jobId: j.id, startFrom: inputs.start, params: { ...take.params, inputs } });
    const r = await comfy.run(graph, { signal: ctx.signal, onBeat: (sec) => { if (sec % 30 < 3) ctx.lease?.progress(`${Math.round(sec / 60)} min`); } });
    const o = r.outputs.find((x) => /\.(mp4|webm|mov)$/i.test(x.filename));
    if (!o) throw Error('H3 returned no video');
    const dest = mediaPath(projectId, `takes/${shotId}-${takeId}.mp4`);
    await comfy.download(o, dest);
    const lf = await lastFrame(dest, mediaPath(projectId, `takes/${shotId}-${takeId}-last.png`));
    ctx.log(`take done in ${Math.round(r.seconds / 60)} min`);
    await setTake(projectId, shotId, takeId, { status: 'done', file: rel(projectId, dest), lastFrame: rel(projectId, lf) }, true);
    return { file: rel(projectId, dest) };
  },

  async 'grok-video'(j, { projectId, shotId, takeId, opts = {} }: any, ctx) {
    const p = readProject(projectId);
    const { shot } = findShot(p, shotId);
    const take = shot.takes.find((t) => t.id === takeId)!;
    const inputs = resolveTakeInputs(p, shot, opts);
    await setTake(projectId, shotId, takeId, { status: 'running', jobId: j.id, startFrom: inputs.start, params: { ...take.params, inputs } });
    const [f] = await grokGenerate({ prompt: take.prompt, kind: 'video', image: inputs.start ? mediaPath(projectId, inputs.start) : undefined, outDir: mediaPath(projectId, 'takes'), onLine: ctx.log });
    const lf = await lastFrame(f, f.replace(/\.\w+$/, '-last.png'));
    await setTake(projectId, shotId, takeId, { status: 'done', file: rel(projectId, f), lastFrame: rel(projectId, lf) }, true);
    return { file: rel(projectId, f) };
  },

  async 'grok-image'(j, payload, ctx) { return HANDLERS.storyboard(j, { ...payload, engine: 'grok' }, ctx); },

  async agent(j, { projectId, agent = 'claude', task, mode = 'basic', sequenceId, replace = true }: { projectId: string; agent: AgentId; task: 'parse' | 'review'; mode: 'basic' | 'expert'; sequenceId?: string; replace?: boolean }, ctx) {
    const p = readProject(projectId);
    if (task === 'review') {
      const seq = p.sequences.find((s) => s.id === sequenceId);
      if (!seq) throw Error('no such sequence');
      const text = await runAgent(agent, sequenceReviewPrompt(p, seq), { signal: ctx.signal, onLine: (l) => ctx.log(l.slice(0, 200)) });
      await mutate(projectId, (pp) => { pp.sequences.find((s) => s.id === sequenceId)!.review = `${agent}, ${now()}\n\n${text}`; });
      return { text };
    }
    if (!p.script.trim()) throw Error('paste the story or lyrics first');
    ctx.log(`asking ${agent} to break the ${p.kind === 'song' ? 'lyrics' : 'story'} into sequences and shots`);
    const text = await runAgent(agent, storyParsePrompt(p, mode), { signal: ctx.signal, onLine: (l) => ctx.log(l.slice(0, 200)) });
    const plan = extractJson(text);
    const counts = await mutate(projectId, (pp) => { applyStoryPlan(pp, plan, replace); });
    ctx.log(`${counts.sequences.length} sequences, ${counts.sequences.reduce((n, s) => n + s.shots.length, 0)} shots, ${counts.cast.length} characters`);
    return { sequences: counts.sequences.length };
  },

  async ark(j, { projectId, stage, opts = {}, shotId }: any, ctx) {
    const p = readProject(projectId);
    const out = await runStage(p, stage, opts, { signal: ctx.signal, onLine: (l) => ctx.log(l.slice(0, 240)) });
    if (stage === 'photoreal' && shotId) {
      const { shot } = findShot(p, shotId);
      const file = await pullSceneClip(p, shot);
      const lf = await lastFrame(mediaPath(projectId, file), mediaPath(projectId, file.replace(/\.mp4$/, '-last.png')));
      await mutate(projectId, (pp) => {
        const s = findShot(pp, shotId).shot;
        const t: Take = { id: uid('t'), status: 'done', engine: 'ark', file, lastFrame: rel(projectId, lf), prompt: s.prompt, params: { stage, ...opts }, at: now() };
        s.takes.unshift(t);
        s.selectedTake = t.id;
      });
    }
    return { out };
  },

  async assemble(j, { projectId, sequenceId }: any, ctx) {
    const p = readProject(projectId);
    const seqs = sequenceId ? p.sequences.filter((s) => s.id === sequenceId) : p.sequences;
    const clips: string[] = [];
    const missing: string[] = [];
    for (const q of seqs) for (const s of q.shots) {
      const t = s.takes.find((x) => x.id === s.selectedTake) ?? s.takes.find((x) => x.status === 'done');
      if (t?.file) clips.push(mediaPath(projectId, t.file)); else missing.push(s.title);
    }
    if (missing.length) ctx.log(`no take yet for: ${missing.join(', ')} (left out)`);
    const first = seqs[0]?.shots[0];
    const name = `assembled/${sequenceId ?? 'film'}-${Date.now()}.mp4`;
    const out = mediaPath(projectId, name);
    await assemble(clips, out, { fps: 24, audio: p.audio ? mediaPath(projectId, p.audio) : undefined, audioFrom: first?.from ?? 0 });
    const info = await probe(out);
    ctx.log(`assembled ${clips.length} takes, ${info.duration.toFixed(1)} s`);
    await mutate(projectId, (pp) => { for (const q of pp.sequences) if (!sequenceId || q.id === sequenceId) q.assembled = name; });
    return { file: name, duration: info.duration, missing };
  },

  async review(j, payload, ctx) { return HANDLERS.agent(j, { ...payload, task: 'review' }, ctx); },
};

const HANDLERS_FAIL: Partial<Record<JobKind, (j: Job, payload: any, error: string) => Promise<void>>> = {
  async take(j, { projectId, shotId, takeId }) { await setTake(projectId, shotId, takeId, { status: j.status === 'cancelled' ? 'cancelled' : 'failed', error: j.error }); },
  async 'grok-video'(j, { projectId, shotId, takeId }) { await setTake(projectId, shotId, takeId, { status: j.status === 'cancelled' ? 'cancelled' : 'failed', error: j.error }); },
};

async function setTake(projectId: string, shotId: string, takeId: string, patch: Partial<Take>, selectIfFirst = false) {
  await mutate(projectId, (pp) => {
    const s = findShot(pp, shotId).shot;
    const t = s.takes.find((x) => x.id === takeId);
    if (!t) return;
    Object.assign(t, patch);
    if (selectIfFirst && (!s.selectedTake || !s.takes.find((x) => x.id === s.selectedTake && x.status === 'done'))) s.selectedTake = t.id;
  });
  projectChanged(projectId);
}

// The pictures a storyboard still follows: the shot's greybox render for layout and camera, then the
// sheets of the characters in it (at most four, the people the greybox actually places first).
export function stillRefs(p: Project, shot: Shot, on = true, sheetFirst = false) {
  if (!on) return { layout: undefined as string | undefined, sheets: [] as { name: string; file: string }[] };
  const placed = (shot.greybox?.actors ?? []).map((a) => a.castId).filter(Boolean) as string[];
  const ids = [...new Set([...placed, ...shot.castIds])];
  const found = ids.map((id) => p.cast.find((c) => c.id === id)).filter((c) => c?.portrait || c?.sheet) as Character[];
  // up to four people, then any set pieces (a gate) so they hold their design and scale
  const sheets = [...found.filter((c) => !c.prop).slice(0, 4), ...found.filter((c) => c.prop).slice(0, 1)]
    .map((c) => ({ name: c.name, file: (sheetFirst ? c.sheet ?? c.portrait : c.portrait ?? c.sheet)!, prop: c.prop, note: c.prop ? c.description : undefined }));
  return { layout: shot.greybox?.still, sheets };
}

// What a take starts from and carries, by the continuity rules:
// start from the previous shot's chosen take's last frame when the sequence chains, otherwise from
// the chosen storyboard frame; every character sheet in the shot and the sequence's look ride along.
export function resolveTakeInputs(p: Project, shot: Shot, opts: any = {}) {
  const { seq } = findShot(p, shot.id);
  const prev = previousShot(p, shot.id);
  const prevTake = prev?.takes.find((t) => t.id === prev.selectedTake && t.status === 'done');
  const frame = shot.storyboard.find((f) => f.id === shot.selectedFrame) ?? shot.storyboard[0];
  const cohesive = cohesionOn(p.render);
  let start: string | undefined;
  let startWhy = 'none';
  if (opts.start === 'none') { start = undefined; }
  else if (opts.start === 'frame') { start = frame?.file; startWhy = 'storyboard frame'; }
  else if (cohesive && seq.continuity.chain && shot.chainFromPrevious && prevTake?.lastFrame) { start = prevTake.lastFrame; startWhy = `last frame of ${prev!.title}`; }
  else if (frame) { start = frame.file; startWhy = 'storyboard frame'; }
  const lookId = shot.lookId ?? seq.continuity.lookId;
  const look = p.looks.find((l) => l.id === lookId)?.image;
  const castIds = [...new Set([...shot.castIds])];
  // sheets ride along on every take when the film needs cohesion; otherwise only locked ones
  const sheets = castIds.map((id) => p.cast.find((c) => c.id === id)).filter((c) => c?.sheet && (cohesive || c.locked)).map((c) => c!.sheet!) as string[];
  const guide = opts.guide === false ? undefined : shot.greybox?.video;
  // a moving shot ends on its chosen end frame unless the take says otherwise
  const endFr = shot.endFrames?.find((f) => f.id === shot.selectedEnd) ?? shot.endFrames?.[0];
  const end = opts.end === 'none' ? undefined : (opts.endFrame as string | undefined) ?? endFr?.file;
  return { start, startWhy: start ? startWhy : 'none', look, sheets, guide, end };
}

export function startTake(projectId: string, shotId: string, opts: any = {}) {
  const p = readProject(projectId);
  const { seq, shot } = findShot(p, shotId);
  const engine: 'h3' | 'grok' = opts.engine ?? (shot.source === 'grok' ? 'grok' : 'h3');
  const take: Take = { id: uid('t'), status: 'queued', engine, prompt: opts.prompt ?? shotPrompt(p, seq, shot), seed: opts.seed ?? seed(), params: { ...opts, inputs: resolveTakeInputs(p, shot, opts) }, at: now() };
  const startFrom = (take.params.inputs as any).start;
  take.startFrom = startFrom;
  return mutate(projectId, (pp) => { findShot(pp, shotId).shot.takes.unshift(take); }).then(() => {
    const kind = engine === 'grok' ? 'grok-video' : 'take';
    const j = enqueue(kind, `${p.title}: ${shot.title} take (${engine === 'grok' ? 'Grok Imagine' : 'H3'})`, { projectId, shotId, takeId: take.id, opts }, { projectId, gpu: engine !== 'grok', ref: { shotId, takeId: take.id, sequenceId: seq.id } });
    return { take, job: j };
  });
}

// Apply an agent's shot list: { cast, sequences: [{ title, summary, continuity, shots: [...] }] }.
export function applyStoryPlan(p: Project, plan: any, replace: boolean) {
  const byName = new Map(p.cast.map((c) => [c.name.toLowerCase(), c]));
  for (const c of plan.cast ?? []) {
    if (!c?.name || byName.has(String(c.name).toLowerCase())) continue;
    const nc = { id: uid('c'), name: String(c.name), description: String(c.description ?? '') };
    p.cast.push(nc);
    byName.set(nc.name.toLowerCase(), nc);
  }
  const seqs = (plan.sequences ?? []).map((sq: any) => {
    const q = newSequence(String(sq.title ?? 'Sequence'));
    q.summary = String(sq.summary ?? '');
    q.continuity.plan = String(sq.continuity ?? '');
    const ids = new Set<string>();
    q.shots = (sq.shots ?? []).map((s: any) => {
      const castIds = (s.cast ?? []).map((n: string) => byName.get(String(n).toLowerCase())?.id).filter(Boolean) as string[];
      castIds.forEach((id) => ids.add(id));
      return newShot({
        ...shotDefaults(p),
        title: String(s.title ?? 'Shot'), action: String(s.action ?? ''), prompt: String(s.prompt ?? ''),
        duration: Math.min(15, Math.max(4, Number(s.duration) || 6)),
        camera: { preset: CAMERA_PRESETS[s.camera] ? s.camera : 'medium', move: s.move ? String(s.move) : undefined },
        castIds, dialogue: s.dialogue || undefined, lyric: s.lyric || undefined,
      });
    });
    q.continuity.castIds = [...ids];
    return q;
  });
  p.sequences = replace ? seqs : [...p.sequences, ...seqs];
  return p;
}

export { ARK_STAGES };
