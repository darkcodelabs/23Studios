import { useCallback, useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Loader2, AlertTriangle, RefreshCw, CheckCircle2, Circle,
  XCircle, Play, ImageIcon, FileCode, ShieldCheck, Truck
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

// Phase 6 B2 — Scene Manager (per-scene drilldown).
// Reads /api/projects/:id/scenes/:sceneId/detail and renders:
//   - top metadata header
//   - 6-stage state-machine strip
//   - per-stage panel (prompt, asset, qa, lua, sim, ship)
//   - right rail: dependency map

const STAGE_ORDER = [
  { key: 'prompt_drafted', label: 'Prompt drafted', icon: FileCode },
  { key: 'asset_generated', label: 'Asset generated', icon: ImageIcon },
  { key: 'qa_passed', label: 'QA passed', icon: ShieldCheck },
  { key: 'lua_written', label: 'Lua written', icon: FileCode },
  { key: 'sim_tested', label: 'Sim tested', icon: Play },
  { key: 'shipped', label: 'Shipped', icon: Truck }
];

function rawAssetUrl(projectId, relPath) {
  if (!relPath) return null;
  const base = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
  return `${base}/api/projects/${projectId}/file/raw?path=${encodeURIComponent(relPath)}`;
}

function StageNode({ stage, idx, active, onClick }) {
  const Icon = stage.icon;
  const done = stage.done;
  const failed = stage.failed;
  let cls = 'bg-ink-800 border-ink-700 text-ink-400';
  if (done) cls = 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300';
  if (failed) cls = 'bg-red-500/15 border-red-500/40 text-red-300';
  if (active) cls += ' ring-2 ring-accent/60';
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-center gap-1 px-2 py-1.5 rounded border ${cls} transition-colors min-w-[88px]`}
    >
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide">
        <span className="font-mono text-ink-500">{idx + 1}</span>
        {done ? <CheckCircle2 className="w-3 h-3" /> :
          failed ? <XCircle className="w-3 h-3" /> :
            <Circle className="w-3 h-3 opacity-50" />}
      </div>
      <Icon className="w-4 h-4" />
      <div className="text-[10px] text-center leading-tight">{stage.label}</div>
    </button>
  );
}

function PromptPanel({ stage }) {
  if (!stage.prompt) return <div className="text-ink-500 text-sm">No prompt recorded yet.</div>;
  return (
    <pre className="whitespace-pre-wrap text-xs text-ink-300 bg-ink-900 border border-ink-700 rounded p-3 overflow-auto max-h-96 font-mono">
      {stage.prompt}
    </pre>
  );
}

function AssetPanel({ stage, projectId, onRegen, regenBusy }) {
  const url = rawAssetUrl(projectId, stage.asset_path);
  return (
    <div className="space-y-3">
      {url ? (
        <div className="bg-ink-900 border border-ink-700 rounded p-2 inline-block">
          <img
            src={url}
            alt="scene background"
            className="image-render-pixel max-w-full"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>
      ) : (
        <div className="text-ink-500 text-sm">No background PNG yet.</div>
      )}
      <button
        type="button"
        onClick={onRegen}
        disabled={regenBusy}
        className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-ink-800 hover:bg-ink-700 border border-ink-700 rounded disabled:opacity-50"
      >
        {regenBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        Re-run background generation
      </button>
    </div>
  );
}

function QaPanel({ stage }) {
  if (!stage.report) return <div className="text-ink-500 text-sm">No QA report yet.</div>;
  return (
    <pre className="text-xs text-ink-300 bg-ink-900 border border-ink-700 rounded p-3 overflow-auto max-h-96 font-mono">
      {JSON.stringify(stage.report, null, 2)}
    </pre>
  );
}

function LuaPanel({ stage }) {
  if (!stage.lua_text) {
    return <div className="text-ink-500 text-sm">No Lua source for this scene yet.</div>;
  }
  return (
    <div className="space-y-2">
      {stage.lua_path ? (
        <div className="text-[11px] font-mono text-ink-500">{stage.lua_path}</div>
      ) : null}
      <pre className="text-xs text-ink-200 bg-ink-900 border border-ink-700 rounded p-3 overflow-auto max-h-[480px] font-mono leading-relaxed">
        {stage.lua_text}
      </pre>
    </div>
  );
}

function SimPanel({ stage }) {
  if (!stage.result) return <div className="text-ink-500 text-sm">Sim test not run.</div>;
  return (
    <pre className="text-xs text-ink-300 bg-ink-900 border border-ink-700 rounded p-3 overflow-auto max-h-96 font-mono">
      {JSON.stringify(stage.result, null, 2)}
    </pre>
  );
}

function ShipPanel({ stage }) {
  return (
    <div className="text-sm text-ink-300">
      {stage.done
        ? <span className="text-emerald-300">Shipped — found in a build/&lt;version&gt;.pdx output.</span>
        : <span className="text-ink-400">Not shipped. Build + export to mark this stage done.</span>}
    </div>
  );
}

function StagePanel({ stageKey, stage, projectId, onRegen, regenBusy }) {
  switch (stageKey) {
    case 'prompt_drafted': return <PromptPanel stage={stage} />;
    case 'asset_generated': return <AssetPanel stage={stage} projectId={projectId} onRegen={onRegen} regenBusy={regenBusy} />;
    case 'qa_passed': return <QaPanel stage={stage} />;
    case 'lua_written': return <LuaPanel stage={stage} />;
    case 'sim_tested': return <SimPanel stage={stage} />;
    case 'shipped': return <ShipPanel stage={stage} />;
    default: return null;
  }
}

export default function SceneManager() {
  const { id, sceneId } = useParams();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [activeStage, setActiveStage] = useState('prompt_drafted');
  const [regenBusy, setRegenBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await api.get(`/api/projects/${id}/scenes/${encodeURIComponent(sceneId)}/detail`);
      setDetail(r);
    } catch (e) { setErr(e); }
    finally { setLoading(false); }
  }, [id, sceneId]);

  useEffect(() => { load(); }, [load]);

  async function regenBg() {
    setRegenBusy(true);
    try {
      await api.post(`/api/projects/${id}/sdk/scenes/${encodeURIComponent(sceneId)}/regen-bg`, {});
      await load();
    } catch (e) { setErr(e); }
    finally { setRegenBusy(false); }
  }

  if (loading && !detail) {
    return (
      <div className="h-screen flex flex-col bg-ink-900 text-ink-100">
        <Nav subtitle={sceneId} showSiderailToggle={false} />
        <div className="flex-1 flex items-center justify-center text-ink-400 text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> loading scene…
        </div>
      </div>
    );
  }
  if (err && !detail) {
    return (
      <div className="h-screen flex flex-col bg-ink-900 text-ink-100">
        <Nav subtitle={sceneId} showSiderailToggle={false} />
        <div className="p-6 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {err?.detail || err?.message || 'failed to load scene'}
        </div>
        <div className="px-6 pb-6">
          <Link to={`/project/${id}/storyboard`} className="text-xs text-ink-400 hover:text-ink-200">
            ← back to storyboard
          </Link>
        </div>
      </div>
    );
  }
  if (!detail) return null;

  const card = detail.card;
  const stages = detail.stages || {};
  const stageList = STAGE_ORDER.map((s) => ({ ...s, ...(stages[s.key] || {}) }));
  const active = stages[activeStage] || {};

  const thumbUrl = rawAssetUrl(id, card.thumbnail_path);

  return (
    <div className="h-screen flex flex-col bg-ink-900 text-ink-100">
      <Nav subtitle={`${card.title} — ${sceneId}`} showSiderailToggle={false} />

      <div className="border-b border-ink-800 px-3 py-2 flex items-center gap-3 flex-wrap">
        <Link
          to={`/project/${id}/storyboard`}
          className="text-xs text-ink-400 hover:text-ink-200 inline-flex items-center gap-1"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> storyboard
        </Link>
        <button
          type="button"
          onClick={load}
          className="btn-icon ml-1"
          title="refresh"
          aria-label="refresh"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <div className="ml-auto text-xs text-ink-500 font-mono">{detail.project_name || detail.project_id}</div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="grid grid-cols-12 gap-3 p-3">
          {/* Center column: scene metadata + stages + active stage panel */}
          <div className="col-span-12 lg:col-span-9 space-y-3">
            <div className="bg-ink-800 border border-ink-700 rounded-lg p-3 flex gap-3">
              <div className="w-40 aspect-[5/3] bg-ink-900 border border-ink-700 rounded overflow-hidden flex items-center justify-center text-ink-500 flex-shrink-0">
                {thumbUrl ? (
                  <img
                    src={thumbUrl}
                    alt={card.title}
                    className="w-full h-full object-cover"
                    style={{ imageRendering: 'pixelated' }}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  <ImageIcon className="w-6 h-6 opacity-40" />
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="text-[10px] font-mono text-ink-500">{card.scene_id}</div>
                <div className="text-lg text-ink-100 truncate">{card.title}</div>
                {card.summary ? (
                  <div className="text-sm text-ink-400">{card.summary}</div>
                ) : null}
                <div className="flex flex-wrap gap-1 pt-1 text-[10px]">
                  {card.mechanic ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">
                      {card.mechanic}
                    </span>
                  ) : null}
                  {(card.characters_present || []).map((c) => (
                    <span key={c} className="inline-flex items-center px-1.5 py-0.5 rounded bg-ink-700 text-ink-300 border border-ink-600">
                      {c}
                    </span>
                  ))}
                </div>
                {detail.canon_section ? (
                  <div className="text-xs text-ink-500 pt-1">
                    canon section: <span className="text-ink-300 font-mono">{detail.canon_section}</span>
                  </div>
                ) : null}
                {(detail.skill_rules || []).length ? (
                  <div className="text-xs text-ink-500">
                    SKILL.md rules: {(detail.skill_rules || []).map((r) => (
                      <span key={r} className="text-ink-300 font-mono mr-1">{r}</span>
                    ))}
                  </div>
                ) : null}
                {(card.anchor_refs || []).length ? (
                  <div className="pt-1">
                    <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">anchor refs</div>
                    <div className="flex flex-wrap gap-1">
                      {card.anchor_refs.map((r) => {
                        const u = rawAssetUrl(id, r);
                        return (
                          <div key={r} className="w-20 h-14 bg-ink-900 border border-ink-700 rounded overflow-hidden">
                            {u ? (
                              <img
                                src={u}
                                alt={r}
                                title={r}
                                className="w-full h-full object-cover"
                                style={{ imageRendering: 'pixelated' }}
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                              />
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="bg-ink-800 border border-ink-700 rounded-lg p-3">
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {stageList.map((s, i) => (
                  <StageNode
                    key={s.key}
                    stage={s}
                    idx={i}
                    active={activeStage === s.key}
                    onClick={() => setActiveStage(s.key)}
                  />
                ))}
              </div>
            </div>

            <div className="bg-ink-800 border border-ink-700 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-ink-200">{STAGE_ORDER.find((s) => s.key === activeStage)?.label}</div>
                <div className="text-[10px] uppercase tracking-wide text-ink-500">
                  {active.done ? 'done' : 'pending'}
                </div>
              </div>
              <StagePanel
                stageKey={activeStage}
                stage={active}
                projectId={id}
                onRegen={regenBg}
                regenBusy={regenBusy}
              />
            </div>
          </div>

          {/* Right rail: dependency map */}
          <div className="col-span-12 lg:col-span-3">
            <div className="bg-ink-800 border border-ink-700 rounded-lg p-3 space-y-3 sticky top-3">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">Blocked by</div>
                {(detail.dependencies?.blocked_by || []).length === 0 ? (
                  <div className="text-xs text-ink-500">(nothing)</div>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {detail.dependencies.blocked_by.map((d) => (
                      <li key={d}>
                        <button
                          type="button"
                          onClick={() => navigate(`/project/${id}/scenes/${encodeURIComponent(d)}`)}
                          className="font-mono text-ink-300 hover:text-accent"
                        >
                          {d}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">Blocks</div>
                {(detail.dependencies?.blocks || []).length === 0 ? (
                  <div className="text-xs text-ink-500">(nothing)</div>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {detail.dependencies.blocks.map((d) => (
                      <li key={d}>
                        <button
                          type="button"
                          onClick={() => navigate(`/project/${id}/scenes/${encodeURIComponent(d)}`)}
                          className="font-mono text-ink-300 hover:text-accent"
                        >
                          {d}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="border-t border-ink-700 pt-2">
                <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">Sources</div>
                <div className="flex flex-wrap gap-1">
                  {(card.sources || []).map((s) => (
                    <span key={s} className="inline-flex items-center px-1.5 py-0.5 text-[10px] rounded bg-ink-700 text-ink-300 border border-ink-600 font-mono">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
