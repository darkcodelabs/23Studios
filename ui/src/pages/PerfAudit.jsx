import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Loader2, RefreshCw, CheckCircle2, AlertTriangle, XCircle,
  ChevronDown, ChevronRight, Image, Volume2, Layers, Cpu, Copy, FileWarning
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtBytes(b) {
  if (b == null || b === 0) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(2) + ' MB';
}

function basename(p) {
  if (!p) return '';
  return p.split('/').pop();
}

function SevBadge({ severity }) {
  if (severity === 'ok') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded bg-emerald-900/40 border border-emerald-700 text-emerald-300">
        <CheckCircle2 className="w-3 h-3" /> ok
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

// ---------------------------------------------------------------------------
// Summary tiles
// ---------------------------------------------------------------------------

function Tile({ icon: Icon, label, value, sub, accent }) {
  const border = accent === 'fail' ? 'border-red-800' : accent === 'warn' ? 'border-amber-800' : 'border-ink-800';
  return (
    <div className={`rounded-lg border ${border} bg-ink-900 px-4 py-3 flex items-start gap-3`}>
      <Icon className="w-5 h-5 text-ink-500 mt-0.5 flex-shrink-0" />
      <div className="min-w-0">
        <p className="text-[11px] text-ink-500 uppercase tracking-wide">{label}</p>
        <p className="text-lg font-semibold text-ink-100 leading-tight">{value}</p>
        {sub && <p className="text-[11px] text-ink-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

function Section({ title, count, defaultOpen, children }) {
  const [open, setOpen] = useState(defaultOpen !== false);
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <div className="rounded-md border border-ink-800 bg-ink-900 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-ink-800/40 transition-colors"
      >
        <Chevron className="w-3.5 h-3.5 text-ink-500 flex-shrink-0" />
        <span className="text-sm font-medium text-ink-100 flex-1">{title}</span>
        {count != null && (
          <span className="text-[11px] text-ink-500 font-mono">{count} item{count === 1 ? '' : 's'}</span>
        )}
      </button>
      {open && (
        <div className="border-t border-ink-800 px-3 pb-3 pt-2">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image sizes table (sortable)
// ---------------------------------------------------------------------------

function ImageSizesTable({ rows }) {
  const [sortKey, setSortKey] = useState('bytes');
  const [asc, setAsc] = useState(false);

  if (!rows || rows.length === 0) {
    return <p className="text-[12px] text-ink-500">No images found.</p>;
  }

  function toggleSort(key) {
    if (sortKey === key) setAsc((v) => !v);
    else { setSortKey(key); setAsc(false); }
  }

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    return asc ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1);
  });

  function Th({ k, label }) {
    const active = sortKey === k;
    return (
      <th
        className={`text-left text-[11px] uppercase tracking-wide px-2 py-1.5 cursor-pointer select-none ${active ? 'text-ink-200' : 'text-ink-500'} hover:text-ink-300`}
        onClick={() => toggleSort(k)}
      >
        {label} {active ? (asc ? '↑' : '↓') : ''}
      </th>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-ink-800">
            <Th k="path" label="File" />
            <Th k="bytes" label="Size" />
            <Th k="w" label="Width" />
            <Th k="h" label="Height" />
            <th className="text-left text-[11px] uppercase tracking-wide px-2 py-1.5 text-ink-500">Severity</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((img, i) => (
            <tr key={i} className="border-b border-ink-800/50 hover:bg-ink-800/20">
              <td className="px-2 py-1.5 font-mono text-ink-300 max-w-[200px] truncate" title={img.path}>{basename(img.path)}</td>
              <td className="px-2 py-1.5 text-ink-400">{fmtBytes(img.bytes)}</td>
              <td className="px-2 py-1.5 text-ink-400">{img.w || '—'}</td>
              <td className="px-2 py-1.5 text-ink-400">{img.h || '—'}</td>
              <td className="px-2 py-1.5"><SevBadge severity={img.severity} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Draw calls bar chart proxy
// ---------------------------------------------------------------------------

const DRAW_MAX = 40; // axis scale

function DrawCallsChart({ rows }) {
  if (!rows || rows.length === 0) {
    return <p className="text-[12px] text-ink-500">No scene Lua files found.</p>;
  }
  const sorted = [...rows].sort((a, b) => b.count - a.count);
  return (
    <div className="space-y-1.5">
      {sorted.map((sc, i) => {
        const pct = Math.min((sc.count / DRAW_MAX) * 100, 100);
        const barColor =
          sc.severity === 'fail' ? 'bg-red-600' :
          sc.severity === 'warn' ? 'bg-amber-500' :
          'bg-emerald-600';
        return (
          <div key={i} className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-ink-400 w-40 truncate flex-shrink-0" title={sc.scene}>
              {basename(sc.scene)}
            </span>
            <div className="flex-1 bg-ink-800 rounded-full h-2.5 overflow-hidden">
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] font-mono text-ink-400 w-8 text-right flex-shrink-0">{sc.count}</span>
            <SevBadge severity={sc.severity} />
          </div>
        );
      })}
      <p className="text-[10px] text-ink-600 mt-1">Bar scaled to {DRAW_MAX} calls. Warn threshold: 20.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Duplications list
// ---------------------------------------------------------------------------

function DuplicationsList({ rows }) {
  if (!rows || rows.length === 0) {
    return <p className="text-[12px] text-ink-500">No duplicate assets detected.</p>;
  }
  return (
    <ul className="space-y-2">
      {rows.map((dup, i) => (
        <li key={i} className="rounded border border-ink-800 bg-ink-950 px-3 py-2">
          <div className="flex items-center gap-2 mb-1">
            <Copy className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <span className="text-[11px] text-amber-300 font-medium">{dup.count} copies</span>
            <code className="text-[10px] text-ink-500 font-mono">{dup.hash.slice(0, 12)}…</code>
          </div>
          <ul className="pl-5 space-y-0.5">
            {dup.files.map((f, j) => (
              <li key={j} className="text-[11px] text-ink-400 font-mono">{basename(f)}</li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Placeholders list
// ---------------------------------------------------------------------------

function PlaceholdersList({ rows }) {
  if (!rows || rows.length === 0) {
    return <p className="text-[12px] text-ink-500">No placeholders detected.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {rows.map((ph, i) => (
        <li key={i} className="flex items-start gap-2">
          <FileWarning className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <span className="text-[12px] text-ink-200 font-mono">{basename(ph.path)}</span>
            <span className="text-[11px] text-ink-500 ml-2">{ph.kind}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Fixes list
// ---------------------------------------------------------------------------

function FixesList({ rows }) {
  if (!rows || rows.length === 0) {
    return <p className="text-[12px] text-ink-500">No issues found.</p>;
  }
  const sorted = [...rows].sort((a, b) => {
    const rank = { fail: 0, warn: 1, ok: 2 };
    return (rank[a.severity] || 2) - (rank[b.severity] || 2);
  });
  return (
    <ul className="space-y-2">
      {sorted.map((f, i) => (
        <li key={i} className="rounded border border-ink-800 bg-ink-950 px-3 py-2">
          <div className="flex items-start gap-2">
            <SevBadge severity={f.severity} />
            <div className="min-w-0">
              <p className="text-[12px] text-ink-200 font-medium">{f.item}</p>
              <p className="text-[11px] text-ink-400 mt-0.5">{f.recommendation}</p>
              {f.fix_hint && (
                <p className="text-[11px] text-ink-600 mt-0.5 italic">{f.fix_hint}</p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function PerfAudit() {
  const { id: projectId } = useParams();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);

  const loadLatest = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get(`/api/projects/${projectId}/perf/audit/latest`);
      setReport(r);
    } catch (e) {
      if (e.status === 404) setReport(null);
      else setErr(e.message || 'failed to load report');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadLatest(); }, [loadLatest]);

  async function runAudit() {
    setRunning(true);
    setErr(null);
    try {
      const r = await api.post(`/api/projects/${projectId}/perf/audit`, {});
      setReport(r);
    } catch (e) {
      setErr((e && e.detail && e.detail.detail) || (e && e.message) || 'audit failed');
    } finally {
      setRunning(false);
    }
  }

  const summary = report && report.summary;
  const memEst  = report && report.memory_estimate;

  const memAccent = memEst
    ? (memEst.severity === 'fail' ? 'fail' : memEst.severity === 'warn' ? 'warn' : null)
    : null;
  const warnAccent = summary && summary.warnings > 0 ? 'warn' : null;
  const errAccent  = summary && summary.errors > 0   ? 'fail' : null;

  return (
    <div className="h-screen flex flex-col bg-ink-950 text-ink-100">
      <Nav subtitle="perf audit" />

      <div className="flex-1 min-h-0 overflow-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-base font-semibold text-ink-100">Performance Audit</h1>
              <p className="text-[12px] text-ink-500 mt-0.5">
                Static scan: sprite count, image sizes, memory budget, draw calls, duplicates, placeholders.
              </p>
            </div>
            <button
              type="button"
              onClick={runAudit}
              disabled={running || loading}
              className="btn btn-primary flex items-center gap-2 text-sm"
            >
              {running
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
              {running ? 'Auditing…' : 'Run audit'}
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
              <Loader2 className="w-4 h-4 animate-spin" /> Loading last report…
            </div>
          )}

          {/* No report yet */}
          {!loading && !report && !err && (
            <div className="rounded-md border border-ink-800 bg-ink-900 px-4 py-6 text-center">
              <p className="text-sm text-ink-400">No audit report yet. Click "Run audit" to scan the project.</p>
            </div>
          )}

          {/* Report */}
          {report && summary && (
            <>
              {/* Audited timestamp */}
              {report.audited_at && (
                <p className="text-[11px] text-ink-600">
                  Last audited: {new Date(report.audited_at).toLocaleString()}
                </p>
              )}

              {/* Summary tiles */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Tile
                  icon={Image}
                  label="Total images"
                  value={fmtBytes(summary.total_image_bytes)}
                  sub={memEst ? `${memEst.budget_pct}% of 4 MB budget` : null}
                  accent={memAccent}
                />
                <Tile
                  icon={Volume2}
                  label="Total audio"
                  value={fmtBytes(summary.total_audio_bytes)}
                />
                <Tile
                  icon={Layers}
                  label="Sprite tables"
                  value={summary.sprite_count}
                  sub={`${summary.scene_count} scene${summary.scene_count === 1 ? '' : 's'}`}
                />
                <Tile
                  icon={AlertTriangle}
                  label="Warnings"
                  value={summary.warnings}
                  accent={warnAccent}
                />
                <Tile
                  icon={XCircle}
                  label="Errors"
                  value={summary.errors}
                  accent={errAccent}
                />
                {memEst && (
                  <Tile
                    icon={Cpu}
                    label="RAM estimate"
                    value={fmtBytes(memEst.total)}
                    sub={`severity: ${memEst.severity}`}
                    accent={memAccent}
                  />
                )}
              </div>

              {/* Image sizes */}
              <Section title="Image Sizes" count={report.image_sizes ? report.image_sizes.length : 0}>
                <ImageSizesTable rows={report.image_sizes} />
              </Section>

              {/* Draw calls */}
              <Section title="Draw Calls per Scene" count={report.draw_calls ? report.draw_calls.length : 0}>
                <DrawCallsChart rows={report.draw_calls} />
              </Section>

              {/* Duplications */}
              <Section
                title="Asset Duplications"
                count={report.duplications ? report.duplications.length : 0}
                defaultOpen={report.duplications && report.duplications.length > 0}
              >
                <DuplicationsList rows={report.duplications} />
              </Section>

              {/* Placeholders */}
              <Section
                title="Placeholders"
                count={report.placeholders ? report.placeholders.length : 0}
                defaultOpen={report.placeholders && report.placeholders.length > 0}
              >
                <PlaceholdersList rows={report.placeholders} />
              </Section>

              {/* Fixes */}
              <Section
                title="Fixes (prioritized)"
                count={report.fixes ? report.fixes.length : 0}
                defaultOpen
              >
                <FixesList rows={report.fixes} />
              </Section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
