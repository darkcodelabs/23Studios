import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronRight
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Severity helpers
// ---------------------------------------------------------------------------

function SeverityBadge({ severity }) {
  if (severity === 'pass') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-emerald-900/40 border border-emerald-700 text-emerald-300">
        <CheckCircle2 className="w-3 h-3" /> pass
      </span>
    );
  }
  if (severity === 'warn') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-amber-900/30 border border-amber-700 text-amber-300">
        <AlertTriangle className="w-3 h-3" /> warn
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-red-900/40 border border-red-700 text-red-300">
      <XCircle className="w-3 h-3" /> fail
    </span>
  );
}

function listOrNone(arr, label) {
  if (!arr || arr.length === 0) return null;
  return (
    <div className="mt-1.5">
      <span className="text-[10px] uppercase tracking-wider text-ink-500">{label}</span>
      <ul className="mt-0.5 space-y-0.5">
        {arr.map((item, i) => (
          <li key={i} className="text-[11px] text-ink-400 font-mono pl-2 border-l border-ink-700">
            {typeof item === 'string' ? item : JSON.stringify(item)}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Check row
// ---------------------------------------------------------------------------

const CHECK_LABELS = {
  rooms_reachable:      'Room reachability',
  item_refs_resolve:    'Item references resolve',
  dialogue_no_dead_ends:'Dialogue dead ends',
  puzzle_solvable:      'Puzzle solvability',
  endings_reachable:    'Endings reachable',
  flag_consistency:     'Flag consistency'
};

function CheckRow({ check }) {
  const [open, setOpen] = useState(check.severity !== 'pass');
  const label = CHECK_LABELS[check.id] || check.id;
  const Chevron = open ? ChevronDown : ChevronRight;

  const rowBorder =
    check.severity === 'fail' ? 'border-red-900/50' :
    check.severity === 'warn' ? 'border-amber-900/40' :
                                'border-ink-800';

  return (
    <div className={`rounded-md border ${rowBorder} bg-ink-900 overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-ink-800/40 transition-colors"
      >
        <Chevron className="w-3.5 h-3.5 text-ink-500 flex-shrink-0" />
        <SeverityBadge severity={check.severity} />
        <span className="text-sm text-ink-100 flex-1">{label}</span>
        <span className="text-[11px] text-ink-500 font-mono">{check.id}</span>
      </button>

      {open && (
        <div className="px-4 pb-3 pt-0.5 border-t border-ink-800 space-y-1.5">
          {check.detail && (
            <p className="text-[12px] text-ink-300 mt-1.5">{check.detail}</p>
          )}
          {listOrNone(check.orphans, 'orphan rooms')}
          {listOrNone(check.broken, 'broken refs')}
          {listOrNone(check.terminal_nodes, 'terminal nodes')}
          {listOrNone(check.unreachable, 'unreachable')}
          {listOrNone(check.cycles && check.cycles[0], 'cyclic puzzles')}
          {listOrNone(check.read_never_written, 'flags read but never written')}
          {listOrNone(check.written_never_read, 'flags written but never read')}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary bar
// ---------------------------------------------------------------------------

function SummaryBar({ summary }) {
  return (
    <div className="flex gap-4 text-sm">
      <span className="text-emerald-400 font-medium">{summary.passed} passed</span>
      <span className="text-amber-400 font-medium">{summary.warned} warned</span>
      <span className="text-red-400 font-medium">{summary.failed} failed</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function DesignValidator() {
  const { id: projectId } = useParams();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);

  const loadLatest = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get(`/api/projects/${projectId}/design/validate/latest`);
      setReport(r);
    } catch (e) {
      if (e.status === 404) setReport(null);
      else setErr(e.message || 'failed to load report');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadLatest(); }, [loadLatest]);

  async function runValidation() {
    setRunning(true);
    setErr(null);
    try {
      const r = await api.post(`/api/projects/${projectId}/design/validate`, {});
      setReport(r);
    } catch (e) {
      if (e && e.error === 'no_compiled_design') {
        setErr('No compiled_design.json found. Run the design compiler first.');
      } else {
        setErr(e.message || 'validation failed');
      }
    } finally {
      setRunning(false);
    }
  }

  const noCompile = report && !report.ok && report.error === 'no_compiled_design';

  return (
    <div className="h-screen flex flex-col bg-ink-950 text-ink-100">
      <Nav subtitle="design validator" />

      <div className="flex-1 min-h-0 overflow-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-base font-semibold text-ink-100">Static Design Validator</h1>
              <p className="text-[12px] text-ink-500 mt-0.5">
                Checks compiled_design.json for structural issues before Lua generation.
              </p>
            </div>
            <button
              type="button"
              onClick={runValidation}
              disabled={running}
              className="btn btn-primary flex items-center gap-2 text-sm"
            >
              {running
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
              {running ? 'Running…' : 'Run validation'}
            </button>
          </div>

          {/* Error banner */}
          {err && (
            <div className="rounded-md bg-red-900/30 border border-red-700 px-3 py-2.5 text-sm text-red-300">
              {err}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <Loader2 className="w-4 h-4 animate-spin" /> loading last report…
            </div>
          )}

          {/* No report yet */}
          {!loading && !report && !err && (
            <div className="rounded-md bg-ink-900 border border-ink-800 px-4 py-6 text-center space-y-2">
              <p className="text-sm text-ink-400">No validation report yet.</p>
              <p className="text-[12px] text-ink-600">
                Run the design compiler, then click "Run validation" above.
              </p>
            </div>
          )}

          {/* no_compiled_design */}
          {noCompile && (
            <div className="rounded-md bg-amber-900/20 border border-amber-700 px-4 py-3 text-sm text-amber-300 space-y-1">
              <p className="font-medium">compiled_design.json not found</p>
              <p className="text-[12px] text-amber-400">{report.detail}</p>
            </div>
          )}

          {/* Report */}
          {report && report.checks && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="rounded-md bg-ink-900 border border-ink-800 px-4 py-3 flex items-center justify-between gap-4">
                <SummaryBar summary={report.summary} />
                <div className="flex items-center gap-2">
                  {report.ok
                    ? <span className="pill pill-ok text-xs">ok</span>
                    : <span className="pill pill-error text-xs">issues found</span>}
                  {report.ran_at && (
                    <span className="text-[10px] text-ink-600">
                      {new Date(report.ran_at).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>

              {/* Check rows */}
              <div className="space-y-2">
                {report.checks.map((check) => (
                  <CheckRow key={check.id} check={check} />
                ))}
              </div>
            </div>
          )}

          {/* Back link */}
          <div className="pt-2">
            <Link
              to={`/project/${projectId}/ship`}
              className="text-[12px] text-ink-500 hover:text-ink-300 transition-colors"
            >
              back to ship status
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}
