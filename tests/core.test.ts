import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOps } from '../server/ops.ts';
import { h3Len, h3Graph } from '../server/workflows.ts';
import { extractJson } from '../server/agents.ts';
import { applyStoryPlan, resolveTakeInputs } from '../server/jobs.ts';
import { imageGraph } from '../server/workflows.ts';
import { sketchPrompt } from '../server/prompts.ts';
import { renderFromFilm, ARK_STAGES } from '../server/ark.ts';
import { newSequence, newShot } from '../server/store.ts';
import { withRender, cohesionOn, videoTypeOf, type Project } from '../shared/types.ts';

const project = (): Project => ({ id: 'test', title: 'T', kind: 'live', fps: 24, aspect: '16:9', style: '', script: '', cast: [], looks: [], sequences: [], render: withRender({ look: 'live' }), created: '', updated: '' });

test('ops address array elements by id', () => {
  const p = project();
  const q = newSequence('A');
  q.shots.push(newShot({ title: 'one' }), newShot({ title: 'two' }));
  p.sequences.push(q);
  const [a, b] = q.shots;
  applyOps(p, [{ op: 'set', path: ['sequences', q.id, 'shots', b.id, 'prompt'], value: 'hello' }]);
  assert.equal(p.sequences[0].shots[1].prompt, 'hello');
  applyOps(p, [{ op: 'move', path: ['sequences', q.id, 'shots'], id: b.id, index: 0 }]);
  assert.deepEqual(p.sequences[0].shots.map((s) => s.title), ['two', 'one']);
  applyOps(p, [{ op: 'remove', path: ['sequences', q.id, 'shots', a.id] }]);
  assert.equal(p.sequences[0].shots.length, 1);
  applyOps(p, [{ op: 'insert', path: ['sequences', q.id, 'shots'], value: { title: 'three' } }]);
  assert.equal(p.sequences[0].shots[1].title, 'three');
  assert.ok(p.sequences[0].shots[1].id.startsWith('s'));
  assert.throws(() => applyOps(p, [{ op: 'set', path: ['id'], value: 'x' }]));
});

test('H3 lengths are 17k + 5 frames within range', () => {
  assert.equal(h3Len(5), 124);
  assert.equal((h3Len(6) - 5) % 17, 0);
  assert.equal(h3Len(60), 362);
  assert.equal(h3Len(0.1), 5);
});

test('H3 graph anchors start and end frames and carries character sheets', () => {
  const g: any = h3Graph({ prompt: 'p', frames: 124, seed: 1, look: 'look.png', characters: ['a.png', 'b.png'], startFrame: 's.png', endFrame: 'e.png', guideVideo: 'g.mp4', prefix: 'x' });
  const refs = Object.keys(g[16].inputs).filter((k) => k.startsWith('ref_images.'));
  assert.equal(refs.length, 3);
  const guides = Object.values(g).filter((n: any) => n.class_type === 'MiniMaxH3AddGuide') as any[];
  assert.deepEqual(guides.map((n) => n.inputs.frame_idx).sort(), [-1, -1, 0, 0]);
  assert.ok(g[6].inputs['ref_videos.ref_video_1']);
  assert.ok(!g[16].inputs['ref_videos.ref_video_1']);
});

test('agent JSON is found inside prose and fences', () => {
  assert.deepEqual(extractJson('Here you go:\n```json\n{"a": {"b": "}"}}\n```'), { a: { b: '}' } });
  assert.deepEqual(extractJson('{"x":1} trailing'), { x: 1 });
});

test('a story plan becomes cast, sequences and shots, and takes chain from the previous last frame', () => {
  const p = project();
  applyStoryPlan(p, {
    cast: [{ name: 'Martha', description: 'woman in her thirties, brown linen' }],
    sequences: [{ title: 'Tomb', continuity: 'dusk, low sun left', shots: [
      { title: 'Wide', action: 'Martha walks to the tomb', prompt: 'woman walks', duration: 30, camera: 'wide-establish', cast: ['martha'] },
      { title: 'Close', action: 'She looks up', duration: 2, camera: 'nope', cast: [] },
    ] }],
  }, true);
  const [q] = p.sequences;
  assert.equal(p.cast.length, 1);
  assert.equal(q.shots[0].duration, 15);
  assert.equal(q.shots[1].duration, 4);
  assert.equal(q.shots[1].camera.preset, 'medium');
  assert.deepEqual(q.continuity.castIds, [p.cast[0].id]);
  q.shots[0].takes.push({ id: 't1', status: 'done', engine: 'h3', file: 'a.mp4', lastFrame: 'a-last.png', prompt: '', params: {}, at: '' });
  q.shots[0].selectedTake = 't1';
  q.shots[1].storyboard.push({ id: 'f', file: 'frame.png', prompt: '', engine: 'comfy', at: '' });
  assert.equal(resolveTakeInputs(p, q.shots[1]).start, 'a-last.png');
  q.continuity.chain = false;
  assert.equal(resolveTakeInputs(p, q.shots[1]).start, 'frame.png');
});

