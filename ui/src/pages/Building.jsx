import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ArrowRight, Pause, X, Loader2, AlertCircle
} from 'lucide-react';
import Handheld from '../components/Handheld.jsx';
import { api } from '../lib/api.js';

// Building — design pass 4, screen 2.
//
// Fidelity reference:
//   design_handoff_23_studios/screen-building.jsx
//   design_handoff_23_studios/23studios_design_README_revised.md §"Screens > 2. Building"
//
// Layout (2-col, main + 380px right rail):
//   Left:  header (now building · seed + title + oneLiner + Cancel/Pause/Open
//          workspace), 6-card phase bar (design's "Option B" buckets), 3-col
//          scene stream grid with done/building/queued/awaiting-review states.
//   Right: build log terminal, build stats dl, mini Playdate live preview,
//          gate queue.
//
// The active mount path is /projects/:id/build/milestones (App.jsx swaps from
// the old <Milestones /> to <Building />); the raw Milestones page lives at
// /project/:id/milestones (legacy single-segment path) for the power user
// timeline view.
//
// Data sources:
//   GET /api/projects/:id                              project name + desc
//   GET /api/projects/:id/sdk/autopilot/status         phase + percent + gate
//   GET /api/projects/:id/card_meta                    scene_count, version
//   GET /api/projects/:id/gallery                      scene asset list (build stream)
//   GET /api/projects/:id/gates                        gate queue
//   GET /api/projects/:id/build/events  (SSE)          milestone / asset / spend
//
// Wave 1 wire: the page now opens an EventSource against /build/events as the
// primary feed. Polling (every 3s) is retained as a SILENT fallback that only
// activates when SSE has been disconnected for > 30s. If the endpoint 404s the
// page degrades cleanly to polling-only. The status of the feed is reflected
// in the small "● live" chip next to the seed in the header.

const POLL_MS = 3000;
const SSE_FALLBACK_MS = 30000;     // give SSE 30s to recover before polling kicks in
const RECONNECT_DELAYS = [1000, 2000, 5000, 10000]; // exponential-ish, capped at 10s

// 6 user-facing phases (design's Option B), mapped to the autopilot's
// 9 actual STAGES. The phase a stage belongs to determines which card
// lights up + how progress accumulates within it.
const PHASE_BUCKETS = [
  { key: 'story_bible',  name: 'Story bible',   stages: ['brainstorm', 'story'] },
  { key: 'game_design',  name: 'Game design',   stages: ['characters'] },
  { key: 'art',          name: '1-bit art',     stages: ['scene_bursts', 'portrait_bursts', 'launcher'] },
  { key: 'audio',        name: 'Tones & music', stages: ['sfx', 'music'] },
  { key: 'lua_compile',  name: 'Lua compile',   stages: ['scene_lua'] },
  { key: 'pdx_package',  name: '.pdx package',  stages: [] }
  // pdx_package has no autopilot stage — it's the post-export step. Stays
  // queued until card_meta surfaces last_build_at, at which point it flips
  // to done.
];

const STAGE_INDEX = (() => {
  const idx = {};
  PHASE_BUCKETS.forEach((p, i) => {
    for (const s of p.stages) idx[s] = i;
  });
  return idx;
})();

function appBase() {
  return (typeof window !== 'undefined' && window.__APP_BASE__) || '';
}

function formatEta(stagesComplete, stagesTotal, startedAt) {
  if (!startedAt) return '—';
  if (!stagesComplete) return 'warming up…';
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  const perStage = elapsedMs / stagesComplete;
  const remaining = stagesTotal - stagesComplete;
  const etaMs = Math.max(0, perStage * remaining);
  const min = Math.floor(etaMs / 60000);
  const sec = Math.floor((etaMs % 60000) / 1000);
  if (min < 1) return `${sec}s`;
  return `${min} min ${sec}s`;
}

