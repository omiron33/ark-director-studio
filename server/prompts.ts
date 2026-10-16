// Turning a shot into words for a model. One place, so storyboards, takes and Grok all agree.
import { CAMERA_PRESETS, cohesionOn, type Project, type Shot, type Sequence, type Sketch } from '../shared/types.ts';

export function shotPrompt(p: Project, seq: Sequence, shot: Shot, { forStill = false } = {}) {
  const cam = CAMERA_PRESETS[shot.camera.preset];
  const cast = shot.castIds.map((id) => p.cast.find((c) => c.id === id)).filter(Boolean)
    .map((c) => `${c!.name}: ${c!.description}`);
  const look = p.looks.find((l) => l.id === (shot.lookId ?? seq.continuity.lookId));
  const parts = [
    shot.prompt.trim() || shot.action.trim(),
    cam ? `${cam.words}${shot.camera.lens || cam.lens ? `, ${shot.camera.lens || cam.lens} lens` : ''}.` : '',
    shot.camera.move && !forStill ? `Camera: ${shot.camera.move}.` : '',
    shot.words?.trim() ? `Words in the scene: ${shot.words.trim()}${shot.lyric ? ` The words read exactly "${shot.lyric}", sharp and legible.` : ''}` : '',
    cast.length ? `In the shot: ${cast.join('; ')}.` : '',
    seq.continuity.plan && cohesionOn(p.render) ? `Continuity: ${seq.continuity.plan}` : '',
    look?.prompt ? `Look: ${look.prompt}` : '',
    p.style ? `Style: ${p.style}` : '',
  ];
  return parts.filter(Boolean).join('\n');
}

// How closely a frame follows Shane's stick-figure sketch.
export const SKETCH_FOLLOW: Record<string, string> = {
  exact: 'Follow the sketch exactly: the same number of people, each where the sketch puts them, in the pose its lines draw, at the size it draws them, with the camera framing the sketch shows.',
  loose: 'Use the sketch as the layout: where people and things stand and roughly how they are posed. Improve the composition where it helps.',
  idea: 'Take the sketch as a rough idea of the scene and compose a strong cinematic frame from it.',
};
export function sketchPrompt(base: string, sk: Sketch, follow = 'exact') {
  return `Image 1 is a rough hand sketch of this frame: stick figures are people (a circle is a head, lines are the body, arms and legs), boxes and lines are buildings, furniture, objects and the ground, arrows show which way someone moves or looks, and written words label what a shape is. Never draw the sketch itself, its lines, or its labels; paint the real scene it describes.
${SKETCH_FOLLOW[follow] ?? SKETCH_FOLLOW.exact}
${sk.note ? `What the sketch shows: ${sk.note}\n` : ''}
${base}`;
}

// The frame a moving shot ends on: the same moment after the camera (and the people) have moved.
export function endFramePrompt(base: string, move?: string) {
  return `This is the LAST frame of the shot, after the camera move${move ? ` (${move})` : ''} has finished: the same place, light and people as the shot's first frame, now seen from where the camera ends.\n\n${base}`;
}

// A storyboard still that follows the shot's greybox and its characters' sheets.
export function refsPrompt(base: string, refs: { layout?: string; sheets: { name: string }[] }) {
  if (!refs.layout && !refs.sheets.length) return base;
  const lines: string[] = [];
  let n = 1;
  if (refs.layout) lines.push(`Image ${n++} is a plain grey Blender layout of this shot: follow its camera angle, framing and where each figure and structure stands. Never draw the grey mannequins, grey boxes or the grey floor; paint the real people and the real place.`);
  for (const s of refs.sheets) lines.push(`Image ${n++} shows ${s.name}: keep that face, hair, build and costume exactly. ${s.name} appears exactly once in the frame.`);
  return `${lines.join('\n')}\n\n${base}`;
}

export function sheetPrompt(p: Project, name: string, description: string) {
  return `Character reference sheet of ${name}: ${description}. Full body front view, three-quarter view and side view standing side by side, plus a head-and-shoulders close-up, on a plain neutral grey studio background, even soft light, consistent costume in every view. ${p.style ? `Style: ${p.style}` : ''}`;
}

