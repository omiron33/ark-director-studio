// The video type of a film: every flag the Ark engine has, in one card. Basic picks one of the video
// types; Expert sets each flag. Cohesion follows the type: on for generated pictures, relaxed for code.
import { Clapperboard } from 'lucide-react';
import { useStudio } from './store';
import { Card, Field, Segmented, Select, Expert } from './ui';
import { VIDEO_TYPES, withRender, cohesionOn, videoTypeOf, type Project, type RenderSetup } from '../../shared/types';

export function VideoTypePicker({ value, onPick, compact }: { value?: string; onPick: (id: string) => void; compact?: boolean }) {
  return (
    <div className={`vt-grid ${compact ? 'compact' : ''}`}>
      {VIDEO_TYPES.map((v) => (
        <button key={v.id} className={`vt ${value === v.id ? 'on' : ''}`} onClick={() => onPick(v.id)} title={v.blurb}>
          <b>{v.label}</b>
          {compact ? null : <span>{v.blurb}</span>}
        </button>
      ))}
    </div>
  );
}

export function RenderCard({ p, grow = 1 }: { p: Project; grow?: number }) {
  const { ops } = useStudio();
  const r = withRender(p.render);
  const setR = (patch: Partial<RenderSetup>) => ops([{ op: 'set', path: ['render'], value: withRender({ ...r, ...patch, photoreal: { ...r.photoreal, ...(patch.photoreal ?? {}) } }) }]);
  const setP = (k: keyof RenderSetup['photoreal'], v: unknown) => setR({ photoreal: { ...r.photoreal, [k]: v } as any });
  const pick = (id: string) => {
    const vt = VIDEO_TYPES.find((v) => v.id === id)!;
    ops([{ op: 'set', path: ['kind'], value: vt.kind }, { op: 'set', path: ['render'], value: withRender({ ...r, ...vt.render }) }]);
  };
  const generated = r.look !== 'code';
  const cohesive = cohesionOn(r);
  return (
    <Card grow={grow} id="render-setup" title="Video type" icon={<Clapperboard size={15} />}
      actions={<span className={`pill ${cohesive ? 'pill-amber' : 'pill-cyan'}`} title="Character sheets on every take, one continuity plan per sequence, each take starting from the last frame">{cohesive ? 'Shot cohesion on' : 'Cohesion relaxed (code)'}</span>}>
      <div className="form">
        <VideoTypePicker value={videoTypeOf(p.kind, r)} onPick={pick} compact />
        <Expert>
          <div className="form-row">
            <Field label="Pictures"><Select value={r.look} onChange={(v) => setR({ look: v as any })} options={[['code', 'Pure code'], ['photoreal', 'Photoreal repaint (H3)'], ['mixed', 'Music video mix'], ['live', 'Live action (H3)']]} /></Field>
            <Field label="Code tier"><Segmented value={r.tier} onChange={(v) => setR({ tier: v })} options={[['fast', 'Fast'], ['standard', 'Standard'], ['premium', 'Premium'], ['ultra', 'Ultra']]} /></Field>
          </div>
          <div className="form-row">
            <Field label="Resolution"><Segmented value={r.resolution} onChange={(v) => setR({ resolution: v })} options={[['1920x1080', '1080p'], ['3840x2160', '4K']]} /></Field>
            <Field label="Words"><Segmented value={r.words} onChange={(v) => setR({ words: v })} options={[['in-scene', 'In the scene'], ['overlay', 'Over the picture'], ['none', 'None']]} /></Field>
            <Field label="Shot cohesion"><Segmented value={r.cohesion} onChange={(v) => setR({ cohesion: v })} options={[['auto', 'Auto'], ['on', 'On'], ['off', 'Off']]} /></Field>
          </div>
          {generated ? (
            <>
              <div className="form-row">
                <Field label="Long takes"><Segmented value={r.photoreal.chain} onChange={(v) => setP('chain', v)} options={[['bridges', 'Bridges'], ['continuum', 'Continuum (trial)']]} /></Field>
                <Field label="Style reference"><Segmented value={r.photoreal.styleRef} onChange={(v) => setP('styleRef', v)} options={[['none', 'Prompt only'], ['code', 'Code frame'], ['image', 'Look image']]} /></Field>
              </div>
              <div className="form-row">
                <Field label="Steps"><input type="number" value={r.photoreal.steps} onChange={(e) => setP('steps', Number(e.target.value) || 20)} /></Field>
                <Field label="Steered steps" hint="code or greybox"><input type="number" value={r.photoreal.keep} onChange={(e) => setP('keep', Number(e.target.value) || 5)} /></Field>
                <Field label="Proxy blur"><input type="number" step={0.5} value={r.photoreal.proxyBlur} onChange={(e) => setP('proxyBlur', Number(e.target.value) || 0)} /></Field>
              </div>
              <label className="check"><input type="checkbox" checked={r.photoreal.tuck} onChange={(e) => setP('tuck', e.target.checked)} />Words tuck behind nearer things H3 paints</label>
            </>
          ) : null}
          {r.look === 'mixed' ? <label className="check"><input type="checkbox" checked={r.popcam} onChange={(e) => setR({ popcam: e.target.checked })} />Pop-video camera on the beat</label> : null}
          <label className="check"><input type="checkbox" checked={r.local} onChange={(e) => setR({ local: e.target.checked })} />Render code scenes on the Mac only (--local)</label>
        </Expert>
        <p className="muted small">
          {r.look === 'code' ? `Pure code at the ${r.tier} tier, ${r.resolution === '3840x2160' ? '4K' : '1080p'}. Every frame is drawn from song time, so shots stay put; sheets and chaining are off unless you turn cohesion on.`
            : r.look === 'live' ? 'Live action from H3: character sheets, the sequence plan and last-frame chaining ride along on every take.'
            : r.look === 'mixed' ? `Code shots at the ${r.tier} tier cut with H3 shots; the generated shots keep cohesion.`
            : `Code scenes at the ${r.tier} tier steer H3 for ${r.photoreal.keep} of ${r.photoreal.steps} steps; long takes join with ${r.photoreal.chain}.`}
        </p>
      </div>
    </Card>
  );
}
