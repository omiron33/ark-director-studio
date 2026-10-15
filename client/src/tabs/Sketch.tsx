// Hands-on scene making: draw the frame with stick figures, lines, boxes, circles, arrows and labels,
// then generate storyboard frames that follow the drawing. The drawing stays editable (it is kept as
// shapes); the model sees a black-on-white PNG of it next to the shot's prompt.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { PenTool, MousePointer2, PersonStanding, Slash, Square, Circle, MoveRight, Type, Undo2, Redo2, Trash2, Save, Sparkles, ListVideo, Image as ImageIcon, Plus, Star, Grid3x3, Layers } from 'lucide-react';
import { api, media } from '../api';
import { useStudio, useSelection, fmtTime } from '../store';
import { Card, Btn, Field, Segmented, Expert, Empty, Cols, Col } from '../ui';
import type { SketchShape, SketchTool, Sketch } from '../../../shared/types';

const SIZES: Record<string, [number, number]> = { '16:9': [1600, 900], '9:16': [900, 1600], '1:1': [1200, 1200], '2.39:1': [1912, 800] };
type Tool = SketchTool | 'select';
const TOOLS: [Tool, any, string][] = [
  ['select', MousePointer2, 'Select and move (V)'], ['figure', PersonStanding, 'Stick figure: drag from head to feet (F)'], ['line', Slash, 'Line (L)'],
  ['box', Square, 'Box (B)'], ['circle', Circle, 'Circle (C)'], ['arrow', MoveRight, 'Arrow: movement or gaze (A)'], ['text', Type, 'Label (T)'],
];
const KEYS: Record<string, Tool> = { v: 'select', f: 'figure', l: 'line', b: 'box', c: 'circle', a: 'arrow', t: 'text' };

// Every shape as simple primitives, so the screen (SVG) and the PNG the model sees draw the same thing.
type Prim = { k: 'line'; x1: number; y1: number; x2: number; y2: number } | { k: 'circle'; cx: number; cy: number; r: number } | { k: 'rect'; x: number; y: number; w: number; h: number } | { k: 'text'; x: number; y: number; text: string; size: number };
export function prims(s: SketchShape): Prim[] {
  const { x1, y1, x2, y2 } = s;
  if (s.tool === 'line') return [{ k: 'line', x1, y1, x2, y2 }];
  if (s.tool === 'box') return [{ k: 'rect', x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }];
  if (s.tool === 'circle') return [{ k: 'circle', cx: x1, cy: y1, r: Math.hypot(x2 - x1, y2 - y1) }];
  if (s.tool === 'text') return [{ k: 'text', x: x1, y: y1, text: s.text ?? '', size: 34 }];
  if (s.tool === 'arrow') {
    const a = Math.atan2(y2 - y1, x2 - x1), L = Math.min(34, Math.hypot(x2 - x1, y2 - y1) * 0.4);
    return [{ k: 'line', x1, y1, x2, y2 }, { k: 'line', x1: x2, y1: y2, x2: x2 - L * Math.cos(a - 0.45), y2: y2 - L * Math.sin(a - 0.45) }, { k: 'line', x1: x2, y1: y2, x2: x2 - L * Math.cos(a + 0.45), y2: y2 - L * Math.sin(a + 0.45) }];
  }
  // figure: (x1,y1) is the top of the head, (x2,y2) the feet; it leans along that line
  const h = Math.max(20, Math.hypot(x2 - x1, y2 - y1)), ux = (x2 - x1) / h || 0, uy = (y2 - y1) / h || 1, nx = -uy, ny = ux;
  const at = (t: number, side = 0) => [x1 + ux * h * t + nx * h * side, y1 + uy * h * t + ny * h * side];
  const r = h * 0.09, [hx, hy] = at(0.09), [nkx, nky] = at(0.18), [shx, shy] = at(0.27), [hipx, hipy] = at(0.56);
  const [lhx, lhy] = at(0.5, -0.2), [rhx, rhy] = at(0.5, 0.2), [lfx, lfy] = at(1, -0.13), [rfx, rfy] = at(1, 0.13);
  return [
    { k: 'circle', cx: hx, cy: hy, r }, { k: 'line', x1: nkx, y1: nky, x2: hipx, y2: hipy },
    { k: 'line', x1: shx, y1: shy, x2: lhx, y2: lhy }, { k: 'line', x1: shx, y1: shy, x2: rhx, y2: rhy },
    { k: 'line', x1: hipx, y1: hipy, x2: lfx, y2: lfy }, { k: 'line', x1: hipx, y1: hipy, x2: rfx, y2: rfy },
  ];
}

