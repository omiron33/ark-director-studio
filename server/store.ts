// Projects live as one JSON file each under data/projects/<id>/project.json, with their media
// (storyboard frames, takes, sheets, greybox clips, audio) under data/projects/<id>/media/.
// Media paths stored in a project are relative to that media folder and served at /media/<id>/<path>.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.ts';
import { VIDEO_TYPES, withRender, cohesionOn, type Project, type Sequence, type Shot, type FilmKind, type RenderSetup } from '../shared/types.ts';

export const uid = (prefix = '') => prefix + crypto.randomBytes(5).toString('hex');
export const now = () => new Date().toISOString();

const projectsDir = path.join(config.dataDir, 'projects');
fs.mkdirSync(projectsDir, { recursive: true });

export const projectDir = (id: string) => path.join(projectsDir, safe(id));
export const mediaDir = (id: string) => path.join(projectDir(id), 'media');
export const mediaPath = (id: string, rel: string) => {
  const base = mediaDir(id);
  const p = path.resolve(base, rel);
  if (!p.startsWith(path.resolve(base))) throw Error('path escapes the project media folder');
  return p;
};
function safe(id: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) throw Error(`bad project id: ${id}`);
  return id;
}

export const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'film';

export function listProjects(): Project[] {
  return fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(projectsDir, d.name, 'project.json')))
    .map((d) => readProject(d.name))
    .sort((a, b) => b.updated.localeCompare(a.updated));
}

export function readProject(id: string): Project {
  const p: Project = JSON.parse(fs.readFileSync(path.join(projectDir(id), 'project.json'), 'utf8'));
  // films made before video types existed: live action stays live, everything else reads as code
  p.render = withRender(p.render ?? (p.kind === 'live' ? { look: 'live' } : {}));
  return p;
}

// Writes are serialised per project and atomic (write a temp file, then rename).
const locks = new Map<string, Promise<unknown>>();
export async function mutate(id: string, fn: (p: Project) => void | Promise<void>): Promise<Project> {
  const prev = locks.get(id) ?? Promise.resolve();
  let result!: Project;
  const next = prev.then(async () => {
    const p = readProject(id);
    await fn(p);
    p.updated = now();
    writeProject(p);
    result = p;
  });
  locks.set(id, next.catch(() => {}));
  await next;
  return result;
}

export function writeProject(p: Project) {
  const dir = projectDir(p.id);
  fs.mkdirSync(path.join(dir, 'media'), { recursive: true });
  const file = path.join(dir, 'project.json');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2));
  fs.renameSync(tmp, file);
}

export function createProject({ title, kind, script = '', style = '', videoType, render }: { title: string; kind: FilmKind; script?: string; style?: string; videoType?: string; render?: Partial<RenderSetup> }): Project {
  const vt = VIDEO_TYPES.find((v) => v.id === videoType);
  if (vt) kind = vt.kind;
  let id = slug(title);
  for (let i = 2; fs.existsSync(projectDir(id)); i++) id = `${slug(title)}-${i}`;
  const p: Project = {
    id, title, kind, fps: 24, aspect: '16:9', style, script,
    cast: [], looks: [], sequences: [], render: withRender({ ...(vt?.render ?? (kind === 'live' ? { look: 'live' } : {})), ...(render ?? {}) }), created: now(), updated: now(),
  };
  writeProject(p);
  return p;
}

export function deleteProject(id: string) {
  // moved aside, never hard-deleted
  const trash = path.join(config.dataDir, 'trash');
  fs.mkdirSync(trash, { recursive: true });
  fs.renameSync(projectDir(id), path.join(trash, `${id}-${Date.now()}`));
}

export function newSequence(title = 'New sequence'): Sequence {
  return { id: uid('q'), title, summary: '', continuity: { plan: '', castIds: [], chain: true }, shots: [] };
}

// A new shot in this film: generated looks chain from the previous shot, pure code does not.
export const shotDefaults = (p: Project): Partial<Shot> => {
  const r = withRender(p.render);
  return { source: r.look === 'code' ? 'code' : 'h3', chainFromPrevious: cohesionOn(r) };
};

export function newShot(partial: Partial<Shot> = {}): Shot {
  return {
    id: uid('s'), title: 'New shot', action: '', prompt: '', duration: 6, source: 'h3',
    camera: { preset: 'medium' }, castIds: [], storyboard: [], takes: [], chainFromPrevious: true,
    ...partial,
  };
}

export function findShot(p: Project, shotId: string) {
  for (const q of p.sequences) {
    const i = q.shots.findIndex((s) => s.id === shotId);
    if (i >= 0) return { seq: q, shot: q.shots[i], index: i };
  }
  throw Error(`no shot ${shotId}`);
}

// The shot that plays before this one in the film (across sequence boundaries only when chaining is on).
export function previousShot(p: Project, shotId: string): Shot | undefined {
  const { seq, index } = findShot(p, shotId);
  return index > 0 ? seq.shots[index - 1] : undefined;
}

export function saveMedia(projectId: string, sub: string, name: string, data: Buffer) {
  const rel = path.posix.join(sub, name);
  const file = mediaPath(projectId, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  return rel;
}
