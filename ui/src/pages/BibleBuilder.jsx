import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Upload, Save, ArrowLeft, Loader2, AlertTriangle, CheckCircle2,
  BookOpen, Users, Film, Layers,
} from 'lucide-react';
import { api } from '../lib/api.js';

// BibleBuilder — paste / upload a rich source story bible and live-preview
// the parser's typed-section split. Save persists the split files to
// <local_path>/sdk_data/bible/*.md and the raw to sdk_data/story_bible.md.
//
// Route: /projects/:id/bible-builder  (Phase 4.7)

const PARSE_DEBOUNCE_MS = 500;

function PreviewSection({ icon: Icon, label, value, sub }) {
  return (
    <div className="flex items-start gap-2 px-2 py-1.5">
      <Icon size={14} className="mt-0.5 flex-shrink-0 text-ink-500" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-xs font-medium text-ink-200">{label}</span>
          {value !== undefined && value !== null && (
            <span className="text-[11px] text-ink-500 font-mono">{value}</span>
          )}
        </div>
        {sub && <p className="text-[11px] text-ink-500 mt-0.5 line-clamp-2">{sub}</p>}
      </div>
    </div>
  );
}

export default function BibleBuilder() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [markdown, setMarkdown] = useState('');
  const [parsed, setParsed] = useState(null);
  const [counts, setCounts] = useState(null);
  const [sections, setSections] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [parseErr, setParseErr] = useState(null);
  const [parseBusy, setParseBusy] = useState(false);
  const [ingestBusy, setIngestBusy] = useState(false);
  const [ingestMsg, setIngestMsg] = useState(null);
  const debTimer = useRef(null);
  const fileInputRef = useRef(null);

  // Live parse — debounced. Skip empties.
  const runParse = useCallback(async (md) => {
    if (!md || md.length < 20) {
      setParsed(null); setCounts(null); setSections([]); setWarnings([]); setParseErr(null);
      return;
    }
    setParseBusy(true);
    setParseErr(null);
    try {
      const r = await api.post(`/api/projects/${id}/bible/parse`, { markdown: md });
      setParsed(r.parsed);
      setCounts(r.counts || {});
      setSections(r.sections_detected || []);
      setWarnings(r.parsed && r.parsed.warnings ? r.parsed.warnings : []);
    } catch (e) {
      setParseErr(e.detail?.error || e.message || 'parse failed');
    } finally {
      setParseBusy(false);
    }
  }, [id]);

  useEffect(() => {
    if (debTimer.current) clearTimeout(debTimer.current);
    debTimer.current = setTimeout(() => runParse(markdown), PARSE_DEBOUNCE_MS);
    return () => { if (debTimer.current) clearTimeout(debTimer.current); };
  }, [markdown, runParse]);

  const onFile = useCallback(async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const text = await f.text();
    setMarkdown(text);
  }, []);

  const ingest = useCallback(async () => {
    if (!markdown || markdown.length < 20) {
      setIngestMsg({ ok: false, text: 'Paste a bible first.' });
      return;
    }
    setIngestBusy(true);
    setIngestMsg(null);
    try {
      const r = await api.post(`/api/projects/${id}/bible/ingest`, { markdown });
      setIngestMsg({ ok: true, text: `Wrote ${r.written.length} section files.` });
      // Brief pause so the user sees the success state, then navigate.
      setTimeout(() => navigate(`/projects/${id}/author/bible`), 600);
    } catch (e) {
      setIngestMsg({ ok: false, text: e.detail?.error || e.message || 'ingest failed' });
    } finally {
      setIngestBusy(false);
    }
  }, [id, markdown, navigate]);

  const protagonistName = parsed && parsed.protagonist
    ? (parsed.protagonist.name || 'Protagonist') : null;
  const antagonistName = parsed && parsed.antagonist
    ? (parsed.antagonist.name || '') : null;

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-ink-800 bg-ink-950 flex-shrink-0">
        <button
          onClick={() => navigate(`/projects/${id}/author/bible`)}
          className="p-1 rounded hover:bg-ink-800 text-ink-400 hover:text-ink-100"
          title="Back to Bible"
        >
          <ArrowLeft size={14} />
        </button>
        <BookOpen size={16} className="text-ink-400" />
        <span className="text-sm text-ink-300 font-medium">Bible Builder</span>
        <span className="text-xs text-ink-600">Phase 4.7</span>
      </div>

      {/* Two-column body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* LEFT: input */}
        <div className="flex flex-col w-1/2 border-r border-ink-800 min-h-0">
          <div className="px-4 py-3 border-b border-ink-800 flex items-center gap-3 flex-shrink-0">
            <div className="flex-1">
              <p className="text-xs text-ink-400">
                Paste your story bible markdown. The parser splits it into the modular
                sections the autopilot consumes.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-ink-800 hover:bg-ink-700 text-ink-300 rounded border border-ink-700"
            >
              <Upload size={11} /> Upload
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".md,.markdown,.txt"
              className="hidden"
              onChange={onFile}
            />
          </div>
          <textarea
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            spellCheck={false}
            placeholder="# Story Bible\n\n## LOGLINE\n\n…"
            className="flex-1 min-h-0 w-full resize-none bg-ink-950 text-ink-100 font-mono text-xs p-4 focus:outline-none"
          />
        </div>

        {/* RIGHT: preview */}
        <div className="flex flex-col w-1/2 min-h-0 overflow-hidden">
          <div className="px-4 py-3 border-b border-ink-800 flex items-center gap-2 flex-shrink-0">
            <span className="text-xs font-medium text-ink-300">Detected sections</span>
            {parseBusy && <Loader2 size={11} className="animate-spin text-ink-500" />}
            {!parseBusy && parsed && (
              <span className="text-[11px] text-ink-500">
                {sections.length} section{sections.length === 1 ? '' : 's'}
              </span>
            )}
            <span className="ml-auto text-[11px] text-ink-600">
              {markdown ? `${markdown.length} chars` : '—'}
            </span>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2">
            {parseErr && (
              <div className="m-2 p-3 rounded border border-red-700 bg-red-950/30 text-red-300 text-xs flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
                <span>{parseErr}</span>
              </div>
            )}

            {!parsed && !parseErr && !parseBusy && (
              <div className="flex items-center justify-center h-full text-xs text-ink-600">
                Paste a bible on the left to preview the split.
              </div>
            )}

            {parsed && (
              <div className="space-y-1">
                {/* Counts row */}
                {counts && (
                  <div className="flex items-center gap-3 flex-wrap px-2 py-2 mb-2 rounded bg-ink-900/50 border border-ink-800">
                    <span className="text-[11px] text-ink-500 uppercase tracking-wide">Counts</span>
                    <span className="text-xs text-ink-200">
                      <span className="text-ink-500">cast</span> {counts.cast}
                    </span>
                    <span className="text-xs text-ink-200">
                      <span className="text-ink-500">scenes</span> {counts.scenes}
                    </span>
                    <span className="text-xs text-ink-200">
                      <span className="text-ink-500">acts</span> {counts.acts}
                    </span>
                    <span className="text-xs text-ink-200">
                      <span className="text-ink-500">beats</span> {counts.beats}
                    </span>
                    <span className="text-xs text-ink-200">
                      <span className="text-ink-500">items</span> {counts.items}
                    </span>
                  </div>
                )}

                {/* Per-section detail */}
                {parsed.logline && (
                  <PreviewSection icon={BookOpen} label="LOGLINE"
                                  sub={parsed.logline} />
                )}
                {parsed.setting && (
                  <PreviewSection icon={BookOpen} label="SETTING"
                                  sub={parsed.setting} />
                )}
                {protagonistName && (
                  <PreviewSection icon={Users} label="PROTAGONIST" value={protagonistName}
                                  sub={parsed.protagonist.voice || parsed.protagonist.description} />
                )}
                {antagonistName && (
                  <PreviewSection icon={Users} label="ANTAGONIST" value={antagonistName}
                                  sub={parsed.antagonist.voice || parsed.antagonist.description} />
                )}
                {parsed.mentor && parsed.mentor.real_name && (
                  <PreviewSection icon={Users} label="MENTOR" value={parsed.mentor.real_name}
                                  sub={parsed.mentor.voice_pre_reveal} />
                )}
                {counts && counts.cast > 0 && (
                  <PreviewSection icon={Users} label="CAST LIST"
                                  value={`${counts.cast} NPC${counts.cast === 1 ? '' : 's'} detected`}
                                  sub={parsed.cast.slice(0, 5).map((c) => c.name).join(' · ')} />
                )}
                {parsed.acts && parsed.acts.map((a) => (
                  <PreviewSection
                    key={a.id}
                    icon={Layers}
                    label={`${a.name || ('Act ' + a.number)}`}
                    value={`${a.beats.length} beat${a.beats.length === 1 ? '' : 's'}${a.length_target ? ' · ' + a.length_target : ''}`}
                    sub={a.setup}
                  />
                ))}
                {counts && counts.scenes > 0 && (
                  <PreviewSection icon={Film} label="SCENE LIST"
                                  value={`${counts.scenes} scene${counts.scenes === 1 ? '' : 's'} detected`}
                                  sub={parsed.scenes.slice(0, 3).map((s) => s.code + ' ' + s.name).join(' · ')} />
                )}

                {/* Warnings */}
                {warnings && warnings.length > 0 && (
                  <div className="m-2 p-3 rounded border border-yellow-700 bg-yellow-950/20 text-yellow-300 text-xs space-y-1">
                    <div className="flex items-center gap-2 font-medium">
                      <AlertTriangle size={12} />
                      Parser warnings ({warnings.length})
                    </div>
                    <ul className="list-disc list-inside space-y-0.5">
                      {warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer / actions */}
      <div className="flex items-center gap-3 px-4 py-3 border-t border-ink-800 bg-ink-950 flex-shrink-0">
        {ingestMsg && (
          <span className={`text-xs flex items-center gap-1 ${ingestMsg.ok ? 'text-green-400' : 'text-red-400'}`}>
            {ingestMsg.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
            {ingestMsg.text}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => navigate(`/projects/${id}/author/bible`)}
            className="px-3 py-1.5 text-xs rounded bg-ink-800 hover:bg-ink-700 text-ink-300 border border-ink-700"
          >
            Cancel
          </button>
          <button
            onClick={ingest}
            disabled={ingestBusy || !parsed}
            className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-40"
          >
            {ingestBusy ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
            Save sections to project
          </button>
        </div>
      </div>
    </div>
  );
}
