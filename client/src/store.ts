import { create } from 'zustand';
import { api, type Op } from './api';
import type { Project, Job, StudioStatus, Mode, Shot, Sequence } from '../../shared/types';

export type Tab = 'projects' | 'story' | 'storyboard' | 'shot' | 'sketch' | 'cast' | 'greybox' | 'timeline' | 'queue' | 'ark' | 'settings';

const saved = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const keep = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

interface State {
  tab: Tab;
  mode: Mode;
  projectId?: string;
  project?: Project;
  sequenceId?: string;
  shotId?: string;
  status?: StudioStatus;
  jobs: Job[];
  toast?: { text: string; kind: 'ok' | 'err' };
  setTab(t: Tab): void;
  setMode(m: Mode): void;
  open(id?: string): Promise<void>;
  reload(): Promise<void>;
  select(sequenceId?: string, shotId?: string): void;
  ops(ops: Op[]): Promise<void>;
  run<T>(fn: () => Promise<T>, ok?: string): Promise<T | undefined>;
  notify(text: string, kind?: 'ok' | 'err'): void;
  refreshJobs(): Promise<void>;
  refreshStatus(fresh?: boolean): Promise<void>;
}

export const useStudio = create<State>((set, get) => ({
  tab: saved<Tab>('ads.tab', 'projects'),
  mode: saved<Mode>('ads.mode', 'basic'),
  projectId: saved<string | undefined>('ads.project', undefined),
  jobs: [],
  setTab: (tab) => { keep('ads.tab', tab); set({ tab }); },
  setMode: (mode) => { keep('ads.mode', mode); set({ mode }); },
  async open(id) {
    keep('ads.project', id);
    if (!id) { set({ projectId: undefined, project: undefined }); return; }
    const project = await api.project(id).catch(() => undefined);
    if (!project) { set({ projectId: undefined, project: undefined }); return; }
    const seq = project.sequences[0];
    set({ projectId: id, project, sequenceId: seq?.id, shotId: seq?.shots[0]?.id });
  },
  async reload() {
    const id = get().projectId;
    if (!id) return;
    const project = await api.project(id).catch(() => undefined);
    if (!project) return;
    const { sequenceId, shotId } = get();
    const seq = project.sequences.find((s) => s.id === sequenceId) ?? project.sequences[0];
    const shot = seq?.shots.find((s) => s.id === shotId) ?? seq?.shots[0];
    set({ project, sequenceId: seq?.id, shotId: shot?.id });
  },
  select(sequenceId, shotId) {
    const p = get().project;
    if (p && sequenceId && !shotId) shotId = p.sequences.find((s) => s.id === sequenceId)?.shots[0]?.id;
    if (p && shotId && !sequenceId) sequenceId = p.sequences.find((q) => q.shots.some((s) => s.id === shotId))?.id;
    set({ sequenceId, shotId });
  },
  async ops(ops) {
    const id = get().projectId;
    if (!id) return;
    try { set({ project: await api.ops(id, ops) }); } catch (e: any) { get().notify(e.message, 'err'); }
  },
  async run(fn, ok) {
    try { const r = await fn(); if (ok) get().notify(ok); return r; } catch (e: any) { get().notify(e.message, 'err'); return undefined; }
  },
  notify(text, kind = 'ok') {
    set({ toast: { text, kind } });
    setTimeout(() => { if (get().toast?.text === text) set({ toast: undefined }); }, kind === 'err' ? 7000 : 3000);
  },
  async refreshJobs() { set({ jobs: await api.jobs().catch(() => get().jobs) }); },
  async refreshStatus(fresh) { const status = await api.status(fresh).catch(() => undefined); if (status) set({ status }); },
}));

export function useSelection(): { project?: Project; seq?: Sequence; shot?: Shot } {
  const { project, sequenceId, shotId } = useStudio();
  const seq = project?.sequences.find((s) => s.id === sequenceId);
  const shot = seq?.shots.find((s) => s.id === shotId);
  return { project, seq, shot };
}

// Live updates: jobs and project changes pushed by the server.
export function connectLive() {
  let ws: WebSocket | null = null;
  let timer: number | undefined;
  let reloadTimer: number | undefined;
  const connect = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (m) => {
      const e = JSON.parse(m.data);
      const st = useStudio.getState();
      if (e.type === 'job' && e.job) {
        const jobs = [e.job, ...st.jobs.filter((j) => j.id !== e.job.id)];
        useStudio.setState({ jobs });
      }
      if (e.type === 'project' && e.projectId === st.projectId) {
        clearTimeout(reloadTimer);
        reloadTimer = window.setTimeout(() => useStudio.getState().reload(), 250);
      }
    };
    ws.onclose = () => { clearTimeout(timer); timer = window.setTimeout(connect, 2000); };
  };
  connect();
}

export const fmtTime = (iso?: string) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' CT' : '';
export const tc = (sec = 0) => { const m = Math.floor(sec / 60); const s = sec - m * 60; return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; };
