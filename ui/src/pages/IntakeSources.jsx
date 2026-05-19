// IntakeSources.jsx — Phase 6 A1 intake surface.
//
// /project/:id/intake — drag-drop / file-picker for bible, canon, SKILL,
// reference images + URL list + free-form notes. POSTs to
// /api/projects/:id/intake/sources and renders the current manifest +
// diff returned from the server.

import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Upload, FileText, Image as ImageIcon, Trash2, Loader2, CheckCircle2, AlertTriangle, Link as LinkIcon, StickyNote, ArrowRight
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { uploadSources, listSources, removeReference } from '../lib/intake_sources_client.js';

function StatusPill({ kind, children }) {
  const cls = {
    ok: 'bg-green-900/40 border-green-500 text-green-200',
    warn: 'bg-yellow-900/40 border-yellow-500 text-yellow-200',
    err: 'bg-red-900/40 border-red-500 text-red-200',
    idle: 'bg-ink-800 border-ink-700 text-ink-300'
  }[kind] || 'bg-ink-800 border-ink-700 text-ink-300';
  return <span className={`inline-block px-2 py-0.5 text-xs border rounded ${cls}`}>{children}</span>;
}

function TextDocPicker({ label, doc, file, onPickFile, onClear }) {
  const present = doc || file;
  return (
    <div className="border border-ink-700 rounded p-3 bg-ink-900">
      <div className="flex items-center gap-2 mb-2">
        <FileText size={16} className="opacity-60" />
        <div className="text-sm font-medium">{label}</div>
        {present
          ? <StatusPill kind="ok">{file ? 'queued' : 'on disk'}</StatusPill>
          : <StatusPill kind="idle">none</StatusPill>}
      </div>
      {doc && !file ? (
        <div className="text-xs text-ink-400 mb-2">
          <span className="opacity-60">{doc.rel_path}</span> · {doc.bytes} bytes · sha {doc.sha256.slice(0, 10)}
        </div>
      ) : null}
      {file ? (
        <div className="text-xs text-ink-300 mb-2">
          <span className="opacity-60">queued:</span> {file.name} ({file.size} bytes)
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <label className="px-2 py-1 bg-ink-800 border border-ink-700 rounded cursor-pointer text-xs hover:bg-ink-700">
          <input type="file" accept=".md,.markdown,.txt" className="hidden" onChange={(e) => {
            const f = e.target.files && e.target.files[0];
            if (f) onPickFile(f);
            e.target.value = '';
          }} />
          Choose file
        </label>
        {file ? <button className="text-xs text-ink-400 hover:text-ink-100" onClick={onClear}>clear</button> : null}
      </div>
    </div>
  );
}

function ReferenceImagesPicker({ existing, queued, onAddFiles, onRemoveExisting, onRemoveQueued, onMetaChange }) {
  return (
    <div className="border border-ink-700 rounded p-3 bg-ink-900">
      <div className="flex items-center gap-2 mb-2">
        <ImageIcon size={16} className="opacity-60" />
        <div className="text-sm font-medium">Reference images</div>
        <StatusPill kind="idle">{existing.length} on disk · {queued.length} queued</StatusPill>
      </div>
      <label className="block px-3 py-4 bg-ink-800 border border-dashed border-ink-700 rounded text-center text-xs text-ink-400 cursor-pointer mb-3 hover:bg-ink-800/60">
        <Upload size={16} className="inline mr-1 align-text-bottom" />
        Drop or click to add PNG / JPG (max 64 files, 16MB each)
        <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) onAddFiles(files);
          e.target.value = '';
        }} />
      </label>

      {existing.length > 0 ? (
        <div className="mb-3">
          <div className="text-xs text-ink-400 mb-1">On disk:</div>
          <ul className="space-y-1">
            {existing.map((img) => (
              <li key={img.rel_path} className="flex items-center gap-2 text-xs px-2 py-1 bg-ink-800/60 rounded">
                <ImageIcon size={12} className="opacity-50" />
                <span className="text-ink-200 flex-1 truncate">{img.filename}</span>
                <span className="text-ink-500">{img.bytes}b</span>
                {img.tag ? <StatusPill kind="ok">{img.tag}</StatusPill> : null}
                <button className="text-ink-500 hover:text-red-400" onClick={() => onRemoveExisting(img.filename)} title="remove">
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {queued.length > 0 ? (
        <div>
          <div className="text-xs text-ink-400 mb-1">Queued for upload:</div>
          <ul className="space-y-1">
            {queued.map((q, i) => (
              <li key={i} className="flex items-center gap-2 text-xs px-2 py-1 bg-ink-800 border border-ink-700 rounded">
                <span className="text-ink-200 flex-1 truncate">{q.file.name}</span>
                <input
                  className="bg-ink-900 border border-ink-700 px-1 py-0.5 rounded w-24 text-ink-200"
                  placeholder="tag"
                  value={q.tag || ''}
                  onChange={(e) => onMetaChange(i, { tag: e.target.value })}
                />
                <input
                  className="bg-ink-900 border border-ink-700 px-1 py-0.5 rounded w-40 text-ink-200"
                  placeholder="subject hint (e.g. SC01)"
                  value={q.subject_hint || ''}
                  onChange={(e) => onMetaChange(i, { subject_hint: e.target.value })}
                />
                <button className="text-ink-500 hover:text-red-400" onClick={() => onRemoveQueued(i)}>
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function UrlList({ urls, onChange }) {
  function addRow() { onChange([...urls, { url: '', tag: '', subject_hint: '' }]); }
  function updateRow(i, patch) {
    const next = urls.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function removeRow(i) { onChange(urls.filter((_, idx) => idx !== i)); }
  return (
    <div className="border border-ink-700 rounded p-3 bg-ink-900">
      <div className="flex items-center gap-2 mb-2">
        <LinkIcon size={16} className="opacity-60" />
        <div className="text-sm font-medium">URLs</div>
        <StatusPill kind="idle">{urls.length}</StatusPill>
        <button className="ml-auto text-xs text-ink-300 hover:text-ink-100" onClick={addRow}>+ add</button>
      </div>
      {urls.length === 0
        ? <div className="text-xs text-ink-500 italic">No URLs yet.</div>
        : (
          <ul className="space-y-1">
            {urls.map((u, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <input
                  className="bg-ink-900 border border-ink-700 px-2 py-1 rounded flex-1 text-ink-200"
                  placeholder="https://..."
                  value={u.url}
                  onChange={(e) => updateRow(i, { url: e.target.value })}
                />
                <input
                  className="bg-ink-900 border border-ink-700 px-2 py-1 rounded w-24 text-ink-200"
                  placeholder="tag"
                  value={u.tag || ''}
                  onChange={(e) => updateRow(i, { tag: e.target.value })}
                />
                <input
                  className="bg-ink-900 border border-ink-700 px-2 py-1 rounded w-40 text-ink-200"
                  placeholder="subject"
                  value={u.subject_hint || ''}
                  onChange={(e) => updateRow(i, { subject_hint: e.target.value })}
                />
                <button className="text-ink-500 hover:text-red-400" onClick={() => removeRow(i)}><Trash2 size={12} /></button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

function NoteList({ notes, onChange }) {
  function addRow() { onChange([...notes, { text: '', tag: '' }]); }
  function updateRow(i, patch) {
    const next = notes.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  }
  function removeRow(i) { onChange(notes.filter((_, idx) => idx !== i)); }
  return (
    <div className="border border-ink-700 rounded p-3 bg-ink-900">
      <div className="flex items-center gap-2 mb-2">
        <StickyNote size={16} className="opacity-60" />
        <div className="text-sm font-medium">Notes / anecdotes</div>
        <StatusPill kind="idle">{notes.length}</StatusPill>
        <button className="ml-auto text-xs text-ink-300 hover:text-ink-100" onClick={addRow}>+ add</button>
      </div>
      {notes.length === 0
        ? <div className="text-xs text-ink-500 italic">No notes yet.</div>
        : (
          <ul className="space-y-2">
            {notes.map((n, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <textarea
                  className="bg-ink-900 border border-ink-700 px-2 py-1 rounded flex-1 text-ink-200"
                  placeholder="cameo dialog / anecdote / cultural context..."
                  rows={2}
                  value={n.text}
                  onChange={(e) => updateRow(i, { text: e.target.value })}
                />
                <input
                  className="bg-ink-900 border border-ink-700 px-2 py-1 rounded w-24 text-ink-200"
                  placeholder="tag"
                  value={n.tag || ''}
                  onChange={(e) => updateRow(i, { tag: e.target.value })}
                />
                <button className="text-ink-500 hover:text-red-400 mt-1" onClick={() => removeRow(i)}><Trash2 size={12} /></button>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

export default function IntakeSources() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [sources, setSources] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [lastDiff, setLastDiff] = useState(null);

  // Queued (not yet uploaded) state
  const [bibleFile, setBibleFile] = useState(null);
  const [canonFile, setCanonFile] = useState(null);
  const [skillFile, setSkillFile] = useState(null);
  const [refQueue, setRefQueue] = useState([]); // [{ file, tag, subject_hint }]
  const [urlsDraft, setUrlsDraft] = useState([]);
  const [notesDraft, setNotesDraft] = useState([]);

  const refresh = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await listSources(id);
      setSources(r.sources);
      setUrlsDraft(r.sources.urls || []);
      setNotesDraft(r.sources.notes || []);
    } catch (e) {
      setErr(e.detail?.detail || e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { refresh(); }, [refresh]);

  function clearQueue() {
    setBibleFile(null);
    setCanonFile(null);
    setSkillFile(null);
    setRefQueue([]);
  }

  async function onUpload() {
    if (busy) return;
    setBusy(true); setErr(null); setLastDiff(null);
    try {
      const spec = {};
      if (bibleFile) spec.bible = { file: bibleFile };
      if (canonFile) spec.canon = { file: canonFile };
      if (skillFile) spec.skill_md = { file: skillFile };
      if (refQueue.length) spec.reference_images = refQueue;
      // Always send urls + notes as the source of truth (the form is the editor).
      spec.urls = urlsDraft.filter((u) => u.url && u.url.trim());
      spec.notes = notesDraft.filter((n) => n.text && n.text.trim());
      if (!spec.bible && !spec.canon && !spec.skill_md && !spec.reference_images && spec.urls.length === 0 && spec.notes.length === 0) {
        setErr('Nothing to upload.');
        setBusy(false);
        return;
      }
      const r = await uploadSources(id, spec);
      setLastDiff(r.diff);
      clearQueue();
      await refresh();
    } catch (e) {
      setErr(e.detail?.detail || e.message || 'upload failed');
    } finally {
      setBusy(false);
    }
  }

  async function onRemoveExisting(filename) {
    try { await removeReference(id, filename); await refresh(); }
    catch (e) { setErr(e.detail?.detail || e.message); }
  }

  const hasBible = !!(sources && sources.text_docs.bible);
  const hasCanon = !!(sources && sources.text_docs.canon);
  const refCount = sources ? sources.reference_images.length : 0;
  const readyForExtract = hasBible || hasCanon || refCount > 0;

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <Nav subtitle={`intake · ${id}`} />
      <div className="max-w-5xl mx-auto p-6">
        <header className="mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Upload size={22} /> Source intake
          </h1>
          <p className="text-sm text-ink-400 mt-1">
            Upload story bible, style canon, SKILL.md, reference images, URLs and notes.
            Each input is hashed for change detection. Re-uploading reports what changed.
          </p>
        </header>

        {err ? (
          <div className="mb-4 p-3 bg-red-900/40 border border-red-500 rounded text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5" /> {err}
          </div>
        ) : null}

        {lastDiff ? (
          <div className="mb-4 p-3 bg-green-900/30 border border-green-700 rounded text-xs">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 size={14} /> <span className="font-medium">Upload OK</span>
            </div>
            <div className="text-ink-300">
              added: {lastDiff.added.length} · changed: {lastDiff.changed.length} · removed: {lastDiff.removed.length} · unchanged: {lastDiff.unchanged.length}
            </div>
            {lastDiff.changed.length > 0 ? (
              <div className="text-yellow-300 mt-1">changed: {lastDiff.changed.join(', ')}</div>
            ) : null}
          </div>
        ) : null}

        {loading ? (
          <Loader2 className="animate-spin" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <TextDocPicker
              label="Story bible (markdown)"
              doc={sources?.text_docs.bible}
              file={bibleFile}
              onPickFile={setBibleFile}
              onClear={() => setBibleFile(null)}
            />
            <TextDocPicker
              label="Style canon (markdown)"
              doc={sources?.text_docs.canon}
              file={canonFile}
              onPickFile={setCanonFile}
              onClear={() => setCanonFile(null)}
            />
            <TextDocPicker
              label="SKILL.md (platform constraints)"
              doc={sources?.text_docs.skill_md}
              file={skillFile}
              onPickFile={setSkillFile}
              onClear={() => setSkillFile(null)}
            />
            <div className="md:col-span-2">
              <ReferenceImagesPicker
                existing={sources?.reference_images || []}
                queued={refQueue}
                onAddFiles={(files) => setRefQueue([...refQueue, ...files.map((f) => ({ file: f, tag: '', subject_hint: '' }))])}
                onRemoveExisting={onRemoveExisting}
                onRemoveQueued={(i) => setRefQueue(refQueue.filter((_, idx) => idx !== i))}
                onMetaChange={(i, patch) => {
                  const next = refQueue.slice();
                  next[i] = { ...next[i], ...patch };
                  setRefQueue(next);
                }}
              />
            </div>
            <UrlList urls={urlsDraft} onChange={setUrlsDraft} />
            <NoteList notes={notesDraft} onChange={setNotesDraft} />
          </div>
        )}

        <div className="mt-6 flex items-center gap-3">
          <button
            disabled={busy}
            onClick={onUpload}
            className="px-4 py-2 bg-blue-700 hover:bg-blue-600 rounded text-sm font-medium disabled:opacity-50 flex items-center gap-2"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Save sources
          </button>
          <button
            disabled={!readyForExtract}
            onClick={() => navigate(`/project/${id}/requirements/extract`)}
            className="px-4 py-2 bg-ink-800 hover:bg-ink-700 border border-ink-700 rounded text-sm font-medium disabled:opacity-40 flex items-center gap-2"
            title={readyForExtract ? 'Run parse + extract' : 'Need at least bible / canon / refs first'}
          >
            Continue to extract <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
