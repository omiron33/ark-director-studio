// The data model shared by the server and the client.
// A project is a film: sequences hold shots, shots hold storyboard frames and takes.
// Cast and looks belong to the project and are reused on every take, so shots stay consistent.

export type FilmKind = 'song' | 'story' | 'musicvideo' | 'live';
export type ShotSource = 'code' | 'h3' | 'grok' | 'still';
export type Mode = 'basic' | 'expert';

export interface Character {
  id: string;
  name: string;
  description: string;      // what never changes: face, build, hair, costume
  sheet?: string;           // media path of the character sheet image
  sheets?: string[];        // earlier sheets, newest first
  locked?: boolean;         // locked sheets are attached to every take the character is in
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

export interface GreyboxActor { castId?: string; label: string; pose: string; x: number; z: number; heading: number }
export interface GreyboxProp { label: string; kind: 'box' | 'cylinder' | 'plane' | 'wall'; x: number; z: number; w: number; h: number; d: number }
export interface Greybox {
  actors: GreyboxActor[];
  props: GreyboxProp[];
  camera: { from: [number, number, number]; to: [number, number, number]; look: [number, number, number]; lens: number };
  sun?: { azimuth: number; elevation: number };
  video?: string;           // media path of the rendered greybox clip
  still?: string;
}

export interface StoryboardFrame { id: string; file: string; prompt: string; engine: string; seed?: number; at: string }

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
  takes: Take[];
  selectedTake?: string;
  chainFromPrevious: boolean; // start this take from the previous shot's last frame
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
  created: string;
  updated: string;
}

export type JobKind = 'storyboard' | 'take' | 'sheet' | 'look' | 'greybox' | 'grok-image' | 'grok-video' | 'agent' | 'ark' | 'assemble' | 'review';
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