function formatRuntime(startedAt) {
  if (!startedAt) return '—';
  const elapsed = Date.now() - new Date(startedAt).getTime();
  const m = Math.floor(elapsed / 60000);
  const s = Math.floor((elapsed % 60000) / 1000);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

// Project seed — derive a deterministic placeholder from the project id
// so the "now building · 0xR23-G23S" stamp doesn't read as fiction.
function deriveSeed(id) {
  if (!id) return '0xR23-G23S';
  const hash = id.split('').reduce((acc, c) => ((acc * 31) ^ c.charCodeAt(0)) >>> 0, 5381);
  return `0x${hash.toString(16).toUpperCase().slice(0, 4)}-${id.slice(0, 8).toUpperCase()}`;
}

// ─── Small presentational helpers ───────────────────────────────────────────
function Panel({ title, right, children, padded = true }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)'
      }}
    >
      <div
        className="flex items-center font-mono uppercase"
        style={{
          padding: '10px 14px',
          gap: 10,
          borderBottom: '1px solid var(--border)',
          fontSize: 10,
          letterSpacing: '.12em',
          color: 'var(--text-muted)'
        }}
      >
        <span>{title}</span>
        {right ? <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>{right}</span> : null}
      </div>
      <div style={{ padding: padded ? 14 : 0 }}>{children}</div>
    </div>
  );
}

// LiveChip — tiny status dot + label next to the seed in the header.
//   live    → green dot, SSE actively pushing
//   polling → amber dot, falling back to 3s HTTP poll
//   down    → red dot, no feed at all (initial state before first connect)
function LiveChip({ status }) {
  const cfg = status === 'live'
    ? { dot: 'var(--ok)',     label: 'live',    fg: 'var(--ok)',     bg: 'oklch(74% 0.14 145 / .12)', bd: 'oklch(50% 0.10 145)' }
    : status === 'polling'
    ? { dot: 'var(--accent)', label: 'polling', fg: 'var(--accent)', bg: 'var(--accent-soft)',        bd: 'var(--accent-dim)' }
    : { dot: 'var(--danger)', label: 'offline', fg: 'var(--danger)', bg: 'oklch(64% 0.18 25 / .12)', bd: 'oklch(50% 0.15 25)' };
  return (
    <span
      className="font-mono uppercase"
      title={`event feed: ${cfg.label}`}
      style={{
        fontSize: 9,
        letterSpacing: '.1em',
        padding: '2px 7px',
        borderRadius: 99,
        background: cfg.bg,
        color: cfg.fg,
        border: `1px solid ${cfg.bd}`,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        lineHeight: 1.3
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6, height: 6, borderRadius: '50%',
          background: cfg.dot,
          boxShadow: status === 'live' ? `0 0 6px ${cfg.dot}` : 'none',
          flex: 'none'
        }}
      />
      {cfg.label}
    </span>
  );
}

function Tag({ tone, children }) {
  const toneMap = {
    accent: { fg: 'var(--accent)', bg: 'var(--accent-soft)', bd: 'var(--accent-dim)' },
    ok:     { fg: 'var(--ok)',     bg: 'oklch(74% 0.14 145 / .1)', bd: 'oklch(50% 0.1 145)' },
    dim:    { fg: 'var(--text-dim)', bg: 'transparent', bd: 'var(--border-2)' }
  };
  const s = toneMap[tone] || toneMap.dim;
  return (
    <span
      className="font-mono uppercase"
      style={{
        fontSize: 10,
        letterSpacing: '.08em',
        padding: '2px 7px',
        borderRadius: 3,
        background: s.bg, color: s.fg, border: `1px solid ${s.bd}`
      }}
    >{children}</span>
  );
}

function PhaseCard({ phase, state, pct, detail }) {
  const labelByState = { done: 'DONE', active: 'BUILDING', queued: 'QUEUED' };
  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column', gap: 8,
        padding: '12px 10px',
        borderRadius: 'var(--radius-sm)',
        background: state === 'active' ? 'var(--accent-soft)' : 'var(--bg-2)',
        border: '1px solid ' + (state === 'active' ? 'var(--accent-dim)' : state === 'done' ? 'var(--border-2)' : 'var(--border)'),
        minHeight: 86
      }}
    >
      <div
        className="font-mono uppercase"
        style={{
          fontSize: 10, letterSpacing: '.1em',
          color: state === 'active' ? 'var(--accent)' : state === 'done' ? 'var(--text-muted)' : 'var(--text-dim)'
        }}
      >
        {labelByState[state]}
      </div>
      <div style={{ fontSize: 13, color: 'var(--text-soft)' }}>{phase.name}</div>
      <div
        style={{
          height: 2, background: 'var(--bg)', borderRadius: 2,
          overflow: 'hidden'
        }}
      >
        <i
          style={{
            display: 'block', height: '100%',
            width: state === 'done' ? '100%' : state === 'active' ? `${Math.max(8, Math.min(100, pct))}%` : '0%',
            background: state === 'done' ? 'var(--text-muted)' : 'var(--accent)'
          }}
        />
      </div>
      <div
        className="font-mono"
        style={{
          fontSize: 10,
          color: state === 'active' ? 'var(--accent)' : 'var(--text-dim)',
          marginTop: 'auto'
        }}
      >
        {detail || ''}
      </div>
    </div>
  );
}

