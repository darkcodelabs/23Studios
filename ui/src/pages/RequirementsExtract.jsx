// RequirementsExtract.jsx — Phase 6 A2 surface.
//
// /project/:id/requirements/extract — kicks off the 3-worker extraction
// job, streams progress via SSE, renders the resulting summary +
// extracted.json sample, and offers a re-run button.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Play, Loader2, CheckCircle2, XCircle, RotateCcw, FileJson, Layers, Users, MapPin, Gamepad2, BookOpen, Image as ImageIcon
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { startExtract, getResult, getLog, subscribeExtractStream } from '../lib/extract_client.js';

function WorkerStatus({ name, status, error }) {
  const cls = {
    pending: 'bg-ink-800 text-ink-400',
    running: 'bg-blue-900/40 text-blue-300',
    done: 'bg-green-900/40 text-green-300',
    skipped: 'bg-ink-800 text-ink-500',
    failed: 'bg-red-900/40 text-red-300'
  }[status] || 'bg-ink-800 text-ink-400';
  const icon = {
    running: <Loader2 size={12} className="animate-spin" />,
    done: <CheckCircle2 size={12} />,
    failed: <XCircle size={12} />
  }[status] || null;
  return (
    <div className={`px-3 py-2 rounded text-xs flex items-center gap-2 ${cls}`}>
      {icon}
      <span className="font-medium">{name}</span>
      <span className="opacity-80">· {status}</span>
      {error ? <span className="opacity-80">· {error}</span> : null}
    </div>
  );
}

function SummaryStat({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon size={14} className="opacity-60" />
      <span className="text-ink-300">{label}:</span>
      <span className="font-semibold text-ink-100">{value}</span>
    </div>
  );
}

