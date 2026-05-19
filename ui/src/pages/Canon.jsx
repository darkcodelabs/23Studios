import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2, BookOpen, Edit3, Save, X, Eye, AlertCircle, Hash, ExternalLink } from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';
import { renderMarkdownToHtml } from '../lib/mdRender.js';

function classNames(...cs) { return cs.filter(Boolean).join(' '); }

export default function Canon() {
  const { id } = useParams();
  const [content, setContent] = useState('');
  const [sections, setSections] = useState([]);
  const [activeVersion, setActiveVersion] = useState(null);
  const [usage, setUsage] = useState({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [mode, setMode] = useState('view'); // 'view' | 'edit'
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeAnchor, setActiveAnchor] = useState(null);
  const renderedRef = useRef(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [canon, usg] = await Promise.all([
        api.get(`/api/projects/${encodeURIComponent(id)}/canon`),
        api.get(`/api/projects/${encodeURIComponent(id)}/canon/usage`)
      ]);
      setContent(canon.content || '');
      setSections(canon.sections || []);
      setActiveVersion(canon.active_version || null);
      setUsage(usg.usage || {});
      setDraft(canon.content || '');
    } catch (e) {
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const html = useMemo(() => renderMarkdownToHtml(content), [content]);

  const usageFor = useCallback((sec) => {
    // Look up under both the slug anchor and the §-symbol form.
    const a = sec.anchor && usage[sec.anchor];
    const b = sec.section_symbol && usage[sec.section_symbol];
    const merged = new Set([...(a || []), ...(b || [])]);
    return Array.from(merged);
  }, [usage]);

  const startEdit = () => {
    setDraft(content);
    setNote('');
    setMode('edit');
  };

  const cancelEdit = () => {
    setMode('view');
    setDraft(content);
    setNote('');
  };

  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const r = await api.post(`/api/projects/${encodeURIComponent(id)}/canon`, {
        content: draft,
        edit_note: note
      });
      setActiveVersion(`v${r.version}.md`);
      // Re-fetch so sections + usage rebuild against the new content.
      await fetchAll();
      setMode('view');
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  };

  const jumpTo = (anchor) => {
    setActiveAnchor(anchor);
    const el = renderedRef.current && renderedRef.current.querySelector(`#${CSS.escape(anchor)}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col">
      <Nav />

      <div className="flex items-center justify-between px-6 pt-4 pb-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <BookOpen size={20} className="text-sky-300" />
          <h1 className="text-xl font-bold">Canon</h1>
          {activeVersion && (
            <span className="text-xs text-zinc-400 font-mono ml-2">{activeVersion}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {mode === 'view' && (
            <button
              onClick={startEdit}
              className="text-xs px-3 py-1.5 rounded bg-sky-700 hover:bg-sky-600 text-white flex items-center gap-1.5"
            >
              <Edit3 size={13} /> Edit canon
            </button>
          )}
          {mode === 'edit' && (
            <>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="edit note (optional)"
                className="text-xs px-2 py-1.5 rounded bg-zinc-900 border border-zinc-700 text-zinc-100 w-64"
              />
              <button
                onClick={save}
                disabled={saving}
                className="text-xs px-3 py-1.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white flex items-center gap-1.5 disabled:opacity-40"
              >
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save new version
              </button>
              <button
                onClick={cancelEdit}
                className="text-xs px-3 py-1.5 rounded border border-zinc-700 hover:bg-zinc-800 flex items-center gap-1.5"
              >
                <X size={13} /> Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {err && (
        <div className="mx-6 mt-3 p-3 rounded border border-rose-700 bg-rose-950/60 text-rose-200 text-sm flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5" />
          <div>{err.message || String(err)}</div>
        </div>
      )}

      {loading ? (
        <div className="flex-1 flex items-center justify-center text-zinc-400 text-sm">
          <Loader2 className="animate-spin mr-2" size={16} /> loading canon…
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-12 gap-0 min-h-0">
          {/* LEFT: TOC */}
          <aside className="col-span-3 lg:col-span-2 border-r border-zinc-800 p-3 overflow-auto text-xs">
            <div className="text-zinc-400 uppercase tracking-wide mb-2">Sections</div>
            {sections.length === 0 && (
              <div className="text-zinc-500 italic">no headings parsed</div>
            )}
            <ul className="space-y-1">
              {sections.map((s) => (
                <li key={`${s.line}-${s.anchor}`}>
                  <button
                    onClick={() => jumpTo(s.anchor)}
                    className={classNames(
                      'block w-full text-left truncate hover:text-white',
                      activeAnchor === s.anchor ? 'text-sky-300' : 'text-zinc-300'
                    )}
                    style={{ paddingLeft: `${(s.level - 1) * 8}px` }}
                  >
                    {s.section_symbol ? <span className="font-mono text-zinc-500 mr-1">{s.section_symbol}</span> : <Hash size={10} className="inline mr-1 text-zinc-600" />}
                    {s.title.replace(/^§\s*\d+(?:\.\d+)*\s*/, '')}
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          {/* CENTER: rendered or editor */}
          <main className="col-span-6 lg:col-span-7 border-r border-zinc-800 overflow-auto" ref={renderedRef}>
            {mode === 'view' && (
              <article
                className="px-6 py-4 max-w-3xl"
                dangerouslySetInnerHTML={{ __html: html || '<p class="text-zinc-500 italic">canon is empty — click Edit to draft it</p>' }}
              />
            )}
            {mode === 'edit' && (
              <div className="p-3 h-full">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="w-full h-full min-h-[60vh] bg-zinc-950 border border-zinc-800 rounded p-3 text-sm font-mono text-zinc-100 focus:outline-none focus:border-sky-700"
                  spellCheck={false}
                />
              </div>
            )}
          </main>

          {/* RIGHT: Used by */}
          <aside className="col-span-3 p-3 overflow-auto text-xs">
            <div className="text-zinc-400 uppercase tracking-wide mb-2 flex items-center gap-1">
              <Eye size={11} /> Used by
            </div>
            {sections.length === 0 && (
              <div className="text-zinc-500 italic">no sections to map</div>
            )}
            <ul className="space-y-3">
              {sections.map((s) => {
                const u = usageFor(s);
                return (
                  <li key={`u-${s.line}-${s.anchor}`}>
                    <button
                      onClick={() => jumpTo(s.anchor)}
                      className="text-zinc-300 hover:text-white text-left block truncate w-full"
                    >
                      <span className="font-mono text-zinc-500 mr-1">{s.section_symbol || `#${s.anchor.slice(0, 20)}`}</span>
                      {s.title.slice(0, 40)}
                    </button>
                    {u.length === 0 ? (
                      <div className="text-zinc-600 italic ml-1">— no work-graph refs</div>
                    ) : (
                      <ul className="ml-1 mt-1 space-y-0.5">
                        {u.slice(0, 8).map((nodeId) => (
                          <li key={nodeId} className="text-emerald-300 font-mono flex items-center gap-1">
                            <ExternalLink size={10} /> {nodeId}
                          </li>
                        ))}
                        {u.length > 8 && (
                          <li className="text-zinc-500 italic">+{u.length - 8} more</li>
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </aside>
        </div>
      )}
    </div>
  );
}
