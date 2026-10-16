// The data model shared by the server and the client.
// A project is a film: sequences hold shots, shots hold storyboard frames and takes.
// Cast and looks belong to the project and are reused on every take, so shots stay consistent.

export type FilmKind = 'song' | 'story' | 'musicvideo' | 'live';
export type ShotSource = 'code' | 'h3' | 'grok' | 'still';
export type Mode = 'basic' | 'expert';

// How a film is made: every video type the Ark engine has. The kind (song, story, music video, live
// action) says what the film is; the render setup says how its pictures are made.
//   code       pure code at a render tier (fast, standard, premium, ultra). Every frame is a function of
//              song time, so shots do not drift: shot cohesion matters less and is relaxed by default.
//   photoreal  the photorealistic setting: each code scene steers MiniMax H3 for its first steps and the
//              in-scene words stay code. Generated, so cohesion (sheets, chaining, one plan) is on.
//   mixed      the music-video setting: code shots cut with generated H3 shots.
//   live       live action: H3 from prompts, looks, character sheets and Blender greyboxes.
export type RenderLook = 'code' | 'photoreal' | 'mixed' | 'live';
// Still frames from ComfyUI (storyboard frames, sheets, looks): quality is FLUX 3 Image Klein, speed is Qwen-Image 2.1.
export type StillModel = 'quality' | 'speed' | 'premium'; // premium: Grok Imagine (storyboard frames only; sheets and looks stay on quality)
export type Tier = 'fast' | 'standard' | 'premium' | 'ultra';
export interface RenderSetup {
  look: RenderLook;
  tier: Tier;                        // the code tier (ultra is the engine default since 2026-10-07)
  resolution: '1920x1080' | '3840x2160';
  words: 'in-scene' | 'overlay' | 'none'; // lyrics drawn in the world (default), a lyric layer over the picture, or none
  cohesion: 'auto' | 'on' | 'off';   // auto: on for generated looks, off for pure code
  photoreal: {
    chain: 'bridges' | 'continuum';  // long takes: first+last-frame bridges (default) or Continuum (trial, opt-in)
    styleRef: 'none' | 'code' | 'image'; // --look: prompt only, the scene's first code frame, or the look image
    tuck: boolean;                   // words tuck behind nearer things H3 paints
    keep: number;                    // steps steered by the code render or greybox
    steps: number;
    proxyBlur: number;
  };
  stills: StillModel;                // ComfyUI still frames: quality (FLUX 3 Klein, the default) or speed (Qwen-Image)
  popcam: boolean;                   // music video: the pop-video camera that plays the track
  local: boolean;                    // --local: code scenes render on the Mac only
}

export const DEFAULT_RENDER: RenderSetup = {
  look: 'code', tier: 'ultra', resolution: '1920x1080', words: 'in-scene', cohesion: 'auto',
  photoreal: { chain: 'bridges', styleRef: 'none', tuck: true, keep: 5, steps: 20, proxyBlur: 0 },
  stills: 'quality', popcam: true, local: false,
};

// One-click video types for Basic mode. Each sets the kind and the render setup together.
export const VIDEO_TYPES: { id: string; label: string; blurb: string; kind: FilmKind; render: Partial<RenderSetup> }[] = [
  { id: 'ultra-code', label: 'Ultra code lyric film', blurb: 'Pure code at the ultra tier, words drawn in the world. The engine default.', kind: 'song', render: { look: 'code', tier: 'ultra', words: 'in-scene' } },
  { id: 'premium-code', label: 'Premium code lyric film', blurb: 'Pure code at 60 fps premium, quicker than ultra.', kind: 'song', render: { look: 'code', tier: 'premium', words: 'in-scene' } },
  { id: 'fast-code', label: 'Fast code preview', blurb: 'A quick 30 fps look at the whole film, no review gates.', kind: 'song', render: { look: 'code', tier: 'fast', words: 'in-scene' } },
  { id: 'photoreal', label: 'Photoreal lyric film', blurb: 'Code scenes repainted by H3 as live action, words stay code.', kind: 'song', render: { look: 'photoreal', tier: 'ultra', words: 'in-scene' } },
  { id: 'musicvideo', label: 'Music video', blurb: 'Generated H3 shots cut with code shots, pop camera on the beat.', kind: 'musicvideo', render: { look: 'mixed', tier: 'ultra', words: 'in-scene', popcam: true } },
  { id: 'story-code', label: 'Narrated story, code', blurb: 'A narrated Bible story drawn in code at the ultra tier.', kind: 'story', render: { look: 'code', tier: 'ultra', words: 'none' } },
  { id: 'story-photoreal', label: 'Narrated story, photoreal', blurb: 'A narrated story with code scenes repainted as live action.', kind: 'story', render: { look: 'photoreal', tier: 'ultra', words: 'none' } },
  { id: 'live', label: 'Live-action film', blurb: 'H3 shots from prompts, character sheets and Blender greyboxes.', kind: 'live', render: { look: 'live', words: 'none' } },
];

