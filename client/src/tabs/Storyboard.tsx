import { RefreshCw, Trash2, Clapperboard, ChevronLeft, ChevronRight, Plus, Images, Film, Link2, Link2Off, Sparkles, Layers, X } from 'lucide-react';
import { api, media } from '../api';
import { useStudio, useSelection, tc } from '../store';
import { useEffect, useState } from 'react';
import { Card, Btn, Edit, Select, Empty, Expert, Field, StatusTag, Cols, Col, Segmented } from '../ui';
import { CAMERA_PRESETS, STILL_MODELS, withRender, type Shot, type Sequence, type Project, type StillModel, type StoryboardFrame } from '../../../shared/types';

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

// The whole film as pictures only: every shot's key frames (start, then end) in story order, one
// continuous strip, so a shot that doesn't follow from the one before is easy to see. Click pictures to
// select them, then delete them or make new ones with FLUX (Quality) or Grok Imagine; double-click opens the picture full size.
function FilmBoard({ p }: { p: Project }) {
  const { select, setTab, ops, run, jobs } = useStudio();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [armed, setArmed] = useState(false);
  const [model, setModel] = useState<StillModel>(withRender(p.render).stills);
  const [view, setView] = useState<string | null>(null);
  type Pic = { key: string; fid?: string; file?: string; n: number; end: boolean; q: string; s: string; fr?: StoryboardFrame; title: string; seq: string; count: number };
  const pics: Pic[] = [];
  let n = 0;
  for (const q of p.sequences) for (const s of q.shots) {
    n++;
    const f = s.storyboard.find((x) => x.id === s.selectedFrame) ?? s.storyboard[0];
    const e = s.endFrames?.find((x) => x.id === s.selectedEnd) ?? s.endFrames?.[0];
    pics.push({ key: s.id + ':s', fid: f?.id, file: f?.file, n, end: false, q: q.id, s: s.id, fr: f, title: s.title, seq: q.title, count: s.storyboard.length });
    if (e) pics.push({ key: s.id + ':e', fid: e.id, file: e.file, n, end: true, q: q.id, s: s.id, fr: e, title: s.title, seq: q.title, count: s.endFrames?.length ?? 0 });
  }
  const chosen = pics.filter((x) => sel.has(x.key));
  const busy = (x: Pic) => jobs.some((j) => j.ref?.shotId === x.s && ['queued', 'waiting-gpu', 'running'].includes(j.status));
  const toggle = (k: string) => setSel((old) => { const nx = new Set(old); if (nx.has(k)) nx.delete(k); else nx.add(k); return nx; });
  const regen = () => {
    const list = chosen;
    run(async () => { for (const x of list) await api.post(p.id, 'storyboard', { shotId: x.s, stills: model, ...(x.end ? { at: 'end' } : {}) }); },
      `${list.length} new frame${list.length > 1 ? 's' : ''} queued (${STILL_MODELS[model].model})`);
    setSel(new Set());
  };
  const del = () => {
    if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 4000); return; }
    setArmed(false);
    const o: any[] = [];
    for (const x of chosen) {
      if (!x.fid) continue;
      const sh = p.sequences.find((q) => q.id === x.q)!.shots.find((s) => s.id === x.s)!;
      const list = x.end ? sh.endFrames ?? [] : sh.storyboard;
      const rest = list.filter((f) => f.id !== x.fid);
      o.push({ op: 'remove', path: ['sequences', x.q, 'shots', x.s, x.end ? 'endFrames' : 'storyboard', x.fid] });
      o.push({ op: 'set', path: ['sequences', x.q, 'shots', x.s, x.end ? 'selectedEnd' : 'selectedFrame'], value: rest[0]?.id });
    }
    if (o.length) ops(o);
    setSel(new Set());
  };
  return (
    <>
      <div className={`fb-tools ${chosen.length ? 'on' : ''}`}>
        {chosen.length ? <>
          <b>{chosen.length} selected</b>
          <Segmented value={model} onChange={(v) => setModel(v as StillModel)} options={[['quality', `Quality · ${STILL_MODELS.quality.model}`], ['speed', `Speed · ${STILL_MODELS.speed.model}`], ['premium', `Premium · ${STILL_MODELS.premium.model}`]]} />
          <Btn small kind="solid" onClick={regen}><RefreshCw size={13} />Regenerate</Btn>
          <Btn small kind="danger" onClick={del}><Trash2 size={13} />{armed ? 'Click again to delete' : 'Delete'}</Btn>
          <Btn small onClick={() => setSel(new Set())}>Clear</Btn>
        </> : <span className="muted small">Click pictures to select them, then regenerate them (Quality · FLUX, Speed · Qwen or Premium · Grok Imagine) or delete them. Double-click a picture to see it full size.</span>}
      </div>
      <div className="filmstrip">
        {pics.map((x) => (
          <figure key={x.key} className={`${x.end ? 'end' : ''} ${sel.has(x.key) ? 'sel' : ''}`} onClick={() => toggle(x.key)} onDoubleClick={() => { toggle(x.key); setView(x.key); }}>
            {x.file ? <img src={media(p.id, x.file)} loading="lazy" /> : <div className="ph"><Clapperboard size={22} /></div>}
            <span>{x.n}{x.end ? ' end' : ''}</span>
            {busy(x) ? <i className="fb-busy">working…</i> : sel.has(x.key) ? <FrameMeta x={x} /> : null}
          </figure>
        ))}
      </div>
      {view ? <Preview pics={pics.filter((x) => x.file)} at={view} p={p} onMove={setView} onClose={() => setView(null)} onShot={(x) => { setView(null); select(x.q, x.s); setTab('shot'); }} /> : null}
    </>
  );
}

