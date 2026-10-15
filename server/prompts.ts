// Turning a shot into words for a model. One place, so storyboards, takes and Grok all agree.
import { CAMERA_PRESETS, type Project, type Shot, type Sequence } from '../shared/types.ts';

export function shotPrompt(p: Project, seq: Sequence, shot: Shot, { forStill = false } = {}) {
  const cam = CAMERA_PRESETS[shot.camera.preset];
  const cast = shot.castIds.map((id) => p.cast.find((c) => c.id === id)).filter(Boolean)
    .map((c) => `${c!.name}: ${c!.description}`);
  const look = p.looks.find((l) => l.id === (shot.lookId ?? seq.continuity.lookId));
  const parts = [
    shot.prompt.trim() || shot.action.trim(),
    cam ? `${cam.words}${shot.camera.lens || cam.lens ? `, ${shot.camera.lens || cam.lens} lens` : ''}.` : '',
    shot.camera.move && !forStill ? `Camera: ${shot.camera.move}.` : '',
    cast.length ? `In the shot: ${cast.join('; ')}.` : '',
    seq.continuity.plan ? `Continuity: ${seq.continuity.plan}` : '',
    look?.prompt ? `Look: ${look.prompt}` : '',
    p.style ? `Style: ${p.style}` : '',
  ];
  return parts.filter(Boolean).join('\n');
}

export function sheetPrompt(p: Project, name: string, description: string) {
  return `Character reference sheet of ${name}: ${description}. Full body front view, three-quarter view and side view standing side by side, plus a head-and-shoulders close-up, on a plain neutral grey studio background, even soft light, consistent costume in every view. ${p.style ? `Style: ${p.style}` : ''}`;
}

export function lookPrompt(p: Project, words: string) {
  return `A single cinematic frame that defines the film's look: ${words}. ${p.style}`;
}

// The ask handed to Claude, Codex or Grok to split a story into sequences and shots.
export function storyParsePrompt(p: Project, mode: 'basic' | 'expert') {
  return `You are a film director breaking a ${p.kind === 'song' ? 'song (lyrics)' : 'story'} into a shot list for an AI video pipeline (MiniMax H3 live-action clips of 4 to 15 seconds at 24 fps, plus code-drawn shots).

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