export const withRender = (r?: Partial<RenderSetup>): RenderSetup => ({ ...DEFAULT_RENDER, ...(r ?? {}), photoreal: { ...DEFAULT_RENDER.photoreal, ...(r?.photoreal ?? {}) } });
export const STILL_MODELS: Record<StillModel, { label: string; model: string; blurb: string }> = {
  quality: { label: 'Quality', model: 'FLUX 3 Klein', blurb: 'FLUX 3 Image Klein int8, 16 steps: sharper, more lifelike faces and hands.' },
  speed: { label: 'Speed', model: 'Qwen-Image', blurb: 'Qwen-Image 2.1 int8, 20 steps: quicker on the 12 GB card.' },
  premium: { label: 'Premium', model: 'Grok Imagine', blurb: "Grok Imagine through the Studio's own Grok window (sign in once in Settings): the best staging, from the shot's words only, no reference images." },
};
export const stillModelOf = (p: { render?: Partial<RenderSetup> }, shot?: { stills?: StillModel }): StillModel => shot?.stills ?? withRender(p.render).stills;
// Sheets, portraits and looks need reference images, which Grok Imagine does not take: premium falls back to quality there.
export const localStillModel = (m: StillModel): 'quality' | 'speed' => (m === 'premium' ? 'quality' : m);
// Shot cohesion (character sheets on every take, one continuity plan, chaining from the last frame)
// is what generated pictures need. Pure code films keep it off unless asked.
export const cohesionOn = (r?: Partial<RenderSetup>) => { const x = withRender(r); return x.cohesion === 'on' || (x.cohesion === 'auto' && x.look !== 'code'); };
export const videoTypeOf = (kind: FilmKind, r?: Partial<RenderSetup>) => {
  const x = withRender(r);
  return VIDEO_TYPES.find((v) => v.kind === kind && v.render.look === x.look && (v.render.tier === undefined || v.render.tier === x.tier || x.look === 'live'))?.id;
};

// A hand sketch: stick figures drawn with lines, boxes and circles, kept as shapes so it stays editable.
export type SketchTool = 'line' | 'box' | 'circle' | 'figure' | 'arrow' | 'text';
export interface SketchShape {
  id: string;
  tool: SketchTool;
  x1: number; y1: number; x2: number; y2: number; // in a 1600x900 canvas (any aspect is scaled into it)
  text?: string;
  color?: string;
  width?: number;
}
export interface Sketch {
  id: string;
  shapes: SketchShape[];
  image?: string;           // media path of the rendered PNG the model sees
  note?: string;            // what the drawing means, in words, added to the prompt
  at: string;
}

// A character's 3D model: the figure Blender builds for them in every greybox, so the guide clip already
// shows who is who (a towering jailer, a robed figure carrying light, a crowd of the dead) and a turnaround
// render of it sits beside the character sheet.
export type ModelBuild = 'slight' | 'average' | 'broad' | 'gaunt' | 'colossal';
export type ModelCostume = 'robe' | 'tunic' | 'rags' | 'loincloth' | 'regal' | 'shroud' | 'armor';
export type ModelCarry = 'none' | 'cross' | 'lyre' | 'staff' | 'chains' | 'keys' | 'crossbeam';
export interface CharacterModel {
  height: number;           // metres, feet to crown
  build: ModelBuild;
  costume: ModelCostume;
  color: string;            // costume colour, #rrggbb
  hair?: 'none' | 'short' | 'long';
  beard?: boolean;
  crown?: boolean;
  wings?: boolean;          // folded wings (a fallen angel)
  carry?: ModelCarry;
  glow?: number;            // 0..1: the light the figure carries (a halo of light that travels with them)
  crowd?: number;           // > 1: this character is a crowd of that many figures (the dead)
  render?: string;          // media path of the turnaround render
  renders?: string[];       // earlier renders, newest first
}
export const DEFAULT_MODEL: CharacterModel = { height: 1.75, build: 'average', costume: 'tunic', color: '#8a7f72', hair: 'short', beard: false, carry: 'none', glow: 0 };

