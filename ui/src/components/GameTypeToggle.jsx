import { safeErr } from '../lib/format_err.js';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Joystick, FileCode2, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';

// Inline segmented control that flips a project between sdk (file browser)
// and pulp (visual editor) game types. Visuals updated to the new ghost
// convention — no decorative border by default, accent is reserved for the
// active segment background.
export default function GameTypeToggle({ project, onChange }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const navigate = useNavigate();
  if (!project) return null;

  const current = project.game_type === 'pulp' ? 'pulp' : 'sdk';

  async function flip(target) {
    if (target === current || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.patch(`/api/projects/${project.id}`, { game_type: target });
      onChange?.(r.project);
      const next = target === 'pulp' ? `/project/${project.id}/edit` : `/project/${project.id}`;
      navigate(next, { replace: true });
    } catch (e) {
      setErr(e.detail?.error || 'flip failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="inline-flex items-center rounded-md bg-ink-800/60 text-[11px] overflow-hidden">
      <Mode
        label="sdk"
        icon={FileCode2}
        active={current === 'sdk'}
        disabled={busy}
        onClick={() => flip('sdk')}
        title="file browser + Claude Code chat"
      />
      <Mode
        label="pulp"
        icon={Joystick}
        active={current === 'pulp'}
        disabled={busy}
        onClick={() => flip('pulp')}
        title="visual game editor"
      />
      {busy ? <Loader2 className="w-3 h-3 animate-spin text-ink-400 mx-1" /> : null}
      {err ? <span className="text-red-400 px-1">{safeErr(err)}</span> : null}
    </div>
  );
}

function Mode({ label, icon: Icon, active, disabled, onClick, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-1 transition-colors ${
        active
          ? 'bg-accent text-ink-900'
          : 'text-ink-400 hover:text-ink-100'
      } disabled:opacity-50`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </button>
  );
}
