import { Users, Palette, Plus, RefreshCw, Trash2, Upload, Sparkles, History, Box } from 'lucide-react';
import { api, media } from '../api';
import { useStudio } from '../store';
import { Card, Btn, Edit, Field, Empty, Expert, Cols, Col, Select } from '../ui';
import { DEFAULT_MODEL, type Character, type CharacterModel, type Project } from '../../../shared/types';
import type { Op } from '../api';

// The character's 3D model: the figure every greybox builds for them, with its turnaround render.
function ModelEditor({ p, c, ops }: { p: Project; c: Character; ops: (o: Op[]) => void }) {
  const m: CharacterModel = { ...DEFAULT_MODEL, ...(c.model ?? {}) };
  const set = (patch: Partial<CharacterModel>) => ops([{ op: 'set', path: ['cast', c.id, 'model'], value: { ...m, ...patch } }]);
  const opts = (xs: string[]) => xs.map((x) => [x, x] as [string, string]);
  return (
    <div className="model-ed">
      <div className="form-row">
        <Field label="Height m"><Edit type="number" step={0.05} value={m.height} onSave={(v) => set({ height: Math.max(0.5, Math.min(8, Number(v) || 1.75)) })} /></Field>
        <Field label="Build"><Select value={m.build} onChange={(v) => set({ build: v as any })} options={opts(['slight', 'average', 'broad', 'gaunt', 'colossal'])} /></Field>
        <Field label="Costume"><Select value={m.costume} onChange={(v) => set({ costume: v as any })} options={opts(['robe', 'tunic', 'rags', 'loincloth', 'regal', 'shroud', 'armor'])} /></Field>
        <Field label="Colour"><input type="color" value={m.color} onChange={(e) => set({ color: e.target.value })} /></Field>
      </div>
      <div className="form-row">
        <Field label="Hair"><Select value={m.hair ?? 'short'} onChange={(v) => set({ hair: v as any })} options={opts(['none', 'short', 'long'])} /></Field>
        <Field label="Carries"><Select value={m.carry ?? 'none'} onChange={(v) => set({ carry: v as any })} options={opts(['none', 'cross', 'crossbeam', 'lyre', 'staff', 'chains', 'keys'])} /></Field>
        <Field label="Light" hint="0-1"><Edit type="number" step={0.1} value={m.glow ?? 0} onSave={(v) => set({ glow: Math.max(0, Math.min(1, Number(v) || 0)) })} /></Field>
        <Field label="Crowd" hint="figures"><Edit type="number" step={1} value={m.crowd ?? 0} onSave={(v) => set({ crowd: Math.max(0, Math.min(60, Math.round(Number(v) || 0))) })} /></Field>
      </div>
      <div className="chips">
        {(['beard', 'crown', 'wings'] as const).map((k) => <button key={k} className={`chip toggle ${m[k] ? 'on' : ''}`} onClick={() => set({ [k]: !m[k] } as any)}>{k}</button>)}
      </div>
    </div>
  );
}

