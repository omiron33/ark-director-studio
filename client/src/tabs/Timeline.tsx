import { useEffect, useMemo, useRef, useState } from 'react';
import { Rows3, Play, Pause, SkipBack, Clapperboard, MessageSquareText, Film } from 'lucide-react';
import { api, media } from '../api';
import { useStudio, useSelection, tc, fmtTime } from '../store';
import { Card, Btn, Segmented, Empty, Media, Cols, Col, Row } from '../ui';
import type { Shot } from '../../../shared/types';

interface Clip { shot: Shot; seqId: string; seqTitle: string; start: number; file?: string; still?: string }

export function Timeline() {
  const { project: p, seq } = useSelection();
  const { select, setTab, run, shotId, jobs } = useStudio();
  const [scope, setScope] = useState<'sequence' | 'film'>('sequence');
  const [zoom, setZoom] = useState(40); // px per second
  const [playing, setPlaying] = useState(false);
  const [idx, setIdx] = useState(0);
  const [t, setT] = useState(0);
  const vid = useRef<HTMLVideoElement>(null);
  const aud = useRef<HTMLAudioElement>(null);

  const clips: Clip[] = useMemo(() => {
    if (!p) return [];
    const out: Clip[] = [];
    let at = 0;
    for (const q of p.sequences) {
      if (scope === 'sequence' && q.id !== seq?.id) continue;
      for (const s of q.shots) {
        const take = s.takes.find((x) => x.id === s.selectedTake && x.status === 'done') ?? s.takes.find((x) => x.status === 'done');
        const frame = s.storyboard.find((f) => f.id === s.selectedFrame) ?? s.storyboard[0];
        out.push({ shot: s, seqId: q.id, seqTitle: q.title, start: at, file: take?.file, still: take?.lastFrame ?? frame?.file });
        at += s.duration;
      }
    }
    return out;
  }, [p, scope, seq?.id]);
  const total = clips.reduce((n, c) => n + c.shot.duration, 0);
  const audioOffset = clips[0]?.shot.from ?? 0;

  // Live cut: plays each shot's chosen take in turn (a still holds for shots without one), audio under it.
  useEffect(() => {
    if (!playing) return;
    const c = clips[idx];
    if (!c) { setPlaying(false); return; }
    let timer: number | undefined;
    if (c.file && vid.current) { vid.current.currentTime = 0; vid.current.play().catch(() => {}); }
    else timer = window.setTimeout(() => setIdx((i) => i + 1), c.shot.duration * 1000);
    if (aud.current) { aud.current.currentTime = audioOffset + c.start; aud.current.play().catch(() => {}); }
    const tick = window.setInterval(() => setT(c.start + (c.file && vid.current ? vid.current.currentTime : 0)), 100);
    return () => { clearTimeout(timer); clearInterval(tick); };
  }, [playing, idx]);
  useEffect(() => { if (!playing) { vid.current?.pause(); aud.current?.pause(); } }, [playing]);

  if (!p) return null;
  const cur = clips[idx];
  const assembled = scope === 'sequence' ? seq?.assembled : p.sequences.find((q) => q.assembled)?.assembled;
  const asmJob = jobs.find((j) => j.kind === 'assemble' && j.projectId === p.id);
  const marks = Array.from({ length: Math.ceil(total) + 1 }, (_, i) => i);

  return (
    <Cols className="g-timeline">
      <Col w={1}>
      <Row grow={1.3}>
      <Card grow={2} area="player" id="tl-player" title="Live cut" icon={<Film size={15} />} pad={false}
        actions={<>
          <span className="mono small">{tc(t)} / {tc(total)}</span>
          <Btn small onClick={() => { setPlaying(false); setIdx(0); setT(0); }}><SkipBack size={13} /></Btn>
          <Btn small kind="solid" onClick={() => setPlaying(!playing)}>{playing ? <Pause size={13} /> : <Play size={13} />}{playing ? 'Pause' : 'Play'}</Btn>
        </>}>
        <div className="stage">
          {cur?.file ? <video ref={vid} key={cur.file} src={media(p.id, cur.file)} muted={!!p.audio} onEnded={() => setIdx((i) => i + 1)} playsInline /> : <Media src={media(p.id, cur?.still)} />}
          {cur ? <div className="stage-caption"><b>{cur.shot.title}</b> · {cur.seqTitle}{cur.file ? '' : ' · no take yet, holding the frame'}</div> : null}
        </div>
        {p.audio ? <audio ref={aud} src={media(p.id, p.audio)} /> : null}
      </Card>

      <Card area="cut" id="tl-assembled" title="Assembled" icon={<Clapperboard size={15} />}
        actions={<Btn small kind="solid" onClick={() => run(() => api.post(p.id, 'assemble', { sequenceId: scope === 'sequence' ? seq?.id : undefined }), 'Assembling')}>Assemble {scope}</Btn>}>
        {assembled ? <Media key={assembled} src={media(p.id, assembled)} video /> : <Empty>Assemble to join the chosen takes into one file with the audio under them.</Empty>}
        {asmJob ? <p className="muted small">Last assemble: {asmJob.status}{asmJob.error ? `, ${asmJob.error}` : ''} · {fmtTime(asmJob.ended ?? asmJob.created)}</p> : null}
        {scope === 'sequence' && seq ? (
          <>
            <Btn small onClick={() => run(() => api.post(p.id, 'agent', { task: 'review', sequenceId: seq.id }), 'Review asked for')}><MessageSquareText size={13} />Review this sequence</Btn>
            {seq.review ? <pre className="review">{seq.review}</pre> : null}
          </>
        ) : null}
      </Card>

      </Row>
      <Card grow={0.9} area="tracks" id="tl-tracks" title="Timeline" icon={<Rows3 size={15} />} pad={false}
        actions={<>
          <Segmented value={scope} onChange={(v) => { setScope(v); setIdx(0); setPlaying(false); }} options={[['sequence', 'This sequence'], ['film', 'Whole film']]} />
          <span className="muted small">zoom</span><input type="range" min={8} max={160} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
        </>}>
        {clips.length === 0 ? <Empty>No shots here yet.</Empty> : (
          <div className="tracks">
            <div className="track-labels"><span>time</span><span>picture</span><span>words</span>{p.audio ? <span>audio</span> : null}</div>
            <div className="track-scroll">
              <div className="track-inner" style={{ width: total * zoom + 40 }}>
                <div className="ruler">{marks.filter((m) => m % (zoom < 20 ? 10 : zoom < 50 ? 5 : 1) === 0).map((m) => <span key={m} style={{ left: m * zoom }}>{tc(m).slice(0, 5)}</span>)}</div>
                <div className="track video">
                  {clips.map((c, i) => (
                    <div key={c.shot.id} className={`clip ${c.shot.id === shotId ? 'on' : ''} ${c.file ? 'has-take' : ''} ${i > 0 && clips[i - 1].seqId !== c.seqId ? 'seq-start' : ''}`} style={{ left: c.start * zoom, width: c.shot.duration * zoom - 2 }}
                      onClick={() => { select(c.seqId, c.shot.id); setIdx(i); setT(c.start); }} onDoubleClick={() => setTab('shot')} title={`${c.shot.title} · ${c.shot.duration}s`}>
                      {c.still ? <img src={media(p.id, c.still)} /> : null}
                      <span>{c.shot.title}</span>
                    </div>
                  ))}
                  <div className="playhead" style={{ left: t * zoom }} />
                </div>
                <div className="track words">
                  {clips.filter((c) => c.shot.dialogue || c.shot.lyric).map((c) => <div key={c.shot.id} className="word-clip" style={{ left: c.start * zoom, width: c.shot.duration * zoom - 2 }}>{c.shot.lyric ?? c.shot.dialogue}</div>)}
                </div>
                {p.audio ? (
                  <div className="track audio">
                    <img src={media(p.id, p.audio + '.wave.png')} onError={(e) => (e.currentTarget.style.display = 'none')} style={{ width: total * zoom }} />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </Card>
      </Col>
    </Cols>
  );
}
