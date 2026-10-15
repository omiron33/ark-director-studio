import { useEffect } from 'react';
import { Clapperboard, FileText, LayoutGrid, Film, Users, Box, Rows3, ListChecks, Ship, Settings as Cog, FolderOpen } from 'lucide-react';
import { useStudio, connectLive, type Tab } from './store';
import { Dot, Segmented } from './ui';
import { Projects } from './tabs/Projects';
import { Story } from './tabs/Story';
import { Storyboard } from './tabs/Storyboard';
import { ShotTab } from './tabs/Shot';
import { Cast } from './tabs/Cast';
import { GreyboxTab } from './tabs/Greybox';
import { Timeline } from './tabs/Timeline';
import { Queue } from './tabs/Queue';
import { Ark } from './tabs/Ark';
import { Settings } from './tabs/Settings';

const TABS: { id: Tab; label: string; icon: any; needsProject?: boolean }[] = [
  { id: 'projects', label: 'Films', icon: FolderOpen },
  { id: 'story', label: 'Story', icon: FileText, needsProject: true },
  { id: 'storyboard', label: 'Storyboard', icon: LayoutGrid, needsProject: true },
  { id: 'shot', label: 'Shot', icon: Film, needsProject: true },
  { id: 'cast', label: 'Cast & looks', icon: Users, needsProject: true },
  { id: 'greybox', label: 'Greybox', icon: Box, needsProject: true },
  { id: 'timeline', label: 'Timeline', icon: Rows3, needsProject: true },
  { id: 'queue', label: 'Queue', icon: ListChecks },
  { id: 'ark', label: 'Ark engine', icon: Ship, needsProject: true },
  { id: 'settings', label: 'Settings', icon: Cog },
];

export function App() {
  const { tab, setTab, mode, setMode, project, projectId, open, status, refreshJobs, refreshStatus, toast, jobs } = useStudio();
  useEffect(() => {
    connectLive();
    refreshJobs();
    refreshStatus();
    if (projectId) open(projectId);
    const t = setInterval(() => refreshStatus(), 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      const i = Number(e.key);
      if (e.altKey && i >= 1 && i <= TABS.length) { setTab(TABS[i - 1].id); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const active = jobs.filter((j) => ['queued', 'waiting-gpu', 'running'].includes(j.status));
  const current = TABS.find((t) => t.id === tab) ?? TABS[0];
  const view = current.needsProject && !project ? 'projects' : current.id;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Clapperboard size={20} /><span>ARK</span><b>DIRECTOR</b></div>
        <div className="film-name" title={project?.ark?.songPath}>
          {project ? <><span className="slate">{project.kind}</span>{project.title}</> : <span className="muted">No film open</span>}
        </div>
        <nav className="tabs">
          {TABS.map((t, i) => (
            <button key={t.id} className={`tab ${view === t.id ? 'on' : ''}`} disabled={t.needsProject && !project} onClick={() => setTab(t.id)} title={`Alt+${i + 1}`}>
              <t.icon size={15} />{t.label}
              {t.id === 'queue' && active.length ? <span className="badge">{active.length}</span> : null}
            </button>
          ))}
        </nav>
        <div className="status-row">
          <Dot ok={status?.comfy.ok} label="ComfyUI" title={status?.comfy.error ?? status?.comfy.vram} />
          <Dot ok={status ? status.gpu.ok && status.gpu.control === 'run' : undefined} label={status?.gpu.ok ? `GPU ${status.gpu.control}${status.gpu.active ? ' · busy' : ''}` : 'GPU queue'} title={status?.gpu.error} />
          <Dot ok={status?.ark.ok} label="Ark" title={status?.ark.error ?? status?.ark.engine} />
          <Dot ok={status ? status.agents.claude.ok || status.agents.codex.ok || status.agents.grok.ok : undefined} label="Agents" title={status ? Object.entries(status.agents).map(([k, v]) => `${k}: ${v.ok ? 'ready' : 'not reachable'}`).join('\n') : ''} />
        </div>
        <Segmented value={mode} onChange={setMode} options={[['basic', 'Basic'], ['expert', 'Expert']]} />
      </header>
      <main className={`view view-${view}`}>
        {view === 'projects' && <Projects />}
        {view === 'story' && <Story />}
        {view === 'storyboard' && <Storyboard />}
        {view === 'shot' && <ShotTab />}
        {view === 'cast' && <Cast />}
        {view === 'greybox' && <GreyboxTab />}
        {view === 'timeline' && <Timeline />}
        {view === 'queue' && <Queue />}
        {view === 'ark' && <Ark />}
        {view === 'settings' && <Settings />}
      </main>
      {toast ? <div className={`toast toast-${toast.kind}`}>{toast.text}</div> : null}
    </div>
  );
}
