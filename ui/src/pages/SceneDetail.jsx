import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  RefreshCw, Loader2, AlertTriangle, Image as ImageIcon, CheckCircle2,
  Circle, XCircle, Play, ChevronRight
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

// Phase 6 B2 — Scene Manager / per-scene drilldown.
// GET /api/projects/:id/scenes/:sceneId/detail
//   → renders metadata header, 6-stage strip, per-stage panel, dep map rail.

const STAGE_ORDER = [
  'prompt_drafted',
  'asset_generated',
  'qa_passed',
  'lua_written',
  'sim_tested',
  'shipped'
];

const STAGE_LABEL = {
  prompt_drafted:   'prompt',
  asset_generated:  'asset',
  qa_passed:        'qa',
  lua_written:      'lua',
  sim_tested:       'sim',
  shipped:          'shipped'
};

function rawAssetUrl(projectId, relPath) {
  if (!relPath) return null;
  const base = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
  return `${base}/api/projects/${projectId}/file/raw?path=${encodeURIComponent(relPath)}`;
}

function StageIcon({ status }) {
  if (status === 'done')   return <CheckCircle2 className="w-4 h-4 text-emerald-300" />;
  if (status === 'failed') return <XCircle className="w-4 h-4 text-red-300" />;
  return <Circle className="w-4 h-4 text-ink-500" />;
}

