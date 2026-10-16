import { useEffect, useState } from 'react';
import { Plus, Ship, Trash2, RefreshCw, Film } from 'lucide-react';
import { api, media, type ProjectSummary, type Song } from '../api';
import { useStudio, fmtTime } from '../store';
import { Card, Btn, Field, Empty, Expert, Cols, Col } from '../ui';
import { VideoTypePicker } from '../render';
import { VIDEO_TYPES } from '../../../shared/types';


export function Projects() {
  const { open, setTab, run, projectId } = useStudio();
  const [list, setList] = useState<ProjectSummary[]>([]);
  const [songs, setSongs] = useState<Song[] | null>(null);
  const [songErr, setSongErr] = useState('');
  const [title, setTitle] = useState('');
  const [videoType, setVideoType] = useState('ultra-code');
  const [script, setScript] = useState('');
  const [armed, setArmed] = useState<string | null>(null);
  const load = () => api.projects().then(setList).catch(() => {});
  const loadSongs = () => { setSongErr(''); api.songs().then(setSongs).catch((e) => { setSongs([]); setSongErr(e.message); }); };
  useEffect(() => { load(); loadSongs(); }, []);

  const create = async () => {
    if (!title.trim()) return;
    const kind = VIDEO_TYPES.find((v) => v.id === videoType)?.kind ?? 'song';
    const p = await run(() => api.create({ title: title.trim(), kind, videoType, script }), 'Film created');
    if (p) { await open(p.id); setTab('story'); }
  };
  const importSong = async (s: Song) => {
    const p = await run(() => api.importSong(s.path), `Imported ${s.title}`);
    if (p) { await open(p.id); setTab('storyboard'); }
  };

  return (
    <Cols className="g-projects">
      <Col w={1.7}>
      <Card area="films" id="films" title="Films" icon={<Film size={15} />} actions={<Btn small onClick={load}><RefreshCw size={13} /></Btn>}>
        {list.length === 0 ? <Empty>No films yet. Start one on the right, or bring in an Ark song.</Empty> : (
          <div className="film-grid">
            {list.map((p) => (
              <article key={p.id} className={`film-card ${p.id === projectId ? 'current' : ''}`} onClick={async () => { await open(p.id); setTab('storyboard'); }}>
                <div className="film-cover">{p.cover ? <img src={media(p.id, p.cover)} /> : <span>{p.title.slice(0, 1)}</span>}</div>
                <div className="film-meta">
                  <span className="slate">{p.kind}</span>
                  <h3>{p.title}</h3>
                  <p>{p.sequences} sequences · {p.shots} shots · {p.takes} takes</p>
                  <p className="muted">{fmtTime(p.updated)}{p.ark ? ' · Ark linked' : ''}</p>
                </div>
                {/* in every mode; a second click confirms (no browser dialog, which some windows block) */}
                <button className={`icon-btn danger film-del ${armed === p.id ? 'armed' : ''}`} title={armed === p.id ? 'Click again to move it to the trash' : 'Move to trash'}
                  onClick={async (e) => { e.stopPropagation(); if (armed !== p.id) { setArmed(p.id); setTimeout(() => setArmed((x) => (x === p.id ? null : x)), 4000); return; } setArmed(null); await run(() => api.remove(p.id), 'Moved to trash'); if (p.id === projectId) open(undefined); load(); }}>
                  <Trash2 size={14} />{armed === p.id ? <span>Delete?</span> : null}
                </button>
              </article>
            ))}
          </div>
        )}
      </Card>

      </Col>

      <Col w={1}>

      <Card area="new" id="new" title="New film" icon={<Plus size={15} />}>
        <div className="form">
          <Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Lazarus, come forth" onKeyDown={(e) => e.key === 'Enter' && create()} /></Field>
          <Field label="Video type"><VideoTypePicker value={videoType} onPick={setVideoType} /></Field>
          <Field label="Story, script or lyrics" hint="optional, you can paste it later"><textarea rows={5} value={script} onChange={(e) => setScript(e.target.value)} /></Field>
          <Btn kind="primary" onClick={create} disabled={!title.trim()}><Plus size={14} />Create film</Btn>
        </div>
      </Card>

      <Card area="ark" id="ark-songs" title="Ark songs" icon={<Ship size={15} />} actions={<Btn small onClick={loadSongs}><RefreshCw size={13} /></Btn>}>
        {songs === null ? <Empty>Reading the song folders…</Empty> : songErr ? <Empty>Could not reach the Ark engine: {songErr}</Empty> : (
          <ul className="list">
            {songs.map((s) => (
              <li key={s.path} className="row">
                <div className="grow"><b>{s.title}</b><span className="muted"> {s.dir} · {s.scenes} scenes · {s.mode}</span></div>
                <span className="muted small">{fmtTime(s.modified)}</span>
                <Btn small kind="solid" onClick={() => importSong(s)}>Open in studio</Btn>
              </li>
            ))}
          </ul>
        )}
      </Card>
      </Col>
    </Cols>
  );
}