export default function RequirementsExtract() {
  const { id } = useParams();
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [events, setEvents] = useState([]);
  const [workers, setWorkers] = useState({ bible: 'pending', canon: 'pending', references: 'pending' });
  const [summary, setSummary] = useState(null);
  const [result, setResult] = useState(null);
  const [log, setLog] = useState(null);
  const [err, setErr] = useState(null);
  const unsubscribeRef = useRef(null);

  const loadPersisted = useCallback(async () => {
    try {
      const r = await getResult(id);
      if (r) setResult(r);
      const l = await getLog(id);
      if (l) setLog(l.log);
    } catch (_e) { /* no extraction yet */ }
  }, [id]);

  useEffect(() => { loadPersisted(); }, [loadPersisted]);
  useEffect(() => () => { if (unsubscribeRef.current) unsubscribeRef.current(); }, []);

  async function onRun() {
    if (running) return;
    setRunning(true); setErr(null); setEvents([]); setSummary(null);
    setWorkers({ bible: 'pending', canon: 'pending', references: 'pending' });
    try {
      const r = await startExtract(id);
      setJobId(r.job_id);
      const unsub = subscribeExtractStream(id, r.job_id, (evt) => {
        setEvents((prev) => [...prev, evt]);
        if (evt.phase === 'worker_started' && evt.worker) {
          setWorkers((w) => ({ ...w, [evt.worker]: 'running' }));
        } else if (evt.phase === 'worker_finished' && evt.worker) {
          setWorkers((w) => ({ ...w, [evt.worker]: evt.status }));
        } else if (evt.phase === 'finished' && evt.summary) {
          setSummary(evt.summary);
        } else if (evt.phase === 'job_done' || evt.phase === 'terminal') {
          setRunning(false);
          loadPersisted();
        } else if (evt.phase === 'job_failed' || (evt.phase === 'terminal' && evt.state === 'failed')) {
          setRunning(false);
          setErr(evt.error || 'job failed');
          loadPersisted();
        }
      }, (e) => {
        setErr('stream error');
        setRunning(false);
      });
      unsubscribeRef.current = unsub;
    } catch (e) {
      setErr(e.detail?.detail || e.message || 'failed to start');
      setRunning(false);
    }
  }

  const sceneCount = (summary && summary.scene_count) ?? (result?.extracted?.scenes?.length) ?? 0;
  const charCount = (summary && summary.character_count) ?? (result?.extracted?.characters?.length) ?? 0;
  const locCount = (result?.extracted?.locations?.length) ?? 0;
  const miniCount = (summary && summary.minigame_count) ?? (result?.extracted?.minigames?.length) ?? 0;
  const canonCount = (summary && summary.canon_section_count) ?? (result?.extracted?.canon?.sections?.length) ?? 0;
  const refCount = (summary && summary.reference_image_count) ?? (result?.reference_catalog?.images?.length) ?? 0;

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <Nav subtitle={`extract · ${id}`} />
      <div className="max-w-5xl mx-auto p-6">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileJson size={22} /> Parse + Extract
            </h1>
            <p className="text-sm text-ink-400 mt-1">
              Runs 3 Claude workers in parallel against the intake sources and
              writes <code className="text-xs">sdk_data/requirements/extracted.json</code>,
              {' '}<code className="text-xs">reference_catalog.json</code>, and
              {' '}<code className="text-xs">extraction_log.json</code>.
            </p>
          </div>
          <button
            disabled={running}
            onClick={onRun}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm font-medium disabled:opacity-50 flex items-center gap-2"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : (result ? <RotateCcw size={14} /> : <Play size={14} />)}
            {result ? 'Re-run extraction' : 'Run extraction'}
          </button>
        </header>

        {err ? (
          <div className="mb-4 p-3 bg-red-900/40 border border-red-500 rounded text-sm flex items-center gap-2">
            <XCircle size={14} /> {err}
          </div>
        ) : null}

        <section className="mb-6">
          <div className="text-xs text-ink-400 mb-2">Workers</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <WorkerStatus name="bible" status={workers.bible} error={log?.workers?.bible?.error} />
            <WorkerStatus name="canon" status={workers.canon} error={log?.workers?.canon?.error} />
            <WorkerStatus name="references" status={workers.references} error={log?.workers?.references?.error} />
          </div>
        </section>

        {(summary || result) ? (
          <section className="mb-6 border border-ink-700 rounded p-4 bg-ink-900">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Layers size={14} /> Extracted summary
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              <SummaryStat icon={Layers} label="scenes" value={sceneCount} />
              <SummaryStat icon={Users} label="characters" value={charCount} />
              <SummaryStat icon={MapPin} label="locations" value={locCount} />
              <SummaryStat icon={Gamepad2} label="minigames" value={miniCount} />
              <SummaryStat icon={BookOpen} label="canon sections" value={canonCount} />
              <SummaryStat icon={ImageIcon} label="ref images" value={refCount} />
            </div>
            {log?.finished_at ? (
              <div className="text-xs text-ink-500 mt-3">
                last run: {new Date(log.finished_at).toLocaleString()}
                {log.started_at ? ` · took ${Math.round((new Date(log.finished_at) - new Date(log.started_at)) / 100) / 10}s` : ''}
              </div>
            ) : null}
          </section>
        ) : null}

        {result?.extracted?.scenes?.length > 0 ? (
          <section className="mb-6">
            <h2 className="text-sm font-semibold mb-2">Scenes (sample)</h2>
            <div className="border border-ink-700 rounded bg-ink-900 max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-ink-400">
                  <tr>
                    <th className="text-left px-3 py-1">ID</th>
                    <th className="text-left px-3 py-1">Act</th>
                    <th className="text-left px-3 py-1">Title</th>
                    <th className="text-left px-3 py-1">Gameplay</th>
                    <th className="text-left px-3 py-1">Characters</th>
                  </tr>
                </thead>
                <tbody>
                  {result.extracted.scenes.slice(0, 50).map((s) => (
                    <tr key={s.id} className="border-t border-ink-800">
                      <td className="px-3 py-1 font-mono">{s.id}</td>
                      <td className="px-3 py-1">{s.act ?? ''}</td>
                      <td className="px-3 py-1 truncate max-w-xs">{s.title}</td>
                      <td className="px-3 py-1 text-ink-400">{s.gameplay_type}</td>
                      <td className="px-3 py-1 text-ink-400 truncate max-w-xs">
                        {(s.characters_present || []).join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        {events.length > 0 ? (
          <section>
            <h2 className="text-sm font-semibold mb-2">Live event log</h2>
            <pre className="border border-ink-700 rounded bg-ink-950 p-3 text-xs text-ink-300 max-h-64 overflow-y-auto">
              {events.map((e, i) => `${new Date(e.ts || Date.now()).toLocaleTimeString()} · ${e.phase}${e.worker ? ' · ' + e.worker : ''}${e.status ? ' · ' + e.status : ''}${e.error ? ' · ' + e.error : ''}`).join('\n')}
            </pre>
          </section>
        ) : null}
      </div>
    </div>
  );
}