// Full-size preview of one board picture. Esc or a click outside closes it; the arrow keys step through the board.
function Preview({ pics, at, p, onMove, onClose, onShot }: { pics: { key: string; file?: string; q: string; s: string; n: number; end: boolean; title: string; seq: string; count: number; fr?: StoryboardFrame }[]; at: string; p: Project; onMove: (k: string) => void; onClose: () => void; onShot: (x: { q: string; s: string }) => void }) {
  const i = Math.max(0, pics.findIndex((x) => x.key === at));
  const x = pics[i];
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight' && pics[i + 1]) onMove(pics[i + 1].key);
      else if (e.key === 'ArrowLeft' && pics[i - 1]) onMove(pics[i - 1].key);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [i, pics, onClose, onMove]);
  if (!x) return null;
  return (
    <div className="fb-preview" onClick={onClose}>
      <div className="fb-preview-box" onClick={(e) => e.stopPropagation()}>
        <img src={media(p.id, x.file!)} />
        <FrameMeta x={x} />
        <div className="fb-preview-bar">
          <Btn small onClick={() => pics[i - 1] && onMove(pics[i - 1].key)}><ChevronLeft size={14} /></Btn>
          <Btn small onClick={() => pics[i + 1] && onMove(pics[i + 1].key)}><ChevronRight size={14} /></Btn>
          <Btn small onClick={() => onShot(x)}>Open shot</Btn>
          <Btn small onClick={onClose}><X size={14} />Close</Btn>
        </div>
      </div>
    </div>
  );
}

// Small print on a selected picture: which shot it is and how it was made.
function FrameMeta({ x }: { x: { fr?: StoryboardFrame; title: string; seq: string; n: number; end: boolean; count: number; file?: string } }) {
  const f = x.fr;
  const when = f?.at ? new Date(f.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const how = !f ? 'no frame yet' : [f.model ?? f.engine, f.engine && f.model && f.engine !== f.model ? f.engine : '', f.seed != null ? `seed ${f.seed}` : '', f.refs?.length ? `${f.refs.length} ref${f.refs.length > 1 ? 's' : ''}` : '', f.sketchId ? 'from sketch' : '', when].filter(Boolean).join(' · ');
  return (
    <figcaption className="fb-meta" title={f?.prompt}>
      <b>{x.n}{x.end ? ' end' : ''} · {x.title}</b>
      <span>{x.seq} · {x.count} {x.end ? 'end ' : ''}frame{x.count === 1 ? '' : 's'}</span>
      <span>{how}</span>
      {f?.fix ? <span>fix: {f.fix}</span> : null}
      {f?.file ? <span className="dim">{f.file.split('/').pop()}</span> : null}
    </figcaption>
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
        <Card area="board" id="filmboard" title={`${p.title} · whole film · ${p.sequences.reduce((k, x) => k + x.shots.length, 0)} shots`} icon={<Images size={15} />}
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
