import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  CheckCircle2, XCircle, Circle, Loader2, AlertTriangle, RefreshCw,
  Play, FileText, ChevronRight, ChevronDown, SkipForward, RotateCcw
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

// Milestone page — vertical timeline of 9 milestone builds.
// Route: /project/:id/milestones

const LABELS = {
  m01_boot:          'Boot',
  m02_title:         'Title screen',
  m03_first_room:    'First room',
  m04_inventory:     'Inventory',
  m05_dialogue:      'Dialogue',
  m06_puzzles:       'Puzzles',
  m07_full_game:     'Full game',
  m08_polish:        'Polish (SFX + music)',
  release_candidate: 'Release candidate'
};

function StatusDot({ boots }) {
  if (boots === true)  return <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />;
  if (boots === false) return <XCircle      className="w-4 h-4 text-red-400 flex-shrink-0" />;
  return                      <Circle       className="w-4 h-4 text-ink-600 flex-shrink-0" />;
}

function fmtBytes(b) {
  if (b == null) return '—';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(2) + ' MB';
}

function fmtTs(s) {
  if (!s) return '—';
  return new Date(s).toLocaleString();
}

// ---------------------------------------------------------------------------
// Smoketest detail card
// ---------------------------------------------------------------------------

function SmokePill({ st }) {
  if (st.skipped) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-ink-800 border border-ink-700 text-ink-400">
        <SkipForward className="w-3 h-3" /> skipped
        {st.reason && <span className="text-ink-500 ml-1">({st.reason})</span>}
      </span>
    );
  }
  if (st.ok && st.booted) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-emerald-900/40 border border-emerald-700 text-emerald-300">
        <CheckCircle2 className="w-3 h-3" /> booted
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-red-900/40 border border-red-700 text-red-300">
      <XCircle className="w-3 h-3" /> crashed
    </span>
  );
}

