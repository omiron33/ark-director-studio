// The GPU queue dashboard: one GPU job at a time on this machine.
// Announce a job as queued, poll /claim until it is granted, report progress, end it.
// Its control state (run / pause / stop) is honoured before anything is announced.
import { config } from './config.ts';

const post = async (url: string, body: unknown, timeout = 30000) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  return r.json().catch(() => ({})) as Promise<any>;
};

export async function gpuState() {
  if (!config.gpuDashboard) return { ok: false, active: 0, queued: 0, error: 'no GPU dashboard configured' };
  try {
    const c = await (await fetch(`${config.gpuDashboard}/api/control`, { signal: AbortSignal.timeout(5000) })).json() as any;
    const r = await (await fetch(`${config.gpuDashboard}/api/renders`, { signal: AbortSignal.timeout(5000) })).json() as any;
    const active = (r.active ?? []) as any[];
    return {
      ok: true,
      control: c.control ?? c.state,
      active: active.filter((j) => j.status !== 'queued').length,
      queued: active.filter((j) => j.status === 'queued').length,
      jobs: active.map((j) => ({ id: j.id, agent: j.agent, tool: j.tool, description: j.description, status: j.status, note: j.note, started: j.started })),
    };
  } catch (e: any) {
    return { ok: false, active: 0, queued: 0, error: e.message };
  }
}

export interface GpuLease { id: string | null; progress(note: string): void; end(status?: 'done' | 'failed' | 'cancelled'): Promise<void> }

export async function claimGpu(opts: { tool: string; description: string; project?: string; expectMinutes?: number; signal?: AbortSignal; onWait?: (note: string) => void }): Promise<GpuLease> {
  const dash = config.gpuDashboard;
  if (!dash) return { id: null, progress() {}, async end() {} };
  const c = await (await fetch(`${dash}/api/control`, { signal: AbortSignal.timeout(10000) })).json() as any;
  const control = c.control ?? c.state;
  if (control !== 'run') throw Error(`the GPU dashboard is set to ${control}; not starting`);
  const { id } = await post(`${dash}/api/renders/start`, {
    agent: 'Ark Director Studio', origin_machine: 'omipc', tool: opts.tool, description: opts.description,
    project: opts.project ?? 'ark-director-studio', expected_minutes: opts.expectMinutes ?? 10, queue: true,
  });
  if (!id) throw Error('the GPU dashboard did not accept the job');
  const lease: GpuLease = {
    id,
    progress: (note) => { post(`${dash}/api/renders/${id}/progress`, { note }).catch(() => {}); },
    end: async (status = 'done') => { await post(`${dash}/api/renders/${id}/end`, { status }).catch(() => {}); },
  };
  let last = '';
  for (;;) {
    if (opts.signal?.aborted) { await lease.end('cancelled'); throw Error('cancelled while waiting for the GPU'); }
    const r = await post(`${dash}/api/renders/${id}/claim`, {}).catch((e) => ({ granted: false, note: `dashboard error ${e.message}` }));
    if (r.granted) return lease;
    if (['stopped', 'failed', 'cancelled'].includes(r.status)) throw Error(`GPU job ${r.status} from the dashboard`);
    if (r.note && r.note !== last) { opts.onWait?.(r.note); last = r.note; }
    await new Promise((res) => setTimeout(res, 15000));
  }
}