function StageStrip({ stages, currentStage, selected, onSelect }) {
  return (
    <div className="flex items-stretch gap-px overflow-x-auto border border-ink-700 rounded-md bg-ink-900">
      {stages.map((s, i) => {
        const isCurrent = s.stage === currentStage;
        const isSelected = s.stage === selected;
        const cls = [
          'flex-1 min-w-[110px] px-3 py-2 flex flex-col gap-1 text-left',
          'transition-colors',
          isSelected ? 'bg-ink-700' : 'bg-ink-800 hover:bg-ink-700',
          isCurrent && !isSelected ? 'ring-1 ring-inset ring-accent/40' : ''
        ].join(' ');
        return (
          <button
            key={s.stage}
            type="button"
            onClick={() => onSelect(s.stage)}
            className={cls}
            title={s.error || s.detail || s.stage}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <div className="flex items-center gap-1.5">
              <StageIcon status={s.status} />
              <span className="text-[10px] text-ink-500 font-mono">{i + 1}</span>
              <span className="text-xs text-ink-100 truncate">{STAGE_LABEL[s.stage] || s.stage}</span>
            </div>
            <div className="text-[10px] text-ink-500 truncate">
              {s.status === 'done' && s.at ? new Date(s.at).toLocaleString() :
               s.status === 'failed' ? <span className="text-red-300">failed</span> :
               <span>pending</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MetadataHeader({ scene, projectId, projectName, onRefresh, loading }) {
  const { metadata } = scene;
  return (
    <div className="border-b border-ink-800 px-4 py-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs text-ink-400 flex-wrap">
        <Link to={`/project/${projectId}/storyboard`} className="hover:text-ink-200">
          ← storyboard
        </Link>
        <ChevronRight className="w-3 h-3 text-ink-600" />
        <span className="font-mono text-ink-300">{scene.scene_id}</span>
        {metadata.act ? (
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-ink-800 border border-ink-700 text-ink-300">
            act {metadata.act}
          </span>
        ) : null}
        <button
          type="button"
          onClick={onRefresh}
          className="ml-auto inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-ink-700 hover:bg-ink-800"
          title="reload from disk"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> refresh
        </button>
      </div>
      <div>
        <h1 className="text-base text-ink-100 truncate" title={metadata.title}>
          {metadata.title}
        </h1>
        {metadata.description ? (
          <div className="text-xs text-ink-400 mt-1 line-clamp-2">{metadata.description}</div>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px]">
        {metadata.mechanic ? (
          <span className="inline-flex items-center gap-1">
            <span className="text-ink-500">mechanic:</span>
            <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent border border-accent/30">{metadata.mechanic}</span>
          </span>
        ) : null}
        {(metadata.characters_present || []).length > 0 ? (
          <span className="inline-flex items-center gap-1 flex-wrap">
            <span className="text-ink-500">characters:</span>
            {metadata.characters_present.map((c) => (
              <span key={c} className="px-1.5 py-0.5 rounded bg-ink-700 text-ink-300 border border-ink-600">{c}</span>
            ))}
          </span>
        ) : null}
        {(metadata.anchor_refs || []).length > 0 ? (
          <span className="inline-flex items-center gap-1 flex-wrap">
            <span className="text-ink-500">anchors:</span>
            {metadata.anchor_refs.map((a) => (
              <span key={a} className="px-1.5 py-0.5 rounded bg-ink-800 text-ink-400 border border-ink-700 font-mono text-[10px]">{a}</span>
            ))}
          </span>
        ) : null}
        {(metadata.canon_sections || []).length > 0 ? (
          <span className="inline-flex items-center gap-1 flex-wrap">
            <span className="text-ink-500">canon:</span>
            {metadata.canon_sections.map((s) => (
              <span key={s} className="px-1.5 py-0.5 rounded bg-ink-800 text-ink-300 border border-ink-700">{s}</span>
            ))}
          </span>
        ) : null}
        {(metadata.skill_rules || []).length > 0 ? (
          <span className="inline-flex items-center gap-1 flex-wrap">
            <span className="text-ink-500">SKILL.md:</span>
            {metadata.skill_rules.map((r) => (
              <span key={r} className="px-1.5 py-0.5 rounded bg-ink-800 text-ink-300 border border-ink-700">{r}</span>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PromptPanel({ panels }) {
  if (!panels.prompt) return <EmptyPanel label="no prompt drafted yet" />;
  return (
    <div className="space-y-2">
      {panels.prompt.prompt_text ? (
        <div>
          <div className="text-[10px] text-ink-500 uppercase tracking-wide mb-1">prompt text</div>
          <pre className="text-xs whitespace-pre-wrap bg-ink-900 p-2 rounded border border-ink-700 max-h-[60vh] overflow-auto">{panels.prompt.prompt_text}</pre>
        </div>
      ) : null}
      <details className="text-xs">
        <summary className="cursor-pointer text-ink-400 hover:text-ink-200">raw JSON</summary>
        <pre className="text-[10px] whitespace-pre-wrap bg-ink-900 p-2 rounded border border-ink-700 mt-1 max-h-80 overflow-auto">{JSON.stringify(panels.prompt.raw, null, 2)}</pre>
      </details>
    </div>
  );
}

function AssetPanel({ projectId, panels, sceneId, onRegen, regenBusy, regenErr }) {
  const url = panels.asset ? rawAssetUrl(projectId, panels.asset.path) : null;
  return (
    <div className="space-y-2">
      {url ? (
        <div className="border border-ink-700 rounded bg-ink-900 p-2 inline-block">
          <img
            src={url}
            alt={`asset for ${sceneId}`}
            className="max-w-full max-h-[60vh] image-render-pixel"
          />
          <div className="text-[10px] text-ink-500 mt-1 font-mono">{panels.asset.path}</div>
        </div>
      ) : (
        <EmptyPanel label="no asset generated yet" />
      )}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onRegen}
          disabled={regenBusy}
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded border border-ink-700 bg-ink-800 hover:bg-ink-700 disabled:opacity-50"
        >
          {regenBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          {url ? 're-run background' : 'generate background'}
        </button>
        {regenErr ? <span className="text-xs text-red-300">{regenErr}</span> : null}
      </div>
    </div>
  );
}

function QaPanel({ panels }) {
  if (!panels.qa) return <EmptyPanel label="no QA report yet" />;
  const passing = panels.qa.pass === true
    || panels.qa.status === 'pass'
    || panels.qa.failed === false;
  return (
    <div className="space-y-2">
      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs ${
        passing
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          : 'bg-red-500/10 border-red-500/30 text-red-300'
      }`}>
        {passing ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
        {passing ? 'pass' : 'fail'}
      </div>
      <pre className="text-[11px] whitespace-pre-wrap bg-ink-900 p-2 rounded border border-ink-700 max-h-[60vh] overflow-auto">{JSON.stringify(panels.qa, null, 2)}</pre>
    </div>
  );
}

function LuaPanel({ panels }) {
  if (!panels.lua) return <EmptyPanel label="no Lua written yet" />;
  return (
    <div className="space-y-2">
      <div className="text-[10px] text-ink-500 font-mono">{panels.lua.path} ({panels.lua.bytes} bytes{panels.lua.truncated ? ', truncated' : ''})</div>
      <pre className="text-[11px] whitespace-pre bg-ink-900 p-2 rounded border border-ink-700 max-h-[65vh] overflow-auto">{panels.lua.text}</pre>
    </div>
  );
}

function SimPanel({ projectId, panels, sceneId }) {
  if (!panels.sim) return <EmptyPanel label="no sim walkthrough yet" />;
  const url = rawAssetUrl(projectId, panels.sim.path);
  return (
    <div className="space-y-2">
      <div className="border border-ink-700 rounded bg-ink-900 p-2 inline-block">
        <img
          src={url}
          alt={`sim walkthrough for ${sceneId}`}
          className="max-w-full max-h-[60vh] image-render-pixel"
        />
        <div className="text-[10px] text-ink-500 mt-1 font-mono">{panels.sim.path}</div>
      </div>
    </div>
  );
}

function ShippedPanel({ scene }) {
  const stage = scene.stages.find((s) => s.stage === 'shipped');
  if (!stage || stage.status !== 'done') return <EmptyPanel label="not shipped yet" />;
  return (
    <div className="space-y-1 text-sm">
      <div className="text-ink-100">
        Shipped via <span className="font-mono text-accent">{stage.detail || 'unknown'}</span>
      </div>
      {stage.artifact_path ? (
        <div className="text-[11px] font-mono text-ink-400">{stage.artifact_path}</div>
      ) : null}
      {stage.at ? <div className="text-[11px] text-ink-500">{new Date(stage.at).toLocaleString()}</div> : null}
    </div>
  );
}

function EmptyPanel({ label }) {
  return <div className="text-xs text-ink-500 italic py-6">{label}</div>;
}

function DepMapRail({ depMap, projectId }) {
  const linkFor = (id) => `/project/${projectId}/scenes/${encodeURIComponent(id)}`;
  return (
    <aside className="w-64 shrink-0 border-l border-ink-800 bg-ink-900 p-3 overflow-auto">
      <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">dependency map</div>
      <div className="space-y-3 text-xs">
        <div>
          <div className="text-ink-400 mb-1">is blocked by</div>
          {(depMap.is_blocked_by || []).length === 0 ? (
            <div className="text-ink-600 italic text-[11px]">none</div>
          ) : (
            <ul className="space-y-0.5">
              {depMap.is_blocked_by.map((id) => (
                <li key={id}>
                  <Link to={linkFor(id)} className="text-ink-200 hover:text-accent font-mono text-[11px]">{id}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="text-ink-400 mb-1">blocks</div>
          {(depMap.blocks || []).length === 0 ? (
            <div className="text-ink-600 italic text-[11px]">none</div>
          ) : (
            <ul className="space-y-0.5">
              {depMap.blocks.map((id) => (
                <li key={id}>
                  <Link to={linkFor(id)} className="text-ink-200 hover:text-accent font-mono text-[11px]">{id}</Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}

export default function SceneDetail() {
  const { id, sceneId } = useParams();
  const [scene, setScene] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedStage, setSelectedStage] = useState(null);
  const [regenBusy, setRegenBusy] = useState(false);
  const [regenErr, setRegenErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await api.get(`/api/projects/${id}/scenes/${encodeURIComponent(sceneId)}/detail`);
      setScene(r);
      if (!selectedStage) setSelectedStage(r.current_stage || 'prompt_drafted');
    } catch (e) { setErr(e); }
    finally { setLoading(false); }
  }, [id, sceneId, selectedStage]);

  useEffect(() => { load(); }, [load]);

  const regenBg = useCallback(async () => {
    setRegenBusy(true); setRegenErr(null);
    try {
      await api.post(`/api/projects/${id}/sdk/scenes/${encodeURIComponent(sceneId)}/regen-bg`, {});
      // Re-read detail so the asset/png stage pulls the new artifact.
      const r = await api.get(`/api/projects/${id}/scenes/${encodeURIComponent(sceneId)}/detail`);
      setScene(r);
    } catch (e) {
      setRegenErr(e?.detail || e?.message || 'regen failed');
    } finally {
      setRegenBusy(false);
    }
  }, [id, sceneId]);

  const activeStage = useMemo(() => {
    if (!scene) return null;
    return scene.stages.find((s) => s.stage === selectedStage) || scene.stages[0];
  }, [scene, selectedStage]);

  return (
    <div className="h-screen flex flex-col bg-ink-900 text-ink-100">
      <Nav subtitle={scene ? `${scene.project_name || id} — ${scene.metadata.title}` : id} showSiderailToggle={false} />

      {loading && !scene ? (
        <div className="flex-1 flex items-center justify-center text-ink-400 text-sm gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> loading scene…
        </div>
      ) : err ? (
        <div className="p-4 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {err?.detail || err?.message || 'failed to load scene'}
        </div>
      ) : !scene ? null : (
        <>
          <MetadataHeader
            scene={scene}
            projectId={id}
            projectName={scene.project_name}
            onRefresh={load}
            loading={loading}
          />

          <div className="px-4 py-3">
            <StageStrip
              stages={scene.stages}
              currentStage={scene.current_stage}
              selected={selectedStage}
              onSelect={setSelectedStage}
            />
          </div>

          <div className="flex flex-1 min-h-0">
            <div className="flex-1 overflow-auto p-4 space-y-3">
              <div className="text-xs text-ink-400 flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide text-ink-500">stage:</span>
                <span className="font-mono text-ink-200">{activeStage.stage}</span>
                {activeStage.error ? <span className="text-red-300">— {activeStage.error}</span> : null}
              </div>
              {activeStage.stage === 'prompt_drafted'  && <PromptPanel  panels={scene.panels} />}
              {activeStage.stage === 'asset_generated' && (
                <AssetPanel
                  projectId={id}
                  panels={scene.panels}
                  sceneId={sceneId}
                  onRegen={regenBg}
                  regenBusy={regenBusy}
                  regenErr={regenErr}
                />
              )}
              {activeStage.stage === 'qa_passed'      && <QaPanel     panels={scene.panels} />}
              {activeStage.stage === 'lua_written'    && <LuaPanel    panels={scene.panels} />}
              {activeStage.stage === 'sim_tested'     && <SimPanel    projectId={id} panels={scene.panels} sceneId={sceneId} />}
              {activeStage.stage === 'shipped'        && <ShippedPanel scene={scene} />}
            </div>
            <DepMapRail depMap={scene.dep_map} projectId={id} />
          </div>
        </>
      )}
    </div>
  );
}