function SmoketestCard({ st, projectId, milestone }) {
  const [open, setOpen] = useState(!st.ok);
  const [rerunning, setRerunning] = useState(false);
  const [rerunErr, setRerunErr] = useState(null);

  async function handleRerun() {
    setRerunning(true);
    setRerunErr(null);
    try {
      await api.post(`/api/projects/${projectId}/milestones/${milestone}/smoketest`, {});
    } catch (e) {
      setRerunErr(e?.message || 'smoketest failed');
    } finally {
      setRerunning(false);
    }
  }

  const hasErrors   = st.errors   && st.errors.length > 0;
  const hasWarnings = st.warnings && st.warnings.length > 0;
  const durationSec = st.duration_ms != null ? (st.duration_ms / 1000).toFixed(1) + 's' : null;

  return (
    <div className="border-t border-ink-800 bg-ink-950/50">
      <div className="flex items-center gap-2 px-3 py-1.5 text-[11px]">
        <span className="text-ink-500 select-none">smoketest</span>
        <SmokePill st={st} />
        {durationSec && <span className="text-ink-500">{durationSec}</span>}
        {st.est_fps != null && <span className="text-ink-500">{st.est_fps} fps</span>}
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleRerun}
          disabled={rerunning}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-ink-800 hover:bg-ink-700 text-ink-300 text-[11px] disabled:opacity-50"
        >
          {rerunning ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
          Re-run smoketest
        </button>
        {(hasErrors || hasWarnings) && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="text-ink-500 hover:text-ink-300"
          >
            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        )}
      </div>

      {rerunErr && (
        <div className="px-3 pb-1.5 flex items-center gap-1.5 text-[11px] text-red-400">
          <AlertTriangle className="w-3 h-3" /> {rerunErr}
        </div>
      )}

      {open && (hasErrors || hasWarnings) && (
        <div className="px-3 pb-2 space-y-1.5">
          {hasErrors && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-red-500">Errors</span>
              <ul className="mt-0.5 space-y-0.5">
                {st.errors.map((e, i) => (
                  <li key={i} className="text-[11px] text-red-300 font-mono pl-2 border-l border-red-800">
                    {e}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasWarnings && (
            <div>
              <span className="text-[10px] uppercase tracking-wider text-amber-500">Warnings</span>
              <ul className="mt-0.5 space-y-0.5">
                {st.warnings.map((w, i) => (
                  <li key={i} className="text-[11px] text-amber-300 font-mono pl-2 border-l border-amber-800">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Milestone row
// ---------------------------------------------------------------------------

function MilestoneRow({ m, projectId, onBuildDone }) {
  const [building, setBuilding] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [log, setLog]         = useState(null);
  const [logErr, setLogErr]   = useState(null);

  const toneRow =
    m.boots === true  ? 'border-l-emerald-500/40' :
    m.boots === false ? 'border-l-red-500/40'     :
                        'border-l-ink-700';

  async function handleBuild() {
    setBuilding(true);
    try {
      await api.post(`/api/projects/${projectId}/milestones/build`, { milestone: m.milestone });
      onBuildDone();
    } catch (e) {
      console.error('[milestone build]', e);
    } finally {
      setBuilding(false);
    }
  }

  async function handleLog() {
    if (showLog) { setShowLog(false); return; }
    setShowLog(true);
    setLog(null);
    setLogErr(null);
    try {
      const raw = await api.get(`/api/projects/${projectId}/milestones/${m.milestone}/log`);
      setLog(typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2));
    } catch (e) {
      setLogErr(e?.detail?.detail || e?.message || 'failed');
    }
  }

  return (
    <div className={`border border-ink-800 border-l-2 ${toneRow} rounded-md bg-ink-900 overflow-hidden`}>
      <div className="flex items-center gap-3 px-3 py-2.5 flex-wrap sm:flex-nowrap">
        <StatusDot boots={m.boots} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-ink-100">{LABELS[m.milestone] || m.milestone}</span>
            <span className="text-[10px] text-ink-500 font-mono">{m.milestone}</span>
          </div>
          <div className="text-[11px] text-ink-500 mt-0.5 flex items-center gap-3 flex-wrap">
            <span>built: {fmtTs(m.built_at)}</span>
            <span>size: {fmtBytes(m.bytes)}</span>
            {m.errors && m.errors.length > 0 && (
              <span className="text-red-400 truncate max-w-xs">{m.errors[0]}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap gap-y-1">
          <button
            type="button"
            onClick={handleBuild}
            disabled={building}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-ink-800 hover:bg-ink-700 text-ink-200 text-xs disabled:opacity-50"
          >
            {building ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
            Build
          </button>
          <button
            type="button"
            onClick={handleLog}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-ink-800 hover:bg-ink-700 text-ink-200 text-xs"
          >
            <FileText className="w-3 h-3" />
            Log
          </button>
        </div>
      </div>

      {showLog && (
        <div className="border-t border-ink-800 px-3 py-2">
          {log == null && logErr == null && (
            <div className="flex items-center gap-1.5 text-xs text-ink-400">
              <Loader2 className="w-3 h-3 animate-spin" /> loading log…
            </div>
          )}
          {logErr && (
            <div className="flex items-center gap-1.5 text-xs text-red-400">
              <AlertTriangle className="w-3 h-3" /> {logErr}
            </div>
          )}
          {log != null && (
            <pre className="text-[10px] text-ink-300 font-mono whitespace-pre-wrap break-all max-h-48 overflow-auto">
              {log}
            </pre>
          )}
        </div>
      )}

      {/* Smoketest detail card — shown when status.smoketest is present */}
      {m.status && m.status.smoketest && (
        <SmoketestCard
          st={m.status.smoketest}
          projectId={projectId}
          milestone={m.milestone}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Milestones() {
  const { id: projectId } = useParams();
  const [milestones, setMilestones] = useState(null);
  const [error, setError]           = useState(null);
  const [buildingAll, setBuildingAll] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await api.get(`/api/projects/${projectId}/milestones`);
      setMilestones(r.milestones || []);
    } catch (e) {
      setError(e?.detail?.detail || e?.message || 'failed to load milestones');
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  async function handleBuildAll() {
    setBuildingAll(true);
    try {
      await api.post(`/api/projects/${projectId}/milestones/build_all`, {});
      await load();
    } catch (e) {
      setError(e?.detail?.detail || e?.message || 'build_all failed');
    } finally {
      setBuildingAll(false);
    }
  }

  const total  = milestones ? milestones.length : 0;
  const done   = milestones ? milestones.filter((m) => m.boots === true).length  : 0;
  const failed = milestones ? milestones.filter((m) => m.boots === false).length : 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      <Nav subtitle="Milestones" />

      <div className="px-4 py-2 border-b border-ink-800 bg-ink-900 flex items-center gap-3 text-sm flex-wrap gap-y-2">
        <Link to={`/project/${projectId}`} className="text-ink-400 hover:text-ink-200 text-xs">
          <ChevronRight className="w-3 h-3 inline rotate-180" /> project
        </Link>
        <span className="text-ink-500">·</span>
        <span className="text-ink-300 text-xs">
          {done}/{total} built
          {failed > 0 && <span className="text-red-400 ml-2">{failed} failed</span>}
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-ink-800 hover:bg-ink-700 text-ink-200 text-xs"
        >
          <RefreshCw className="w-3 h-3" /> refresh
        </button>
        <button
          type="button"
          onClick={handleBuildAll}
          disabled={buildingAll}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-accent hover:bg-accent/90 text-white text-xs font-medium disabled:opacity-50"
        >
          {buildingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
          Build all
        </button>
      </div>

      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded border border-red-500/30 bg-red-500/10 text-red-300 text-xs flex items-center gap-2">
          <AlertTriangle className="w-3.5 h-3.5" /> {error}
        </div>
      )}

      {milestones == null && !error ? (
        <div className="flex-1 flex items-center justify-center text-ink-400 text-sm">
          <Loader2 className="w-4 h-4 mr-2 animate-spin" /> loading…
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-4">
          <div className="w-full max-w-2xl mx-auto space-y-2">
            {(milestones || []).map((m) => (
              <MilestoneRow
                key={m.milestone}
                m={m}
                projectId={projectId}
                onBuildDone={load}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
