import { safeErr } from '../lib/format_err.js';
import { useEffect, useRef, useState } from 'react';
import {
  Loader2, CheckCircle2, AlertTriangle, Circle, X,
  Image as ImageIcon, Music2, Map as MapIcon, Rocket
} from 'lucide-react';
import {
  runAutopilot, cancel as cancelAutopilot, AUTOPILOT_STAGES
} from '../lib/pulp_autopilot_client.js';

const MAX_LOG_LINES = 200;

// Render the live SSE feed. Owns its own AbortController + state.
// Props:
//   projectId: required
//   pitch: string — sent on mount
//   model?: string
//   onClose(): called when the user clicks close or after auto-close
//   onDone({summary}): optional callback
export default function PulpAutopilotProgress({ projectId, pitch, model, onClose, onDone }) {
  const [stages, setStages] = useState(() => initialStages());
  const [counters, setCounters] = useState({ tile: 0, scene: 0, sound: 0,
    tile_total: 0, scene_total: 0, sound_total: 0 });
  const [log, setLog] = useState([]);
  const [running, setRunning] = useState(true);
  const [summary, setSummary] = useState(null);
  const [stageErrors, setStageErrors] = useState({});
  const [autoClose, setAutoClose] = useState(false);
  const ctrlRef = useRef(null);
  const logRef = useRef(null);

  useEffect(() => {
    if (!projectId || !pitch) return;
    const ctrl = runAutopilot(projectId, { pitch, model }, {
      onPhase: ({ stage, label }) => {
        setStages((prev) => prev.map((s) => {
          if (s.id === stage) return { ...s, status: 'running', label: label || s.label };
          // Anything before "stage" in our list that's still 'pending'
          // becomes 'done' (best-effort — exact done is signalled per log).
          return s;
        }));
        pushLog(`▶ ${label || stage}`);
      },
      onLog: ({ text }) => {
        if (typeof text === 'string' && text.length > 0) pushLog(text);
        // crude heuristic: server emits "[<stage>] complete"
        const m = /^\[([a-z_]+)\]\s+complete$/.exec(String(text || '').trim());
        if (m) {
          setStages((prev) => prev.map((s) =>
            s.id === m[1] ? { ...s, status: 'done' } : s));
        }
        const f = /^\[([a-z_]+)\]\s+failed/.exec(String(text || '').trim());
        if (f) {
          setStages((prev) => prev.map((s) =>
            s.id === f[1] ? { ...s, status: 'failed' } : s));
        }
      },
      onAsset: ({ kind, id, count_so_far, total_planned }) => {
        setCounters((prev) => {
          const next = { ...prev };
          next[kind] = count_so_far || 0;
          next[`${kind}_total`] = total_planned || prev[`${kind}_total`] || 0;
          return next;
        });
        // Mark the matching asset burst stage as running while assets stream in,
        // and done if we reach the total.
        const stageId = ({ tile: 'tile_burst', scene: 'scene_burst', sound: 'sound_burst' })[kind];
        if (stageId) {
          setStages((prev) => prev.map((s) => {
            if (s.id !== stageId) return s;
            if (total_planned && count_so_far >= total_planned) {
              return { ...s, status: 'done' };
            }
            return { ...s, status: 'running' };
          }));
        }
        pushLog(`+ ${kind}: ${id} (${count_so_far}/${total_planned || '?'})`);
      },
      onError: ({ message, stage, recoverable }) => {
        const msg = safeErr(message) || 'error';
        pushLog(`! error${stage ? ` [${stage}]` : ''}: ${msg}`);
        if (stage) {
          setStageErrors((prev) => ({ ...prev, [stage]: msg }));
          setStages((prev) => prev.map((s) =>
            s.id === stage ? { ...s, status: recoverable ? 'failed' : 'failed' } : s));
        }
      },
      onDone: ({ summary: s }) => {
        setSummary(s || null);
        setRunning(false);
        setStages((prev) => prev.map((st) => st.status === 'pending'
          ? { ...st, status: 'done' }
          : st));
        pushLog(`done — tiles=${s?.tiles_added ?? 0} scenes=${s?.scenes_added ?? 0} sounds=${s?.sounds_added ?? 0}`);
        onDone?.({ summary: s });
      },
      onClose: () => setRunning(false)
    });
    ctrlRef.current = ctrl;
    return () => {
      try { ctrl.abort(); } catch (_e) { /* ignore */ }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, pitch, model]);

  // Auto-scroll log.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  function pushLog(text) {
    setLog((prev) => {
      const next = prev.concat([text]);
      if (next.length > MAX_LOG_LINES) next.splice(0, next.length - MAX_LOG_LINES);
      return next;
    });
  }

  async function onCancel() {
    try { await cancelAutopilot(projectId); } catch (_e) { /* ignore */ }
    try { ctrlRef.current?.abort(); } catch (_e) { /* ignore */ }
    setRunning(false);
    onClose?.();
  }

  // Auto-close 2s after done if user opted-in.
  useEffect(() => {
    if (!autoClose || running || !summary) return;
    const t = setTimeout(() => { onClose?.(); }, 1500);
    return () => clearTimeout(t);
  }, [autoClose, running, summary, onClose]);

  return (
    <div className="space-y-3 text-ink-200">
      <div className="flex items-center gap-2">
        <Rocket className="w-4 h-4 text-accent" />
        <div className="text-sm font-mono">
          {running ? 'generating your game…' : (summary ? 'done.' : 'finished')}
        </div>
        <div className="flex-1" />
        {running ? (
          <button type="button" className="btn text-xs" onClick={onCancel}>
            <X className="w-3 h-3" /> cancel
          </button>
        ) : (
          <button type="button" className="btn text-xs" onClick={onClose}>close</button>
        )}
      </div>

      {/* Stage list */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono">
        {stages.map((s) => (
          <StageRow key={s.id} stage={s} error={stageErrors[s.id]} />
        ))}
      </div>

      {/* Asset counters */}
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <Counter
          icon={<ImageIcon className="w-3 h-3" />}
          label="tiles"
          count={counters.tile}
          total={counters.tile_total}
        />
        <Counter
          icon={<MapIcon className="w-3 h-3" />}
          label="scenes"
          count={counters.scene}
          total={counters.scene_total}
        />
        <Counter
          icon={<Music2 className="w-3 h-3" />}
          label="sounds"
          count={counters.sound}
          total={counters.sound_total}
        />
      </div>

      {/* Log tail */}
      <div
        ref={logRef}
        className="border border-ink-700 rounded bg-ink-900 p-2 h-44 overflow-y-auto font-mono text-[10px] text-ink-300 whitespace-pre-wrap"
      >
        {log.length === 0
          ? <div className="text-ink-500">connecting…</div>
          : log.map((ln, i) => <div key={i}>{ln}</div>)}
      </div>

      {summary ? (
        <div className="flex items-center gap-2 text-[11px] text-ink-300">
          <input
            id="ap-auto-close"
            type="checkbox"
            checked={autoClose}
            onChange={(e) => setAutoClose(e.target.checked)}
          />
          <label htmlFor="ap-auto-close" className="cursor-pointer">
            close automatically and open editor
          </label>
          <div className="flex-1" />
          <button type="button" className="btn-primary text-xs" onClick={onClose}>
            open editor
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StageRow({ stage, error }) {
  const Icon = ({
    pending: Circle,
    running: Loader2,
    done: CheckCircle2,
    failed: AlertTriangle
  })[stage.status] || Circle;
  const cls = ({
    pending: 'text-ink-500',
    running: 'text-accent animate-spin',
    done: 'text-emerald-400',
    failed: 'text-red-400'
  })[stage.status] || 'text-ink-500';
  return (
    <div className="flex items-center gap-1.5 py-0.5">
      <Icon className={`w-3 h-3 shrink-0 ${cls}`} />
      <span className={stage.status === 'pending' ? 'text-ink-500' : 'text-ink-200'}>
        {stage.label}
      </span>
      {error ? (
        <span className="text-[10px] text-red-300 truncate" title={error}>
          — {error}
        </span>
      ) : null}
    </div>
  );
}

function Counter({ icon, label, count, total }) {
  return (
    <div className="border border-ink-700 rounded p-1.5 flex items-center gap-1.5 bg-ink-900/60">
      <span className="text-ink-400">{icon}</span>
      <span className="text-ink-300">{label}</span>
      <span className="flex-1" />
      <span className="font-mono text-ink-100">
        {count}{total ? ` / ${total}` : ''}
      </span>
    </div>
  );
}

function initialStages() {
  return AUTOPILOT_STAGES.map((s) => ({ id: s.id, label: s.label, status: 'pending' }));
}
