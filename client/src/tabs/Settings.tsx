import { useEffect } from 'react';
import { Settings as Cog, Sparkles, Bot, RefreshCw, Keyboard } from 'lucide-react';
import { api } from '../api';
import { useStudio } from '../store';
import { Card, Btn, Dot, Cols, Col } from '../ui';

export function Settings() {
  const { status, refreshStatus, run } = useStudio();
  useEffect(() => { refreshStatus(true); }, []);
  return (
    <Cols className="g-settings">
      <Col w={1}>
      <Card area="svc" id="set-svc" title="Connections" icon={<Cog size={15} />} actions={<Btn small onClick={() => refreshStatus(true)}><RefreshCw size={13} />Check again</Btn>}>
        {!status ? <p>Checking…</p> : (
          <ul className="list">
            <li className="row"><Dot ok={status.comfy.ok} label="ComfyUI" /><span className="grow muted small">{status.comfy.ok ? `${status.comfy.vram ?? ''} · ${status.comfy.queue?.running ?? 0} running, ${status.comfy.queue?.pending ?? 0} waiting` : status.comfy.error}</span></li>
            <li className="row"><Dot ok={status.gpu.ok && status.gpu.control === 'run'} label="GPU queue dashboard" /><span className="grow muted small">{status.gpu.ok ? `control ${status.gpu.control} · ${status.gpu.active} running · ${status.gpu.queued} queued` : status.gpu.error}</span></li>
            <li className="row"><Dot ok={status.ark.ok} label="Ark engine" /><span className="grow muted small">{status.ark.ok ? `${status.ark.engine} on ${status.ark.machine}` : status.ark.error}</span></li>
            <li className="row"><Dot ok={status.blender.ok} label="Blender" /><span className="grow muted small">{status.blender.path}</span></li>
          </ul>
        )}
      </Card>
      <Card area="agents" id="set-agents" title="Agents" icon={<Bot size={15} />}>
        {status ? (
          <ul className="list">
            {Object.entries(status.agents).map(([k, v]) => <li key={k} className="row"><Dot ok={v.ok} label={k === 'grok' ? 'Grok Build' : k[0].toUpperCase() + k.slice(1)} /><span className="grow muted small">{v.how}</span></li>)}
          </ul>
        ) : null}
        <p className="muted small">Agents break stories into shots and review assembled sequences. Pick one per job in Expert mode; Basic uses Claude.</p>
      </Card>
      </Col>
      <Col w={1}>
      <Card area="grok" id="set-grok" title="Grok Imagine" icon={<Sparkles size={15} />}>
        <p>Grok Imagine runs in its own browser window on this PC, signed in to your Grok subscription.</p>
        <p className="muted small">Profile: {status?.grok.profile ? 'saved' : 'not created yet'}{status?.grok.signedIn !== undefined ? ` · ${status.grok.signedIn ? 'signed in' : 'not signed in'}` : ''}</p>
        <div className="form-row">
          <Btn kind="solid" onClick={() => run(() => api.grokOpen(), 'Grok window opened on OmiPC')}>Open Grok</Btn>
          <Btn onClick={() => run(() => api.grokClose(), 'Grok window closed')}>Close Grok window</Btn>
        </div>
        <p className="muted small">Sign in yourself the first time; the studio never sees your password. If Grok asks you to prove you're human, answer it in that window and retry the job.</p>
      </Card>
      <Card area="keys" id="set-keys" title="Keys and modes" icon={<Keyboard size={15} />}>
        <ul className="list">
          <li className="row"><kbd>Alt</kbd>+<kbd>1</kbd>…<kbd>0</kbd><span className="grow muted">switch tabs</span></li>
          <li className="row"><b>Basic</b><span className="grow muted">prompt, length, camera, characters and look. The studio picks the engine, seed, steps, start frame and agent.</span></li>
          <li className="row"><b>Expert</b><span className="grow muted">engine per take, seeds, steps, greybox guide steps, start-frame override, lens and move, Grok frames, every Ark command and its options.</span></li>
        </ul>
      </Card>
      </Col>
    </Cols>
  );
}
