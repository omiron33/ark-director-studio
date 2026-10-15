// Claude, Codex and Grok Build as text-in, text-out workers through their own CLIs.
// Codex and Grok run on this machine; Claude runs wherever config.agents.claude.ssh points (or here).
// Prompts go in on stdin or a temp file, never on the command line, so long scripts are safe.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { config } from './config.ts';
import { exec } from './media.ts';
import type { AgentId } from '../shared/types.ts';

export async function runAgent(agent: AgentId, prompt: string, { signal, onLine, timeoutMs = 20 * 60000 }: { signal?: AbortSignal; onLine?: (l: string) => void; timeoutMs?: number } = {}): Promise<string> {
  const a = config.agents[agent];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `ads-${agent}-`));
  try {
    if (agent === 'grok') {
      const pf = path.join(tmp, 'prompt.md');
      fs.writeFileSync(pf, prompt);
      const args = a.args.filter((x) => x !== '-p');
      const r = await exec(a.cmd, [...args, '--prompt-file', pf, '--output-format', 'text', '--disable-web-search'], { signal, onLine, timeoutMs });
      if (r.code !== 0) throw Error(`grok exited ${r.code}: ${r.err.slice(-600)}`);
      return r.out.trim();
    }
    if (agent === 'codex') {
      const last = path.join(tmp, 'last.md');
      const r = await exec(a.cmd, [...a.args, '--output-last-message', last, '-'], { signal, onLine, input: prompt, timeoutMs, cwd: tmp });
      if (r.code !== 0) throw Error(`codex exited ${r.code}: ${r.err.slice(-600)}`);
      return (fs.existsSync(last) ? fs.readFileSync(last, 'utf8') : r.out).trim();
    }
    // claude: locally, or on the machine named in agents.claude.ssh
    const cmd = a.ssh ? 'ssh' : a.cmd;
    const args = a.ssh ? ['-o', 'BatchMode=yes', a.ssh, a.cmd, ...a.args] : a.args;
    const r = await exec(cmd, args, { signal, onLine, input: prompt, timeoutMs });
    if (r.code !== 0) throw Error(`claude exited ${r.code}: ${r.err.slice(-600)}`);
    return r.out.trim();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

export async function agentStatus(agent: AgentId) {
  const a = config.agents[agent];
  const how = a.ssh ? `${path.basename(a.cmd)} on ${a.ssh}` : agent;
  try {
    const cmd = a.ssh ? 'ssh' : a.cmd;
    const pre = a.cmd === process.execPath ? a.args.slice(0, 1) : [];
    const args = a.ssh ? ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', a.ssh, a.cmd, '--version'] : [...pre, '--version'];
    const r = await exec(cmd, args, { timeoutMs: 15000 });
    return { ok: r.code === 0, how: r.code === 0 ? `${how} (${r.out.trim().split('\n')[0]})` : how };
  } catch {
    return { ok: false, how };
  }
}

// The first JSON object in an answer (models sometimes wrap it in a fence or a sentence).
export function extractJson(text: string): any {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text;
  const start = body.indexOf('{');
  if (start < 0) throw Error('the agent answered without JSON');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(body.slice(start, i + 1));
  }
  throw Error('the agent answered with unfinished JSON');
}
