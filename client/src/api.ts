import type { Project, Job, StudioStatus } from '../../shared/types';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : {}, body: body !== undefined ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Error((j as any).error ?? `${r.status}`);
  return j as T;
}

export type Op =
  | { op: 'set'; path: (string | number)[]; value: unknown }
  | { op: 'insert'; path: (string | number)[]; value: any; index?: number }
  | { op: 'remove'; path: (string | number)[] }
  | { op: 'move'; path: (string | number)[]; id: string; index: number; to?: (string | number)[] };

export interface ProjectSummary { id: string; title: string; kind: string; updated: string; ark?: string; sequences: number; shots: number; takes: number; cover?: string }
export interface Song { dir: string; path: string; title: string; mode: string; scenes: number; modified: string }

export const api = {
  status: (fresh = false) => req<StudioStatus>('GET', `/api/status${fresh ? '?fresh=1' : ''}`),
  gpu: () => req<any>('GET', '/api/gpu'),
  projects: () => req<ProjectSummary[]>('GET', '/api/projects'),
  project: (id: string) => req<Project>('GET', `/api/projects/${id}`),
  create: (b: { title: string; kind: string; script?: string; style?: string }) => req<Project>('POST', '/api/projects', b),
  remove: (id: string) => req('DELETE', `/api/projects/${id}`),
  ops: (id: string, ops: Op[]) => req<Project>('PATCH', `/api/projects/${id}`, { ops }),
  post: <T = any>(id: string, what: string, body: unknown) => req<T>('POST', `/api/projects/${id}/${what}`, body),
  takeInputs: (id: string, shotId: string) => req<{ start?: string; startWhy: string; look?: string; sheets: string[]; guide?: string }>('GET', `/api/projects/${id}/take-inputs/${shotId}`),
  jobs: () => req<Job[]>('GET', '/api/jobs'),
  cancel: (jid: string) => req('POST', `/api/jobs/${jid}/cancel`),
  songs: () => req<Song[]>('GET', '/api/ark/songs'),
  stages: () => req<Record<string, { label: string; expert: boolean; gpu: boolean }>>('GET', '/api/ark/stages'),
  importSong: (songPath: string) => req<Project>('POST', '/api/ark/import', { songPath }),
  grokOpen: () => req('POST', '/api/grok/open'),
  grokClose: () => req('POST', '/api/grok/close'),
  upload: async (id: string, sub: string, file: File) => {
    const r = await fetch(`/api/projects/${id}/upload?sub=${sub}&name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
    const j = await r.json();
    if (!r.ok) throw Error(j.error);
    return j.file as string;
  },
};

export const media = (projectId: string, rel?: string) => rel ? `/media/${projectId}/${rel}` : undefined;