function toPng(shapes: SketchShape[], [W, H]: [number, number]) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#000'; g.fillStyle = '#000';
  for (const s of shapes) {
    g.lineWidth = s.width ?? 6;
    for (const p of prims(s)) {
      g.beginPath();
      if (p.k === 'line') { g.moveTo(p.x1, p.y1); g.lineTo(p.x2, p.y2); g.stroke(); }
      if (p.k === 'circle') { g.arc(p.cx, p.cy, p.r, 0, Math.PI * 2); g.stroke(); }
      if (p.k === 'rect') { g.strokeRect(p.x, p.y, p.w, p.h); }
      if (p.k === 'text') { g.font = `600 ${p.size}px sans-serif`; g.fillText(p.text, p.x, p.y); }
    }
  }
  return c.toDataURL('image/png');
}

const near = (s: SketchShape, x: number, y: number) => {
  const d = (ax: number, ay: number, bx: number, by: number) => {
    const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1, t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2));
    return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay));
  };
  return Math.min(...prims(s).map((p) => p.k === 'line' ? d(p.x1, p.y1, p.x2, p.y2) : p.k === 'circle' ? Math.abs(Math.hypot(x - p.cx, y - p.cy) - p.r)
    : p.k === 'rect' ? Math.min(d(p.x, p.y, p.x + p.w, p.y), d(p.x + p.w, p.y, p.x + p.w, p.y + p.h), d(p.x, p.y + p.h, p.x + p.w, p.y + p.h), d(p.x, p.y, p.x, p.y + p.h))
    : Math.hypot(x - p.x - 40, y - p.y + 12)));
};
const uid = () => Math.random().toString(36).slice(2, 10);

