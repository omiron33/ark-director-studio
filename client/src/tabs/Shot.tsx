import { useEffect, useState } from 'react';
import { Film, Settings2, Play, Trash2, Star, RefreshCw, Sparkles, X, ListVideo, Box, Image as ImageIcon } from 'lucide-react';
import { api, media } from '../api';
import { useStudio, useSelection, fmtTime } from '../store';
import { Card, Btn, Edit, Select, Field, Segmented, Expert, Basic, Empty, Media, StatusTag, Cols, Col } from '../ui';
import { CAMERA_PRESETS, cohesionOn } from '../../../shared/types';

export function ShotTab() {
  const { project: p, seq: q, shot: s } = useSelection();
  const { ops, run, select, setTab, jobs } = useStudio();
  const [inputs, setInputs] = useState<{ start?: string; startWhy: string; look?: string; sheets: string[]; guide?: string } | null>(null);
  const [startMode, setStartMode] = useState<'auto' | 'frame' | 'none'>('auto');
  const [engine, setEngine] = useState<'h3' | 'grok'>('h3');
  const [seed, setSeed] = useState('');
  const [steps, setSteps] = useState('20');
  const [keep, setKeep] = useState('5');
  const [useGuide, setUseGuide] = useState(true);
  const [viewing, setViewing] = useState<string | undefined>();
  useEffect(() => { if (p && s) api.takeInputs(p.id, s.id).then(setInputs).catch(() => setInputs(null)); }, [p?.updated, s?.id]);
  useEffect(() => { setViewing(undefined); setEngine(s?.source === 'grok' ? 'grok' : 'h3'); }, [s?.id]);
  if (!p || !q) return null;
  if (!s) return <Cols><Col><Card area="list" title="Shots"><Empty>This sequence has no shots yet.</Empty></Card></Col></Cols>;

  const base = ['sequences', q.id, 'shots', s.id];
  const set = (k: (string | number)[], value: unknown) => ops([{ op: 'set', path: [...base, ...k], value }]);
  const frame = s.storyboard.find((f) => f.id === s.selectedFrame) ?? s.storyboard[0];
  const selected = s.takes.find((t) => t.id === (viewing ?? s.selectedTake)) ?? s.takes.find((t) => t.status === 'done');
  const go = () => run(() => api.post(p.id, 'take', {
    shotId: s.id,
    opts: { engine, start: startMode === 'auto' ? undefined : startMode, guide: useGuide, ...(seed ? { seed: Number(seed) } : {}), steps: Number(steps) || 20, keep: Number(keep) || 5 },
  }), engine === 'grok' ? 'Grok Imagine take queued' : 'H3 take queued');
  const active = jobs.filter((j) => j.ref?.shotId === s.id && ['queued', 'waiting-gpu', 'running'].includes(j.status));

  return (
    <Cols className="g-shot">
      <Col fixed={320}>
      <Card area="list" id="shot-list" title={q.title} icon={<ListVideo size={15} />} pad={false}>
        <ul className="rail">
          {q.shots.map((x, i) => {
            const f = x.storyboard.find((ff) => ff.id === x.selectedFrame) ?? x.storyboard[0];
            return (
              <li key={x.id} className={x.id === s.id ? 'on' : ''} onClick={() => select(q.id, x.id)}>
                <span className="num">{String(i + 1).padStart(2, '0')}</span>
                {f ? <img className="thumb wide" src={media(p.id, f.file)} /> : <span className="thumb wide ph" />}
                <div className="grow"><b>{x.title}</b><span className="muted small">{x.duration}s · {x.takes.filter((t) => t.status === 'done').length} takes</span></div>
              </li>
            );
          })}
        </ul>
      </Card>

      </Col>

      <Col w={1.8}>

      <Card area="preview" id="shot-preview" title={selected ? `Take · ${fmtTime(selected.at)}` : 'Storyboard frame'} icon={<Play size={15} />} pad={false}
        actions={selected && selected.id !== s.selectedTake && selected.status === 'done' ? <Btn small kind="solid" onClick={() => set(['selectedTake'], selected.id)}><Star size={13} />Use this take</Btn> : null}>
        <div className="stage">
          {selected?.file ? <Media key={selected.file} src={media(p.id, selected.file)} video poster={media(p.id, frame?.file)} /> : <Media src={media(p.id, frame?.file)} />}
        </div>
      </Card>

      <Card grow={0.42} area="takes" id="shot-takes" title={`Takes (${s.takes.length})`} icon={<Film size={15} />} pad={false}>
        {s.takes.length === 0 ? <Empty>No takes yet. Generate one on the right.</Empty> : (
          <div className="take-strip">
            {s.takes.map((t) => (
              <div key={t.id} className={`take ${t.id === s.selectedTake ? 'chosen' : ''} ${t.id === selected?.id ? 'viewing' : ''}`} onClick={() => setViewing(t.id)}>
                <div className="take-pic">
                  {t.lastFrame ? <img src={media(p.id, t.lastFrame)} /> : t.startFrom ? <img className="dim" src={media(p.id, t.startFrom)} /> : <div className="ph" />}
                  <StatusTag s={t.status} />
                  {t.id === s.selectedTake ? <span className="take-chosen"><Star size={11} />in the cut</span> : null}
                </div>
                <div className="take-meta">
                  <span>{t.engine.toUpperCase()}{t.seed !== undefined ? ` · ${t.seed}` : ''}</span>
                  <span className="muted">{fmtTime(t.at)}</span>
                </div>
                {t.error ? <p className="err small clamp2" title={t.error}>{t.error}</p> : null}
                <div className="take-actions" onClick={(e) => e.stopPropagation()}>
                  {[1, 2, 3, 4, 5].map((r) => <button key={r} className={`star ${(t.rating ?? 0) >= r ? 'on' : ''}`} onClick={() => ops([{ op: 'set', path: [...base, 'takes', t.id, 'rating'], value: r }])}>★</button>)}
                  <span className="grow" />
                  {['queued', 'running'].includes(t.status) && t.jobId ? <button className="icon-btn" title="Cancel" onClick={() => run(() => api.cancel(t.jobId!), 'Cancelling')}><X size={13} /></button> : null}
                  <button className="icon-btn danger" title="Delete take" onClick={() => ops([{ op: 'remove', path: [...base, 'takes', t.id] }, ...(s.selectedTake === t.id ? [{ op: 'set' as const, path: [...base, 'selectedTake'], value: undefined }] : [])])}><Trash2 size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      </Col>

      <Col w={1}>

      <Card area="settings" id="shot-settings" title="Shot" icon={<Settings2 size={15} />}>
        <div className="form">
          <Field label="Title"><Edit value={s.title} onSave={(v) => set(['title'], v)} /></Field>
          <Field label="What happens"><Edit multiline rows={3} value={s.action} onSave={(v) => set(['action'], v)} /></Field>
          <Field label="Prompt" hint="the words the model gets; empty uses what happens"><Edit multiline rows={6} value={s.prompt} onSave={(v) => set(['prompt'], v)} /></Field>
          <div className="form-row">
            <Field label="Length" hint="seconds"><Edit type="number" step={0.5} value={s.duration} onSave={(v) => set(['duration'], Math.min(15, Math.max(1, Number(v) || 6)))} /></Field>
            <Field label="Camera"><Select value={s.camera.preset} onChange={(v) => set(['camera', 'preset'], v)} options={Object.entries(CAMERA_PRESETS).map(([k, c]) => [k, c.label])} /></Field>
          </div>
          <Expert>
            <div className="form-row">
              <Field label="Lens"><Edit value={s.camera.lens ?? ''} onSave={(v) => set(['camera', 'lens'], v || undefined)} placeholder={CAMERA_PRESETS[s.camera.preset]?.lens} /></Field>
              <Field label="Move"><Edit value={s.camera.move ?? ''} onSave={(v) => set(['camera', 'move'], v || undefined)} placeholder="slow push in" /></Field>
            </div>
            <div className="form-row">
              <Field label="Source"><Select value={s.source} onChange={(v) => set(['source'], v)} options={[['h3', 'H3 live action'], ['grok', 'Grok Imagine'], ['code', 'Ark code'], ['still', 'Still']]} /></Field>
              <Field label="Look"><Select value={s.lookId ?? ''} onChange={(v) => set(['lookId'], v || undefined)} options={[['', 'Sequence look'], ...p.looks.map((l) => [l.id, l.name] as [string, string])]} /></Field>
            </div>
            <Field label="Dialogue or lyric"><Edit multiline rows={2} value={s.dialogue ?? s.lyric ?? ''} onSave={(v) => set([s.lyric !== undefined ? 'lyric' : 'dialogue'], v || undefined)} /></Field>
          </Expert>
          <Field label="Characters">
            <div className="chips">
              {p.cast.map((c) => {
                const on = s.castIds.includes(c.id);
                return <button key={c.id} className={`chip toggle ${on ? 'on' : ''}`} onClick={() => set(['castIds'], on ? s.castIds.filter((x) => x !== c.id) : [...s.castIds, c.id])}>{c.name}</button>;
              })}
            </div>
          </Field>
          {cohesionOn(p.render)
            ? <label className="check"><input type="checkbox" checked={s.chainFromPrevious} onChange={(e) => set(['chainFromPrevious'], e.target.checked)} />Start from the previous shot's last frame</label>
            : <p className="muted small">Code film: shot cohesion is relaxed, so takes don't chain or carry character sheets (turn it on under Ark engine, Video type).</p>}
        </div>
      </Card>

      <Card grow={0.8} area="generate" id="shot-generate" title="Generate a take" icon={<RefreshCw size={15} />}>
        <div className="form">
          <div className="inputs-preview">
            <div><span className="field-label">Starts from</span>{inputs?.start && startMode !== 'none' ? <img src={media(p.id, startMode === 'frame' ? frame?.file : inputs.start)} /> : <span className="ph-box">nothing</span>}<em>{startMode === 'none' ? 'no start frame' : startMode === 'frame' ? 'storyboard frame' : inputs?.startWhy}</em></div>
            <div><span className="field-label">Look</span>{inputs?.look ? <img src={media(p.id, inputs.look)} /> : <span className="ph-box">none</span>}</div>
            <div><span className="field-label">Characters</span><div className="sheet-row">{inputs?.sheets.length ? inputs.sheets.map((x) => <img key={x} src={media(p.id, x)} />) : <span className="ph-box">no sheets</span>}</div></div>
            <div><span className="field-label">Greybox</span>{s.greybox?.still ? <img src={media(p.id, s.greybox.still)} onClick={() => setTab('greybox')} /> : <span className="ph-box" onClick={() => setTab('greybox')}><Box size={14} /> none</span>}</div>
          </div>
          <Basic><p className="muted small">H3, 960×544 at 24 fps, upscaled in the cut. Missing character sheets? Make them in Cast &amp; looks so every take keeps the same faces.</p></Basic>
          <Expert>
            <Field label="Engine"><Segmented value={engine} onChange={setEngine} options={[['h3', 'H3 (ComfyUI)'], ['grok', 'Grok Imagine']]} /></Field>
            <Field label="Start"><Segmented value={startMode} onChange={setStartMode} options={[['auto', 'Continuity'], ['frame', 'Storyboard frame'], ['none', 'None']]} /></Field>
            {engine === 'h3' ? (
              <div className="form-row">
                <Field label="Seed" hint="empty is random"><input value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ''))} /></Field>
                <Field label="Steps"><input value={steps} onChange={(e) => setSteps(e.target.value)} /></Field>
                <Field label="Guide steps" hint="greybox"><input value={keep} onChange={(e) => setKeep(e.target.value)} /></Field>
              </div>
            ) : null}
            {s.greybox?.video ? <label className="check"><input type="checkbox" checked={useGuide} onChange={(e) => setUseGuide(e.target.checked)} />Steer with the greybox clip</label> : null}
          </Expert>
          <div className="form-row">
            <Btn kind="primary" onClick={go} disabled={s.source === 'code'}><Film size={14} />{s.takes.length ? 'Regenerate take' : 'Generate take'}</Btn>
            <Btn onClick={() => run(() => api.post(p.id, 'storyboard', { shotId: s.id }), 'Frame queued')}><ImageIcon size={14} />New frame</Btn>
            <Expert><Btn onClick={() => run(() => api.post(p.id, 'storyboard', { shotId: s.id, engine: 'grok' }), 'Grok frame queued')}><Sparkles size={14} />Grok frame</Btn></Expert>
          </div>
          {s.source === 'code' ? <p className="muted small">Code shots render in the Ark engine tab at the film's tier. Frames and sketches still work here for planning.</p> : null}
          {active.map((j) => <div key={j.id} className="job-inline"><StatusTag s={j.status} /><span className="grow">{j.note}</span><button className="icon-btn" onClick={() => run(() => api.cancel(j.id))}><X size={13} /></button></div>)}
        </div>
      </Card>
      </Col>
    </Cols>
  );
}
