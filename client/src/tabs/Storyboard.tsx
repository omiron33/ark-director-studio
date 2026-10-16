import { RefreshCw, Trash2, Clapperboard, ChevronLeft, ChevronRight, Plus, Images, Film, Link2, Link2Off, Sparkles, Layers } from 'lucide-react';
import { api, media } from '../api';
import { useStudio, useSelection, tc } from '../store';
import { useState } from 'react';
import { Card, Btn, Edit, Select, Empty, Expert, Field, StatusTag, Cols, Col } from '../ui';
import { CAMERA_PRESETS, type Shot, type Sequence, type Project } from '../../../shared/types';

export function SequenceRail() {
  const { project: p, sequenceId, select } = useStudio();
  if (!p) return null;
  return (
    <Card area="rail" id="rail" title="Sequences" icon={<Layers size={15} />} pad={false}>
      <ul className="rail">
        {p.sequences.map((q, i) => {
          const done = q.shots.filter((s) => s.takes.some((t) => t.status === 'done')).length;
          const framed = q.shots.filter((s) => s.storyboard.length).length;
          return (
            <li key={q.id} className={q.id === sequenceId ? 'on' : ''} onClick={() => select(q.id)}>
              <span className="num">{String(i + 1).padStart(2, '0')}</span>
              <div className="grow">
                <b>{q.title}</b>
                <div className="meter"><i style={{ width: `${q.shots.length ? (framed / q.shots.length) * 100 : 0}%` }} /><i className="takes" style={{ width: `${q.shots.length ? (done / q.shots.length) * 100 : 0}%` }} /></div>
                <span className="muted small">{q.shots.length} shots · {framed} framed · {done} with takes</span>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ShotCard({ p, q, s, i }: { p: Project; q: Sequence; s: Shot; i: number }) {
  const { ops, run, select, setTab, shotId, jobs } = useStudio();
  const frame = s.storyboard.find((f) => f.id === s.selectedFrame) ?? s.storyboard[0];
  const take = s.takes.find((t) => t.id === s.selectedTake);
  const busy = jobs.find((j) => j.ref?.shotId === s.id && ['queued', 'waiting-gpu', 'running'].includes(j.status));
  const move = (d: number) => ops([{ op: 'move', path: ['sequences', q.id, 'shots'], id: s.id, index: i + d }]);
  const regen = (engine: 'comfy' | 'grok') => run(() => api.post(p.id, 'storyboard', { shotId: s.id, engine }), 'Frame queued');
  return (
    <article className={`shot-card ${s.id === shotId ? 'on' : ''}`} onClick={() => select(q.id, s.id)} onDoubleClick={() => setTab('shot')}>
      <div className="shot-frame">
        {take?.file ? <video src={media(p.id, take.file)} muted loop onMouseEnter={(e) => e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} poster={media(p.id, frame?.file)} /> : frame ? <img src={media(p.id, frame.file)} /> : <div className="ph"><Clapperboard size={28} /></div>}
        <span className="shot-no">{String(i + 1).padStart(2, '0')}</span>
        {(() => { const e = s.endFrames?.find((f) => f.id === s.selectedEnd) ?? s.endFrames?.[0]; return e ? <img className="shot-end" title="Where the camera move ends" src={media(p.id, e.file)} /> : null; })()}
        <span className="shot-dur">{s.duration}s</span>
        {s.chainFromPrevious && q.continuity.chain && i > 0 ? <span className="shot-chain" title="Starts from the previous shot's last frame"><Link2 size={12} /></span> : null}
        {busy ? <span className="shot-busy"><StatusTag s={busy.status} /></span> : take ? <span className="shot-take">take ✓</span> : null}
      </div>
      {s.storyboard.length > 1 ? (
        <div className="frame-strip">
          {s.storyboard.slice(0, 6).map((f) => (
            <img key={f.id} className={f.id === frame?.id ? 'on' : ''} src={media(p.id, f.file)} onClick={(e) => { e.stopPropagation(); ops([{ op: 'set', path: ['sequences', q.id, 'shots', s.id, 'selectedFrame'], value: f.id }]); }} />
          ))}
        </div>
      ) : null}
      <div className="shot-body">
        <Edit value={s.title} onSave={(v) => ops([{ op: 'set', path: ['sequences', q.id, 'shots', s.id, 'title'], value: v }])} />
        <p className="clamp3">{s.action || s.prompt || <span className="muted">No action written yet.</span>}</p>
        <div className="chips">
          <span className="chip">{CAMERA_PRESETS[s.camera.preset]?.label ?? s.camera.preset}</span>
          <span className={`chip src-${s.source}`}>{s.source}</span>
          {s.castIds.map((id) => <span key={id} className="chip cast">{p.cast.find((c) => c.id === id)?.name ?? '?'}</span>)}
        </div>
      </div>
      <footer className="shot-actions" onClick={(e) => e.stopPropagation()}>
        <button className="icon-btn" title="New storyboard frame" onClick={() => regen('comfy')}><RefreshCw size={14} /></button>
        <Expert><button className="icon-btn" title="New frame with Grok Imagine" onClick={() => regen('grok')}><Sparkles size={14} /></button></Expert>
        <button className="icon-btn" title="Generate a take" disabled={s.source === 'code'} onClick={() => run(() => api.post(p.id, 'take', { shotId: s.id }), 'Take queued')}><Film size={14} /></button>
        <span className="grow" />
        <button className="icon-btn" title="Move earlier" disabled={i === 0} onClick={() => move(-1)}><ChevronLeft size={14} /></button>
        <button className="icon-btn" title="Move later" disabled={i === q.shots.length - 1} onClick={() => move(1)}><ChevronRight size={14} /></button>
        <button className="icon-btn danger" title="Delete shot" onClick={() => confirm(`Delete "${s.title}"?`) && ops([{ op: 'remove', path: ['sequences', q.id, 'shots', s.id] }])}><Trash2 size={14} /></button>
      </footer>
    </article>
  );
}

// The whole film in story order on one page: every shot's start and end frame, its time in the song,
// its lyric and what happens, under its sequence heading, so shots that don't follow are easy to spot.
function FilmBoard({ p }: { p: Project }) {
  const { select, setTab } = useStudio();
  let n = 0;
  return (
    <div className="filmboard">
      {p.sequences.map((q, qi) => (
        <section key={q.id} className="fb-seq">
          <h3><span className="num">{String(qi + 1).padStart(2, '0')}</span>{q.title}<em>{q.summary}</em></h3>
          <div className="fb-row">
            {q.shots.map((s) => {
              n++;
              const f = s.storyboard.find((x) => x.id === s.selectedFrame) ?? s.storyboard[0];
              const e = s.endFrames?.find((x) => x.id === s.selectedEnd) ?? s.endFrames?.[0];
              return (
                <article key={s.id} className="fb-shot" onClick={() => select(q.id, s.id)} onDoubleClick={() => { select(q.id, s.id); setTab('shot'); }} title="Double-click to open the shot">
                  <div className="fb-pics">
                    {f ? <img src={media(p.id, f.file)} /> : <div className="ph"><Clapperboard size={22} /></div>}
                    {e ? <img src={media(p.id, e.file)} /> : <div className="ph small">no end frame</div>}
                  </div>
                  <div className="fb-meta"><b>{String(n).padStart(2, '0')} · {s.title}</b><span className="muted">{tc(s.from)} · {s.duration}s · {CAMERA_PRESETS[s.camera.preset]?.label ?? s.camera.preset}</span></div>
                  {s.lyric ? <p className="fb-lyric">{s.lyric}</p> : <p className="fb-lyric muted">(instrumental)</p>}
                  <p className="fb-action clamp3">{s.action}</p>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

export function Storyboard() {
  const { project: p, seq: q } = useSelection();
  const { ops, run, setTab } = useStudio();
  const [whole, setWhole] = useState<boolean>(() => { try { return localStorage.getItem('ads.board.whole') !== '0'; } catch { return true; } });
  const toggle = (v: boolean) => { setWhole(v); try { localStorage.setItem('ads.board.whole', v ? '1' : '0'); } catch {} };
  if (!p) return null;
  if (whole) return (
    <Cols className="g-board">
      <Col w={1}>
        <Card area="board" id="filmboard" title={`Whole film storyboard · ${p.sequences.reduce((k, x) => k + x.shots.length, 0)} shots`} icon={<Images size={15} />}
          actions={<Btn small onClick={() => toggle(false)}><Layers size={13} />One sequence</Btn>}>
          <FilmBoard p={p} />
        </Card>
      </Col>
    </Cols>
  );
  return (
    <Cols className="g-board">
      <Col fixed={300}><SequenceRail /></Col>
      <Col w={1}>
      <Card area="board" id="board" title={q ? q.title : 'Storyboard'} icon={<Images size={15} />}
        actions={q ? <>
          <Btn small onClick={() => toggle(true)}><Images size={13} />Whole film</Btn>
          <Btn small onClick={() => run(() => api.post(p.id, 'storyboard-all', { sequenceId: q.id, missingOnly: true }), 'Frames queued for shots without one')}><Images size={13} />Frame the rest</Btn>
          <Btn small onClick={() => run(() => api.post(p.id, 'end-frames', { sequenceId: q.id, missingOnly: true }), 'End frames queued for moving shots')}><Film size={13} />End frames</Btn>
          <Expert><Btn small onClick={() => confirm('Make a new frame for every shot in this sequence?') && run(() => api.post(p.id, 'storyboard-all', { sequenceId: q.id, missingOnly: false }), 'New frames queued')}><RefreshCw size={13} />Redo all frames</Btn></Expert>
          <Btn small kind="solid" onClick={() => run(() => api.post(p.id, 'takes-sequence', { sequenceId: q.id, missingOnly: true }), 'Takes queued in film order')}><Film size={13} />Takes for the sequence</Btn>
          <Btn small onClick={() => { run(() => api.post(p.id, 'assemble', { sequenceId: q.id }), 'Assembling'); setTab('timeline'); }}>Assemble</Btn>
        </> : null}>
        {!q ? <Empty>Pick or add a sequence.</Empty> : (
          <div className="board">
            {q.shots.map((s, i) => <ShotCard key={s.id} p={p} q={q} s={s} i={i} />)}
            <button className="shot-add" onClick={() => ops([{ op: 'insert', path: ['sequences', q.id, 'shots'], value: { title: `Shot ${q.shots.length + 1}`, castIds: q.continuity.castIds } }])}><Plus size={22} />Add shot</button>
          </div>
        )}
      </Card>
      </Col>
      {q ? <Col fixed={420}><ContinuityCard /></Col> : null}
    </Cols>
  );
}

export function ContinuityCard() {
  const { project: p, seq: q } = useSelection();
  const { ops, run } = useStudio();
  if (!p || !q) return null;
  const base = ['sequences', q.id, 'continuity'];
  return (
    <Card area="side" id="continuity" title="Continuity" icon={q.continuity.chain ? <Link2 size={15} /> : <Link2Off size={15} />}>
      <div className="form">
        <Field label="Plan" hint="one per sequence"><Edit multiline rows={6} value={q.continuity.plan} onSave={(v) => ops([{ op: 'set', path: [...base, 'plan'], value: v }])} placeholder="Bethany at dusk. Low warm sun from camera left. Martha by the tomb, Mary kneeling, Jesus centre in white." /></Field>
        <Field label="Look"><Select value={q.continuity.lookId ?? ''} onChange={(v) => ops([{ op: 'set', path: [...base, 'lookId'], value: v || undefined }])} options={[['', 'No look image'], ...p.looks.map((l) => [l.id, l.name] as [string, string])]} /></Field>
        <label className="check"><input type="checkbox" checked={q.continuity.chain} onChange={(e) => ops([{ op: 'set', path: [...base, 'chain'], value: e.target.checked }])} />Each take starts from the last frame of the take before it</label>
        <Field label="Characters in this sequence">
          <div className="chips">
            {p.cast.map((c) => {
              const on = q.continuity.castIds.includes(c.id);
              return <button key={c.id} className={`chip toggle ${on ? 'on' : ''}`} onClick={() => ops([{ op: 'set', path: [...base, 'castIds'], value: on ? q.continuity.castIds.filter((x) => x !== c.id) : [...q.continuity.castIds, c.id] }])}>{c.name}{c.sheet ? ' ✓' : ''}</button>;
            })}
            {p.cast.length === 0 ? <span className="muted small">No characters yet.</span> : null}
          </div>
        </Field>
        <Field label="Summary"><Edit multiline rows={3} value={q.summary} onSave={(v) => ops([{ op: 'set', path: ['sequences', q.id, 'summary'], value: v }])} /></Field>
        {q.review ? <Field label="Latest sequence review"><pre className="review">{q.review}</pre></Field> : null}
        <Btn small onClick={() => run(() => api.post(p.id, 'agent', { task: 'review', sequenceId: q.id }), 'Review asked for')}>Review the whole sequence</Btn>
      </div>
    </Card>
  );
}
