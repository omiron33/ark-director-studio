import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useStudio } from './store';

// A card that fills its grid cell, collapses to its header, and scrolls inside itself.
export function Card({ title, icon, actions, children, area, id, pad = true, collapsible = true, className = '', defaultOpen = true, grow = 1 }: { title: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode; area?: string; id?: string; pad?: boolean; collapsible?: boolean; className?: string; defaultOpen?: boolean; grow?: number }) {
  const key = id ? `ads.card.${id}` : undefined;
  const [open, setOpen] = useState<boolean>(() => { try { const v = key && localStorage.getItem(key); return v ? v === '1' : defaultOpen; } catch { return defaultOpen; } });
  useEffect(() => { try { if (key) localStorage.setItem(key, open ? '1' : '0'); } catch {} }, [open, key]);
  return (
    <section className={`card ${open ? '' : 'collapsed'} ${area ? `area-${area}` : ''} ${className}`} style={open ? { flexGrow: grow } : undefined}>
      <header className="card-head">
        {collapsible ? (
          <button className="card-toggle" onClick={() => setOpen(!open)} aria-expanded={open} title={open ? 'Collapse' : 'Expand'}>
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : null}
        {icon ? <span className="card-icon">{icon}</span> : null}
        <h2>{title}</h2>
        <div className="card-actions">{actions}</div>
      </header>
      {open ? <div className={`card-body ${pad ? 'pad' : ''}`}>{children}</div> : null}
    </section>
  );
}

export function Btn({ children, onClick, kind = 'ghost', disabled, title, small, type = 'button', style }: { children: ReactNode; onClick?: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'solid'; disabled?: boolean; title?: string; small?: boolean; type?: 'button' | 'submit'; style?: CSSProperties }) {
  return <button type={type} className={`btn btn-${kind} ${small ? 'btn-sm' : ''}`} onClick={onClick} disabled={disabled} title={title} style={style}>{children}</button>;
}

export function Field({ label, children, hint, wide }: { label: string; children: ReactNode; hint?: string; wide?: boolean }) {
  return (
    <label className={`field ${wide ? 'wide' : ''}`}>
      <span className="field-label">{label}{hint ? <em>{hint}</em> : null}</span>
      {children}
    </label>
  );
}

// A text input that saves on blur (or Enter for single lines), so typing never fights live reloads.
export function Edit({ value, onSave, multiline, rows = 3, placeholder, mono, type = 'text', step }: { value: string | number | undefined; onSave: (v: string) => void; multiline?: boolean; rows?: number; placeholder?: string; mono?: boolean; type?: string; step?: number }) {
  const [v, setV] = useState(String(value ?? ''));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setV(String(value ?? '')); }, [value]);
  const commit = () => { focused.current = false; if (v !== String(value ?? '')) onSave(v); };
  const common = { value: v, placeholder, className: mono ? 'mono' : undefined, onFocus: () => { focused.current = true; }, onBlur: commit, onChange: (e: any) => setV(e.target.value) };
  return multiline
    ? <textarea {...common} rows={rows} />
    : <input {...common} type={type} step={step} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

export function Select({ value, onChange, options }: { value: string | undefined; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, ReactNode][] }) {
  return (
    <div className="seg">
      {options.map(([v, l]) => <button key={v} className={v === value ? 'on' : ''} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export const Expert = ({ children }: { children: ReactNode }) => useStudio((s) => s.mode) === 'expert' ? <>{children}</> : null;
export const Basic = ({ children }: { children: ReactNode }) => useStudio((s) => s.mode) === 'basic' ? <>{children}</> : null;

export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }

export function Dot({ ok, label, title }: { ok: boolean | undefined; label: string; title?: string }) {
  return <span className={`dot ${ok === undefined ? 'unk' : ok ? 'ok' : 'bad'}`} title={title}><i />{label}</span>;
}

export function StatusTag({ s }: { s: string }) {
  return <span className={`tag tag-${s}`}>{s.replace('-', ' ')}</span>;
}

export function Media({ src, video, className, poster, controls = true, onEnded, autoPlay }: { src?: string; video?: boolean; className?: string; poster?: string; controls?: boolean; onEnded?: () => void; autoPlay?: boolean }) {
  if (!src) return <div className={`media media-empty ${className ?? ''}`}><span>no picture yet</span></div>;
  return video || /\.(mp4|webm|mov)$/i.test(src)
    ? <video className={`media ${className ?? ''}`} src={src} poster={poster} controls={controls} onEnded={onEnded} autoPlay={autoPlay} playsInline />
    : <img className={`media ${className ?? ''}`} src={src} loading="lazy" />;
}

// Layout: columns side by side, each a stack of cards. A collapsed card shrinks to its header and the
// cards around it take the room, so nothing ever runs off the screen.
export function Cols({ children, className = '' }: { children: ReactNode; className?: string }) { return <div className={`cols ${className}`}>{children}</div>; }
export function Col({ children, w, fixed }: { children: ReactNode; w?: number; fixed?: number }) {
  return <div className="col" style={fixed ? { flex: `0 0 ${fixed}px` } : { flex: `${w ?? 1} 1 0` }}>{children}</div>;
}
export function Row({ children, grow = 1 }: { children: ReactNode; grow?: number }) { return <div className="rowstack" style={{ flexGrow: grow }}>{children}</div>; }
