import { useEffect, useState } from 'react';
import { Ship, Download, Upload, Play, ScrollText } from 'lucide-react';
import { api } from '../api';
import { useStudio, useSelection, fmtTime } from '../store';
import { Card, Btn, Empty, Expert, Field, Segmented, Select, Cols, Col } from '../ui';
import { JobList } from './Queue';

const BASIC_PIPELINE = ['storyboard-draft', 'draft', 'stills', 'photoreal', 'final-check', 'critic-film'];

export function Ark() {
  const { project: p, shot } = useSelection();
  const { run, jobs, mode, status } = useStudio();
  const [stages, setStages] = useState<Record<string, { label: string; expert: boolean; gpu: boolean }>>({});
  const [only, setOnly] = useState('');
  const [chain, setChain] = useState<'bridges' | 'continuum'>('bridges');
  const [local, setLocal] = useState(false);
  const [critic, setCritic] = useState('claude');
  useEffect(() => { api.stages().then(setStages).catch(() => {}); }, []);
  if (!p) return null;
  const arkJobs = jobs.filter((j) => j.projectId === p.id && j.kind === 'ark');
  const keys = mode === 'basic' ? BASIC_PIPELINE.filter((k) => stages[k]) : Object.keys(stages);
  const stage = (k: string) => run(() => api.post(p.id, 'ark/stage', { stage: k, opts: { only: only || undefined, chain, local, agent: critic }, shotId: k === 'photoreal' && only && shot?.arkScene === only ? shot.id : undefined }), `${stages[k]?.label} started`);

  return (
    <Cols className="g-ark">
      <Col w={1}>
      <Card grow={0.35} area="link" id="ark-link" title="Ark song" icon={<Ship size={15} />}>
        {!p.ark ? (
          <Empty>This film is not linked to an Ark song folder. Open one from Films → Ark songs to work on it here; the studio then reads its film.json and writes back only the prompts.</Empty>
        ) : (
          <div className="form">
            <p><b>{p.ark.songPath.split('/').pop()}</b> on {p.ark.machine}</p>
            <p className="muted small">Engine: {status?.ark.ok ? status.ark.engine : status?.ark.error ?? '…'}</p>
            <p className="muted small">Pulled {fmtTime(p.ark.lastPull) || 'never'} · pushed {fmtTime(p.ark.lastPush) || 'never'}</p>
            <div className="form-row">
              <Btn onClick={() => run(() => api.post(p.id, 'ark/pull', {}), 'Pulled film.json')}><Download size={14} />Pull film.json</Btn>
              <Btn kind="solid" onClick={() => confirm('Write the scene and take prompts back into film.json? The old file is kept as film.json.studio-bak.') && run(async () => { const r = await api.post<{ changed: number }>(p.id, 'ark/push', {}); return r; }, 'Prompts written to film.json')}><Upload size={14} />Push prompts</Btn>
            </div>
            <p className="muted small">Pull keeps every storyboard frame and take made here. Push writes only scene prompts and take continuity plans.</p>
          </div>
        )}
      </Card>

      <Card area="stages" id="ark-stages" title={mode === 'basic' ? 'The film, step by step' : 'Engine commands'} icon={<Play size={15} />}>
        {!p.ark ? <Empty>Link an Ark song first.</Empty> : (
          <div className="form">
            <Expert>
              <div className="form-row">
                <Field label="Only scenes" hint="e.g. 07 or 03,04"><input value={only} onChange={(e) => setOnly(e.target.value)} placeholder={shot?.arkScene ?? 'all'} /></Field>
                <Field label="Long takes"><Segmented value={chain} onChange={setChain} options={[['bridges', 'Bridges'], ['continuum', 'Continuum (trial)']]} /></Field>
                <Field label="Critic"><Select value={critic} onChange={setCritic} options={[['claude', 'Claude'], ['codex', 'Codex']]} /></Field>
              </div>
              <label className="check"><input type="checkbox" checked={local} onChange={(e) => setLocal(e.target.checked)} />Render code scenes on the Mac only (--local, keeps them off OmiPC)</label>
            </Expert>
            <ol className="pipeline">
              {keys.map((k, i) => (
                <li key={k}>
                  <span className="num">{i + 1}</span>
                  <span className="grow">{stages[k].label}{stages[k].gpu ? <em className="muted small"> · uses OmiPC's GPU through its queue</em> : null}</span>
                  <Btn small kind={k === 'photoreal' ? 'solid' : 'ghost'} onClick={() => stage(k)}><Play size={12} />Run</Btn>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Card>

      </Col>

      <Col w={1.3}>

      <Card area="log" id="ark-log" title="Engine runs" icon={<ScrollText size={15} />}>
        {arkJobs.length ? (
          <>
            <JobList jobs={arkJobs.slice(0, 6)} compact />
            <pre className="log">{arkJobs[0].log.slice(-120).join('\n')}</pre>
          </>
        ) : <Empty>No engine runs yet.</Empty>}
      </Card>
      </Col>
    </Cols>
  );
}
