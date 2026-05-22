import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Paperclip, ArrowRight, Loader2, ChevronUp, ChevronDown, X } from 'lucide-react';
import { api } from '../lib/api.js';

// FloatingComposer — global docked prompt bar.
//
// Lives at viewport bottom on every AppShell + ProjectShell page. Two states:
//   - collapsed (default): a single 56px-tall pill in the lower-right with
//                          the project name truncated + a Build button.
//   - expanded: the full Landing composer card slides up from bottom.
//
// State persists to localStorage so a user who collapses it stays collapsed
// across reloads. Hidden entirely on the Landing screen (Landing has its own
// hero composer).

const SEED = '0xR23-G23S';
const STORAGE_KEY = 'studio.floatingComposer.open';

function deriveName(prompt) {
  const t = (prompt || '').trim();
  if (!t) return 'New project';
  const first = t.split(/\n/)[0].split(/[.!?]/)[0];
  return first.trim().split(/\s+/).slice(0, 6).join(' ') || 'New project';
}

function Chip({ children, subtle, title, onClick }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="font-mono inline-flex items-center"
      style={{
        appearance: 'none',
        background: 'transparent',
        border: `1px solid ${subtle ? 'var(--border)' : 'var(--border-2)'}`,
        color: subtle ? 'var(--text-dim)' : 'var(--text-muted)',
        padding: '5px 10px',
        borderRadius: 999,
        fontSize: 10,
        letterSpacing: '.04em',
        gap: 6,
        lineHeight: 1,
        cursor: onClick ? 'pointer' : 'default'
      }}
    >
      {children}
    </button>
  );
}

export default function FloatingComposer() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(STORAGE_KEY) === '1';
  });
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, open ? '1' : '0'); } catch (_e) {}
  }, [open]);

  // Hide entirely on /new (Landing) — Landing owns its own hero composer.
  if (typeof window !== 'undefined') {
    const p = window.location.pathname;
    if (p === '/new' || p.endsWith('/new')) return null;
  }

  const charCount = useMemo(() => (prompt || '').length, [prompt]);

  async function onBuild() {
    if (busy) return;
    const text = (prompt || '').trim();
    if (!text) { setError('Describe the game first.'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/api/projects', {
        name: deriveName(text),
        description: text,
        game_type: 'sdk'
      });
      const newId = r && (r.project ? r.project.id : r.id);
      if (!newId) throw new Error('no project id returned');
      navigate(`/projects/${newId}/build/milestones`);
    } catch (e) {
      const msg = (e && e.detail && e.detail.detail) || (e && e.detail) || e?.message || 'failed';
      setError(typeof msg === 'string' ? msg : 'failed to create project');
      setBusy(false);
    }
  }

  // Collapsed dock — small pill bottom-right.
  if (!open) {
    return (
      <div
        className="font-mono"
        style={{
          position: 'fixed',
          bottom: 18,
          right: 22,
          zIndex: 60
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Open prompt composer"
          className="inline-flex items-center"
          style={{
            appearance: 'none',
            cursor: 'pointer',
            background: 'var(--surface)',
            border: '1px solid var(--border-2)',
            color: 'var(--text-muted)',
            padding: '8px 14px',
            borderRadius: 999,
            fontSize: 11,
            letterSpacing: '.08em',
            gap: 8,
            boxShadow: '0 8px 24px -10px rgba(0,0,0,.5), 0 1px 0 rgba(255,255,255,.04) inset',
            textTransform: 'uppercase'
          }}
        >
          <span style={{ color: 'var(--accent)' }}>+</span>
          new project
          <ChevronUp className="w-3 h-3" />
        </button>
      </div>
    );
  }

  // Expanded dock — full composer slid up from bottom-center.
  return (
    <div
      className="font-ui"
      style={{
        position: 'fixed',
        bottom: 18,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 60,
        width: 'min(760px, calc(100vw - 60px))'
      }}
    >
      <div
        className="relative w-full"
        style={{
          background: 'oklch(17% 0.006 75 / .96)',
          backdropFilter: 'blur(20px) saturate(140%)',
          WebkitBackdropFilter: 'blur(20px) saturate(140%)',
          border: '1px solid var(--border-2)',
          borderRadius: 20,
          padding: 4,
          boxShadow:
            '0 1px 0 rgba(255,255,255,.04) inset, 0 24px 60px -20px rgba(0,0,0,.7), 0 2px 0 rgba(0,0,0,.3)'
        }}
      >
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Collapse composer"
          title="Collapse"
          className="absolute grid place-items-center"
          style={{
            top: -10, right: -10,
            width: 22, height: 22,
            borderRadius: '50%',
            background: 'var(--surface)',
            border: '1px solid var(--border-2)',
            color: 'var(--text-muted)',
            cursor: 'pointer'
          }}
        >
          <X className="w-3 h-3" />
        </button>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe a game…"
          spellCheck={false}
          rows={3}
          className="font-ui w-full"
          style={{
            border: 0, outline: 0, resize: 'none',
            background: 'transparent',
            color: 'var(--text)',
            fontSize: 14,
            lineHeight: 1.5,
            padding: '14px 18px 6px',
            minHeight: 72
          }}
        />
        <div className="flex items-center" style={{ padding: '4px 10px 8px', gap: 8 }}>
          <div className="flex items-center flex-wrap" style={{ gap: 5 }}>
            <Chip title="Attach reference"><Paperclip className="w-3 h-3" /></Chip>
            <Chip>target · playdate</Chip>
            <Chip>art · 1-bit</Chip>
            <Chip>runtime · sdk</Chip>
            <Chip subtle>seed · {SEED}</Chip>
          </div>
          <div className="flex items-center" style={{ marginLeft: 'auto', gap: 8 }}>
            <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>
              {charCount}
            </span>
            <button
              type="button"
              onClick={onBuild}
              disabled={busy}
              className="font-ui inline-flex items-center"
              style={{
                borderRadius: 999,
                padding: '7px 13px',
                background: 'var(--accent)',
                color: 'var(--accent-ink)',
                border: '1px solid var(--accent)',
                fontWeight: 600,
                fontSize: 12,
                gap: 6,
                cursor: busy ? 'wait' : 'pointer',
                opacity: busy ? 0.7 : 1
              }}
            >
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              {busy ? 'Building…' : 'Build'}
              {!busy ? <ArrowRight className="w-3 h-3" /> : null}
            </button>
          </div>
        </div>
        {error ? (
          <div
            className="font-mono"
            style={{
              padding: '4px 14px 8px',
              fontSize: 10,
              color: 'var(--danger)'
            }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </div>
  );
}