export interface Character {
  id: string;
  name: string;
  description: string;      // what never changes: face, build, hair, costume
  sheet?: string;           // media path of the character sheet image
  portrait?: string;        // one full-length view of the character, painted from the sheet: what stills use as the reference, so the sheet's several views are never copied into a frame
  sheets?: string[];        // earlier sheets, newest first
  locked?: boolean;         // locked sheets are attached to every take the character is in
  model?: CharacterModel;   // the 3D figure used in greyboxes
  prop?: boolean;           // a set piece (a gate, a tomb), not a person: its sheet is a reference picture that holds its design and scale
}

export interface Look {
  id: string;
  name: string;
  prompt: string;           // palette, light, lens and texture in words
  image?: string;           // media path of the look reference
}

export interface Camera {
  preset: string;           // a key of CAMERA_PRESETS
  lens?: string;            // e.g. "35mm"
  move?: string;            // free text, e.g. "slow push in"
  height?: string;          // eye, low, high, overhead
}

// x2/z2 (and pose2) are where the figure has walked to, and how it stands, by the end of the shot.
export interface GreyboxActor { castId?: string; label: string; pose: string; x: number; z: number; heading: number; x2?: number; z2?: number; pose2?: string; y?: number; y2?: number; model?: Partial<CharacterModel> } // model: per-shot changes to the character's model, e.g. a crowd's size
export interface GreyboxProp { label: string; kind: 'box' | 'cylinder' | 'plane' | 'wall' | 'arch' | 'stairs' | 'rock'; x: number; z: number; w: number; h: number; d: number; y?: number; rot?: number; tilt?: number; tilt2?: number }
// A light in the greybox: Christ's light, a fire fissure. Drawn as a bright sphere so H3 sees where light comes from.
export interface GreyboxLight { label: string; x: number; y: number; z: number; size: number; color?: string; x2?: number; y2?: number; z2?: number }
export interface Greybox {
  actors: GreyboxActor[];
  props: GreyboxProp[];
  lights?: GreyboxLight[];
  mist?: number;            // 0..1 distance fog
  useSet?: boolean;         // include the sequence's shared set (default true)
  camera: { from: [number, number, number]; to: [number, number, number]; look: [number, number, number]; lens: number };
  sun?: { azimuth: number; elevation: number };
  video?: string;           // media path of the rendered greybox clip
  still?: string;
}

export interface StoryboardFrame { id: string; file: string; prompt: string; engine: string; model?: string; seed?: number; at: string; sketchId?: string; refs?: string[]; fix?: string }

export type TakeStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export interface Take {
  id: string;
  status: TakeStatus;
  engine: 'h3' | 'grok' | 'ark';
  file?: string;            // media path of the clip
  lastFrame?: string;       // media path of its last frame, the next take's start
  startFrom?: string;       // media path of the frame it started from
  prompt: string;
  seed?: number;
  params: Record<string, unknown>;
  jobId?: string;
  error?: string;
  rating?: number;          // 0..5
  note?: string;
  at: string;
}

export interface Shot {
  id: string;
  title: string;
  action: string;           // what happens, in plain words
  prompt: string;           // the generation prompt (built from action, cast, look and camera when empty)
  dialogue?: string;
  lyric?: string;
  words?: string;           // how the lyric lives in the scene: carved, burned or lit on what, where in frame
  duration: number;         // seconds, 4..15 for H3
  from?: number;            // song seconds, when the shot is tied to the audio
  source: ShotSource;
  camera: Camera;
  castIds: string[];
  lookId?: string;
  arkScene?: string;        // id of the Ark film.json scene this shot mirrors
  greybox?: Greybox;
  storyboard: StoryboardFrame[];
  selectedFrame?: string;
  endFrames?: StoryboardFrame[]; // where a moving shot ends: painted from the greybox's last frame, anchored as the take's end
  selectedEnd?: string;
  sketches?: Sketch[];      // hand-drawn stick-figure layouts, newest first
  takes: Take[];
  selectedTake?: string;
  chainFromPrevious: boolean; // start this take from the previous shot's last frame
  stills?: StillModel;      // this shot's still frames, when they differ from the film's setting
  notes?: string;
}

