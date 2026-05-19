import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ShieldAlert, ShieldCheck, ChevronRight } from 'lucide-react';
import { api } from '../lib/api.js';

// GateBanner — shows the active gate's name + pending-decision count.
// Click navigates to the gate review page. Renders nothing if there's no
// active gate OR no project in scope.
//
// Polls /gates every 20s + on focus. Cheap enough — single JSON fetch.
//
// Mount this above page content on any project route that should surface
// gate state (Project, SdkEditPage, etc.).
export default function GateBanner() {
  const params = useParams();
  const navigate = useNavigate();
  const projectId = params && params.id ? params.id : sniffProjectId();
  const [active, setActive] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    if (!projectId) { setActive(null); return undefined; }
    let cancelled = false;
    async function tick() {
      try {
        const r = await api.get(`/api/projects/${projectId}/gates`);
        if (cancelled) return;
        setActive(r && r.active ? r.active : null);
        setErr(null);
      } catch (e) {
        if (cancelled) return;
        setErr((e && e.detail && (e.detail.detail || e.detail.error)) || e.message || 'gate fetch failed');
        setActive(null);
      }
    }
    tick();
    const iv = setInterval(tick, 20000);
    const onFocus = () => tick();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      clearInterval(iv);
      window.removeEventListener('focus', onFocus);
    };
  }, [projectId]);

  if (!projectId || (!active && !err)) return null;
  if (err) {
    return (
      <div className="bg-amber-900/30 border-b border-amber-800/60 text-amber-200 text-xs px-3 py-1.5">
        gate status: {err}
      </div>
    );
  }
  const pending = active.pending || 0;
  const onClick = () => navigate(`/project/${projectId}/gates/${active.id}`);
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'w-full flex items-center gap-2 px-3 py-1.5 text-xs border-b transition-colors ' +
        (pending > 0
          ? 'bg-amber-900/40 border-amber-800/60 hover:bg-amber-900/60 text-amber-100'
          : 'bg-emerald-900/30 border-emerald-800/60 hover:bg-emerald-900/50 text-emerald-100')
      }
      title="open gate review"
    >
      {pending > 0
        ? <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
        : <ShieldCheck className="w-3.5 h-3.5 shrink-0" />}
      <span className="font-medium">{active.name}</span>
      <span className="opacity-80">·</span>
      <span>
        {pending > 0
          ? `${pending} decision${pending === 1 ? '' : 's'} pending`
          : 'ready to sign off'}
      </span>
      <ChevronRight className="w-3.5 h-3.5 ml-auto opacity-70" />
    </button>
  );
}

function sniffProjectId() {
  if (typeof window === 'undefined') return null;
  const m = window.location.pathname.match(/\/project\/([A-Za-z0-9_-]{1,80})(\/|$)/);
  return m ? m[1] : null;
}
