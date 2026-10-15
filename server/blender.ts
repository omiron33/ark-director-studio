// Blender greybox renders: a shot's actors, props and camera move as a plain clip that guides H3.
import fs from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.ts';
import { exec } from './media.ts';
import { H3, h3Len } from './workflows.ts';
import type { Greybox, Shot } from '../shared/types.ts';

export const defaultGreybox = (shot: Shot): Greybox => ({
  actors: shot.castIds.length ? shot.castIds.map((id, i) => ({ castId: id, label: id, pose: 'stand', x: (i - (shot.castIds.length - 1) / 2) * 1.2, z: 0, heading: 0 })) : [{ label: 'figure', pose: 'stand', x: 0, z: 0, heading: 0 }],
  props: [],
  camera: { from: [0, 1.6, 7], to: [0, 1.6, 5.5], look: [0, 1.3, 0], lens: 35 },
  sun: { azimuth: 40, elevation: 35 },
});

export async function renderGreybox(shot: Shot, gb: Greybox, outDir: string, { signal, onLine }: { signal?: AbortSignal; onLine?: (l: string) => void } = {}) {
  const frames = h3Len(shot.duration);
  const framesDir = path.join(outDir, `frames-${Date.now()}`);
  fs.mkdirSync(framesDir, { recursive: true });
  const spec = { fps: H3.fps, frames, width: H3.width, height: H3.height, ...gb };
  const specFile = path.join(framesDir, 'spec.json');
  fs.writeFileSync(specFile, JSON.stringify(spec));
  const r = await exec(config.blender, ['-b', '--factory-startup', '-P', path.join(ROOT, 'blender', 'greybox.py'), '--', '--spec', specFile, '--out', framesDir], { signal, onLine, timeoutMs: 30 * 60000 });
  if (r.code !== 0 || !/GREYBOX_DONE/.test(r.out)) throw Error(`Blender failed: ${(r.err || r.out).slice(-800)}`);
  const video = path.join(outDir, `greybox-${Date.now()}.mp4`);
  const ff = await exec(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(H3.fps), '-i', path.join(framesDir, '%04d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', video]);
  if (ff.code !== 0) throw Error(`encoding the greybox failed: ${ff.err.slice(-400)}`);
  const still = path.join(outDir, path.basename(video).replace('.mp4', '.png'));
  fs.copyFileSync(path.join(framesDir, '0001.png'), still);
  fs.rmSync(framesDir, { recursive: true, force: true });
  return { video, still, frames };
}
