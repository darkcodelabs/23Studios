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
//
// SSE was on the table but the existing stream POST /api/projects/:id/sdk/autopilot
// expects a fresh pitch body — it kicks off a NEW run rather than tailing the
// current one. Polling every 3s is good enough for the visible cadence.

const POLL_MS = 3000;

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

function SceneCard({ asset, stage, onClick }) {
  // stage: done | building | queued | awaiting_review
  const empty = stage === 'queued' || stage === 'building';
  const imageUrl = asset?.imageUrl
    ? (asset.imageUrl.startsWith('/') ? appBase() + asset.imageUrl : asset.imageUrl)
    : null;
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

  useEffect(() => {
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => clearInterval(id);
  }, [tick]);

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
  const previewUrl = previewAsset && previewAsset.imageUrl
    ? (previewAsset.imageUrl.startsWith('/') ? appBase() + previewAsset.imageUrl : previewAsset.imageUrl)
    : null;

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
                  color: 'var(--text-muted)'
                }}
              >
                now building · {seed}
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
