import { useState } from 'react';
import { FileText, Wand2, ListTree, Plus, Trash2, Upload, Activity } from 'lucide-react';
import { api, media } from '../api';
import { useStudio } from '../store';
import { Card, Btn, Field, Edit, Select, Segmented, Expert, Basic, Empty, Cols, Col } from '../ui';
import { JobList } from './Queue';
import type { AgentId } from '../../../shared/types';

export function Story() {
  const { project: p, ops, run, select, setTab, jobs, mode } = useStudio();
  const [agent, setAgent] = useState<AgentId>('claude');
  const [replace, setReplace] = useState(true);
  if (!p) return null;
  const breakdown = () => run(() => api.post(p.id, 'agent', { agent, task: 'parse', mode, replace }), 'Story breakdown started');
  const mine = jobs.filter((j) => j.projectId === p.id && j.kind === 'agent').slice(0, 8);

  return (
    <Cols className="g-story">
      <Col w={1.1}>
      <Card area="script" id="story-script" title="Story" icon={<FileText size={15} />}>
        <div className="form fill">
          <div className="form-row">
            <Field label="Title"><Edit value={p.title} onSave={(v) => ops([{ op: 'set', path: ['title'], value: v }])} /></Field>
            <Field label="Kind"><Select value={p.kind} onChange={(v) => ops([{ op: 'set', path: ['kind'], value: v }])} options={[['live', 'Live-action film'], ['story', 'Narrated story'], ['song', 'Song lyric film'], ['musicvideo', 'Music video']]} /></Field>
            <Expert>
              <Field label="Aspect"><Select value={p.aspect} onChange={(v) => ops([{ op: 'set', path: ['aspect'], value: v }])} options={[['16:9', '16:9'], ['2.39:1', '2.39:1 scope'], ['9:16', '9:16 vertical'], ['1:1', '1:1']]} /></Field>
            </Expert>
          </div>
          <Field label="Style" hint="added to every prompt"><Edit multiline rows={3} value={p.style} onSave={(v) => ops([{ op: 'set', path: ['style'], value: v }])} placeholder="Photorealistic live action, shot on 35mm film, low-key light, real faces, dust in the air" /></Field>
          <Field label={p.kind === 'song' || p.kind === 'musicvideo' ? 'Lyrics' : 'Script'} wide><Edit multiline rows={18} value={p.script} onSave={(v) => ops([{ op: 'set', path: ['script'], value: v }])} placeholder="Paste the story, a Bible passage, a screenplay or the lyrics." /></Field>
          <div className="form-row">
            <Field label="Audio" hint={p.audio ? p.audio.split('/').pop() : 'song or narration'}>
              <label className="btn btn-ghost file-btn"><Upload size={14} />{p.audio ? 'Replace audio' : 'Add audio'}<input type="file" accept="audio/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) run(() => api.upload(p.id, 'audio', f), 'Audio added'); }} /></label>
            </Field>
            {p.audio ? <audio controls src={media(p.id, p.audio)} style={{ flex: 1 }} /> : null}
          </div>
        </div>
      </Card>

      <Card grow={0.45} area="breakdown" id="story-breakdown" title="Break it into shots" icon={<Wand2 size={15} />}>
        <div className="form">
          <Basic><p className="muted">Claude reads the {p.kind === 'song' ? 'lyrics' : 'story'} and writes sequences, a continuity plan for each, the characters, and every shot with its prompt, length and camera.</p></Basic>
          <Expert>
            <Field label="Agent"><Segmented value={agent} onChange={setAgent} options={[['claude', 'Claude'], ['codex', 'Codex'], ['grok', 'Grok Build']]} /></Field>
            <Field label="Existing sequences"><Segmented value={replace ? 'replace' : 'append'} onChange={(v) => setReplace(v === 'replace')} options={[['replace', 'Replace'], ['append', 'Add after']]} /></Field>
          </Expert>
          <Btn kind="primary" onClick={breakdown} disabled={!p.script.trim()}><Wand2 size={14} />{p.sequences.length && replace ? 'Redo the breakdown' : 'Break down the story'}</Btn>
          {mine.length ? <JobList jobs={mine} compact /> : null}
        </div>
      </Card>

      </Col>

      <Col w={1.4}>

      <Card area="outline" id="story-outline" title="Sequences and shots" icon={<ListTree size={15} />} actions={<Btn small onClick={() => ops([{ op: 'insert', path: ['sequences'], value: { title: `Sequence ${p.sequences.length + 1}` } }])}><Plus size={13} />Sequence</Btn>}>
        {p.sequences.length === 0 ? <Empty>No sequences yet. Break the story down, or add one.</Empty> : p.sequences.map((q, qi) => (
          <div key={q.id} className="outline-seq">
            <div className="outline-head">
              <span className="num">{String(qi + 1).padStart(2, '0')}</span>
              <Edit value={q.title} onSave={(v) => ops([{ op: 'set', path: ['sequences', q.id, 'title'], value: v }])} />
              <span className="muted small">{q.shots.length} shots · {q.shots.reduce((n, s) => n + s.duration, 0).toFixed(0)} s</span>
              <button className="icon-btn" title="Add a shot" onClick={() => ops([{ op: 'insert', path: ['sequences', q.id, 'shots'], value: { title: `Shot ${q.shots.length + 1}` } }])}><Plus size={14} /></button>
              <button className="icon-btn danger" title="Delete sequence" onClick={() => confirm(`Delete "${q.title}" and its ${q.shots.length} shots?`) && ops([{ op: 'remove', path: ['sequences', q.id] }])}><Trash2 size={14} /></button>
            </div>
            <Edit multiline rows={2} value={q.continuity.plan} onSave={(v) => ops([{ op: 'set', path: ['sequences', q.id, 'continuity', 'plan'], value: v }])} placeholder="Continuity plan: place, time, light, weather, who stands where" />
            <ol className="outline-shots">
              {q.shots.map((s) => (
                <li key={s.id} onClick={() => { select(q.id, s.id); setTab('shot'); }}>
                  <b>{s.title}</b><span className="muted"> {s.duration}s · {s.camera.preset}</span>
                  <p>{s.action || s.prompt}</p>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </Card>

      <Card grow={0.4} area="log" id="story-cast" title="Characters found" icon={<Activity size={15} />}>
        {p.cast.length === 0 ? <Empty>Characters appear here after the breakdown.</Empty> : (
          <ul className="list">
            {p.cast.map((c) => (
              <li key={c.id} className="row" onClick={() => setTab('cast')}>
                {c.sheet ? <img className="thumb" src={media(p.id, c.sheet)} /> : <span className="thumb ph">{c.name[0]}</span>}
                <div className="grow"><b>{c.name}</b><p className="muted small clamp2">{c.description}</p></div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      </Col>
    </Cols>
  );
}
