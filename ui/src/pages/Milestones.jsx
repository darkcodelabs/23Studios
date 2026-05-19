import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CheckCircle2, XCircle, Circle, Loader2, AlertTriangle, RefreshCw, Play, FileText, ChevronRight } from 'lucide-react';
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
    <div className={`border border-ink-800 border-l-2 ${toneRow} rounded-md bg-ink-900`}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <StatusDot boots={m.boots} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink-100">{LABELS[m.milestone] || m.milestone}</span>
            <span className="text-[10px] text-ink-500 font-mono">{m.milestone}</span>
          </div>
          <div className="text-[11px] text-ink-500 mt-0.5 flex items-center gap-3">
            <span>built: {fmtTs(m.built_at)}</span>
            <span>size: {fmtBytes(m.bytes)}</span>
            {m.errors && m.errors.length > 0 && (
              <span className="text-red-400 truncate max-w-xs">{m.errors[0]}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
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
    </div>
  );
}

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

      <div className="px-4 py-2 border-b border-ink-800 bg-ink-900 flex items-center gap-3 text-sm flex-wrap">
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
          <div className="max-w-2xl mx-auto space-y-2">
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