export function SketchTab() {
  const { project: p, seq: q, shot: s } = useSelection();
  const { run, select, setTab, ops, jobs } = useStudio();
  const size = SIZES[p?.aspect ?? '16:9'] ?? SIZES['16:9'];
  const [tool, setTool] = useState<Tool>('figure');
  const [shapes, setShapes] = useState<SketchShape[]>([]);
  const [past, setPast] = useState<SketchShape[][]>([]);
  const [future, setFuture] = useState<SketchShape[][]>([]);
  const [draft, setDraft] = useState<SketchShape | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [sketchId, setSketchId] = useState<string | undefined>();
  const [note, setNote] = useState('');
  const [prompt, setPrompt] = useState('');
  const [follow, setFollow] = useState<'exact' | 'loose' | 'idea'>('exact');
  const [count, setCount] = useState(2);
  const [engine, setEngine] = useState<'comfy' | 'grok'>('comfy');
  const [grid, setGrid] = useState(true);
  const [trace, setTrace] = useState(false);
  const [dirty, setDirty] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{ id: string; mode: 'move' | 'p1' | 'p2'; x: number; y: number; orig: SketchShape } | null>(null);

  const load = (k?: Sketch) => {
    setSketchId(k?.id); setShapes(k?.shapes ?? []); setNote(k?.note ?? ''); setPast([]); setFuture([]); setSel(null); setDirty(false);
  };
  useEffect(() => { load(s?.sketches?.[0]); setPrompt(''); }, [s?.id]);

  const commit = (next: SketchShape[]) => { setPast((h) => [...h.slice(-80), shapes]); setFuture([]); setShapes(next); setDirty(true); };
  const undo = () => { if (!past.length) return; setFuture((f) => [shapes, ...f]); setShapes(past[past.length - 1]); setPast(past.slice(0, -1)); setDirty(true); };
  const redo = () => { if (!future.length) return; setPast((h) => [...h, shapes]); setShapes(future[0]); setFuture(future.slice(1)); setDirty(true); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.shiftKey ? redo() : undo(); e.preventDefault(); return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { commit(shapes.filter((x) => x.id !== sel)); setSel(null); e.preventDefault(); return; }
      const t = KEYS[e.key.toLowerCase()];
      if (t && !e.altKey && !e.metaKey && !e.ctrlKey) setTool(t);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pt = (e: RPointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: Math.round(((e.clientX - r.left) / r.width) * size[0]), y: Math.round(((e.clientY - r.top) / r.height) * size[1]) };
  };
  const down = (e: RPointerEvent<SVGSVGElement>) => {
    const { x, y } = pt(e);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (tool === 'select') {
      const handle = (e.target as Element).getAttribute('data-handle') as 'p1' | 'p2' | null;
      const hit = handle && sel ? shapes.find((z) => z.id === sel) : [...shapes].reverse().find((z) => near(z, x, y) < 14);
      setSel(hit?.id ?? null);
      if (hit) { setPast((h) => [...h.slice(-80), shapes]); setFuture([]); drag.current = { id: hit.id, mode: handle ?? 'move', x, y, orig: hit }; }
      return;
    }
    if (tool === 'text') {
      const text = window.prompt('Label (e.g. JESUS, tomb, crowd)');
      if (text?.trim()) commit([...shapes, { id: uid(), tool: 'text', x1: x, y1: y, x2: x, y2: y, text: text.trim() }]);
      return;
    }
    setDraft({ id: uid(), tool, x1: x, y1: y, x2: x, y2: y });
  };
  const move = (e: RPointerEvent<SVGSVGElement>) => {
    const { x, y } = pt(e);
    if (draft) { setDraft({ ...draft, x2: x, y2: y }); return; }
    const d = drag.current;
    if (!d) return;
    const dx = x - d.x, dy = y - d.y, o = d.orig;
    const next = d.mode === 'move' ? { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy } : d.mode === 'p1' ? { ...o, x1: o.x1 + dx, y1: o.y1 + dy } : { ...o, x2: o.x2 + dx, y2: o.y2 + dy };
    setShapes((all) => all.map((z) => z.id === d.id ? next : z));
    setDirty(true);
  };
  const up = () => {
    if (draft) {
      const big = Math.hypot(draft.x2 - draft.x1, draft.y2 - draft.y1) > 8;
      // a click with the figure tool drops a standing figure 300 tall
      const shape = big ? draft : draft.tool === 'figure' ? { ...draft, y2: draft.y1 + 300 } : null;
      if (shape) commit([...shapes, shape]);
      setDraft(null);
    }
    drag.current = null;
  };

  const save = async (): Promise<string | undefined> => {
    if (!p || !s) return;
    const k = await run(() => api.post<Sketch>(p.id, 'sketch', { shotId: s.id, sketchId, shapes, note, png: toPng(shapes, size) }), dirty ? 'Sketch saved' : undefined);
    if (k) { setSketchId(k.id); setDirty(false); }
    return k?.id;
  };
  const generate = async () => {
    if (!p || !s || !shapes.length) return;
    const id = dirty || !sketchId ? await save() : sketchId;
    if (!id) return;
    await run(() => api.post(p.id, 'sketch-frames', { shotId: s.id, sketchId: id, count, prompt: prompt.trim() || undefined, follow, engine }), `${count} frame${count > 1 ? 's' : ''} queued from the sketch`);
  };

  const frames = useMemo(() => (s?.storyboard ?? []).filter((f) => f.sketchId), [s?.storyboard]);
  const traceFrame = s?.storyboard.find((f) => f.id === s.selectedFrame) ?? s?.storyboard[0];
  const active = jobs.filter((j) => j.ref?.shotId === s?.id && j.kind === 'storyboard' && ['queued', 'waiting-gpu', 'running'].includes(j.status));
  if (!p || !q) return null;
  if (!s) return <Cols><Col><Card title="Sketch"><Empty>Add a shot first (Story or Storyboard), then sketch it here.</Empty></Card></Col></Cols>;
  const selShape = shapes.find((z) => z.id === sel);
  const all = draft ? [...shapes, draft] : shapes;

  return (
    <Cols className="g-sketch">
      <Col fixed={300}>
        <Card id="sketch-shots" title={q.title} icon={<ListVideo size={15} />} pad={false}>
          <ul className="rail">
            {q.shots.map((x, i) => (
              <li key={x.id} className={x.id === s.id ? 'on' : ''} onClick={() => { if (dirty && !confirm('Leave this sketch without saving?')) return; select(q.id, x.id); }}>
                <span className="num">{String(i + 1).padStart(2, '0')}</span>
                {x.sketches?.[0]?.image ? <img className="thumb wide paper" src={media(p.id, x.sketches[0].image)} /> : <span className="thumb wide ph" />}
                <div className="grow"><b>{x.title}</b><span className="muted small">{x.sketches?.length ?? 0} sketches</span></div>
              </li>
            ))}
          </ul>
        </Card>
        <Card grow={0.7} id="sketch-list" title="Sketches" icon={<Layers size={15} />} actions={<Btn small onClick={() => { if (dirty && !confirm('Start over without saving?')) return; load(undefined); }}><Plus size={13} />New</Btn>}>
          {!s.sketches?.length ? <Empty>No sketches for this shot yet.</Empty> : (
            <div className="sketch-list">
              {s.sketches.map((k) => (
                <div key={k.id} className={`sketch-item ${k.id === sketchId ? 'on' : ''}`} onClick={() => { if (dirty && !confirm('Open another sketch without saving?')) return; load(k); }}>
                  {k.image ? <img className="paper" src={media(p.id, k.image)} /> : <div className="ph" />}
                  <span className="muted small">{fmtTime(k.at)}</span>
                  <button className="icon-btn danger" title="Delete sketch" onClick={(e) => { e.stopPropagation(); ops([{ op: 'remove', path: ['sequences', q.id, 'shots', s.id, 'sketches', k.id] }]); if (k.id === sketchId) load(undefined); }}><Trash2 size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </Card>
      </Col>

      <Col w={2.4}>
        <Card id="sketch-canvas" title={`Sketch · ${s.title}${dirty ? ' ·  unsaved' : ''}`} icon={<PenTool size={15} />} pad={false} collapsible={false}
          actions={<>
            <div className="toolbar">
              {TOOLS.map(([t, Icon, label]) => <button key={t} className={`tool ${tool === t ? 'on' : ''}`} title={label} onClick={() => setTool(t)}><Icon size={16} /></button>)}
              <span className="sep" />
              <button className="tool" title="Undo (Ctrl+Z)" onClick={undo} disabled={!past.length}><Undo2 size={16} /></button>
              <button className="tool" title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!future.length}><Redo2 size={16} /></button>
              <button className="tool" title="Delete the selected shape (Del)" onClick={() => { if (sel) { commit(shapes.filter((x) => x.id !== sel)); setSel(null); } }} disabled={!sel}><Trash2 size={16} /></button>
              <span className="sep" />
              <button className={`tool ${grid ? 'on' : ''}`} title="Thirds grid" onClick={() => setGrid(!grid)}><Grid3x3 size={16} /></button>
              <button className={`tool ${trace ? 'on' : ''}`} title="Trace over the shot's storyboard frame" onClick={() => setTrace(!trace)} disabled={!traceFrame}><ImageIcon size={16} /></button>
            </div>
            <Btn small onClick={() => { if (shapes.length && confirm('Clear the whole drawing?')) commit([]); }}>Clear</Btn>
            <Btn small kind="solid" onClick={save} disabled={!shapes.length}><Save size={13} />Save</Btn>
          </>}>
          <div className="sketch-stage">
            <div className="paper-wrap" style={{ aspectRatio: `${size[0]} / ${size[1]}`, width: `min(100cqw, calc(100cqh * ${(size[0] / size[1]).toFixed(4)}))` }}>
              {trace && traceFrame ? <img className="trace" src={media(p.id, traceFrame.file)} /> : null}
              <svg ref={svg} className={`paper-svg tool-${tool}`} viewBox={`0 0 ${size[0]} ${size[1]}`} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up}>
                {grid ? <g className="thirds">{[1, 2].map((i) => <g key={i}><line x1={(size[0] * i) / 3} y1={0} x2={(size[0] * i) / 3} y2={size[1]} /><line x1={0} y1={(size[1] * i) / 3} x2={size[0]} y2={(size[1] * i) / 3} /></g>)}</g> : null}
                {all.map((z) => (
                  <g key={z.id} className={`shape ${z.id === sel ? 'sel' : ''}`} strokeWidth={z.width ?? 6}>
                    {prims(z).map((pr, i) => pr.k === 'line' ? <line key={i} x1={pr.x1} y1={pr.y1} x2={pr.x2} y2={pr.y2} />
                      : pr.k === 'circle' ? <circle key={i} cx={pr.cx} cy={pr.cy} r={pr.r} />
                      : pr.k === 'rect' ? <rect key={i} x={pr.x} y={pr.y} width={pr.w} height={pr.h} />
                      : <text key={i} x={pr.x} y={pr.y} fontSize={pr.size}>{pr.text}</text>)}
                  </g>
                ))}
                {selShape && selShape.tool !== 'text' ? <>
                  <circle className="handle" data-handle="p1" cx={selShape.x1} cy={selShape.y1} r={12} />
                  <circle className="handle" data-handle="p2" cx={selShape.x2} cy={selShape.y2} r={12} />
                </> : null}
              </svg>
              {!shapes.length && !draft ? <div className="paper-hint">Drag from head to feet to place a stick figure · L line · B box · C circle · A arrow · T label · V select</div> : null}
            </div>
          </div>
        </Card>
      </Col>

      <Col w={1}>
        <Card id="sketch-generate" title="Frames from the sketch" icon={<Sparkles size={15} />}>
          <div className="form">
            <Field label="What the sketch shows" hint="who is who, what the boxes are">
              <textarea rows={3} value={note} placeholder="Left figure is Jesus, arms raised. Right, Martha kneeling. The tall box is the tomb." onChange={(e) => { setNote(e.target.value); setDirty(true); }} />
            </Field>
            <Field label="Prompt" hint="empty uses the shot's prompt">
              <textarea rows={4} value={prompt} placeholder={s.prompt || s.action || 'The scene, as it should look'} onChange={(e) => setPrompt(e.target.value)} />
            </Field>
            <Field label="Follow the sketch"><Segmented value={follow} onChange={setFollow} options={[['exact', 'Exactly'], ['loose', 'As layout'], ['idea', 'As an idea']]} /></Field>
            <div className="form-row">
              <Field label="Frames"><Segmented value={String(count) as any} onChange={(v: string) => setCount(Number(v))} options={[['1', '1'], ['2', '2'], ['3', '3'], ['4', '4']]} /></Field>
              <Expert><Field label="Engine"><Segmented value={engine} onChange={setEngine} options={[['comfy', 'Qwen-Image'], ['grok', 'Grok Imagine']]} /></Field></Expert>
            </div>
            <Btn kind="primary" onClick={generate} disabled={!shapes.length}><Sparkles size={14} />Generate {count} frame{count > 1 ? 's' : ''}</Btn>
            <p className="muted small">Qwen-Image on OmiPC sees the drawing as a reference and paints the real scene from it, through the GPU queue. Pick a frame below to make it the shot's storyboard frame and the start of its next take.</p>
            {active.length ? <p className="small"><span className="tag tag-running">{active.length} queued</span> {active[0].note}</p> : null}
          </div>
        </Card>
        <Card id="sketch-frames" title={`From sketches (${frames.length})`} icon={<ImageIcon size={15} />}>
          {!frames.length ? <Empty>Frames made from your sketches land here.</Empty> : (
            <div className="frame-pick">
              {frames.map((f) => (
                <div key={f.id} className={`fp ${f.id === s.selectedFrame ? 'on' : ''}`}>
                  <img src={media(p.id, f.file)} onClick={() => ops([{ op: 'set', path: ['sequences', q.id, 'shots', s.id, 'selectedFrame'], value: f.id }])} />
                  <div className="fp-row">
                    <span className="muted small">{fmtTime(f.at)}</span>
                    {f.id === s.selectedFrame ? <span className="take-chosen"><Star size={11} />storyboard</span> : <Btn small onClick={() => ops([{ op: 'set', path: ['sequences', q.id, 'shots', s.id, 'selectedFrame'], value: f.id }])}>Use</Btn>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {frames.length ? <Btn small onClick={() => setTab('shot')}>Open the shot to make a take</Btn> : null}
        </Card>
      </Col>
    </Cols>
  );
}
