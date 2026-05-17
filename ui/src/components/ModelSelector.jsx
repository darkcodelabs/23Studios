import { safeErr } from '../lib/format_err.js';
import { useEffect, useState } from 'react';
import { ChevronDown, Cpu } from 'lucide-react';
import { api } from '../lib/api.js';

export const CLAUDE_OPTION = { id: 'claude', label: 'Claude (via Claude Code)', backend: 'claude' };

const FEATURED_PREFIXES = [
  'openai/gpt-4', 'openai/o', 'anthropic/claude', 'google/gemini',
  'meta-llama/llama-3', 'mistralai/', 'deepseek/'
];

function score(modelId) {
  for (let i = 0; i < FEATURED_PREFIXES.length; i++) {
    if (modelId.startsWith(FEATURED_PREFIXES[i])) return i;
  }
  return FEATURED_PREFIXES.length;
}

export default function ModelSelector({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const r = await api.get('/api/openrouter/models');
        if (!alive) return;
        const opts = (r.models || []).map((m) => ({
          id: m.id, label: m.name || m.id, backend: 'openrouter'
        }));
        opts.sort((a, b) => {
          const sa = score(a.id); const sb = score(b.id);
          if (sa !== sb) return sa - sb;
          return a.label.localeCompare(b.label);
        });
        setModels(opts);
      } catch (_e) {
        if (alive) setErr('failed to load models');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const current = value || CLAUDE_OPTION;

  function choose(opt) {
    setOpen(false);
    onChange?.(opt);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn text-xs gap-1.5"
      >
        <Cpu className="w-3.5 h-3.5 text-accent" />
        <span className="truncate max-w-[200px]">{current.label}</span>
        <ChevronDown className="w-3 h-3" />
      </button>
      {open ? (
        <div
          className="absolute right-0 mt-1 w-80 max-h-80 overflow-y-auto bg-ink-800 border border-ink-600 rounded-md shadow-xl z-20"
          onMouseLeave={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={() => choose(CLAUDE_OPTION)}
            className={`w-full text-left px-3 py-2 text-xs font-mono hover:bg-ink-700 ${current.id === CLAUDE_OPTION.id ? 'bg-ink-700 text-accent' : 'text-ink-200'}`}
          >
            {CLAUDE_OPTION.label}
            <div className="text-[10px] text-ink-500">subprocess. has cwd context.</div>
          </button>
          <div className="border-t border-ink-700" />
          {loading ? (
            <div className="px-3 py-2 text-xs text-ink-400">loading models…</div>
          ) : err ? (
            <div className="px-3 py-2 text-xs text-red-400">{safeErr(err)}</div>
          ) : models.length === 0 ? (
            <div className="px-3 py-2 text-xs text-ink-500">no models available (set OPENROUTER_API_KEY)</div>
          ) : models.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => choose(m)}
              className={`w-full text-left px-3 py-1.5 text-xs font-mono hover:bg-ink-700 ${current.id === m.id ? 'bg-ink-700 text-accent' : 'text-ink-200'}`}
            >
              <span className="truncate block">{m.label}</span>
              <span className="text-[10px] text-ink-500 truncate block">{m.id}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
