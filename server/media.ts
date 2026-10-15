// ffmpeg helpers: last frames for chaining, thumbnails, probing, and assembling a sequence.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.ts';

export function exec(cmd: string, args: string[], { cwd, signal, onLine, input, timeoutMs }: { cwd?: string; signal?: AbortSignal; onLine?: (l: string) => void; input?: string; timeoutMs?: number } = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, windowsHide: true, shell: false });
    let out = '', err = '';
    const feed = (buf: Buffer, sink: 'out' | 'err') => {
      const s = buf.toString();
      if (sink === 'out') out += s; else err += s;
      if (onLine) for (const l of s.split(/\r?\n/)) if (l.trim()) onLine(l);
    };
    p.stdout.on('data', (b) => feed(b, 'out'));
    p.stderr.on('data', (b) => feed(b, 'err'));
    const kill = () => { try { p.kill(); } catch {} };
    signal?.addEventListener('abort', kill, { once: true });
    const timer = timeoutMs ? setTimeout(kill, timeoutMs) : null;
    p.on('error', reject);
    p.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, out, err }); });
    if (input !== undefined) { p.stdin.write(input); p.stdin.end(); }
  });
}

const ff = async (args: string[]) => {
  const r = await exec(config.ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args]);
  if (r.code !== 0) throw Error(`ffmpeg failed: ${r.err.slice(-800)}`);
};

export async function probe(file: string) {
  const r = await exec(config.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=width,height,r_frame_rate,nb_frames', '-of', 'json', file]);
  try {
    const j = JSON.parse(r.out);
    const v = (j.streams ?? []).find((s: any) => s.width);
    return { duration: Number(j.format?.duration ?? 0), width: v?.width, height: v?.height, fps: v?.r_frame_rate, frames: Number(v?.nb_frames ?? 0) };
  } catch { return { duration: 0 }; }
}

export async function lastFrame(video: string, out: string) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await ff(['-sseof', '-0.25', '-i', video, '-update', '1', '-q:v', '2', out]);
  if (!fs.existsSync(out)) await ff(['-i', video, '-vf', 'reverse', '-frames:v', '1', out]);
  return out;
}

export async function firstFrame(video: string, out: string) {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await ff(['-i', video, '-frames:v', '1', '-q:v', '2', out]);
  return out;
}

// Join clips back to back at one size and frame rate; the audio, when given, plays under the whole.
export async function assemble(clips: string[], out: string, { fps = 24, width = 1920, height = 1080, audio, audioFrom = 0 }: { fps?: number; width?: number; height?: number; audio?: string; audioFrom?: number } = {}) {
  if (!clips.length) throw Error('nothing to assemble');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const args: string[] = [];
  for (const c of clips) args.push('-i', c);
  if (audio) args.push('-ss', String(audioFrom), '-i', audio);
  const scale = clips.map((_, i) => `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},setsar=1,format=yuv420p[v${i}]`).join(';');
  const cat = clips.map((_, i) => `[v${i}]`).join('') + `concat=n=${clips.length}:v=1:a=0[v]`;
  args.push('-filter_complex', `${scale};${cat}`, '-map', '[v]');
  if (audio) args.push('-map', `${clips.length}:a`, '-shortest', '-c:a', 'aac', '-b:a', '256k');
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-movflags', '+faststart', out);
  await ff(args);
  return out;
}

export async function thumbnail(input: string, out: string, width = 480) {
  await ff(['-i', input, '-frames:v', '1', '-vf', `scale=${width}:-2`, out]);
  return out;
}

export async function waveform(audio: string, out: string) {
  await ff(['-i', audio, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=4000x160:colors=0x5eead4', '-frames:v', '1', out]);
  return out;
}