export interface Continuity {
  plan: string;             // one continuity plan per sequence: place, time, light, who is where
  castIds: string[];
  lookId?: string;
  chain: boolean;           // each take starts from the previous take's last frame
}

export interface Sequence {
  id: string;
  title: string;
  summary: string;
  continuity: Continuity;
  set?: GreyboxProp[];      // the place, built once for the sequence and shared by every shot's greybox
  setLights?: GreyboxLight[];
  shots: Shot[];
  assembled?: string;       // media path of the latest assembled sequence
  review?: string;          // latest whole-sequence review
}

export interface ArkLink {
  machine: string;          // ssh host alias the engine runs on
  songPath: string;         // absolute song folder on that machine
  lastPull?: string;
  lastPush?: string;
}

export interface Project {
  id: string;
  title: string;
  kind: FilmKind;
  fps: number;
  aspect: '16:9' | '9:16' | '1:1' | '2.39:1';
  style: string;            // the film-wide style line, prepended to every prompt
  script: string;           // the story, script or lyrics as pasted
  audio?: string;           // media path
  cast: Character[];
  looks: Look[];
  sequences: Sequence[];
  ark?: ArkLink;
  render?: RenderSetup;     // missing on older films: read it with withRender()
  created: string;
  updated: string;
}

export type JobKind = 'storyboard' | 'take' | 'sheet' | 'look' | 'greybox' | 'model' | 'grok-image' | 'grok-video' | 'agent' | 'ark' | 'assemble' | 'review';
export type JobStatus = 'queued' | 'waiting-gpu' | 'running' | 'done' | 'failed' | 'cancelled';
export interface Job {
  id: string;
  kind: JobKind;
  projectId?: string;
  title: string;
  status: JobStatus;
  gpu: boolean;
  note?: string;
  log: string[];
  result?: unknown;
  error?: string;
  created: string;
  started?: string;
  ended?: string;
  ref?: { sequenceId?: string; shotId?: string; takeId?: string; castId?: string; lookId?: string };
}

export type AgentId = 'claude' | 'codex' | 'grok';

export interface StudioStatus {
  comfy: { ok: boolean; url: string; queue?: { running: number; pending: number }; vram?: string; error?: string };
  gpu: { ok: boolean; control?: string; active: number; queued: number; error?: string };
  ark: { ok: boolean; machine: string; engine: string; error?: string };
  blender: { ok: boolean; path: string };
  grok: { profile: boolean; signedIn?: boolean };
  agents: Record<AgentId, { ok: boolean; how: string }>;
}

export const CAMERA_PRESETS: Record<string, { label: string; words: string; lens: string }> = {
  'wide-establish': { label: 'Wide establishing', words: 'wide establishing shot, the whole place and the people small in it', lens: '24mm' },
  'medium': { label: 'Medium', words: 'medium shot, waist up', lens: '35mm' },
  'close': { label: 'Close-up', words: 'close-up on the face, shallow depth of field', lens: '85mm' },
  'extreme-close': { label: 'Extreme close-up', words: 'extreme close-up on a detail', lens: '100mm macro' },
  'ots': { label: 'Over the shoulder', words: 'over-the-shoulder shot, the near shoulder soft in the foreground', lens: '50mm' },
  'pov': { label: 'Point of view', words: 'point-of-view shot, hand-held', lens: '28mm' },
  'low-hero': { label: 'Low angle', words: 'low angle looking up, the figure towering against the sky', lens: '24mm' },
  'high-down': { label: 'High angle', words: 'high angle looking down on the scene', lens: '35mm' },
  'overhead': { label: 'Overhead', words: 'top-down overhead shot', lens: '24mm' },
  'tracking': { label: 'Tracking', words: 'tracking shot moving alongside the subject at walking pace', lens: '35mm' },
  'push-in': { label: 'Slow push in', words: 'slow push in toward the subject', lens: '50mm' },
  'pull-out': { label: 'Pull out reveal', words: 'slow pull back revealing the wider scene', lens: '35mm' },
  'crane': { label: 'Crane', words: 'crane shot rising over the scene', lens: '24mm' },
  'orbit': { label: 'Orbit', words: 'slow orbit around the subject', lens: '35mm' },
  'silhouette': { label: 'Rim-lit silhouette', words: 'figure as a rim-lit silhouette against bright light, face unseen', lens: '50mm' },
};
