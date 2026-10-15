import { useEffect, useState } from 'react';
import { ListChecks, Cpu, ScrollText, X } from 'lucide-react';
import { api } from '../api';
import { useStudio, fmtTime } from '../store';
import { Card, Segmented, Empty, StatusTag, Cols, Col } from '../ui';
import type { Job } from '../../../shared/types';

export function JobList({ jobs, compact, selected, onPick }: { jobs: Job[]; compact?: boolean; selected?: string; onPick?: (id: string) => void }) {
  const { run } = useStudio();
  return (
    <ul className={`jobs ${compact ? 'compact' : ''}`}>
      {jobs.map((j) => (
        <li key={j.id} className={j.id === selected ? 'on' : ''} onClick={() => onPick?.(j.id)}>
          <StatusTag s={j.status} />
          <div className="grow">
            <b>{j.title}</b>
            <span className="muted small">{j.kind}{j.gpu ? ' · GPU' : ''} · {fmtTime(j.created)}{j.note && !['done'].includes(j.status) ? ` · ${j.note}` : ''}</span>
            {j.error ? <p className="err small clamp2">{j.error}</p> : null}
          </div>
          {['queued', 'waiting-gpu', 'running'].includes(j.status) ? <button className="icon-btn" title="Cancel" onClick={(e) => { e.stopPropagation(); run(() => api.cancel(j.id), 'Cancelling'); }}><X size={13} /></button> : null}
        </li>
      ))}
    </ul>
  );
}

export function Queue() {
  const { jobs, refreshJobs } = useStudio();
  const [filter, setFilter] = useState<'all' | 'gpu' | 'agents' | 'ark' | 'failed'>('all');
  const [pick, setPick] = useState<string>();
  const [gpu, setGpu] = useState<any>(null);
  useEffect(() => { refreshJobs(); const load = () => api.gpu().then(setGpu).catch(() => setGpu(null)); load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);
  const shown = jobs.filter((j) => filter === 'all' || (filter === 'gpu' && j.gpu) || (filter === 'agents' && (j.kind === 'agent' || j.kind === 'review')) || (filter === 'ark' && j.kind === 'ark') || (filter === 'failed' && j.status === 'failed'));
  const job = jobs.find((j) => j.id === pick) ?? shown[0];

  return (
    <Cols className="g-queue">
      <Col w={1.1}>
      <Card area="jobs" id="q-jobs" title={`Studio jobs (${shown.length})`} icon={<ListChecks size={15} />} pad={false}
        actions={<Segmented value={filter} onChange={setFilter} options={[['all', 'All'], ['gpu', 'GPU'], ['agents', 'Agents'], ['ark', 'Ark'], ['failed', 'Failed']]} />}>
        {shown.length ? <JobList jobs={shown} selected={job?.id} onPick={setPick} /> : <Empty>Nothing here.</Empty>}
      </Card>
      </Col>
      <Col w={1.2}>
      <Card area="log" id="q-log" title={job ? job.title : 'Log'} icon={<ScrollText size={15} />}>
        {job ? (
          <>
            <p className="muted small">{job.status} · started {fmtTime(job.started) || 'not yet'} · ended {fmtTime(job.ended) || '—'}</p>
            {job.error ? <pre className="err">{job.error}</pre> : null}
            <pre className="log">{job.log.join('\n') || 'No output yet.'}</pre>
            {job.result ? <pre className="log">{JSON.stringify(job.result, null, 2).slice(0, 4000)}</pre> : null}
          </>
        ) : <Empty>Pick a job.</Empty>}
      </Card>
      </Col>
      <Col fixed={480}>
      <Card area="gpu" id="q-gpu" title="GPU queue (every agent)" icon={<Cpu size={15} />}>
        {!gpu ? <Empty>Reading the GPU dashboard…</Empty> : !gpu.ok ? <Empty>GPU dashboard not reachable: {gpu.error}</Empty> : (
          <>
            <p>Control: <b className={gpu.control === 'run' ? 'ok' : 'err'}>{gpu.control}</b> · {gpu.active} running · {gpu.queued} queued</p>
            {(gpu.jobs ?? []).length === 0 ? <Empty>The GPU is free.</Empty> : (
              <ul className="jobs compact">
                {gpu.jobs.map((g: any) => <li key={g.id}><StatusTag s={g.status} /><div className="grow"><b>{g.description}</b><span className="muted small">{g.agent} · {g.tool}{g.note ? ` · ${g.note}` : ''}</span></div></li>)}
              </ul>
            )}
            <p className="muted small">Studio GPU jobs wait here for their turn and never overlap another agent's render.</p>
          </>
        )}
      </Card>
      </Col>
    </Cols>
  );
}
