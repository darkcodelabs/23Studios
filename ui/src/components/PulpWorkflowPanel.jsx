import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import {
  Sparkles, Loader2, Check, AlertCircle, RefreshCw, Pencil, Save, X,
  CheckCircle2, Circle, CircleDot, Lock, User, Map, Wand2, ListChecks,
  Palette, Menu as MenuIcon, Image as ImageIcon, FileCode2, ClipboardCheck
} from 'lucide-react';
import { STAGE_META, patchStage, applyOutput, runStage } from '../lib/pulp_workflow_client.js';

const STATUS_LABEL = {
  empty: 'empty',
  in_progress: 'in progress',
  complete: 'complete',
  locked: 'locked'
};

const STAGE_ICON = {
  brainstorm: Sparkles,
  story: FileCode2,
  characters: User,
  world: Map,
  mechanics: ListChecks,
  vibe: Palette,
  menus: MenuIcon,
  assets: ImageIcon,
  scripts: FileCode2,
  playtest: ClipboardCheck
};

function StatusBadge({ status }) {
  const cls =
    status === 'complete' ? 'border-accent text-accent' :
    status === 'in_progress' ? 'border-accent/60 text-accent/80' :
    status === 'locked' ? 'border-ink-600 text-ink-500' :
    'border-ink-600 text-ink-300';
  const Icon =
    status === 'complete' ? CheckCircle2 :
    status === 'in_progress' ? CircleDot :
    status === 'locked' ? Lock : Circle;
  return (
    <span className={`pill ${cls} gap-1`}>
      <Icon className="w-3 h-3" /> {STATUS_LABEL[status] || status}
    </span>
  );
}

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  return [v];
}

// ---- per-stage renderers ----------------------------------------------------

function JsonFallback({ value }) {
  return (
    <pre className="text-[11px] font-mono text-ink-200 whitespace-pre-wrap break-words bg-ink-900/60 border border-ink-700 rounded p-3 overflow-auto max-h-[400px]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function KeyValueCards({ output }) {
  const entries = output && typeof output === 'object' && !Array.isArray(output) ? Object.entries(output) : [];
  if (!entries.length) return <JsonFallback value={output} />;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {entries.map(([k, v]) => (
        <div key={k} className="card !p-3">
          <div className="text-[10px] uppercase tracking-wider text-ink-400 mb-1">{k}</div>
          <div className="text-sm text-ink-100 whitespace-pre-wrap">
            {typeof v === 'string' ? v : JSON.stringify(v, null, 2)}
          </div>
        </div>
      ))}
    </div>
  );
}

