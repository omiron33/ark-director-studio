// Blender greybox renders: a shot's characters (built from their models), the sequence's set, lights and
// the camera move as a plain clip that guides H3. Also the turnaround render of one character's model.
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.ts';
import { exec } from './media.ts';
import { H3, h3Len } from './workflows.ts';
import { DEFAULT_MODEL, type Character, type Greybox, type Project, type Sequence, type Shot } from '../shared/types.ts';

export const defaultGreybox = (shot: Shot): Greybox => ({
  actors: shot.castIds.length ? shot.castIds.map((id, i) => ({ castId: id, label: id, pose: 'stand', x: (i - (shot.castIds.length - 1) / 2) * 1.2, z: 0, heading: 0 })) : [{ label: 'figure', pose: 'stand', x: 0, z: 0, heading: 0 }],
  props: [],
  camera: { from: [0, 1.6, 7], to: [0, 1.6, 5.5], look: [0, 1.3, 0], lens: 35 },
  sun: { azimuth: 40, elevation: 35 },
});

export const modelOf = (c?: Character) => ({ ...DEFAULT_MODEL, ...(c?.model ?? {}) });

// The spec greybox.py reads: the shot's own greybox, the sequence's set and lights unless turned off,
// and each actor's character model.
export function greyboxSpec(p: Project, seq: Sequence | undefined, shot: Shot, gb: Greybox) {
  const useSet = gb.useSet !== false;
  return {
    mode: 'shot', fps: H3.fps, frames: h3Len(shot.duration), width: H3.width, height: H3.height,
    mist: gb.mist ?? 0, sun: gb.sun, camera: gb.camera,
    props: [...(useSet ? seq?.set ?? [] : []), ...gb.props],
    lights: [...(useSet ? seq?.setLights ?? [] : []), ...(gb.lights ?? [])],
    actors: gb.actors.map((a) => ({ ...a, model: a.castId ? modelOf(p.cast.find((c) => c.id === a.castId)) : undefined })),
  };
}

async function blender(spec: unknown, framesDir: string, opts: { signal?: AbortSignal; onLine?: (l: string) => void }) {
  fs.mkdirSync(framesDir, { recursive: true });
  const specFile = path.join(framesDir, 'spec.json');
  fs.writeFileSync(specFile, JSON.stringify(spec));
  const r = await exec(config.blender, ['-b', '--factory-startup', '-P', path.join(ROOT, 'blender', 'greybox.py'), '--', '--spec', specFile, '--out', framesDir], { ...opts, timeoutMs: 30 * 60000 });
  if (r.code !== 0 || !/GREYBOX_DONE/.test(r.out)) throw Error(`Blender failed: ${(r.err || r.out).slice(-800)}`);
}

export async function renderGreybox(p: Project, seq: Sequence | undefined, shot: Shot, gb: Greybox, outDir: string, opts: { signal?: AbortSignal; onLine?: (l: string) => void } = {}) {
  const spec = greyboxSpec(p, seq, shot, gb);
  const framesDir = path.join(outDir, `frames-${Date.now()}`);
  await blender(spec, framesDir, opts);
  const video = path.join(outDir, `greybox-${shot.id}-${Date.now()}.mp4`);
  const ff = await exec(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(H3.fps), '-i', path.join(framesDir, '%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', video]);
  if (ff.code !== 0) throw Error(`encoding the greybox failed: ${ff.err.slice(-400)}`);
  const still = path.join(outDir, path.basename(video).replace('.mp4', '.png'));
  fs.copyFileSync(path.join(framesDir, '0001.png'), still);
  // the last frame too: what the shot ends on, for planning the next one
  const last = path.join(framesDir, `${String(spec.frames).padStart(4, '0')}.png`);
  if (fs.existsSync(last)) fs.copyFileSync(last, still.replace('.png', '-end.png'));
  fs.rmSync(framesDir, { recursive: true, force: true });
  return { video, still, frames: spec.frames };
}

// Front, side and back of one character's model, side by side.
export async function renderModel(c: Character, outDir: string, opts: { signal?: AbortSignal; onLine?: (l: string) => void } = {}) {
  const framesDir = path.join(outDir, `turn-${Date.now()}`);
  await blender({ mode: 'turnaround', width: 1344, height: 768, actors: [{ label: c.name, pose: 'stand', model: modelOf(c) }] }, framesDir, opts);
  const file = path.join(outDir, `${c.id}-${Date.now()}.png`);
  fs.copyFileSync(path.join(framesDir, 'turnaround.png'), file);
  fs.rmSync(framesDir, { recursive: true, force: true });
  return file;
}