function SceneCard({ asset, stage, onClick, bust }) {
  // stage: done | building | queued | awaiting_review
  const empty = stage === 'queued' || stage === 'building';
  const base = asset?.imageUrl
    ? (asset.imageUrl.startsWith('/') ? appBase() + asset.imageUrl : asset.imageUrl)
    : null;
  const imageUrl = base && bust ? `${base}${base.includes('?') ? '&' : '?'}v=${bust}` : base;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        appearance: 'none',
        border: '1px solid ' + (stage === 'awaiting_review' ? 'var(--accent)' : 'var(--border)'),
        background: 'var(--surface)',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        padding: 0,
        textAlign: 'left',
        cursor: 'pointer',
        animation: stage === 'awaiting_review' ? 'sceneCardPulse 1.6s ease-in-out infinite' : 'none'
      }}
    >
      <div
        style={{
          aspectRatio: '16 / 10',
          background: empty ? 'var(--bg-2)' : 'oklch(85% 0.03 80)',
          position: 'relative', overflow: 'hidden',
          display: 'grid', placeItems: 'center'
        }}
      >
        {stage === 'done' && imageUrl ? (
          <img
            src={imageUrl}
            alt={asset.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated' }}
            onError={(e) => { e.currentTarget.style.display = 'none'; }}
          />
        ) : stage === 'queued' ? (
          <span className="font-mono" style={{ color: 'var(--text-dim)', fontSize: 11 }}>queued</span>
        ) : stage === 'building' ? (
          <div
            className="bsc-scan"
            style={{
              position: 'absolute', inset: 0
            }}
          />
        ) : stage === 'awaiting_review' ? (
          <span className="font-mono" style={{ color: 'var(--accent)', fontSize: 11 }}>awaiting review</span>
        ) : null}
      </div>
      <div
        className="flex items-center font-mono"
        style={{
          padding: '8px 10px',
          gap: 8, fontSize: 11,
          color: 'var(--text-muted)'
        }}
      >
        <span style={{ color: 'var(--text-soft)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {asset ? `${asset.id} · ${asset.name}` : ''}
        </span>
        <span style={{ color: stage === 'done' ? 'var(--ok)' : stage === 'building' ? 'var(--accent)' : stage === 'awaiting_review' ? 'var(--accent)' : 'var(--text-dim)' }}>
          {stage === 'done' ? '✓' : stage === 'building' ? '…' : stage === 'awaiting_review' ? '!' : ''}
        </span>
      </div>
    </button>
  );
}

function LogLine({ t, l, m }) {
  const lvlColor = {
    ok:   'var(--ok)',
    info: 'var(--text-muted)',
    warn: 'var(--accent)',
    err:  'var(--danger)',
    cmd:  'var(--phosphor)'
  }[l] || 'var(--text-muted)';
  // Highlight numbers + flags
  const html = (m || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/(--\w+|\d+(?:\.\d+)?(?:Hz|KB|MB|min|ms|s)?)/g, '<span style="color: var(--accent)">$1</span>');
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ color: 'var(--text-dim)', width: 56, flex: 'none' }}>{t}</span>
      <span style={{ color: lvlColor, width: 36, flex: 'none' }}>{l}</span>
      <span
        style={{ color: 'var(--text-soft)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function Building() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [snap,    setSnap]    = useState(null);
  const [meta,    setMeta]    = useState(null);
  const [assets,  setAssets]  = useState([]);
  const [gates,   setGates]   = useState([]);
  const [err,     setErr]     = useState(null);
  const [log,     setLog]     = useState(() => [
    { t: '00:00', l: 'cmd', m: '23s sdk autopilot start' }
  ]);
  // 'live'    — SSE is connected and pumping
  // 'polling' — SSE is closed or unavailable; polling is filling in
  // 'down'    — initial connection failing, no feed yet
  const [feedStatus, setFeedStatus] = useState('down');
  // Bumps a cache-bust query param on a per-asset basis when SSE pushes an
  // `asset` event; mirrors the cdn-bust pattern used by the gallery thumbnail
  // refresh in the workspace.
  const [assetBust, setAssetBust] = useState({});

  // Force a dark body bg (matches Library / Landing pattern).
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = 'var(--bg)';
    return () => { document.body.style.background = prev; };
  }, []);

  const lastSnapPhase = useRef(null);
  const lastSceneCount = useRef(0);

  const tick = useCallback(async () => {
    try {
      const [p, s, m, g, gt] = await Promise.allSettled([
        api.get(`/api/projects/${projectId}`),
        api.get(`/api/projects/${projectId}/sdk/autopilot/status`),
        api.get(`/api/projects/${projectId}/card_meta`),
        api.get(`/api/projects/${projectId}/gallery`),
        api.get(`/api/projects/${projectId}/gates`)
      ]);
      if (p.status === 'fulfilled') setProject((p.value && p.value.project) || p.value);
      if (s.status === 'fulfilled') setSnap(s.value);
      if (m.status === 'fulfilled') setMeta(m.value);
      if (g.status === 'fulfilled') setAssets((g.value && g.value.assets) || []);
      if (gt.status === 'fulfilled') setGates((gt.value && gt.value.gates) || []);
      setErr(null);

      // Append a synthetic log line on phase changes — gives the terminal
      // panel something to scroll without a real event bus.
      if (s.status === 'fulfilled') {
        const phase = s.value && s.value.phase;
        if (phase && phase !== lastSnapPhase.current) {
          const t = new Date();
          const ts = `${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
          setLog((prev) => [...prev.slice(-40), { t: ts, l: 'info', m: `phase → ${phase}` }]);
          lastSnapPhase.current = phase;
        }
      }
      // Append scene-count growth as well.
      if (g.status === 'fulfilled') {
        const sceneAssets = ((g.value && g.value.assets) || []).filter((a) => a.type === 'scene');
        if (sceneAssets.length > lastSceneCount.current) {
          const t = new Date();
          const ts = `${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
          setLog((prev) => [...prev.slice(-40), {
            t: ts, l: 'ok',
            m: `scene art → ${sceneAssets.length} ready`
          }]);
          lastSceneCount.current = sceneAssets.length;
        }
      }
    } catch (e) {
      setErr(e?.message || 'poll failed');
    }
  }, [projectId]);

  // Track the most recent moment SSE was confirmed alive (any event in or a
  // successful `hello`). The polling loop reads this to decide whether to
  // actually issue HTTP requests or stay quiet.
  const lastSseEventAt = useRef(0);
  const feedStatusRef = useRef('down');
  useEffect(() => { feedStatusRef.current = feedStatus; }, [feedStatus]);

  // Initial fetch always runs once so the page paints something even before
  // SSE establishes. After that, the interval only fires when SSE has gone
  // quiet for > SSE_FALLBACK_MS.
  useEffect(() => {
    tick();
    const id = setInterval(() => {
      if (feedStatusRef.current === 'live') {
        const since = Date.now() - lastSseEventAt.current;
        if (since < SSE_FALLBACK_MS) return; // SSE is driving — skip
      }
      tick();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [tick]);

  // ─── SSE connection ─────────────────────────────────────────────────────
  // Opens an EventSource at /api/projects/:id/build/events and consumes the
  // Wave 1A backend's hello/milestone/asset/spend events. On error/close,
  // reconnects with capped exponential backoff. On a 404 (endpoint not yet
  // shipped) we let the polling fallback take over silently.
  useEffect(() => {
    if (!projectId) return undefined;
    if (typeof window === 'undefined' || typeof window.EventSource !== 'function') {
      setFeedStatus('polling');
      return undefined;
    }

    let es = null;
    let reconnectTimer = null;
    let attempt = 0;
    let disposed = false;
    let gave_up = false;

    const appendLog = (level, message) => {
      const t = new Date();
      const ts = `${String(t.getMinutes()).padStart(2, '0')}:${String(t.getSeconds()).padStart(2, '0')}`;
      setLog((prev) => [...prev.slice(-40), { t: ts, l: level, m: message }]);
    };

    const scheduleReconnect = () => {
      if (disposed || gave_up) return;
      const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    const onHello = (evt) => {
      lastSseEventAt.current = Date.now();
      attempt = 0;
      setFeedStatus('live');
      try {
        const data = evt.data ? JSON.parse(evt.data) : null;
        if (data && data.message) {
          appendLog('ok', `sse → ${data.message}`);
        } else {
          appendLog('ok', 'sse → connected');
        }
      } catch (_e) {
        appendLog('ok', 'sse → connected');
      }
    };

    const onMilestone = (evt) => {
      lastSseEventAt.current = Date.now();
      setFeedStatus('live');
      try {
        const data = evt.data ? JSON.parse(evt.data) : null;
        if (!data) return;
        // Merge into snap (autopilot status shape) — partial update only.
        setSnap((prev) => {
          const base = prev || {};
          const next = { ...base };
          if (data.phase != null)            next.phase = data.phase;
          if (data.percent != null)          next.percent = data.percent;
          if (typeof data.running === 'boolean') next.running = data.running;
          if (data.stages_complete != null)  next.stages_complete = data.stages_complete;
          if (data.stages_total != null)     next.stages_total = data.stages_total;
          if (data.started_at != null)       next.started_at = data.started_at;
          if (data.awaiting_gate !== undefined) next.awaiting_gate = data.awaiting_gate;
          if (data.error)                    next.error = data.error;
          return next;
        });
        const label = data.phase
          ? `milestone → ${data.phase}${data.status ? ' (' + data.status + ')' : ''}`
          : `milestone update`;
        appendLog(data.error ? 'err' : (data.status === 'done' ? 'ok' : 'info'), label);
      } catch (e) {
        appendLog('warn', `milestone parse failed: ${e.message || e}`);
      }
    };

    const onAsset = (evt) => {
      lastSseEventAt.current = Date.now();
      setFeedStatus('live');
      try {
        const data = evt.data ? JSON.parse(evt.data) : null;
        if (!data) return;
        const incoming = data.asset || data; // accept either {asset:{...}} or flat
        if (!incoming || !incoming.id) {
          appendLog('warn', 'asset event missing id');
          return;
        }
        setAssets((prev) => {
          const cur = Array.isArray(prev) ? prev : [];
          const idx = cur.findIndex((a) => a.id === incoming.id);
          if (idx === -1) return [...cur, incoming];
          const merged = { ...cur[idx], ...incoming };
          const out = cur.slice();
          out[idx] = merged;
          return out;
        });
        // Cache-bust the thumbnail so the image element refetches.
        setAssetBust((prev) => ({ ...prev, [incoming.id]: Date.now() }));
        appendLog('ok', `asset → ${incoming.type || 'asset'} ${incoming.id}`);
      } catch (e) {
        appendLog('warn', `asset parse failed: ${e.message || e}`);
      }
    };

    const onSpend = (evt) => {
      lastSseEventAt.current = Date.now();
      setFeedStatus('live');
      try {
        const data = evt.data ? JSON.parse(evt.data) : null;
        if (!data) return;
        const delta = typeof data.cost === 'number' ? data.cost
                    : typeof data.amount === 'number' ? data.amount
                    : 0;
        const total = typeof data.cumulative === 'number' ? data.cumulative
                    : typeof data.total === 'number' ? data.total
                    : null;
        // Bump the cumulative cost on card_meta so the stats panel reflects
        // it without waiting for a card_meta poll.
        if (total != null) {
          setMeta((prev) => ({ ...(prev || {}), cost_total: total }));
        } else if (delta) {
          setMeta((prev) => ({
            ...(prev || {}),
            cost_total: ((prev && typeof prev.cost_total === 'number') ? prev.cost_total : 0) + delta
          }));
        }
        const note = data.note || data.kind || 'spend';
        const amountStr = delta ? `$${delta.toFixed(4)}` : '';
        appendLog('info', `spend → ${note} ${amountStr}`.trim());
      } catch (e) {
        appendLog('warn', `spend parse failed: ${e.message || e}`);
      }
    };

    const connect = () => {
      if (disposed) return;
      try {
        const url = `${appBase()}/api/projects/${projectId}/build/events`;
        es = new EventSource(url);
      } catch (e) {
        console.warn('[building] EventSource construct failed', e);
        setFeedStatus('polling');
        gave_up = true;
        return;
      }

      es.addEventListener('hello',     onHello);
      es.addEventListener('milestone', onMilestone);
      es.addEventListener('asset',     onAsset);
      es.addEventListener('spend',     onSpend);
      // Some servers also emit message-typed default events; mirror as info.
      es.onmessage = (evt) => {
        lastSseEventAt.current = Date.now();
        setFeedStatus('live');
        if (evt && evt.data) {
          try {
            const data = JSON.parse(evt.data);
            if (data && data.message) appendLog('info', `sse: ${data.message}`);
          } catch (_e) { /* swallow */ }
        }
      };

      es.onopen = () => {
        attempt = 0;
        lastSseEventAt.current = Date.now();
        setFeedStatus('live');
      };

      es.onerror = (_e) => {
        // EventSource auto-retries by default; we close + manage backoff
        // explicitly so we can flag the chip + fall through to polling.
        const readyState = es ? es.readyState : 2;
        try { if (es) es.close(); } catch (_x) { /* ignore */ }
        es = null;
        // readyState 2 = CLOSED. If the very first connect failed (e.g. 404),
        // log a single warn and stop retrying so we don't spam the console.
        if (attempt === 0 && readyState === 2 && lastSseEventAt.current === 0) {
          console.warn('[building] /build/events unavailable — falling back to 3s polling');
          appendLog('warn', 'sse unavailable — using poll fallback');
          gave_up = true;
          setFeedStatus('polling');
          return;
        }
        setFeedStatus('polling');
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (es) {
        try { es.close(); } catch (_e) { /* ignore */ }
      }
    };
  }, [projectId]);

  const seed = useMemo(() => deriveSeed(projectId), [projectId]);

  // Derive phase states from snap.phase.
  const phaseStates = useMemo(() => {
    const phase = snap?.phase || null;
    const activeBucket = phase != null ? STAGE_INDEX[phase] : null;
    return PHASE_BUCKETS.map((p, i) => {
      let state = 'queued';
      let pct = 0;
      if (snap && snap.running && activeBucket === i) {
        state = 'active';
        pct = 50; // bucket-internal progress isn't tracked; show half-fill
      } else if (activeBucket != null && i < activeBucket) {
        state = 'done';
      } else if (snap && !snap.running && snap.percent === 100 && i < PHASE_BUCKETS.length - 1) {
        // Pipeline finished all 9 stages — first 5 buckets done; last
        // (pdx_package) flips to done when card_meta shows a build.
        state = 'done';
      } else if (i === PHASE_BUCKETS.length - 1 && meta && meta.last_build_at) {
        state = 'done';
      }
      const detail = state === 'active' ? phase
        : state === 'done' ? 'complete'
        : '';
      return { phase: p, state, pct, detail };
    });
  }, [snap, meta]);

  // Build a 12-cell scene stream: real scene assets, then placeholders
  // for "queued" so the grid stays visually balanced.
  const sceneStream = useMemo(() => {
    const scenes = assets.filter((a) => a.type === 'scene');
    const expected = Math.max(scenes.length, meta?.scene_count || 0, 6);
    const out = [];
    const awaitingGate = snap?.awaiting_gate;
    for (let i = 0; i < expected; i += 1) {
      const a = scenes[i] || null;
      let stage;
      if (a) {
        // If a gate is open and this is the most recently produced scene,
        // surface as awaiting_review.
        if (awaitingGate && i === scenes.length - 1) stage = 'awaiting_review';
        else stage = 'done';
      } else if (i === scenes.length && snap?.running) {
        stage = 'building';
      } else {
        stage = 'queued';
      }
      out.push({ asset: a || { id: `scene_${i + 1}`, name: 'pending' }, stage });
    }
    return out;
  }, [assets, snap, meta]);

  // Live preview asset — newest done scene.
  const previewAsset = useMemo(() => {
    const scenes = assets.filter((a) => a.type === 'scene');
    if (scenes.length === 0) return null;
    return scenes[scenes.length - 1];
  }, [assets]);
  const previewUrlBase = previewAsset && previewAsset.imageUrl
    ? (previewAsset.imageUrl.startsWith('/') ? appBase() + previewAsset.imageUrl : previewAsset.imageUrl)
    : null;
  const previewBust = previewAsset ? assetBust[previewAsset.id] : null;
  const previewUrl = previewUrlBase && previewBust
    ? `${previewUrlBase}${previewUrlBase.includes('?') ? '&' : '?'}v=${previewBust}`
    : previewUrlBase;

  const sceneCount = assets.filter((a) => a.type === 'scene').length;
  const portraitCount = assets.filter((a) => a.type === 'portrait').length;
  const eta = formatEta(snap?.stages_complete || 0, snap?.stages_total || 9, snap?.started_at);
  const runtime = formatRuntime(snap?.started_at);

  const title = project?.name || projectId || '—';
  const oneLiner = (project?.description || '').slice(0, 140) || 'no pitch saved';

  const onCancel = () => {
    // Cancel route doesn't exist yet — navigate back so the user has an exit.
    navigate(`/projects/${projectId}/author/brief`);
  };
  const onOpenWorkspace = () => navigate(`/projects/${projectId}/author/gallery`);
  const onJumpToReview = (gateId) => {
    navigate(`/projects/${projectId}/author/gallery${gateId ? `?gate=${encodeURIComponent(gateId)}` : ''}`);
  };

  return (
    <div
      className="font-ui"
      style={{
        background: 'var(--bg)',
        color: 'var(--text)',
        minHeight: '100vh'
      }}
    >
      <style>{`
        @keyframes sceneCardPulse {
          0%, 100% { box-shadow: 0 0 0 0 var(--accent-soft); }
          50%      { box-shadow: 0 0 0 4px transparent; }
        }
        @keyframes scanMove {
          from { background-position: 0 0; }
          to   { background-position: 17px 17px; }
        }
        .bsc-scan {
          background:
            repeating-linear-gradient(45deg,
              oklch(85% 0.03 80) 0 6px,
              oklch(78% 0.03 80) 6px 12px);
          animation: scanMove 1.2s linear infinite;
        }
      `}</style>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 380px',
          gap: 24,
          padding: '24px 32px 40px'
        }}
      >
        {/* ─── LEFT column ───────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          {/* Header row */}
          <div className="flex items-center" style={{ gap: 16, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div
                className="font-mono uppercase"
                style={{
                  marginBottom: 4,
                  fontSize: 10,
                  letterSpacing: '.12em',
                  color: 'var(--text-muted)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8
                }}
              >
                <span>now building · {seed}</span>
                <LiveChip status={feedStatus} />
              </div>
              <h1
                style={{
                  margin: 0,
                  fontSize: 26, fontWeight: 500, letterSpacing: '-.02em',
                  color: 'var(--text)'
                }}
              >
                {title}
              </h1>
              <div
                className="font-mono"
                style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}
              >
                {oneLiner}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button
                type="button"
                onClick={onCancel}
                className="font-ui inline-flex items-center"
                style={{
                  background: 'transparent', color: 'var(--text-muted)',
                  border: '1px solid transparent',
                  padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                  fontSize: 12, gap: 6, cursor: 'pointer'
                }}
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
              <button
                type="button"
                disabled
                title="pause not yet implemented in the autopilot orchestrator"
                className="font-ui inline-flex items-center"
                style={{
                  background: 'var(--surface)', color: 'var(--text-dim)',
                  border: '1px solid var(--border-2)',
                  padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                  fontSize: 12, gap: 6, cursor: 'not-allowed', opacity: 0.55
                }}
              >
                <Pause className="w-3.5 h-3.5" /> Pause
              </button>
              <button
                type="button"
                onClick={onOpenWorkspace}
                className="font-ui inline-flex items-center"
                style={{
                  background: 'var(--accent)', color: 'var(--accent-ink)',
                  border: '1px solid var(--accent)',
                  padding: '6px 12px', borderRadius: 'var(--radius-sm)',
                  fontSize: 12, gap: 6, cursor: 'pointer', fontWeight: 600
                }}
              >
                Open workspace
                <span
                  style={{
                    background: 'rgba(0,0,0,.18)',
                    color: 'var(--accent-ink)',
                    borderRadius: 3,
                    padding: '1px 5px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10
                  }}
                >→</span>
              </button>
            </div>
          </div>

          {/* Phase bar */}
          <div
            style={{
              display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)',
              gap: 6,
              padding: 14,
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)'
            }}
          >
            {phaseStates.map((ps) => (
              <PhaseCard
                key={ps.phase.key}
                phase={ps.phase}
                state={ps.state}
                pct={ps.pct}
                detail={ps.detail}
              />
            ))}
          </div>

          {/* Scene stream */}
          <Panel
            title={`scenes · ${sceneCount} of ${Math.max(sceneCount, meta?.scene_count || 0)}`}
            right={
              <>
                <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {snap?.running ? 'auto-streaming' : (snap?.percent === 100 ? 'complete' : 'idle')}
                </span>
                {snap?.running ? <Tag tone="accent">live</Tag> : null}
              </>
            }
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 12
              }}
            >
              {sceneStream.slice(0, 12).map((s, i) => (
                <SceneCard
                  key={s.asset.id + ':' + i}
                  asset={s.asset}
                  stage={s.stage}
                  bust={assetBust[s.asset.id]}
                  onClick={() => onJumpToReview()}
                />
              ))}
            </div>
          </Panel>

          {err ? (
            <div
              className="font-mono inline-flex items-center"
              style={{
                color: 'var(--danger)', fontSize: 12,
                background: 'oklch(64% 0.18 25 / .12)',
                border: '1px solid oklch(50% 0.15 25)',
                padding: '8px 12px', borderRadius: 'var(--radius-sm)',
                gap: 8
              }}
            >
              <AlertCircle className="w-3.5 h-3.5" /> {err}
            </div>
          ) : null}
        </div>

        {/* ─── RIGHT rail ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, minWidth: 0 }}>
          {/* Build log */}
          <Panel
            title="build log"
            right={
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {log.length} lines
              </span>
            }
            padded={false}
          >
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                padding: 14,
                background: 'var(--bg-2)',
                maxHeight: 260,
                overflowY: 'auto',
                display: 'flex', flexDirection: 'column', gap: 4,
                borderTop: '1px solid var(--border)'
              }}
            >
              {log.map((ln, i) => (
                <LogLine key={i} t={ln.t} l={ln.l} m={ln.m} />
              ))}
              <div style={{ display: 'flex', gap: 10 }}>
                <span style={{ color: 'var(--text-dim)', width: 56 }}>--:--</span>
                <span style={{ color: 'var(--text-muted)', width: 36 }}>…</span>
                <span style={{ color: 'var(--text-dim)' }}>
                  {snap?.running ? 'awaiting next phase' : 'pipeline idle'}
                </span>
              </div>
            </div>
          </Panel>

          {/* Build stats */}
          <Panel title="build stats">
            <div className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              <StatRow k="target"     v="Playdate · 400×240 1-bit" />
              <StatRow k="scenes"     v={String(sceneCount)} />
              <StatRow k="portraits"  v={String(portraitCount)} />
              <StatRow k="eta"        v={eta} />
              <StatRow k="seed"       v={seed} />
              <StatRow k="runtime"    v={runtime} />
              <StatRow k="model"      v={meta?.image_model || 'openai/gpt-5-image'} />
              <StatRow k="cost"       v={typeof meta?.cost_total === 'number' ? `$${meta.cost_total.toFixed(2)}` : '—'} />
            </div>
          </Panel>

          {/* Live preview */}
          <Panel title="live preview">
            <div style={{ display: 'grid', placeItems: 'center', padding: 8 }}>
              <Handheld scale={0.7}>
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt={previewAsset.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated' }}
                  />
                ) : (
                  <div
                    className="font-lcd"
                    style={{
                      width: '100%', height: '100%',
                      display: 'grid', placeItems: 'center',
                      color: 'oklch(20% 0.01 75)',
                      fontSize: 22
                    }}
                  >
                    {snap?.running ? 'rendering…' : 'idle'}
                  </div>
                )}
              </Handheld>
              <div
                className="font-mono uppercase"
                style={{
                  marginTop: 10,
                  fontSize: 10, letterSpacing: '.12em',
                  color: 'var(--text-muted)'
                }}
              >
                {previewAsset
                  ? `latest · ${previewAsset.id}`
                  : (snap?.running ? 'awaiting first scene' : 'no preview yet')}
              </div>
            </div>
          </Panel>

          {/* Gate queue */}
          <Panel
            title="gate queue"
            right={
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {gates.filter((g) => g.status === 'active' || g.status === 'awaiting_review').length} open
              </span>
            }
          >
            {gates.length === 0 || gates.every((g) => g.status === 'signed_off') ? (
              <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>
                no pending reviews.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {gates
                  .filter((g) => g.status !== 'signed_off')
                  .slice(0, 5)
                  .map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => onJumpToReview(g.id)}
                      className="text-left flex items-center"
                      style={{
                        appearance: 'none',
                        background: 'var(--bg-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '8px 10px',
                        gap: 10, cursor: 'pointer'
                      }}
                    >
                      <Tag tone={g.status === 'awaiting_review' ? 'accent' : 'dim'}>
                        {g.status === 'awaiting_review' ? 'review' : g.status}
                      </Tag>
                      <span style={{ fontSize: 12, flex: 1, color: 'var(--text-soft)' }}>
                        {g.name || g.id}
                      </span>
                      <ArrowRight className="w-3.5 h-3.5" style={{ color: 'var(--text-dim)' }} />
                    </button>
                  ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function StatRow({ k, v }) {
  return (
    <div
      className="flex"
      style={{
        justifyContent: 'space-between',
        padding: '4px 0',
        borderBottom: '1px dashed var(--border)'
      }}
    >
      <span style={{ color: 'var(--text-dim)' }}>{k}</span>
      <span style={{ color: 'var(--text)' }}>{v}</span>
    </div>
  );
}
