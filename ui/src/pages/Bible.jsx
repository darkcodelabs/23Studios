import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  BookOpen, Plus, Save, Trash2, RefreshCw, GripVertical,
  AlertTriangle, ChevronDown, ChevronRight, Loader2, GitCompare
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANONICAL_PREFIX_RE = /^\d{2}_/;
const CANONICAL_FILES = new Set([
  '00_premise.md','01_era_location.md','02_cast.md','03_world_rules.md',
  '04_act_breakdown.md','05_tone.md','06_dither.md','07_setting_anchors.md',
  '08_mechanic_hook.md','09_do_not.md',
]);

const SECTION_TEMPLATES = {
  character: (slug) =>
    `# Character: ${slug}\n\n## Role\n\n<!-- protagonist / antagonist / supporting -->\n\n## Visual Anchor\n\n<!-- stable descriptor used in every prompt -->\n\n## Bio\n\n`,
  scene: (slug) =>
    `# Scene: ${slug}\n\n## Setting\n\n## Mood\n\n## Key Events\n\n## Exits\n\n`,
  rule: (slug) =>
    `# Rule: ${slug}\n\n<!-- Describe a world rule, constraint, or mechanic -->\n\n`,
  blank: (slug) => `# ${slug}\n\n`,
};

function fmtBytes(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

// ---------------------------------------------------------------------------
// Add Section Modal
// ---------------------------------------------------------------------------

function AddSectionModal({ onClose, onAdd, busy }) {
  const [slug, setSlug] = useState('');
  const [template, setTemplate] = useState('blank');
  const [err, setErr] = useState('');

  function slugify(v) {
    return v.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
  }

  function submit(e) {
    e.preventDefault();
    const safe = slugify(slug);
    if (!safe) { setErr('slug required'); return; }
    const filename = `custom_${safe}.md`;
    const content = (SECTION_TEMPLATES[template] || SECTION_TEMPLATES.blank)(safe);
    onAdd({ filename, content });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <form onSubmit={submit}
            className="bg-ink-900 border border-ink-700 rounded-lg p-6 w-full max-w-md space-y-4">
        <h2 className="text-base font-semibold text-ink-100">Add section</h2>

        <label className="block text-sm text-ink-300">
          Slug <span className="text-ink-500 text-xs">(becomes custom_&lt;slug&gt;.md)</span>
          <input
            autoFocus
            className="mt-1 block w-full bg-black/40 border border-ink-700 px-3 py-1.5 rounded text-sm font-mono text-ink-100"
            value={slug}
            onChange={(e) => { setSlug(e.target.value); setErr(''); }}
            placeholder="my_villain"
          />
        </label>

        <label className="block text-sm text-ink-300">
          Template
          <select
            className="mt-1 block w-full bg-black/40 border border-ink-700 px-3 py-1.5 rounded text-sm"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          >
            <option value="blank">Blank</option>
            <option value="character">Character</option>
            <option value="scene">Scene</option>
            <option value="rule">Rule / Constraint</option>
          </select>
        </label>

        {err && <p className="text-red-400 text-xs">{err}</p>}

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose}
                  className="px-3 py-1.5 rounded text-sm bg-ink-800 hover:bg-ink-700 text-ink-300">
            Cancel
          </button>
          <button type="submit" disabled={busy}
                  className="px-3 py-1.5 rounded text-sm bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-40 flex items-center gap-1">
            {busy && <Loader2 size={12} className="animate-spin" />}
            Add
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Regen Plan Modal
// ---------------------------------------------------------------------------

function RegenPlanModal({ plan, onClose, onApply, busy }) {
  if (!plan) return null;

  const hasWork = !plan.full_pipeline_required
    && (plan.regen_characters.length + plan.regen_scenes.length + plan.regen_lua.length) > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="bg-ink-900 border border-ink-700 rounded-lg p-6 w-full max-w-lg space-y-4 max-h-[80vh] overflow-y-auto">
        <h2 className="text-base font-semibold text-ink-100">Regen plan</h2>

        {plan.since && (
          <p className="text-xs text-ink-500">Changes since autopilot snapshot: {plan.since}</p>
        )}

        {plan.full_pipeline_required && (
          <div className="p-3 rounded bg-red-900/30 border border-red-700 text-red-300 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <span>{plan.full_pipeline_reason}</span>
          </div>
        )}

        {!plan.full_pipeline_required && plan.regen_characters.length === 0
          && plan.regen_scenes.length === 0 && plan.regen_lua.length === 0 && (
          <p className="text-sm text-ink-400">No items to regenerate. Bible is in sync with last autopilot run.</p>
        )}

        {plan.regen_characters.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-ink-400 uppercase mb-1">Characters ({plan.regen_characters.length})</h3>
            <ul className="space-y-1">
              {plan.regen_characters.map((c) => (
                <li key={c.id} className="text-sm text-ink-200">
                  <span className="font-mono text-ink-300">{c.id}</span>
                  <span className="text-ink-500 ml-2 text-xs">{c.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {plan.regen_scenes.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-ink-400 uppercase mb-1">Scene backgrounds ({plan.regen_scenes.length})</h3>
            <ul className="space-y-1">
              {plan.regen_scenes.map((s) => (
                <li key={s.id} className="text-sm text-ink-200">
                  <span className="font-mono text-ink-300">{s.id}</span>
                  <span className="text-ink-500 ml-2 text-xs">{s.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {plan.regen_lua.length > 0 && (
          <section>
            <h3 className="text-xs font-semibold text-ink-400 uppercase mb-1">Lua re-emit ({plan.regen_lua.length})</h3>
            <ul className="space-y-1">
              {plan.regen_lua.map((l) => (
                <li key={l.scene_id} className="text-sm text-ink-200">
                  <span className="font-mono text-ink-300">{l.scene_id}</span>
                  <span className="text-ink-500 ml-2 text-xs">{l.reason}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!plan.full_pipeline_required && (
          <p className="text-xs text-ink-500">
            Estimated cost: <span className="text-ink-200">${plan.estimated_cost_usd.toFixed(4)}</span>
          </p>
        )}

        <div className="flex gap-2 justify-end pt-2">
          <button onClick={onClose}
                  className="px-3 py-1.5 rounded text-sm bg-ink-800 hover:bg-ink-700 text-ink-300">
            Close
          </button>
          {hasWork && (
            <button onClick={onApply} disabled={busy}
                    className="px-3 py-1.5 rounded text-sm bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-40 flex items-center gap-1">
              {busy && <Loader2 size={12} className="animate-spin" />}
              Apply regen
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Bible() {
  const { id } = useParams();

  // Section list + compiled bytes
  const [sections, setSections] = useState([]);
  const [compiledBytes, setCompiledBytes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [listErr, setListErr] = useState(null);

  // Editor state
  const [active, setActive] = useState(null); // filename
  const [editorContent, setEditorContent] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  // Drag state for reordering custom sections
  const [dragOver, setDragOver] = useState(null);
  const dragSrc = useRef(null);

  // Add section modal
  const [showAdd, setShowAdd] = useState(false);
  const [addBusy, setAddBusy] = useState(false);

  // Diff
  const [showDiff, setShowDiff] = useState(false);
  const [diffData, setDiffData] = useState(null);
  const [diffLoading, setDiffLoading] = useState(false);

  // Regen plan
  const [regenPlan, setRegenPlan] = useState(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenResult, setRegenResult] = useState(null);

  // Compile busy
  const [compileBusy, setCompileBusy] = useState(false);

  // ---------------------------------------------------------------------------
  // Load section list
  // ---------------------------------------------------------------------------

  const loadSections = useCallback(async () => {
    setLoading(true);
    setListErr(null);
    try {
      const r = await api.get(`/api/projects/${id}/bible`);
      setSections(r.sections || []);
      setCompiledBytes(r.compiled_bytes);
    } catch (e) {
      setListErr(e.message || 'load failed');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { loadSections(); }, [loadSections]);

  // ---------------------------------------------------------------------------
  // Load section content when active changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    api.get(`/api/projects/${id}/bible/${active}`).then((content) => {
      if (!cancelled) {
        setEditorContent(typeof content === 'string' ? content : String(content));
        setEditorDirty(false);
        setSaveMsg('');
      }
    }).catch(() => {
      if (!cancelled) setEditorContent('');
    });
    return () => { cancelled = true; };
  }, [id, active]);

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  async function save() {
    if (!active) return;
    setSaveBusy(true);
    setSaveMsg('');
    try {
      await api.post(`/api/projects/${id}/bible/${active}`, { content: editorContent });
      setEditorDirty(false);
      setSaveMsg('Saved');
      await loadSections();
      setTimeout(() => setSaveMsg(''), 2000);
    } catch (e) {
      setSaveMsg(e.detail?.error || e.message || 'save failed');
    } finally {
      setSaveBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Delete (custom sections only)
  // ---------------------------------------------------------------------------

  async function deleteSection(filename) {
    if (!confirm(`Delete ${filename}? This cannot be undone.`)) return;
    try {
      await api.del(`/api/projects/${id}/bible/${filename}`);
      if (active === filename) { setActive(null); setEditorContent(''); }
      await loadSections();
    } catch (e) {
      alert(e.message || 'delete failed');
    }
  }

  // ---------------------------------------------------------------------------
  // Add section
  // ---------------------------------------------------------------------------

  async function addSection({ filename, content }) {
    setAddBusy(true);
    try {
      await api.post(`/api/projects/${id}/bible/${filename}`, { content });
      setShowAdd(false);
      await loadSections();
      setActive(filename);
    } catch (e) {
      alert(e.message || 'add failed');
    } finally {
      setAddBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Recompile
  // ---------------------------------------------------------------------------

  async function recompile() {
    setCompileBusy(true);
    try {
      const r = await api.post(`/api/projects/${id}/bible/compile`, {});
      setCompiledBytes(r.bytes);
    } catch (e) {
      alert(e.message || 'compile failed');
    } finally {
      setCompileBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Drag reorder (custom sections only — NN_ prefix order is canonical)
  // ---------------------------------------------------------------------------

  function onDragStart(e, filename) {
    dragSrc.current = filename;
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(e, filename) {
    e.preventDefault();
    setDragOver(filename);
  }

  function onDrop(e, targetFilename) {
    e.preventDefault();
    setDragOver(null);
    const src = dragSrc.current;
    if (!src || src === targetFilename) return;
    // Only allow reordering custom_* sections (canonical NN_ order is fixed).
    if (CANONICAL_PREFIX_RE.test(src) || CANONICAL_PREFIX_RE.test(targetFilename)) return;
    // Visual reorder only — actual order is filename sort. Rename to swap prefix.
    // For simplicity, just reorder the local list for UX; server returns sorted order.
    setSections((prev) => {
      const next = [...prev];
      const srcIdx = next.findIndex((s) => s.filename === src);
      const tgtIdx = next.findIndex((s) => s.filename === targetFilename);
      if (srcIdx < 0 || tgtIdx < 0) return prev;
      const [item] = next.splice(srcIdx, 1);
      next.splice(tgtIdx, 0, item);
      return next;
    });
  }

  // ---------------------------------------------------------------------------
  // Diff
  // ---------------------------------------------------------------------------

  async function loadDiff() {
    setDiffLoading(true);
    try {
      const r = await api.get(`/api/projects/${id}/bible/diff`);
      setDiffData(r);
    } catch (e) {
      setDiffData({ error: e.message });
    } finally {
      setDiffLoading(false);
    }
  }

  function toggleDiff() {
    if (!showDiff && !diffData) loadDiff();
    setShowDiff((v) => !v);
  }

  // ---------------------------------------------------------------------------
  // Regen plan
  // ---------------------------------------------------------------------------

  async function loadRegenPlan() {
    setPlanLoading(true);
    setRegenResult(null);
    try {
      const r = await api.post(`/api/projects/${id}/regen/plan`, {});
      setRegenPlan(r);
    } catch (e) {
      alert(e.message || 'plan failed');
    } finally {
      setPlanLoading(false);
    }
  }

  async function applyRegenPlan() {
    if (!regenPlan) return;
    setRegenBusy(true);
    try {
      const r = await api.post(`/api/projects/${id}/regen/apply`, { plan: regenPlan });
      setRegenResult(r);
      setRegenPlan(null);
      setDiffData(null); // force re-load after apply
    } catch (e) {
      alert(e.message || 'apply failed');
    } finally {
      setRegenBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Diff banner (summarise changes)
  // ---------------------------------------------------------------------------

  const diffChanged = diffData && !diffData.error
    && (diffData.added.length + diffData.modified.length + diffData.removed.length) > 0;

  const regenNeeded = diffData && diffChanged
    && (diffData.impact?.characters_changed?.length > 0
        || diffData.impact?.scenes_changed?.length > 0
        || diffData.impact?.tone_changed
        || diffData.impact?.do_not_changed);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Nav subtitle="Bible editor" />

      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-ink-800 bg-ink-950 flex-shrink-0">
        <BookOpen size={16} className="text-ink-400" />
        <span className="text-sm text-ink-300 font-medium">Story Bible</span>
        <span className="text-xs text-ink-600">{fmtBytes(compiledBytes)} compiled</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={toggleDiff}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs border ${showDiff ? 'bg-blue-900/40 border-blue-700 text-blue-300' : 'bg-ink-800 border-ink-700 text-ink-400 hover:text-ink-200'}`}
          >
            <GitCompare size={12} />
            {diffLoading ? <Loader2 size={12} className="animate-spin" /> : 'Diff'}
          </button>
          <button
            onClick={recompile}
            disabled={compileBusy}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-ink-800 border border-ink-700 text-ink-400 hover:text-ink-200 disabled:opacity-40"
          >
            {compileBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            Recompile
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white"
          >
            <Plus size={12} /> Add section
          </button>
        </div>
      </div>

      {/* Diff banner */}
      {showDiff && diffData && (
        <div className="px-4 py-2 border-b border-ink-800 bg-ink-950 text-xs flex-shrink-0">
          {diffData.error ? (
            <span className="text-red-400">{diffData.error}</span>
          ) : !diffChanged ? (
            <span className="text-ink-500">No changes since last autopilot snapshot
              {diffData.since ? ` (${diffData.since})` : ''}.</span>
          ) : (
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-ink-400">Since: <span className="text-ink-300">{diffData.since || '—'}</span></span>
              {diffData.added.length > 0 && <span className="text-green-400">+{diffData.added.length} added</span>}
              {diffData.modified.length > 0 && <span className="text-yellow-400">{diffData.modified.length} modified</span>}
              {diffData.removed.length > 0 && <span className="text-red-400">{diffData.removed.length} removed</span>}
              {regenNeeded && (
                <button
                  onClick={loadRegenPlan}
                  disabled={planLoading}
                  className="ml-auto flex items-center gap-1 px-2 py-1 rounded bg-yellow-800/40 border border-yellow-700 text-yellow-300 hover:bg-yellow-800/60 disabled:opacity-40"
                >
                  {planLoading ? <Loader2 size={12} className="animate-spin" /> : null}
                  Preview regen plan
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Regen result banner */}
      {regenResult && (
        <div className="px-4 py-2 border-b border-green-800/40 bg-green-950/20 text-xs text-green-300 flex items-center gap-3 flex-shrink-0">
          Regen complete —
          {regenResult.characters?.length > 0 && <span>{regenResult.characters.length} portraits</span>}
          {regenResult.scenes?.length > 0 && <span>{regenResult.scenes.length} scenes</span>}
          {regenResult.lua?.length > 0 && <span>{regenResult.lua.length} lua</span>}
          {regenResult.errors?.length > 0 && (
            <span className="text-red-400">{regenResult.errors.length} errors</span>
          )}
          <button onClick={() => setRegenResult(null)} className="ml-auto text-ink-500 hover:text-ink-300">×</button>
        </div>
      )}

      {/* Main split */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left pane: section list */}
        <aside className="w-56 flex-shrink-0 border-r border-ink-800 overflow-y-auto bg-ink-950">
          {loading && <div className="p-3 text-xs text-ink-500">Loading…</div>}
          {listErr && <div className="p-3 text-xs text-red-400">{listErr}</div>}
          {!loading && sections.map((s) => {
            const isCanonical = CANONICAL_FILES.has(s.filename);
            const isActive = s.filename === active;
            const isModified = diffData && !diffData.error
              && (diffData.modified.includes(s.filename) || diffData.added.includes(s.filename));

            return (
              <div
                key={s.filename}
                draggable={!isCanonical}
                onDragStart={!isCanonical ? (e) => onDragStart(e, s.filename) : undefined}
                onDragOver={!isCanonical ? (e) => onDragOver(e, s.filename) : undefined}
                onDrop={!isCanonical ? (e) => onDrop(e, s.filename) : undefined}
                onDragLeave={() => setDragOver(null)}
                onClick={() => setActive(s.filename)}
                className={[
                  'flex items-center gap-1 px-3 py-2 cursor-pointer text-xs border-b border-ink-900',
                  isActive ? 'bg-blue-900/30 text-ink-100' : 'text-ink-400 hover:bg-ink-900 hover:text-ink-200',
                  dragOver === s.filename ? 'border-t-2 border-t-blue-500' : '',
                ].join(' ')}
              >
                {!isCanonical && (
                  <GripVertical size={10} className="text-ink-700 flex-shrink-0" />
                )}
                <span className="flex-1 truncate">{s.title || s.filename}</span>
                {isModified && showDiff && (
                  <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 flex-shrink-0" title="modified since snapshot" />
                )}
                {!isCanonical && (
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSection(s.filename); }}
                    className="text-ink-700 hover:text-red-400 flex-shrink-0"
                    title="Delete section"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </div>
            );
          })}
        </aside>

        {/* Right pane: editor */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-ink-600 text-sm">
              Select a section to edit
            </div>
          ) : (
            <>
              {/* Editor toolbar */}
              <div className="flex items-center gap-3 px-4 py-2 border-b border-ink-800 flex-shrink-0">
                <span className="text-xs font-mono text-ink-400">{active}</span>
                {editorDirty && <span className="text-xs text-yellow-400">unsaved</span>}
                {saveMsg && (
                  <span className={`text-xs ${saveMsg === 'Saved' ? 'text-green-400' : 'text-red-400'}`}>
                    {saveMsg}
                  </span>
                )}
                <button
                  onClick={save}
                  disabled={saveBusy || !editorDirty}
                  className="ml-auto flex items-center gap-1 px-3 py-1 rounded text-xs bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-40"
                >
                  {saveBusy ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
                  Save
                </button>
              </div>

              {/* Textarea editor */}
              <textarea
                className="flex-1 min-h-0 w-full resize-none bg-ink-950 text-ink-100 font-mono text-sm p-4 focus:outline-none"
                value={editorContent}
                onChange={(e) => { setEditorContent(e.target.value); setEditorDirty(true); }}
                spellCheck={false}
                placeholder="Start writing…"
              />
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      {showAdd && (
        <AddSectionModal
          onClose={() => setShowAdd(false)}
          onAdd={addSection}
          busy={addBusy}
        />
      )}

      {regenPlan && (
        <RegenPlanModal
          plan={regenPlan}
          onClose={() => setRegenPlan(null)}
          onApply={applyRegenPlan}
          busy={regenBusy}
        />
      )}
    </div>
  );
}
