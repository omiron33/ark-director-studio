// Continue a shot's take with one more H3 piece that starts on a given frame (the previous piece's last frame),
// so a shot longer than one generation can hold is rendered as chained pieces rather than stretched.
// Runs outside the studio server (it claims the GPU through the dashboard like any take):
//   npx tsx scripts/continue-take.ts --project <id> --shot <shotId> --start <media path> --seconds <s> --out <media path>
//        [--end <media path>|none] [--sung <media path> --speaker <name>] [--keep 3]
import path from 'node:path';
import { readProject, findShot, mediaPath } from '../server/store.ts';
import { shotPrompt } from '../server/prompts.ts';
import { h3Graph, h3Len } from '../server/workflows.ts';
import * as comfy from '../server/comfy.ts';
import { claimGpu } from '../server/gpuq.ts';
import { lastFrame } from '../server/media.ts';
import { cohesionOn } from '../shared/types.ts';

const arg = (k: string) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : undefined; };
const projectId = arg('project')!, shotId = arg('shot')!, start = arg('start')!, out = arg('out')!;
const seconds = Number(arg('seconds')), end = arg('end'), sung = arg('sung'), speaker = arg('speaker') ?? 'The speaker';
const p = readProject(projectId);
const { seq, shot } = findShot(p, shotId);
const cohesive = cohesionOn(p.render);
const sheets = shot.castIds.map((id) => p.cast.find((c) => c.id === id)).filter((c) => c?.sheet && (cohesive || c.locked)).map((c) => c!.sheet!) as string[];
const lookId = shot.lookId ?? seq.continuity.lookId;
const look = p.looks.find((l) => l.id === lookId)?.image;
const endFr = end === 'none' ? undefined : end ?? (shot.endFrames?.find((f) => f.id === shot.selectedEnd) ?? shot.endFrames?.[0])?.file;
const tag = `${projectId}-${shotId}-cont-${Date.now()}`;
const up = (f: string | undefined, name: string) => f ? comfy.upload(path.isAbsolute(f) ? f : mediaPath(projectId, f), `ads-${tag}-${name}${path.extname(f)}`) : Promise.resolve(null);
const prompt = shotPrompt(p, seq, shot)
  + '\nThis piece continues the shot seamlessly from its first frame: the same place, people, light and camera move, carrying on without any cut or reset.'
  + (sung ? `\n${speaker} sings exactly the words heard in <Audio 1>, lips and jaw matching every syllable at the moment it is sung; whenever the audio is silent his mouth is closed. Nobody else in the shot sings or speaks.` : '')
  + '\nThe whole world in the frame moves naturally and continuously the entire time. One smooth, continuous camera move, with no jumps, morphs or sudden changes.';
const graph = h3Graph({
  prompt, frames: h3Len(seconds), seed: Math.floor(Math.random() * 2 ** 31), steps: 20, keep: Number(arg('keep') ?? 3), guideVideo: null,
  look: (await up(look, 'look')), characters: (await Promise.all(sheets.map((s, i) => up(s, `cast${i}`)))).filter(Boolean) as string[],
  startFrame: await up(start, 'start'), endFrame: await up(endFr, 'end'), songAudio: sung ? await up(sung, 'sung') : null,
  prefix: `ark-studio/${tag}`,
});
const lease = await claimGpu({ tool: 'MiniMax H3', description: `${p.title}: ${shot.title} (continuation piece)`, project: projectId, expectMinutes: 15, onWait: (n) => console.log('waiting:', n) });
try {
  const r = await comfy.run(graph, { onBeat: (sec) => { if (sec % 60 < 3) lease.progress(`${Math.round(sec / 60)} min`); } });
  const o = r.outputs.find((x) => /\.(mp4|webm|mov)$/i.test(x.filename));
  if (!o) throw Error('H3 returned no video');
  const dest = path.isAbsolute(out) ? out : mediaPath(projectId, out);
  await comfy.download(o, dest);
  await lastFrame(dest, dest.replace(/\.mp4$/, '-last.png'));
  console.log('wrote', dest, `${Math.round(r.seconds / 60)} min`);
  await lease.end('done');
} catch (e) { await lease.end('failed'); throw e; }