export function Cast() {
  const { project: p, ops, run, jobs } = useStudio();
  if (!p) return null;
  const busy = (ref: string) => jobs.some((j) => (j.ref?.castId === ref || j.ref?.lookId === ref) && ['queued', 'waiting-gpu', 'running'].includes(j.status));
  const used = (id: string) => p.sequences.reduce((n, q) => n + q.shots.filter((s) => s.castIds.includes(id)).length, 0);

  return (
    <Cols className="g-cast">
      <Col w={1.6}>
      <Card area="cast" id="cast" title={`Characters (${p.cast.length})`} icon={<Users size={15} />} actions={<>
          <Btn small onClick={() => run(() => api.post(p.id, 'cast-all', { what: 'sheet', missingOnly: true }), 'Missing sheets queued')}><RefreshCw size={13} />Missing sheets</Btn>
          <Btn small onClick={() => run(() => api.post(p.id, 'cast-all', { what: 'model', missingOnly: false }), 'Every model queued')}><Box size={13} />Build all models</Btn>
          <Btn small onClick={() => run(() => api.post(p.id, 'cast-all', { what: 'portrait', missingOnly: false }), 'Portraits queued')}><RefreshCw size={13} />Portraits from sheets</Btn>
          <Btn small onClick={() => ops([{ op: 'insert', path: ['cast'], value: {} }])}><Plus size={13} />Character</Btn></>}>
        <p className="muted small lead">A character's sheet rides along as a reference on every still and take they are in, so the same face, build and costume carry from shot to shot. Their model is the figure Blender builds for them in every greybox.</p>
        {p.cast.length === 0 ? <Empty>No characters yet.</Empty> : (
          <div className="cast-grid">
            {p.cast.map((c) => (
              <article key={c.id} className="cast-card">
                <div className="cast-pics">
                  <div className="cast-sheet" title="Character sheet">
                    {c.sheet ? <img src={media(p.id, c.sheet)} /> : <div className="ph">{c.name[0]}</div>}
                    <span className="pic-tag">sheet</span>
                  </div>
                  {c.portrait ? <div className="cast-sheet" title="Portrait: the single view stills use"><img src={media(p.id, c.portrait)} /><span className="pic-tag">portrait</span></div> : null}
                  <div className="cast-sheet" title="3D model in the greybox">
                    {c.model?.render ? <img src={media(p.id, c.model.render)} /> : <div className="ph"><Box size={28} /></div>}
                    <span className="pic-tag">model</span>
                  </div>
                  {busy(c.id) ? <span className="busy-veil">working…</span> : null}
                </div>
                <div className="cast-body">
                  <Edit value={c.name} onSave={(v) => ops([{ op: 'set', path: ['cast', c.id, 'name'], value: v }])} />
                  <Edit multiline rows={4} value={c.description} onSave={(v) => ops([{ op: 'set', path: ['cast', c.id, 'description'], value: v }])} placeholder="Face, age, build, hair, costume: what never changes" />
                  <span className="muted small">in {used(c.id)} shots</span>
                  <ModelEditor p={p} c={c} ops={ops} />
                  <div className="row-actions">
                    <Btn small kind="solid" onClick={() => run(() => api.post(p.id, 'sheet', { castId: c.id }), 'Sheet queued')}><RefreshCw size={13} />{c.sheet ? 'New sheet' : 'Make sheet'}</Btn>
                    <Btn small onClick={() => run(() => api.post(p.id, 'model', { castId: c.id }), 'Model render queued')}><Box size={13} />{c.model?.render ? 'Rebuild model' : 'Build model'}</Btn>
                    <Expert><Btn small onClick={() => run(() => api.post(p.id, 'sheet', { castId: c.id, engine: 'grok' }), 'Grok sheet queued')}><Sparkles size={13} />Grok</Btn></Expert>
                    <label className="btn btn-ghost btn-sm file-btn" title="Use your own sheet"><Upload size={13} /><input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const file = await run(() => api.upload(p.id, 'cast', f)); if (file) ops([{ op: 'set', path: ['cast', c.id, 'sheets'], value: [c.sheet, ...(c.sheets ?? [])].filter(Boolean) }, { op: 'set', path: ['cast', c.id, 'sheet'], value: file }]); }} /></label>
                    <span className="grow" />
                    <button className="icon-btn danger" title="Delete character" onClick={() => confirm(`Delete ${c.name}?`) && ops([{ op: 'remove', path: ['cast', c.id] }])}><Trash2 size={13} /></button>
                  </div>
                  {c.sheets?.length ? (
                    <div className="frame-strip" title="Earlier sheets; click to bring one back">
                      <History size={12} />
                      {c.sheets.slice(0, 6).map((f) => <img key={f} src={media(p.id, f)} onClick={() => ops([{ op: 'set', path: ['cast', c.id, 'sheets'], value: [c.sheet, ...(c.sheets ?? []).filter((x) => x !== f)].filter(Boolean) }, { op: 'set', path: ['cast', c.id, 'sheet'], value: f }])} />)}
                    </div>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>

      </Col>

      <Col w={1}>

      <Card area="looks" id="looks" title={`Looks (${p.looks.length})`} icon={<Palette size={15} />} actions={<Btn small onClick={() => ops([{ op: 'insert', path: ['looks'], value: {} }])}><Plus size={13} />Look</Btn>}>
        <p className="muted small lead">A look image sets palette, light and texture for a sequence. Pick it per sequence in the Storyboard's continuity card.</p>
        {p.looks.length === 0 ? <Empty>No looks yet.</Empty> : (
          <div className="look-grid">
            {p.looks.map((l) => (
              <article key={l.id} className="look-card">
                <div className="look-pic">{l.image ? <img src={media(p.id, l.image)} /> : <div className="ph" />}{busy(l.id) ? <span className="busy-veil">painting…</span> : null}</div>
                <Edit value={l.name} onSave={(v) => ops([{ op: 'set', path: ['looks', l.id, 'name'], value: v }])} />
                <Field label="In words"><Edit multiline rows={3} value={l.prompt} onSave={(v) => ops([{ op: 'set', path: ['looks', l.id, 'prompt'], value: v }])} placeholder="Low warm sun, long shadows, dusty air, muted ochre and olive" /></Field>
                <div className="row-actions">
                  <Btn small kind="solid" disabled={!l.prompt.trim()} onClick={() => run(() => api.post(p.id, 'look', { lookId: l.id }), 'Look queued')}><RefreshCw size={13} />Paint it</Btn>
                  <label className="btn btn-ghost btn-sm file-btn"><Upload size={13} /><input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; const file = await run(() => api.upload(p.id, 'looks', f)); if (file) ops([{ op: 'set', path: ['looks', l.id, 'image'], value: file }]); }} /></label>
                  <span className="grow" />
                  <button className="icon-btn danger" onClick={() => confirm(`Delete look ${l.name}?`) && ops([{ op: 'remove', path: ['looks', l.id] }])}><Trash2 size={13} /></button>
                </div>
              </article>
            ))}
          </div>
        )}
      </Card>
      </Col>
    </Cols>
  );
}
