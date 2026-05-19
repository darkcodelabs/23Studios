import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, AlertCircle, Loader2, Play, FileCode } from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

// LintPage — paste Lua → see findings inline. Phase 6 B10.
//
// Also offers "lint all scenes" which calls /api/projects/:id/lint/all and
// walks every scene_lua attached to sdk_data/project.json.

export default function LintPage() {
  const { id } = useParams();
  const [lua, setLua] = useState('');
  const [findings, setFindings] = useState(null);
  const [summary, setSummary] = useState(null);
  const [allScenes, setAllScenes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function lintOne() {
    if (!lua.trim()) return;
    setBusy(true); setErr(null); setAllScenes(null);
    try {
      const r = await api.post(`/api/projects/${id}/lint`, { lua, file_path: 'inline.lua' });
      setFindings(r.findings || []);
      setSummary(r.summary || null);
    } catch (e) { setErr(e?.detail || e?.message || 'lint failed'); }
    finally { setBusy(false); }
  }

  async function lintAll() {
    setBusy(true); setErr(null); setFindings(null); setSummary(null);
    try {
      const r = await api.post(`/api/projects/${id}/lint/all`, {});
      setAllScenes(r);
    } catch (e) { setErr(e?.detail || e?.message || 'lint failed'); }
    finally { setBusy(false); }
  }

  return (
    <div className="h-screen flex flex-col bg-ink-900 text-ink-100">
      <Nav subtitle={`lint · ${id}`} showSiderailToggle={false} />
      <div className="flex-1 overflow-auto px-4 py-6">
        <div className="max-w-5xl mx-auto space-y-6">
          <header className="flex items-center gap-3">
            <FileCode className="w-4 h-4 text-ink-400" />
            <h1 className="text-sm text-ink-200">Lua Lint</h1>
            <span className="text-[11px] text-ink-500">SKILL.md #2 #6 #8 #9 #11 #12 #14 + mandatory calls + bootstrap</span>
          </header>

          <section className="space-y-2">
            <textarea
              rows={14} value={lua}
              onChange={(e) => setLua(e.target.value)}
              placeholder="paste Lua here…"
              className="w-full bg-ink-800/60 ring-1 ring-ink-800 rounded-md px-3 py-2 text-sm font-mono text-ink-100 leading-relaxed resize-y"
            />
            <div className="flex gap-2">
              <button onClick={lintOne} disabled={busy || !lua.trim()} className="btn-primary text-xs disabled:opacity-50">
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />} lint paste
              </button>
              <button onClick={lintAll} disabled={busy} className="btn text-xs disabled:opacity-50">
                {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : null} lint all scenes
              </button>
            </div>
          </section>

          {err && (
            <div className="text-xs text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3" /> {err}
            </div>
          )}

          {summary && <SummaryBar summary={summary} />}
          {findings && <FindingsList findings={findings} />}

          {allScenes && (
            <div className="space-y-4">
              <SummaryBar summary={allScenes.summary} />
              {(allScenes.files || []).map((f) => (
                <div key={f.scene_id} className="rounded-md ring-1 ring-ink-800 bg-ink-900">
                  <div className="px-3 py-2 border-b border-ink-800 flex items-center gap-2 text-xs text-ink-300">
                    <FileCode className="w-3 h-3" /> {f.scene_name}
                    <span className="text-ink-500 font-mono">{f.scene_id}</span>
                    <span className="ml-auto text-[11px] text-ink-500">
                      {f.summary.errors}E · {f.summary.warnings}W
                    </span>
                  </div>
                  <FindingsList findings={f.findings} compact />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryBar({ summary }) {
  const blocked = summary.errors > 0;
  return (
    <div className={`text-xs px-3 py-2 rounded ${blocked ? 'bg-red-500/15 text-red-300 ring-1 ring-red-500/30' : 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'}`}>
      {blocked ? <AlertCircle className="w-3 h-3 inline mr-1" /> : null}
      {summary.errors} errors · {summary.warnings} warnings
      {blocked ? ' — ship is blocked until errors are resolved.' : ' — clean.'}
    </div>
  );
}

function FindingsList({ findings, compact = false }) {
  if (!findings || findings.length === 0) {
    return <div className={`text-${compact ? '[11px]' : 'xs'} text-ink-500 px-3 py-2`}>no findings</div>;
  }
  return (
    <div className={compact ? 'divide-y divide-ink-800' : 'space-y-1'}>
      {findings.map((f, i) => (
        <div key={i} className={`text-${compact ? '[11px]' : 'xs'} px-3 py-1.5 flex items-start gap-2 ${f.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}>
          <span className="font-mono text-ink-500 shrink-0">{f.line}:{f.col}</span>
          <span className="font-mono text-ink-500 shrink-0">[{f.rule}]</span>
          <span className="flex-1">{f.message}</span>
          {f.autofix && <span className="font-mono text-ink-500 truncate max-w-xs" title={f.autofix}>fix: {f.autofix}</span>}
        </div>
      ))}
    </div>
  );
}
