import { useRef, useState } from 'react';
import { Box, Plus, Trash2, Play, Move3d, Camera as CamIcon, Sun, Layers } from 'lucide-react';
import { api, media } from '../api';
import { useStudio, useSelection } from '../store';
import { Card, Btn, Empty, Media, Select, Field, Expert, StatusTag, Cols, Col } from '../ui';
import type { Greybox, GreyboxActor, GreyboxProp, GreyboxLight } from '../../../shared/types';

const POSES = ['stand', 'walk', 'run', 'kneel', 'sit', 'arms-up', 'reach', 'bow', 'lie', 'cower', 'stagger', 'point', 'prostrate'];
const KINDS = ['box', 'cylinder', 'wall', 'plane', 'arch', 'stairs', 'rock'];
const fresh = (castIds: string[]): Greybox => ({
  actors: (castIds.length ? castIds : ['figure']).map((id, i, a) => ({ castId: id === 'figure' ? undefined : id, label: id, pose: 'stand', x: (i - (a.length - 1) / 2) * 1.2, z: 0, heading: 0 })),
  props: [],
  camera: { from: [0, 1.6, 7], to: [0, 1.6, 5.5], look: [0, 1.3, 0], lens: 35 },
  sun: { azimuth: 40, elevation: 35 },
});

