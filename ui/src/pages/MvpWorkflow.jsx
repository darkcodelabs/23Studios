import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Lock, Loader2, Play, Check, X as XIcon, RefreshCw, Sparkles, AlertTriangle
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

// MvpWorkflow — 3-pane: queue (left) | prompt editor (center) | output review (right).
//
// Lifecycle:
//   - mount: GET /mvp/prompts. If empty, POST /mvp/start to build the scope.
//   - user edits center pane; PATCH /mvp/prompts/:id (no approval flag)
//     saves edits. "Approve" PATCHes approved=true which dispatches to
//     OpenRouter + writes the output PNG.
//   - footer "Lock vibe" is enabled when every prompt is status=complete;
//     POST /mvp/lock writes locked.json and bounces back to the project.

export default function MvpWorkflow() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [prompts, setPrompts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);   // local edits (system_prompt/user_prompt/model)
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [bootMsg, setBootMsg] = useState('loading…');
  const [locking, setLocking] = useState(false);

  const refresh = async () => {
    const r = await api.get(`/api/projects/${id}/mvp/prompts`);
    setPrompts(r.prompts || []);
    return r.prompts || [];
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let list = await refresh();
        if (alive && list.length === 0) {
          setBootMsg('picking scope + building prompts…');
          await api.post(`/api/projects/${id}/mvp/start`, {});
          list = await refresh();
        }
        if (alive && list.length > 0) setSelectedId(list[0].id);
        if (alive) setBootMsg(null);
      } catch (e) {
        if (alive) { setErr(e); setBootMsg(null); }
      }
    })();
    return () => { alive = false; };
  }, [id]);

  const selected = useMemo(
    () => prompts.find((p) => p.id === selectedId) || null,
    [prompts, selectedId]
  );

  // Seed the editor draft when selection changes.
  useEffect(() => {
    if (selected) {
      setDraft({
        system_prompt: selected.system_prompt || '',
        user_prompt: selected.user_prompt || '',
        model: selected.model || ''
      });
    } else {
      setDraft(null);
    }
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const completedCount = prompts.filter((p) => p.status === 'complete').length;
  const allComplete = prompts.length > 0 && completedCount === prompts.length;

  async function persistEdits() {
    if (!selected || !draft) return;
    setBusy(true); setErr(null);
    try {
      await api.patch(`/api/projects/${id}/mvp/prompts/${selected.id}`, {
        system_prompt: draft.system_prompt,
        user_prompt: draft.user_prompt,
        model: draft.model
      });
      await refresh();
    } catch (e) { setErr(e); }
    finally { setBusy(false); }
  }

  async function approve() {
    if (!selected || !draft) return;
    setBusy(true); setErr(null);
    try {
      await api.patch(`/api/projects/${id}/mvp/prompts/${selected.id}`, {
        system_prompt: draft.system_prompt,
        user_prompt: draft.user_prompt,
        model: draft.model,
        approved: true
      });
      const list = await refresh();
      // Auto-advance to next pending after dispatch.
      const next = list.find((p) => p.status === 'pending_approval' && p.id !== selected.id);
      if (next) setSelectedId(next.id);
    } catch (e) { setErr(e); }
    finally { setBusy(false); }
  }

  async function reject() {
    if (!selected) return;
    setBusy(true); setErr(null);
    try {
      await api.patch(`/api/projects/${id}/mvp/prompts/${selected.id}`, { approved: false });
      await refresh();
    } catch (e) { setErr(e); }
    finally { setBusy(false); }
  }

  async function regenerate() {
    if (!selected) return;
    // Re-approve = re-dispatch with the same (possibly edited) prompt.
    await approve();
  }

  async function lockVibe() {
    setLocking(true); setErr(null);
    try {
      await api.post(`/api/projects/${id}/mvp/lock`, {});
      navigate(`/project/${id}`);
    } catch (e) { setErr(e); }
    finally { setLocking(false); }
  }

  const totalCost = prompts.reduce((sum, p) => sum + (p.est_cost_usd || 0), 0);

  return (
    <div className="h-screen flex flex-col bg-ink-900 text-ink-100">
      <Nav subtitle={`MVP vibe-lock · ${id}`} />

      <div className="px-4 h-10 flex items-center gap-2 border-b border-ink-800 bg-ink-900">
        <Sparkles className="w-4 h-4 text-amber-300" />
        <span className="text-sm">
          {prompts.length === 0 ? 'no prompts yet' :
            `${completedCount} / ${prompts.length} complete · est cost $${totalCost.toFixed(2)}`}
        </span>
        <div className="flex-1" />
        {err ? (
          <span className="text-xs text-red-300 inline-flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" />
            {err.detail || err.message || 'error'}
          </span>
        ) : null}
        <button
          type="button"
          onClick={lockVibe}
          disabled={!allComplete || locking}
          className="btn text-xs"
          title={allComplete ? 'persist anchors as the locked vibe; downstream autopilot inherits them'
                             : 'approve every prompt to enable'}
        >
          {locking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Lock className="w-3 h-3" />}
          Lock vibe
        </button>
      </div>

      {bootMsg ? (
        <div className="flex-1 flex items-center justify-center text-ink-400 text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> {bootMsg}
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-[280px_1fr_360px]">
          {/* Queue */}
          <aside className="border-r border-ink-800 overflow-y-auto bg-ink-900">
            {prompts.length === 0 ? (
              <div className="p-4 text-xs text-ink-500">no prompts. POST /mvp/start to build.</div>
            ) : (
              <ul className="divide-y divide-ink-800">
                {prompts.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={`w-full text-left p-3 hover:bg-ink-800/40 ${selectedId === p.id ? 'bg-ink-800/60' : ''}`}
                    >
                      <div className="flex items-center gap-2">
                        <StatusBadge status={p.status} />
                        <span className="text-xs text-ink-400 font-mono">{p.kind}</span>
                      </div>
                      <div className="text-sm mt-1 truncate">{p.target_label || p.target_id}</div>
                      <div className="text-[10px] text-ink-500 truncate font-mono">{p.target_file}</div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          {/* Editor */}
          <section className="overflow-y-auto bg-ink-900 p-4">
            {!selected ? (
              <div className="text-ink-500 text-sm">select a prompt from the queue</div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-xs uppercase tracking-wide text-ink-400 mb-1">target</div>
                  <div className="text-sm">{selected.target_label || selected.target_id}</div>
                  <div className="text-xs text-ink-500 font-mono">{selected.target_file}</div>
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wide text-ink-400 mb-1">model</label>
                  <input
                    value={draft?.model || ''}
                    onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                    className="w-full bg-ink-800 border border-ink-700 rounded p-2 text-sm font-mono focus:outline-none focus:border-emerald-600"
                    placeholder="openai/gpt-5-image-mini"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wide text-ink-400 mb-1">system prompt</label>
                  <textarea
                    rows={12}
                    value={draft?.system_prompt || ''}
                    onChange={(e) => setDraft({ ...draft, system_prompt: e.target.value })}
                    className="w-full bg-ink-800 border border-ink-700 rounded p-2 text-xs font-mono focus:outline-none focus:border-emerald-600"
                  />
                </div>

                <div>
                  <label className="block text-xs uppercase tracking-wide text-ink-400 mb-1">user prompt</label>
                  <textarea
                    rows={8}
                    value={draft?.user_prompt || ''}
                    onChange={(e) => setDraft({ ...draft, user_prompt: e.target.value })}
                    className="w-full bg-ink-800 border border-ink-700 rounded p-2 text-sm focus:outline-none focus:border-emerald-600"
                  />
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={persistEdits}
                    disabled={busy}
                    className="btn text-xs"
                    title="save edits without dispatching"
                  >
                    save edits
                  </button>
                  <button
                    type="button"
                    onClick={approve}
                    disabled={busy || selected.status === 'dispatched'}
                    className="btn text-xs"
                    title="dispatch the prompt to OpenRouter"
                  >
                    {busy && selected.status === 'pending_approval'
                      ? <Loader2 className="w-3 h-3 animate-spin" />
                      : <Check className="w-3 h-3" />}
                    Approve + dispatch
                  </button>
                  <button
                    type="button"
                    onClick={reject}
                    disabled={busy}
                    className="btn text-xs"
                    title="mark as rejected (excluded from lock)"
                  >
                    <XIcon className="w-3 h-3" /> Reject
                  </button>
                  {selected.status === 'complete' || selected.status === 'failed' ? (
                    <button
                      type="button"
                      onClick={regenerate}
                      disabled={busy}
                      className="btn text-xs"
                      title="re-dispatch with the current prompt"
                    >
                      <RefreshCw className="w-3 h-3" /> Re-queue
                    </button>
                  ) : null}
                  <span className="text-[10px] text-ink-500 ml-2">
                    est cost ${(selected.est_cost_usd || 0).toFixed(3)}
                  </span>
                </div>
              </div>
            )}
          </section>

          {/* Output review */}
          <aside className="border-l border-ink-800 overflow-y-auto bg-ink-900 p-3">
            {!selected ? (
              <div className="text-ink-500 text-xs">no selection</div>
            ) : (
              <div>
                <div className="text-xs uppercase tracking-wide text-ink-400 mb-2">output</div>
                <div className="mb-2"><StatusBadge status={selected.status} /></div>
                {selected.status === 'complete' && selected.output_path ? (
                  <div className="space-y-2">
                    <PngThumb projectId={id} promptId={selected.id} />
                    <div className="text-[10px] text-ink-500 font-mono break-all">
                      {selected.output_path}
                    </div>
                  </div>
                ) : selected.status === 'failed' ? (
                  <div className="text-xs text-red-300">
                    <AlertTriangle className="w-3 h-3 inline" /> {selected.error || 'unknown error'}
                  </div>
                ) : selected.status === 'dispatched' ? (
                  <div className="text-xs text-ink-400 inline-flex items-center gap-2">
                    <Loader2 className="w-3 h-3 animate-spin" /> waiting on OpenRouter…
                  </div>
                ) : (
                  <div className="text-xs text-ink-500">approve to generate</div>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }) {
  const cls = {
    pending_approval: 'bg-amber-900/60 text-amber-200',
    dispatched: 'bg-blue-900/60 text-blue-200',
    complete: 'bg-emerald-900/60 text-emerald-200',
    failed: 'bg-red-900/60 text-red-200',
    rejected: 'bg-ink-800 text-ink-400'
  }[status] || 'bg-ink-800 text-ink-300';
  return <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded ${cls}`}>{status}</span>;
}

function PngThumb({ projectId, promptId }) {
  // The output PNG file is named after the prompt id (server convention).
  const file = `${promptId}.png`;
  const src = `/api/projects/${projectId}/mvp/outputs/${file}?ts=${Date.now()}`;
  return (
    <img
      src={src}
      alt={promptId}
      className="border border-ink-700 rounded bg-ink-950 w-full"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