test('pure code films relax cohesion: no chaining, only locked sheets', () => {
  const p = project();
  p.render = withRender({ look: 'code', tier: 'ultra' });
  assert.equal(cohesionOn(p.render), false);
  assert.equal(cohesionOn(withRender({ look: 'code', cohesion: 'on' })), true);
  assert.equal(cohesionOn(withRender({ look: 'photoreal' })), true);
  const q = newSequence('A');
  p.cast.push({ id: 'c1', name: 'M', description: '', sheet: 'm.png' });
  q.shots.push(newShot({ title: 'one' }), newShot({ title: 'two', castIds: ['c1'] }));
  p.sequences.push(q);
  q.shots[0].takes.push({ id: 't1', status: 'done', engine: 'h3', file: 'a.mp4', lastFrame: 'a-last.png', prompt: '', params: {}, at: '' });
  q.shots[0].selectedTake = 't1';
  const r = resolveTakeInputs(p, q.shots[1]);
  assert.equal(r.start, undefined);
  assert.deepEqual(r.sheets, []);
  p.cast[0].locked = true;
  assert.deepEqual(resolveTakeInputs(p, q.shots[1]).sheets, ['m.png']);
  assert.equal(videoTypeOf('song', p.render), 'ultra-code');
});

test('every video type reaches the engine as flags', () => {
  const r = withRender({ look: 'photoreal', tier: 'premium', resolution: '3840x2160', photoreal: { chain: 'continuum', styleRef: 'code', tuck: false, keep: 6, steps: 24, proxyBlur: 1.5 } as any });
  assert.deepEqual(ARK_STAGES.film.args('S', { r }), ['photoreal/film.mjs', '--song', 'S', '--tier', 'premium', '--res', '3840x2160']);
  assert.deepEqual(ARK_STAGES.photoreal.args('S', { r, only: '07' }), ['photoreal/photorealistic.mjs', '--song', 'S', '--only', '07', '--chain', 'continuum', '--look', 'code', '--keep', '6', '--steps', '24', '--no-tuck', '--proxy-blur', '1.5']);
  assert.deepEqual(ARK_STAGES.musicvideo.args('S', { r: withRender({ look: 'mixed', popcam: false }) }), ['photoreal/musicvideo.mjs', '--song', 'S', '--tier', 'ultra', '--no-popcam']);
  const f = renderFromFilm({ mode: 'musicvideo', tier: 'fast', scenes: [{ id: '01', source: 'h3' }] });
  assert.equal(f.look, 'mixed');
  assert.equal(f.tier, 'fast');
  assert.equal(renderFromFilm({ scenes: [{ id: '01', scene: 'ridge' }] }).look, 'code');
});

test('a sketch rides into Qwen-Image as a reference image', () => {
  const g: any = imageGraph({ prompt: 'p', seed: 1, prefix: 'x', refs: ['sketch.png'] });
  assert.equal(g[20].inputs.image, 'sketch.png');
  assert.deepEqual(g[4].inputs['images.image_1'], ['20', 0]);
  assert.deepEqual(g[4].inputs.vae, ['3', 0]);
  const plain: any = imageGraph({ prompt: 'p', seed: 1, prefix: 'x' });
  assert.equal(plain[4].inputs.vae, undefined);
  const text = sketchPrompt('Martha at the tomb.', { id: 'k', shapes: [], note: 'left is Martha', at: '' }, 'exact');
  assert.match(text, /stick figures are people/);
  assert.match(text, /left is Martha/);
  assert.match(text, /Martha at the tomb\./);
});
