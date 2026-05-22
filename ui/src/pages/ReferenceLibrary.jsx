import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Image as ImageIcon, Loader2, Search, X, Plus, Tag,
  CheckSquare, Square, Anchor, ArrowLeft, RefreshCw
} from 'lucide-react';
import { api } from '../lib/api.js';

// Build an APP_BASE-aware raw image URL using the existing /file/raw endpoint.
function rawUrl(projectId, filePath) {
  const base = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
  return `${base}/api/projects/${projectId}/file/raw?path=${encodeURIComponent(filePath)}`;
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '?';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

function anchorCount(a) {
  if (!a) return 0;
  return (a.scenes?.length || 0) + (a.characters?.length || 0) + (a.ui?.length || 0);
}

export default function ReferenceLibrary() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [activeImage, setActiveImage] = useState(null); // detail modal
  const [bulkOpen, setBulkOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get(`/api/projects/${id}/references`);
      setData(r);
    } catch (e) {
      setErr(e);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  // Aggregate tag list from all items, for the search facet hint.
  const allTags = useMemo(() => {
    if (!data) return [];
    const set = new Set();
    for (const it of data.items) for (const t of (it.tags || [])) set.add(t);
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.items;
    // Query syntax (additive AND across tokens):
    //   plain text   -> substring match against path/name
    //   tag:foo      -> tag exact-match
    //   anchor:scN   -> anchored_to.* exact match
    const tokens = q.split(/\s+/).filter(Boolean);
    return data.items.filter((it) => {
      for (const tok of tokens) {
        if (tok.startsWith('tag:')) {
          const t = tok.slice(4);
          if (!(it.tags || []).some((x) => x === t)) return false;
        } else if (tok.startsWith('anchor:')) {
          const a = tok.slice(7);
          const ar = it.anchored_to || {};
          const all = [...(ar.scenes || []), ...(ar.characters || []), ...(ar.ui || [])];
          if (!all.some((x) => x.toLowerCase() === a)) return false;
        } else {
          const hay = (it.path + '\n' + it.name).toLowerCase();
          if (!hay.includes(tok)) return false;
        }
      }
      return true;
    });
  }, [data, query]);

  function toggleSelect(p) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }
  function clearSelect() { setSelected(new Set()); }
  function selectAllVisible() {
    setSelected(new Set(filtered.map((x) => x.path)));
  }

  function patchItemInState(updated) {
    setData((d) => {
      if (!d) return d;
      const items = d.items.map((it) => it.path === updated.path
        ? { ...it, tags: updated.tags, anchored_to: updated.anchored_to, notes: updated.notes }
        : it);
      return { ...d, items };
    });
  }

  return (
    <div className="min-h-screen bg-ink-900 text-ink-100">
      <div className="px-4 py-3 border-b border-ink-800 flex items-center gap-2">
        <Link to={`/project/${id}`} className="btn-icon" title="back to project" aria-label="back">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-sm text-ink-200 flex items-center gap-2">
          <ImageIcon className="w-4 h-4 text-ink-400" />
          Reference library
          {data ? <span className="text-ink-500 text-xs font-mono">{filtered.length}/{data.count}</span> : null}
        </h1>
        <div className="flex-1" />
        <SearchBox value={query} onChange={setQuery} suggestions={allTags} />
        <button type="button" className="btn-icon" onClick={load} title="reload" aria-label="reload">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </button>
      </div>

      {err ? (
        <div className="px-4 py-3 text-sm text-red-400">
          failed to load references: {err.detail?.detail || err.message || 'unknown'}
        </div>
      ) : null}

      {selected.size > 0 ? (
        <div className="px-4 py-2 border-b border-ink-800 bg-ink-800/30 flex items-center gap-3 text-xs text-ink-300">
          <span className="font-mono">{selected.size} selected</span>
          <button type="button" className="btn text-xs" onClick={() => setBulkOpen(true)}>
            <Tag className="w-3 h-3" /> bulk tag…
          </button>
          <button type="button" className="btn text-xs" onClick={selectAllVisible}>
            select all visible
          </button>
          <button type="button" className="btn text-xs" onClick={clearSelect}>
            clear
          </button>
        </div>
      ) : null}

      {!data && loading ? (
        <div className="p-6 flex items-center gap-2 text-ink-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> scanning project…
        </div>
      ) : data && data.count === 0 ? (
        <div className="p-10 text-center text-ink-500 text-sm">
          No image files found under <span className="font-mono text-ink-400">{data.local_path}</span>
        </div>
      ) : (
        <div
          className="p-4 grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}
        >
          {filtered.map((it) => (
            <Tile
              key={it.path}
              item={it}
              projectId={id}
              selected={selected.has(it.path)}
              onToggleSelect={() => toggleSelect(it.path)}
              onOpen={() => setActiveImage(it)}
            />
          ))}
        </div>
      )}

      {activeImage ? (
        <DetailModal
          projectId={id}
          item={activeImage}
          anchorCandidates={data?.anchor_candidates}
          onClose={() => setActiveImage(null)}
          onSaved={patchItemInState}
        />
      ) : null}

      {bulkOpen ? (
        <BulkTagModal
          projectId={id}
          paths={Array.from(selected)}
          onClose={() => setBulkOpen(false)}
          onApplied={async () => {
            setBulkOpen(false);
            clearSelect();
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function SearchBox({ value, onChange, suggestions }) {
  return (
    <div className="relative">
      <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-ink-500 pointer-events-none" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="search · tag:foo · anchor:SC01"
        className="bg-ink-800/60 border-0 border-b border-b-ink-700 focus:border-b-accent focus:bg-ink-800 text-ink-100 placeholder-ink-500 text-xs rounded-md pl-7 pr-7 py-1.5 w-72 font-mono outline-none"
        list="ref-tag-suggestions"
      />
      <datalist id="ref-tag-suggestions">
        {suggestions.map((t) => <option key={t} value={`tag:${t}`} />)}
      </datalist>
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-1 top-1/2 -translate-y-1/2 btn-icon w-5 h-5"
          aria-label="clear search"
        >
          <X className="w-3 h-3" />
        </button>
      ) : null}
    </div>
  );
}

function Tile({ item, projectId, selected, onToggleSelect, onOpen }) {
  const src = rawUrl(projectId, item.path);
  const [failed, setFailed] = useState(false);
  const small = item.dims && item.dims.w < 512;
  return (
    <div className={`relative rounded-lg overflow-hidden bg-ink-800/40 ring-1 ${selected ? 'ring-accent' : 'ring-ink-800'} hover:ring-ink-700 transition group`}>
      <button
        type="button"
        onClick={onToggleSelect}
        className="absolute top-1.5 left-1.5 z-10 btn-icon bg-ink-900/70 backdrop-blur-sm"
        title={selected ? 'deselect' : 'select'}
        aria-label={selected ? 'deselect' : 'select'}
      >
        {selected ? <CheckSquare className="w-3.5 h-3.5 text-accent" /> : <Square className="w-3.5 h-3.5" />}
      </button>
      <button
        type="button"
        onClick={onOpen}
        className="block w-full bg-ink-950/40 aspect-square flex items-center justify-center overflow-hidden"
        title={item.path}
      >
        {failed ? (
          <div className="text-ink-500 text-xs px-2 text-center">preview unavailable</div>
        ) : (
          <img
            src={src}
            alt={item.name}
            loading="lazy"
            onError={() => setFailed(true)}
            className={`max-w-full max-h-full object-contain ${small ? 'pixelated' : ''}`}
          />
        )}
      </button>
      <div className="px-2 py-1.5 text-[11px] font-mono text-ink-300 truncate" title={item.path}>
        {item.name}
      </div>
      <div className="px-2 pb-1.5 text-[10px] text-ink-500 flex items-center gap-1.5">
        {item.dims ? <span>{item.dims.w}×{item.dims.h}</span> : <span>?×?</span>}
        <span>·</span>
        <span>{formatBytes(item.size)}</span>
        {anchorCount(item.anchored_to) > 0 ? (
          <span title="anchored" className="ml-auto inline-flex items-center gap-0.5 text-accent">
            <Anchor className="w-3 h-3" />{anchorCount(item.anchored_to)}
          </span>
        ) : null}
      </div>
      {item.tags && item.tags.length > 0 ? (
        <div className="px-2 pb-2 flex flex-wrap gap-1">
          {item.tags.slice(0, 4).map((t) => (
            <span key={t} className="pill text-[9px] leading-none px-1.5 py-0.5">{t}</span>
          ))}
          {item.tags.length > 4 ? <span className="pill text-[9px]">+{item.tags.length - 4}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function DetailModal({ projectId, item, anchorCandidates, onClose, onSaved }) {
  const [tags, setTags] = useState(item.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [anchors, setAnchors] = useState({
    scenes: (item.anchored_to?.scenes) || [],
    characters: (item.anchored_to?.characters) || [],
    ui: (item.anchored_to?.ui) || []
  });
  const [uiInput, setUiInput] = useState('');
  const [notes, setNotes] = useState(item.notes || '');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function addTag(raw) {
    const v = (raw || '').trim().toLowerCase();
    if (!v) return;
    if (tags.includes(v)) return;
    setTags([...tags, v].slice(0, 32));
    setTagInput('');
  }
  function removeTag(t) { setTags(tags.filter((x) => x !== t)); }

  function toggleAnchor(kind, value) {
    setAnchors((cur) => {
      const list = cur[kind] || [];
      const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
      return { ...cur, [kind]: next };
    });
  }
  function addUi() {
    const v = (uiInput || '').trim();
    if (!v) return;
    if (anchors.ui.includes(v)) return;
    setAnchors({ ...anchors, ui: [...anchors.ui, v] });
    setUiInput('');
  }
  function removeUi(v) { setAnchors({ ...anchors, ui: anchors.ui.filter((x) => x !== v) }); }

  async function save() {
    setSaving(true); setSaveErr(null);
    try {
      const r = await api.patch(`/api/projects/${projectId}/references`, {
        path: item.path,
        tags,
        anchored_to: anchors,
        notes
      });
      onSaved(r.item);
      onClose();
    } catch (e) {
      setSaveErr(e.detail?.detail || e.message || 'save failed');
    } finally {
      setSaving(false);
    }
  }

  const src = rawUrl(projectId, item.path);
  const sceneCandidates = anchorCandidates?.scenes || [];
  const charCandidates = anchorCandidates?.characters || [];
  const small = item.dims && item.dims.w < 512;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      ref={ref}
      className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center p-6"
    >
      <div className="bg-ink-900 ring-1 ring-ink-800 rounded-xl max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-4 h-11 flex items-center gap-2 border-b border-ink-800">
          <ImageIcon className="w-4 h-4 text-ink-500" />
          <span className="text-sm text-ink-200 font-mono truncate">{item.path}</span>
          {item.dims ? <span className="text-xs text-ink-500 font-mono ml-2">{item.dims.w}×{item.dims.h}</span> : null}
          <span className="text-xs text-ink-500 font-mono">· {formatBytes(item.size)}</span>
          <div className="flex-1" />
          <button type="button" className="btn-icon" onClick={onClose} aria-label="close"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[1fr_320px]">
          <div className="bg-ink-950/50 min-h-0 flex items-center justify-center p-4 overflow-auto">
            <img src={src} alt={item.path} className={`max-w-full max-h-[70vh] object-contain ${small ? 'pixelated' : ''}`} />
          </div>
          <aside className="border-l border-ink-800 overflow-y-auto p-4 space-y-4 text-xs">
            <section>
              <h3 className="text-ink-400 text-[11px] uppercase tracking-wider mb-2">Tags</h3>
              <div className="flex flex-wrap gap-1 mb-2">
                {tags.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => removeTag(t)}
                    className="pill text-[10px] hover:bg-red-500/30 hover:text-red-300"
                    title="click to remove"
                  >
                    {t} <X className="w-2.5 h-2.5 ml-0.5" />
                  </button>
                ))}
                {tags.length === 0 ? <span className="text-ink-500 italic">no tags</span> : null}
              </div>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTag(tagInput); } }}
                  placeholder="add tag…"
                  className="flex-1 bg-ink-800/60 border-0 border-b border-b-ink-700 focus:border-b-accent text-ink-100 placeholder-ink-500 rounded-md px-2 py-1 outline-none font-mono"
                />
                <button type="button" className="btn-icon" onClick={() => addTag(tagInput)} aria-label="add tag">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </section>

            <section>
              <h3 className="text-ink-400 text-[11px] uppercase tracking-wider mb-2">Anchored to scenes</h3>
              {sceneCandidates.length === 0 ? (
                <p className="text-ink-500 italic">no scenes under sdk_data/scenes/</p>
              ) : (
                <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                  {sceneCandidates.map((s) => {
                    const on = anchors.scenes.includes(s);
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => toggleAnchor('scenes', s)}
                        className={`pill text-[10px] ${on ? 'bg-accent text-ink-900' : ''}`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <h3 className="text-ink-400 text-[11px] uppercase tracking-wider mb-2">Anchored to characters</h3>
              {charCandidates.length === 0 ? (
                <p className="text-ink-500 italic">no characters under sdk_data/characters/</p>
              ) : (
                <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                  {charCandidates.map((c) => {
                    const on = anchors.characters.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleAnchor('characters', c)}
                        className={`pill text-[10px] ${on ? 'bg-accent text-ink-900' : ''}`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <h3 className="text-ink-400 text-[11px] uppercase tracking-wider mb-2">Anchored to UI surfaces</h3>
              <div className="flex flex-wrap gap-1 mb-2">
                {anchors.ui.map((u) => (
                  <button
                    key={u}
                    type="button"
                    onClick={() => removeUi(u)}
                    className="pill text-[10px] hover:bg-red-500/30 hover:text-red-300"
                  >
                    {u} <X className="w-2.5 h-2.5 ml-0.5" />
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                <input
                  type="text"
                  value={uiInput}
                  onChange={(e) => setUiInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addUi(); } }}
                  placeholder="e.g. main_menu, hud, inventory"
                  className="flex-1 bg-ink-800/60 border-0 border-b border-b-ink-700 focus:border-b-accent text-ink-100 placeholder-ink-500 rounded-md px-2 py-1 outline-none font-mono"
                />
                <button type="button" className="btn-icon" onClick={addUi} aria-label="add ui surface">
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>
            </section>

            <section>
              <h3 className="text-ink-400 text-[11px] uppercase tracking-wider mb-2">Notes</h3>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value.slice(0, 1024))}
                rows={3}
                className="w-full bg-ink-800/60 border-0 border-b border-b-ink-700 focus:border-b-accent text-ink-100 placeholder-ink-500 rounded-md px-2 py-1 outline-none text-[11px] font-mono"
                placeholder="why this reference matters…"
              />
              <div className="text-ink-600 text-[10px] text-right">{notes.length}/1024</div>
            </section>

            {item.perceptual_hash ? (
              <div className="text-ink-600 text-[10px] font-mono break-all">
                phash: {item.perceptual_hash}
              </div>
            ) : null}
          </aside>
        </div>
        <div className="px-4 h-12 border-t border-ink-800 flex items-center justify-end gap-2">
          {saveErr ? <span className="text-red-400 text-xs mr-auto">{saveErr}</span> : null}
          <button type="button" className="btn text-xs" onClick={onClose}>cancel</button>
          <button type="button" className="btn-primary text-xs" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            save
          </button>
        </div>
      </div>
    </div>
  );
}

function BulkTagModal({ projectId, paths, onClose, onApplied }) {
  const [addText, setAddText] = useState('');
  const [removeText, setRemoveText] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function splitTags(s) {
    return (s || '').split(/[,\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  }

  async function apply() {
    const add = splitTags(addText);
    const remove = splitTags(removeText);
    if (add.length === 0 && remove.length === 0) {
      setErr('add at least one tag to add or remove'); return;
    }
    setSaving(true); setErr(null);
    try {
      await api.post(`/api/projects/${projectId}/references/bulk-tag`, {
        paths, add_tags: add, remove_tags: remove
      });
      onApplied();
    } catch (e) {
      setErr(e.detail?.detail || e.message || 'failed');
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      ref={ref}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
    >
      <div className="bg-ink-900 ring-1 ring-ink-800 rounded-xl w-full max-w-md p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-ink-400" />
          <h2 className="text-sm text-ink-200">Bulk tag {paths.length} item{paths.length === 1 ? '' : 's'}</h2>
          <div className="flex-1" />
          <button type="button" className="btn-icon" onClick={onClose} aria-label="close"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-ink-400">Add tags (comma or space separated)</label>
          <input
            type="text"
            value={addText}
            onChange={(e) => setAddText(e.target.value)}
            placeholder="hero, hero_close, act1"
            className="input text-xs font-mono"
          />
        </div>
        <div className="space-y-2">
          <label className="block text-xs text-ink-400">Remove tags</label>
          <input
            type="text"
            value={removeText}
            onChange={(e) => setRemoveText(e.target.value)}
            placeholder="placeholder, unsorted"
            className="input text-xs font-mono"
          />
        </div>
        {err ? <div className="text-red-400 text-xs">{err}</div> : null}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn text-xs" onClick={onClose}>cancel</button>
          <button type="button" className="btn-primary text-xs" onClick={apply} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
            apply
          </button>
        </div>
      </div>
    </div>
  );
}