function StoryAccordion({ output }) {
  const acts = asArray(output?.acts || output);
  if (!acts.length) return <JsonFallback value={output} />;
  return (
    <div className="space-y-2">
      {acts.map((act, i) => (
        <details key={i} open={i === 0} className="card !p-0 overflow-hidden">
          <summary className="px-3 py-2 cursor-pointer text-sm text-ink-100 hover:bg-ink-700/40">
            {act?.title || act?.name || `Act ${i + 1}`}
          </summary>
          <div className="px-3 py-2 border-t border-ink-700 text-xs text-ink-300 space-y-1">
            {act?.summary ? <p className="text-ink-200">{act.summary}</p> : null}
            {asArray(act?.beats).length ? (
              <ul className="list-disc list-inside space-y-0.5">
                {asArray(act.beats).map((b, j) => (
                  <li key={j}>{typeof b === 'string' ? b : (b?.text || JSON.stringify(b))}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}

function CharacterCards({ output }) {
  const chars = asArray(output?.characters || output);
  if (!chars.length) return <JsonFallback value={output} />;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {chars.map((c, i) => (
        <div key={i} className="card !p-3 flex gap-3">
          <div className="w-12 h-12 shrink-0 rounded border border-ink-600 bg-ink-900/60 grid place-items-center text-ink-500">
            <User className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <div className="text-sm text-ink-100 font-medium">{c?.name || `Character ${i + 1}`}</div>
            {c?.role ? <div className="text-[10px] uppercase text-ink-400">{c.role}</div> : null}
            <div className="text-xs text-ink-300 mt-1 whitespace-pre-wrap">{c?.bio || c?.description || ''}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function WorldLocationCards({ output }) {
  const locs = asArray(output?.locations || output);
  if (!locs.length) return <JsonFallback value={output} />;
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-ink-500">TODO: room-mapping not yet persisted</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {locs.map((l, i) => (
          <div key={i} className="card !p-3">
            <div className="text-sm text-ink-100 font-medium">{l?.name || `Location ${i + 1}`}</div>
            <div className="text-xs text-ink-300 mt-1 whitespace-pre-wrap">{l?.description || ''}</div>
            <div className="mt-2 flex items-center gap-2">
              <label className="text-[10px] uppercase text-ink-500">map to room</label>
              <select disabled className="bg-ink-900 border border-ink-700 text-[11px] text-ink-400 rounded px-1 py-0.5">
                <option>—</option>
              </select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MechanicsList({ output }) {
  const verbs = asArray(output?.verbs || output?.mechanics);
  const win = output?.win_condition || output?.win;
  if (!verbs.length && !win) return <JsonFallback value={output} />;
  return (
    <div className="space-y-3">
      {verbs.length ? (
        <div className="card !p-3">
          <div className="text-[10px] uppercase text-ink-400 mb-1">verbs</div>
          <ul className="list-disc list-inside text-sm text-ink-100 space-y-0.5">
            {verbs.map((v, i) => <li key={i}>{typeof v === 'string' ? v : (v?.label || JSON.stringify(v))}</li>)}
          </ul>
        </div>
      ) : null}
      {win ? (
        <div className="card !p-3">
          <div className="text-[10px] uppercase text-ink-400 mb-1">win condition</div>
          <div className="text-sm text-ink-100 whitespace-pre-wrap">{typeof win === 'string' ? win : JSON.stringify(win)}</div>
        </div>
      ) : null}
    </div>
  );
}

function VibeChips({ output }) {
  const palette = asArray(output?.palette);
  const refs = asArray(output?.style_refs || output?.references);
  const mood = output?.mood;
  if (!palette.length && !refs.length && !mood) return <JsonFallback value={output} />;
  return (
    <div className="space-y-3">
      {mood ? (
        <div className="card !p-3">
          <div className="text-[10px] uppercase text-ink-400 mb-1">mood</div>
          <div className="text-sm text-ink-100 whitespace-pre-wrap">{typeof mood === 'string' ? mood : JSON.stringify(mood)}</div>
        </div>
      ) : null}
      {palette.length ? (
        <div className="card !p-3">
          <div className="text-[10px] uppercase text-ink-400 mb-1">palette</div>
          <div className="flex flex-wrap gap-1.5">
            {palette.map((c, i) => {
              const hex = typeof c === 'string' ? c : (c?.hex || c?.color || '');
              return (
                <span key={i} className="pill gap-1.5 !pl-1">
                  <span className="inline-block w-3 h-3 rounded border border-ink-700" style={{ background: hex || '#222' }} />
                  {hex || JSON.stringify(c)}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
      {refs.length ? (
        <div className="card !p-3">
          <div className="text-[10px] uppercase text-ink-400 mb-1">style refs</div>
          <div className="flex flex-wrap gap-1.5">
            {refs.map((r, i) => (
              <span key={i} className="pill">{typeof r === 'string' ? r : (r?.label || JSON.stringify(r))}</span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function MenuTree({ output }) {
  const menus = output?.menus || output;
  if (!menus || typeof menus !== 'object') return <JsonFallback value={output} />;
  return (
    <pre className="text-[11px] font-mono text-ink-100 bg-ink-900/60 border border-ink-700 rounded p-3 overflow-auto max-h-[400px]">
{renderMenuTree(menus, 0)}
    </pre>
  );
}

function renderMenuTree(node, depth) {
  const pad = '  '.repeat(depth);
  if (Array.isArray(node)) {
    return node.map((n) => renderMenuTree(n, depth)).join('\n');
  }
  if (node && typeof node === 'object') {
    const label = node.label || node.name || node.title || '(menu)';
    const items = node.items || node.children || [];
    let out = `${pad}- ${label}`;
    if (items.length) out += '\n' + renderMenuTree(items, depth + 1);
    return out;
  }
  return `${pad}- ${String(node)}`;
}

function AssetCounts({ output, onJumpTab }) {
  const counts = output?.counts || output || {};
  const entries = Object.entries(counts).filter(([, v]) => typeof v === 'number' || (v && typeof v === 'object' && 'count' in v));
  if (!entries.length) return <JsonFallback value={output} />;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {entries.map(([k, v]) => {
        const n = typeof v === 'number' ? v : v.count;
        return (
          <div key={k} className="card !p-3 text-center">
            <div className="text-[10px] uppercase text-ink-400">{k}</div>
            <div className="text-xl text-ink-100 font-mono mt-1">{n}</div>
            <button
              type="button"
              onClick={() => onJumpTab?.(k)}
              className="btn !py-1 !px-2 mt-2 text-[11px]"
              title="TODO: jump to the matching editor tab"
            >
              generate now
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ScriptsPreview({ output, onJumpTab }) {
  const scripts = asArray(output?.scripts || output);
  if (!scripts.length) return <JsonFallback value={output} />;
  return (
    <div className="space-y-2">
      {scripts.map((s, i) => (
        <div key={i} className="card !p-0 overflow-hidden">
          <div className="px-3 py-2 border-b border-ink-700 flex items-center justify-between">
            <div className="text-sm text-ink-100">{s?.name || s?.room || `script ${i + 1}`}</div>
            <button
              type="button"
              onClick={() => onJumpTab?.('script')}
              className="text-[11px] text-accent hover:underline"
            >
              open in Script tab
            </button>
          </div>
          <pre className="text-[11px] font-mono text-ink-200 bg-ink-900/60 p-3 overflow-auto max-h-[260px] whitespace-pre">{s?.code || s?.body || ''}</pre>
        </div>
      ))}
    </div>
  );
}

function PlaytestChecklist({ output }) {
  const items = asArray(output?.checklist || output);
  if (!items.length) return <JsonFallback value={output} />;
  return (
    <ul className="space-y-1">
      {items.map((it, i) => {
        const text = typeof it === 'string' ? it : (it?.text || it?.label || JSON.stringify(it));
        const done = !!(it && typeof it === 'object' && (it.done || it.checked));
        return (
          <li key={i} className="flex items-start gap-2 text-sm text-ink-100">
            <input type="checkbox" defaultChecked={done} className="mt-1 accent-[#9dffce]" readOnly />
            <span>{text}</span>
          </li>
        );
      })}
    </ul>
  );
}

const RENDERERS = {
  brainstorm: KeyValueCards,
  story: StoryAccordion,
  characters: CharacterCards,
  world: WorldLocationCards,
  mechanics: MechanicsList,
  vibe: VibeChips,
  menus: MenuTree,
  assets: AssetCounts,
  scripts: ScriptsPreview,
  playtest: PlaytestChecklist
};

// ---- panel ------------------------------------------------------------------

export default function PulpWorkflowPanel({ stageId, stage, project, workflow, onStageMutated, onJumpTab }) {
  const meta = STAGE_META[stageId] || { label: stageId, placeholder: 'Describe what you want for this stage.' };
  const Icon = STAGE_ICON[stageId] || Sparkles;
  const locked = stage?.status === 'locked' || stageRequiresUnmet(stage, workflow).length > 0;

  const [prompt, setPrompt] = useState(stage?.input || '');
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [parsed, setParsed] = useState(stage?.output || null);
  const [warnings, setWarnings] = useState([]);
  const [streaming, setStreaming] = useState(false);
  const [err, setErr] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editJson, setEditJson] = useState('');
  const [editErr, setEditErr] = useState(null);
  const ctrlRef = useRef(null);
  const promptDebounceRef = useRef(null);

  // Reset local state when the stage changes.
  useEffect(() => {
    setPrompt(stage?.input || '');
    setParsed(stage?.output || null);
    setStreamText('');
    setWarnings([]);
    setErr(null);
    setEditing(false);
    setEditJson('');
    setEditErr(null);
  }, [stageId, stage?.last_updated_ts]);

  useEffect(() => () => { ctrlRef.current?.abort?.(); }, []);

  const debouncedSavePrompt = useCallback((nextValue) => {
    if (promptDebounceRef.current) clearTimeout(promptDebounceRef.current);
    promptDebounceRef.current = setTimeout(async () => {
      setSavingPrompt(true);
      try {
        await patchStage(project.id, stageId, { input: nextValue });
        onStageMutated?.();
      } catch (_e) { /* ignore — surfaces on next action */ }
      finally { setSavingPrompt(false); }
    }, 500);
  }, [project?.id, stageId, onStageMutated]);

  function onPromptChange(e) {
    const v = e.target.value.slice(0, 8000);
    setPrompt(v);
    debouncedSavePrompt(v);
  }

  async function onRun() {
    if (streaming || locked) return;
    setStreaming(true);
    setErr(null);
    setStreamText('');
    setWarnings([]);
    setParsed(null);
    ctrlRef.current?.abort?.();
    ctrlRef.current = runStage(project.id, stageId, { user_prompt: prompt }, {
      onChunk: (t) => setStreamText((prev) => prev + t),
      onParsed: (data) => {
        if (data?.output !== undefined) setParsed(data.output);
        if (Array.isArray(data?.warnings)) setWarnings(data.warnings);
      },
      onError: (m) => setErr(m || 'stream_failed'),
      onClose: () => {
        setStreaming(false);
        onStageMutated?.();
      }
    });
  }

  function onCancel() {
    ctrlRef.current?.abort?.();
    setStreaming(false);
  }

  async function onMarkComplete() {
    try {
      await patchStage(project.id, stageId, { status: 'complete' });
      onStageMutated?.();
    } catch (_e) { setErr('failed to mark complete'); }
  }

  async function onReopen() {
    try {
      await patchStage(project.id, stageId, { status: 'in_progress' });
      onStageMutated?.();
    } catch (_e) { setErr('failed to reopen'); }
  }

  function onEditStart() {
    setEditJson(JSON.stringify(parsed ?? {}, null, 2));
    setEditErr(null);
    setEditing(true);
  }

  async function onEditSave() {
    let parsedJson;
    try { parsedJson = JSON.parse(editJson); }
    catch (e) { setEditErr('invalid JSON'); return; }
    try {
      await applyOutput(project.id, stageId, parsedJson);
      setParsed(parsedJson);
      setEditing(false);
      onStageMutated?.();
    } catch (_e) { setEditErr('save failed'); }
  }

  const Render = RENDERERS[stageId] || (({ output }) => <JsonFallback value={output} />);

  const reqList = stage?.requires || [];
  const unmet = stageRequiresUnmet(stage, workflow);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">

        {/* header */}
        <header className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg border border-ink-700 bg-ink-800 grid place-items-center text-accent shrink-0">
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h1 className="text-lg text-ink-50 font-mono">{meta.label}</h1>
              <StatusBadge status={stage?.status || 'empty'} />
              {savingPrompt ? <span className="text-[10px] text-ink-500">saving…</span> : null}
            </div>
            {reqList.length ? (
              <div className={`text-[11px] mt-1 ${unmet.length ? 'text-amber-300' : 'text-ink-500'}`}>
                requires: {reqList.map((r) => (
                  <span key={r} className={unmet.includes(r) ? 'underline' : ''}>{r}</span>
                )).reduce((acc, el, i) => acc.concat(i ? [', ', el] : [el]), [])}
                {unmet.length ? <span> — {unmet.length} unmet</span> : null}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {stage?.status === 'complete' ? (
              <button type="button" onClick={onReopen} className="btn !py-1.5 text-xs">
                <RefreshCw className="w-3.5 h-3.5" /> reopen
              </button>
            ) : (
              <button type="button" onClick={onMarkComplete} className="btn !py-1.5 text-xs" disabled={locked}>
                <Check className="w-3.5 h-3.5" /> mark complete
              </button>
            )}
          </div>
        </header>

        {locked ? (
          <div className="card !p-3 text-xs text-amber-200 flex items-start gap-2">
            <Lock className="w-4 h-4 mt-0.5" />
            <div>
              this stage is locked until upstream stages are complete: <strong>{unmet.join(', ')}</strong>.
              you can still draft a prompt but AI generation is disabled.
            </div>
          </div>
        ) : null}

        {/* prompt */}
        <section>
          <label className="text-[11px] uppercase tracking-wider text-ink-400">your prompt</label>
          <TextareaAutosize
            value={prompt}
            onChange={onPromptChange}
            placeholder={meta.placeholder}
            minRows={3}
            maxRows={16}
            maxLength={8000}
            className="input font-mono resize-none mt-1"
          />
          <div className="flex items-center justify-between mt-1">
            <span className="text-[10px] text-ink-500">{prompt.length} / 8000</span>
            <div className="flex items-center gap-2">
              {streaming ? (
                <button type="button" onClick={onCancel} className="btn !py-1.5 text-xs">
                  <X className="w-3.5 h-3.5" /> cancel
                </button>
              ) : null}
              <button
                type="button"
                onClick={onRun}
                disabled={streaming || locked || !prompt.trim()}
                className="btn-primary !py-1.5 text-xs"
              >
                {streaming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                {streaming ? 'generating…' : 'generate with AI'}
              </button>
            </div>
          </div>
        </section>

        {err ? (
          <div className="card !p-3 text-xs text-red-300 border-red-900/60 bg-red-950/30 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> {err}
          </div>
        ) : null}

        {/* live stream */}
        {(streaming || (streamText && !parsed)) ? (
          <section>
            <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1 flex items-center gap-2">
              live response
              {streaming ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
            </div>
            <pre className="text-[11px] font-mono text-ink-200 bg-ink-900/60 border border-ink-700 rounded p-3 overflow-auto max-h-[300px] whitespace-pre-wrap break-words">{streamText || '…'}</pre>
          </section>
        ) : null}

        {/* parsed output */}
        {parsed != null ? (
          <section>
            <div className="text-[11px] uppercase tracking-wider text-ink-400 mb-1 flex items-center justify-between">
              <span>structured output</span>
              {editing ? (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setEditing(false)} className="btn !py-1 !px-2 text-[11px]">
                    <X className="w-3 h-3" /> cancel
                  </button>
                  <button type="button" onClick={onEditSave} className="btn-primary !py-1 !px-2 text-[11px]">
                    <Save className="w-3 h-3" /> save
                  </button>
                </div>
              ) : (
                <button type="button" onClick={onEditStart} className="text-ink-400 hover:text-ink-100 inline-flex items-center gap-1 text-[11px]">
                  <Pencil className="w-3 h-3" /> edit JSON
                </button>
              )}
            </div>
            {editing ? (
              <div>
                <textarea
                  value={editJson}
                  onChange={(e) => setEditJson(e.target.value)}
                  className="input font-mono text-[11px] min-h-[260px]"
                  spellCheck={false}
                />
                {editErr ? <div className="text-[11px] text-red-300 mt-1">{editErr}</div> : null}
              </div>
            ) : (
              <Render output={parsed} onJumpTab={onJumpTab} />
            )}
            {warnings.length ? (
              <div className="mt-2 text-[11px] text-amber-300 space-y-0.5">
                {warnings.map((w, i) => <div key={i}>! {w}</div>)}
              </div>
            ) : null}
          </section>
        ) : null}

      </div>
    </div>
  );
}

function stageRequiresUnmet(stage, workflow) {
  if (!stage?.requires?.length) return [];
  return stage.requires.filter((r) => {
    const s = workflow?.stages?.[r];
    return !s || s.status !== 'complete';
  });
}