export function portraitPrompt(p: Project, name: string, description: string) {
  return `Image 1 is the character sheet of ${name}. Paint ONE full-length portrait of this same person: exactly one person in the image, standing, facing the camera, head to toe, the same face, hair, build and costume as the sheet, on a plain neutral grey studio background with even soft light. Never repeat the person, never draw several views. ${name}: ${description}. ${p.style ? `Style: ${p.style}` : ''}`;
}

export function lookPrompt(p: Project, words: string) {
  return `A single cinematic frame that defines the film's look: ${words}. ${p.style}`;
}

// The ask handed to Claude, Codex or Grok to split a story into sequences and shots.
const LOOK_WORDS: Record<string, string> = {
  code: 'Every shot is drawn in code by the Ark engine (raymarched scenes, words placed in the world), so shots can be any length and continuity between shots is the director\'s choice, not a model\'s.',
  photoreal: 'Each shot is a code scene repainted as live action by MiniMax H3 (4 to 15 second pieces at 24 fps); people and places must hold from shot to shot.',
  mixed: 'A music video: generated MiniMax H3 live-action shots (4 to 15 seconds at 24 fps) cut with code-drawn shots on the beat.',
  live: 'Every shot is a MiniMax H3 live-action clip of 4 to 15 seconds at 24 fps, blocked with a Blender greybox; people and places must hold from shot to shot.',
};
export function storyParsePrompt(p: Project, mode: 'basic' | 'expert') {
  return `You are a film director breaking a ${p.kind === 'song' ? 'song (lyrics)' : 'story'} into a shot list for the Ark video pipeline. ${LOOK_WORDS[p.render?.look ?? 'code'] ?? LOOK_WORDS.code}

Rules:
- Group shots into sequences. A sequence is one place and one continuous stretch of time; cut to a new sequence only on a real change of place or time.
- Give each sequence a continuity plan: the place, time of day, light, weather, and who stands where.
- Name every recurring character once, with what never changes about them (face, age, build, hair, costume).
- Each shot: a short title, what happens in plain words (the action), a generation prompt (concrete, visual, present tense, no camera jargon beyond the camera field), a duration in seconds between 4 and 15, a camera preset, and which characters are in it.
- People act the story; never use symbols or abstract metaphors in place of the action.
- Jesus' robe is always spotless white.
${mode === 'basic' ? '- Keep it simple: 3 to 8 shots per sequence.' : '- Be thorough: coverage a real editor could cut (wide, medium, close, reverse), dialogue and lyric lines attached to the shots they play over.'}

Camera presets: ${Object.keys(CAMERA_PRESETS).join(', ')}.

Answer with JSON only, no prose, in exactly this shape:
{"cast":[{"name":"","description":""}],"sequences":[{"title":"","summary":"","continuity":"","shots":[{"title":"","action":"","prompt":"","duration":6,"camera":"medium","move":"","cast":["name"],"dialogue":"","lyric":""}]}]}

Film title: ${p.title}
${p.style ? `Style: ${p.style}\n` : ''}
The ${p.kind === 'song' ? 'lyrics' : 'story'}:
"""
${p.script}
"""`;
}

export function sequenceReviewPrompt(p: Project, seq: Sequence) {
  return `Review this assembled sequence from "${p.title}" as an editor would, as a whole, not frame by frame.
Sequence: ${seq.title}. ${seq.summary}
Continuity plan: ${seq.continuity.plan}
Shots in order:
${seq.shots.map((s, i) => `${i + 1}. ${s.title} (${s.duration}s, ${s.camera.preset}): ${s.action}`).join('\n')}

Say whether the characters stay the same person shot to shot, whether the place, light and weather hold, whether each cut joins (screen direction, eyelines, motion carried across), and which shots to regenerate and why. Lead with a verdict: keep, or regenerate shots N, M.`;
}
