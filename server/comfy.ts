// ComfyUI over its HTTP API: upload inputs, queue a graph, wait for it, download its outputs.
// Every graph that touches the GPU goes through claimGpu() first (see jobs.ts).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

const getJson = async (url: string, timeout = 15000) => (await fetch(url, { signal: AbortSignal.timeout(timeout) })).json() as Promise<any>;

export async function comfyStatus() {
  try {
    const s = await getJson(`${config.comfyUrl}/system_stats`, 5000);
    const q = await getJson(`${config.comfyUrl}/queue`, 5000);
    const dev = s.devices?.[0];
    const vram = dev ? `${Math.round((dev.vram_total - dev.vram_free) / 2 ** 30)} / ${Math.round(dev.vram_total / 2 ** 30)} GB` : undefined;
    return { ok: true, url: config.comfyUrl, queue: { running: q.queue_running?.length ?? 0, pending: q.queue_pending?.length ?? 0 }, vram };
  } catch (e: any) {
    return { ok: false, url: config.comfyUrl, error: e.message };
  }
}

export async function upload(file: string, name: string) {
  const form = new FormData();
  form.append('image', new Blob([fs.readFileSync(file)]), name);
  form.append('overwrite', 'true');
  const r = await fetch(`${config.comfyUrl}/upload/image`, { method: 'POST', body: form, signal: AbortSignal.timeout(600000) });
  if (!r.ok) throw Error(`uploading ${name} to ComfyUI failed: ${r.status}`);
  return (await r.json() as any).name as string;
}

export async function interrupt() {
  await fetch(`${config.comfyUrl}/interrupt`, { method: 'POST' }).catch(() => {});
}

export interface Output { filename: string; subfolder?: string; type?: string }

// Queue a graph and wait. Returns every image/video output it produced.
export async function run(graph: Record<string, unknown>, { signal, onBeat }: { signal?: AbortSignal; onBeat?: (sec: number) => void } = {}) {
  const r = await fetch(`${config.comfyUrl}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: graph, client_id: 'ark-director-studio' }) });
  const body = await r.json() as any;
  if (!body.prompt_id) throw Error('ComfyUI rejected the graph: ' + JSON.stringify(body).slice(0, 1500));
  const id = body.prompt_id as string;
  const t0 = Date.now();
  for (;;) {
    if (signal?.aborted) {
      await fetch(`${config.comfyUrl}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [id] }) }).catch(() => {});
      await interrupt();
      throw Error('cancelled');
    }
    await new Promise((res) => setTimeout(res, 3000));
    onBeat?.(Math.round((Date.now() - t0) / 1000));
    const h = (await getJson(`${config.comfyUrl}/history/${id}`).catch(() => ({})))[id];
    if (!h) continue;
    if (h.status?.status_str === 'error') throw Error('ComfyUI failed: ' + JSON.stringify(h.status?.messages ?? h.status).slice(0, 2000));
    const outs: Output[] = [];
    for (const node of Object.values(h.outputs ?? {}) as any[]) {
      outs.push(...(node.images ?? []), ...(node.videos ?? []), ...(node.gifs ?? []));
    }
    if (outs.length) return { promptId: id, seconds: Math.round((Date.now() - t0) / 1000), outputs: outs };
    if (h.status?.completed) throw Error('ComfyUI finished without an output');
  }
}

export async function download(o: Output, dest: string) {
  const q = new URLSearchParams({ filename: o.filename, subfolder: o.subfolder ?? '', type: o.type ?? 'output' });
  const res = await fetch(`${config.comfyUrl}/view?${q}`, { signal: AbortSignal.timeout(600000) });
  if (!res.ok) throw Error(`downloading ${o.filename} failed: ${res.status}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}