// Top-down plan: drag figures, props and the camera's start and end marks. 1 grid square = 1 m.
function Plan({ gb: saved, onChange, set = [] }: { gb: Greybox; onChange: (g: Greybox) => void; set?: GreyboxProp[] }) {
  const [local, setLocal] = useState<Greybox | null>(null);
  const gb = local ?? saved;
  const ref = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ kind: 'actor' | 'prop' | 'from' | 'to' | 'look' | 'light'; i: number } | null>(null);
  const R = 14; // metres from centre to edge
  const toWorld = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 * R - R, z: ((e.clientY - r.top) / r.height) * 2 * R - R };
  };
  const move = (e: React.PointerEvent) => {
    if (!drag) return;
    const { x, z } = toWorld(e);
    const rx = Math.round(x * 10) / 10, rz = Math.round(z * 10) / 10;
    const g = structuredClone(gb);
    if (drag.kind === 'actor') { g.actors[drag.i].x = rx; g.actors[drag.i].z = rz; }
    if (drag.kind === 'prop') { g.props[drag.i].x = rx; g.props[drag.i].z = rz; }
    if (drag.kind === 'light' && g.lights) { g.lights[drag.i].x = rx; g.lights[drag.i].z = rz; }
    if (drag.kind === 'from' || drag.kind === 'to' || drag.kind === 'look') { g.camera[drag.kind][0] = rx; g.camera[drag.kind][2] = rz; }
    setLocal(g);
  };
  const end = () => { if (local) onChange(local); setLocal(null); setDrag(null); };
  const S = (v: number) => v; // world units map 1:1 into the viewBox
  return (
    <svg ref={ref} className="plan" viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`} onPointerMove={move} onPointerUp={end} onPointerLeave={end}>
      <defs><pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="var(--line)" strokeWidth="0.03" /></pattern></defs>
      <rect x={-R} y={-R} width={2 * R} height={2 * R} fill="url(#grid)" />
      {set.map((p, i) => <rect key={`set${i}`} className="plan-set" x={p.x - p.w / 2} y={p.z - p.d / 2} width={p.w} height={Math.max(p.d, 0.15)}><title>{p.label} (sequence set)</title></rect>)}
      {gb.props.map((p, i) => <rect key={i} className="plan-prop" x={S(p.x - p.w / 2)} y={S(p.z - p.d / 2)} width={p.w} height={Math.max(p.d, 0.15)} onPointerDown={() => setDrag({ kind: 'prop', i })}><title>{p.label}</title></rect>)}
      <line className="plan-path" x1={gb.camera.from[0]} y1={gb.camera.from[2]} x2={gb.camera.to[0]} y2={gb.camera.to[2]} />
      <line className="plan-aim" x1={gb.camera.to[0]} y1={gb.camera.to[2]} x2={gb.camera.look[0]} y2={gb.camera.look[2]} />
      {gb.actors.map((a, i) => a.x2 !== undefined || a.z2 !== undefined ? <line key={`w${i}`} className="plan-walk" x1={a.x} y1={a.z} x2={a.x2 ?? a.x} y2={a.z2 ?? a.z} /> : null)}
      {(gb.lights ?? []).map((l, i) => <g key={`l${i}`} className="plan-light" transform={`translate(${l.x} ${l.z})`} onPointerDown={() => setDrag({ kind: 'light', i })}><circle r={Math.max(0.2, l.size)} /><text y="-0.5" textAnchor="middle">{l.label}</text></g>)}
      {gb.actors.map((a, i) => (
        <g key={i} transform={`translate(${a.x} ${a.z}) rotate(${-a.heading})`} onPointerDown={() => setDrag({ kind: 'actor', i })} className="plan-actor">
          <circle r="0.35" /><line x1="0" y1="0" x2="0" y2="0.6" />
          <text y="-0.55" textAnchor="middle">{a.label}</text>
        </g>
      ))}
      {(['from', 'to'] as const).map((k) => <g key={k} className={`plan-cam ${k}`} transform={`translate(${gb.camera[k][0]} ${gb.camera[k][2]})`} onPointerDown={() => setDrag({ kind: k, i: 0 })}><rect x="-0.35" y="-0.25" width="0.7" height="0.5" rx="0.08" /><text y="0.75" textAnchor="middle">{k === 'from' ? 'cam start' : 'cam end'}</text></g>)}
      <g className="plan-look" transform={`translate(${gb.camera.look[0]} ${gb.camera.look[2]})`} onPointerDown={() => setDrag({ kind: 'look', i: 0 })}><circle r="0.2" /><text y="0.6" textAnchor="middle">aim</text></g>
    </svg>
  );
}

const num = (v: string, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function GreyboxTab() {
  const { project: p, seq: q, shot: s } = useSelection();
  const { ops, run, select, jobs } = useStudio();
  if (!p || !q) return null;
  if (!s) return <Empty>Pick a shot.</Empty>;
  const gb = s.greybox ?? fresh(s.castIds);
  const save = (g: Greybox) => ops([{ op: 'set', path: ['sequences', q.id, 'shots', s.id, 'greybox'], value: { ...g, video: s.greybox?.video, still: s.greybox?.still } }]);
  const setActor = (i: number, patch: Partial<GreyboxActor>) => { const g = structuredClone(gb); Object.assign(g.actors[i], patch); save(g); };
  const setProp = (i: number, patch: Partial<GreyboxProp>) => { const g = structuredClone(gb); Object.assign(g.props[i], patch); save(g); };
  const setLight = (i: number, patch: Partial<GreyboxLight>) => { const g = structuredClone(gb); Object.assign(g.lights![i], patch); save(g); };
  const opt = (v: string) => (v.trim() === '' ? undefined : num(v));
  const setCam = (k: 'from' | 'to' | 'look', axis: number, v: number) => { const g = structuredClone(gb); g.camera[k][axis] = v; save(g); };
  const busy = jobs.find((j) => j.kind === 'greybox' && j.ref?.shotId === s.id && ['queued', 'waiting-gpu', 'running'].includes(j.status));

  return (
    <Cols className="g-greybox">
      <Col fixed={360}>
      <Card area="pick" id="gb-shots" title="Shot" icon={<Box size={15} />}>
        <div className="form">
          <Field label="Sequence"><Select value={q.id} onChange={(v) => select(v)} options={p.sequences.map((x) => [x.id, x.title])} /></Field>
          <Field label="Shot"><Select value={s.id} onChange={(v) => select(q.id, v)} options={q.shots.map((x, i) => [x.id, `${i + 1}. ${x.title}`])} /></Field>
          <p className="small clamp3">{s.action || s.prompt}</p>
          <p className="muted small">The greybox is a plain Blender clip of who stands where and how the camera moves, with each character built from their model and the sequence's set around them. H3 follows it for the first denoise steps, then paints the real picture over it; storyboard stills follow its first frame.</p>
          <Btn kind="primary" onClick={() => run(() => api.post(p.id, 'greybox', { shotId: s.id }), 'Greybox queued')} disabled={!!busy}><Play size={14} />Render greybox in Blender</Btn>
          {busy ? <div className="job-inline"><StatusTag s={busy.status} /><span>{busy.note}</span></div> : null}
          <Btn small onClick={() => run(() => api.post(p.id, 'greybox-all', { sequenceId: q.id }), 'Every greybox in this sequence queued')}><Layers size={13} />Render the whole sequence</Btn>
          <label className="check"><input type="checkbox" checked={gb.useSet !== false} onChange={(e) => save({ ...gb, useSet: e.target.checked })} />Build the sequence's set ({q.set?.length ?? 0} pieces, {q.setLights?.length ?? 0} lights)</label>
          <Field label="Mist" hint="0-1"><input type="number" step={0.1} min={0} max={1} value={gb.mist ?? 0} onChange={(e) => save({ ...gb, mist: num(e.target.value) })} /></Field>
          {s.greybox?.still ? <img className="gb-end" src={media(p.id, s.greybox.still.replace('.png', '-end.png'))} title="Where the shot ends" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : null}
          {s.greybox ? <Btn small kind="danger" onClick={() => ops([{ op: 'set', path: ['sequences', q.id, 'shots', s.id, 'greybox'], value: undefined }])}><Trash2 size={13} />Clear greybox</Btn> : null}
        </div>
      </Card>

      </Col>

      <Col w={1.1}>

      <Card area="plan" id="gb-plan" title="Plan from above" icon={<Move3d size={15} />} pad={false} actions={<span className="muted small">drag figures, props and camera marks · 1 square = 1 m</span>}>
        <Plan gb={gb} onChange={save} set={gb.useSet !== false ? q.set : []} />
      </Card>

      <Card area="render" id="gb-render" title="Greybox clip" icon={<Play size={15} />} pad={false}>
        <div className="stage">{s.greybox?.video ? <Media key={s.greybox.video} src={media(p.id, s.greybox.video)} video poster={media(p.id, s.greybox.still)} /> : <Media />}</div>
      </Card>

      </Col>

      <Col w={1}>

      <Card area="parts" id="gb-parts" title="Figures, props and camera" icon={<CamIcon size={15} />}
        actions={<><Btn small onClick={() => save({ ...gb, actors: [...gb.actors, { label: `figure ${gb.actors.length + 1}`, pose: 'stand', x: 0, z: 0, heading: 0 }] })}><Plus size={13} />Figure</Btn><Btn small onClick={() => save({ ...gb, props: [...gb.props, { label: `prop ${gb.props.length + 1}`, kind: 'box', x: 2, z: -2, w: 1, h: 1, d: 1 }] })}><Plus size={13} />Prop</Btn><Btn small onClick={() => save({ ...gb, lights: [...(gb.lights ?? []), { label: `light ${(gb.lights?.length ?? 0) + 1}`, x: 0, y: 2.5, z: -2, size: 0.4, color: '#fff3dc' }] })}><Sun size={13} />Light</Btn></>}>
        <table className="tbl">
          <thead><tr><th>Figure</th><th>Character</th><th>Pose</th><th>x</th><th>z</th><th>Facing°</th><th>to x</th><th>to z</th><th>ends</th><th /></tr></thead>
          <tbody>
            {gb.actors.map((a, i) => (
              <tr key={i}>
                <td><input value={a.label} onChange={(e) => setActor(i, { label: e.target.value })} /></td>
                <td><Select value={a.castId ?? ''} onChange={(v) => setActor(i, { castId: v || undefined, label: p.cast.find((c) => c.id === v)?.name ?? a.label })} options={[['', '—'], ...p.cast.map((c) => [c.id, c.name] as [string, string])]} /></td>
                <td><Select value={a.pose} onChange={(v) => setActor(i, { pose: v })} options={POSES.map((x) => [x, x])} /></td>
                <td><input type="number" step={0.1} value={a.x} onChange={(e) => setActor(i, { x: num(e.target.value) })} /></td>
                <td><input type="number" step={0.1} value={a.z} onChange={(e) => setActor(i, { z: num(e.target.value) })} /></td>
                <td><input type="number" step={15} value={a.heading} onChange={(e) => setActor(i, { heading: num(e.target.value) })} /></td>
                <td><input type="number" step={0.1} value={a.x2 ?? ''} onChange={(e) => setActor(i, { x2: opt(e.target.value) })} /></td>
                <td><input type="number" step={0.1} value={a.z2 ?? ''} onChange={(e) => setActor(i, { z2: opt(e.target.value) })} /></td>
                <td><Select value={a.pose2 ?? ''} onChange={(v) => setActor(i, { pose2: v || undefined })} options={[['', 'same'], ...POSES.map((x) => [x, x] as [string, string])]} /></td>
                <td><button className="icon-btn danger" onClick={() => save({ ...gb, actors: gb.actors.filter((_, j) => j !== i) })}><Trash2 size={13} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {gb.props.length ? (
          <table className="tbl">
            <thead><tr><th>Prop</th><th>Kind</th><th>x</th><th>z</th><th>w</th><th>h</th><th>d</th><th>tilt°</th><th>to°</th><th /></tr></thead>
            <tbody>
              {gb.props.map((pr, i) => (
                <tr key={i}>
                  <td><input value={pr.label} onChange={(e) => setProp(i, { label: e.target.value })} /></td>
                  <td><Select value={pr.kind} onChange={(v) => setProp(i, { kind: v as GreyboxProp['kind'] })} options={KINDS.map((x) => [x, x] as [string, string])} /></td>
                  {(['x', 'z', 'w', 'h', 'd'] as const).map((k) => <td key={k}><input type="number" step={0.1} value={pr[k]} onChange={(e) => setProp(i, { [k]: num(e.target.value) } as any)} /></td>)}
                  {(['tilt', 'tilt2'] as const).map((k) => <td key={k}><input type="number" step={5} value={pr[k] ?? ''} onChange={(e) => setProp(i, { [k]: opt(e.target.value) } as any)} /></td>)}
                  <td><button className="icon-btn danger" onClick={() => save({ ...gb, props: gb.props.filter((_, j) => j !== i) })}><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {gb.lights?.length ? (
          <table className="tbl">
            <thead><tr><th>Light</th><th>x</th><th>height</th><th>z</th><th>size</th><th>colour</th><th /></tr></thead>
            <tbody>
              {gb.lights.map((l, i) => (
                <tr key={i}>
                  <td><input value={l.label} onChange={(e) => setLight(i, { label: e.target.value })} /></td>
                  {(['x', 'y', 'z', 'size'] as const).map((k) => <td key={k}><input type="number" step={0.1} value={l[k]} onChange={(e) => setLight(i, { [k]: num(e.target.value) } as any)} /></td>)}
                  <td><input type="color" value={l.color ?? '#fff3dc'} onChange={(e) => setLight(i, { color: e.target.value })} /></td>
                  <td><button className="icon-btn danger" onClick={() => save({ ...gb, lights: gb.lights!.filter((_, j) => j !== i) })}><Trash2 size={13} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        <table className="tbl">
          <thead><tr><th>Camera</th><th>x</th><th>height</th><th>z</th></tr></thead>
          <tbody>
            {(['from', 'to', 'look'] as const).map((k) => (
              <tr key={k}><td>{k === 'from' ? 'start' : k === 'to' ? 'end' : 'aim at'}</td>{[0, 1, 2].map((ax) => <td key={ax}><input type="number" step={0.1} value={gb.camera[k][ax]} onChange={(e) => setCam(k, ax, num(e.target.value))} /></td>)}</tr>
            ))}
          </tbody>
        </table>
        <div className="form-row">
          <Field label="Lens mm"><input type="number" value={gb.camera.lens} onChange={(e) => save({ ...gb, camera: { ...gb.camera, lens: num(e.target.value, 35) } })} /></Field>
          <Expert>
            <Field label="Sun azimuth°"><input type="number" value={gb.sun?.azimuth ?? 40} onChange={(e) => save({ ...gb, sun: { azimuth: num(e.target.value), elevation: gb.sun?.elevation ?? 35 } })} /></Field>
            <Field label="Sun height°"><input type="number" value={gb.sun?.elevation ?? 35} onChange={(e) => save({ ...gb, sun: { azimuth: gb.sun?.azimuth ?? 40, elevation: num(e.target.value) } })} /></Field>
          </Expert>
        </div>
      </Card>
      </Col>
    </Cols>
  );
}
