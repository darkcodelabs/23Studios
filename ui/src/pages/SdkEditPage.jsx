import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, Save, Loader2, AlertTriangle, Image as ImageIcon,
  Hammer, Download, PlayCircle, MessageSquare, ChevronRight, ChevronDown
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import ShipButton from '../components/ShipButton.jsx';
import { api } from '../lib/api.js';

// SDK editor — read sdk_data/project.json, expose every scene + character
// field, push edits via PATCH, regenerate per-asset PNGs via the regen
// endpoints, and trigger a fresh pdc build. Replaces the "locked SDK" UX.
export default function SdkEditPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [snap, setSnap] = useState(null);
  const [draft, setDraft] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null); // scene/char id currently regenerating
  const [openIds, setOpenIds] = useState({}); // expanded rows

  const [build, setBuild] = useState(null);
  const [building, setBuilding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await api.get(`/api/projects/${id}/sdk/project`);
      setSnap(r);
      setDraft(JSON.parse(JSON.stringify(r)));
    } catch (e) { setErr(e); }
    finally { setLoading(false); }
  }, [id]);

  const refreshBuild = useCallback(async () => {
    try { setBuild(await api.get(`/api/projects/${id}/sdk/build/status`)); }
    catch (_e) { setBuild(null); }
  }, [id]);

  useEffect(() => { load(); refreshBuild(); }, [load, refreshBuild]);
  useEffect(() => {
    const t = setInterval(refreshBuild, 6000);
    return () => clearInterval(t);
  }, [refreshBuild]);

  const dirty = useMemo(() => JSON.stringify(snap) !== JSON.stringify(draft), [snap, draft]);

  function patchScene(sid, patch) {
    setDraft((d) => ({
      ...d,
      scenes: d.scenes.map((s) => s.id === sid ? { ...s, ...patch } : s)
    }));
  }
  function patchChar(cid, patch) {
    setDraft((d) => ({
      ...d,
      characters: d.characters.map((c) => c.id === cid ? { ...c, ...patch } : c)
    }));
  }
  function patchRoot(patch) { setDraft((d) => ({ ...d, ...patch })); }

  async function save() {
    if (!dirty || saving) return;
    setSaving(true); setErr(null);
    try {
      // Only send the deltas the server cares about.
      const body = {
        name: draft.name,
        description: draft.description,
        startup_scene: draft.startup_scene,
        scenes: draft.scenes.map((s) => ({
          id: s.id, name: s.name, description: s.description,
          style_reference: s.style_reference
        })),
        characters: draft.characters.map((c) => ({
          id: c.id, name: c.name, role: c.role, bio: c.bio,
          portrait_prompt: c.portrait_prompt
        }))
      };
      await api.patch(`/api/projects/${id}/sdk/project`, body);
      await load();
    } catch (e) { setErr(e); }
    finally { setSaving(false); }
  }

  async function regenScene(sceneId) {
    setBusyId(sceneId);
    try { await api.post(`/api/projects/${id}/sdk/scenes/${sceneId}/regen-bg`, {}); }
    catch (e) { setErr(e); }
    finally { setBusyId(null); }
  }
  async function regenPortrait(charId) {
    setBusyId(charId);
    try { await api.post(`/api/projects/${id}/sdk/characters/${charId}/regen-portrait`, {}); }
    catch (e) { setErr(e); }
    finally { setBusyId(null); }
  }

  async function doBuild() {
    setBuilding(true);
    try {
      const r = await api.post(`/api/projects/${id}/sdk/export`, {});
      const statusUrl = r.status_url;
      const deadline = Date.now() + 5 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 1500));
        try {
          const s = await api.get(statusUrl);
          if (s.status === 'done' || s.status === 'failed') break;
        } catch (_e) { /* retry */ }
      }
      await refreshBuild();
    } catch (e) { setErr(e); }
    finally { setBuilding(false); }
  }

  function toggle(rowId) { setOpenIds((o) => ({ ...o, [rowId]: !o[rowId] })); }

  if (loading || !draft) {
    return (
      <div className="h-screen flex flex-col bg-ink-900 text-ink-100">
        <Nav subtitle={id} showSiderailToggle={false} />
        <div className="flex-1 flex items-center justify-center gap-2 text-ink-400 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> loading project…
        </div>
      </div>
    );
  }
  if (err && !draft) {
    return (
      <div className="h-screen flex flex-col bg-ink-900 text-ink-100">
        <Nav subtitle={id} showSiderailToggle={false} />
        <div className="p-6 text-red-400 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {err?.detail || err?.message || 'failed to load'}
        </div>
      </div>
    );
  }

  const ready = build?.has_build && build?.pdx_exists;

  return (
    <div className="h-screen flex flex-col bg-ink-900 text-ink-100">
      <Nav subtitle={draft.name || id} showSiderailToggle={false} />

      <div className="border-b border-ink-800">
        <div className="px-4 h-10 flex items-center gap-2">
          <button type="button" onClick={() => navigate(`/project/${id}`)} className="btn text-xs">
            <ArrowLeft className="w-3.5 h-3.5" /> back
          </button>
          <h2 className="text-sm text-ink-200">Edit SDK Project</h2>
          <div className="flex-1" />
          <BuildBar build={build} ready={ready} building={building}
                    onBuild={doBuild} onPlay={() => { window.location.href = `/project/${id}/sdk/play`; }} />
          <ShipButton projectId={id} />
          <button type="button" onClick={save}
                  className="btn-primary text-xs disabled:opacity-50"
                  disabled={!dirty || saving}>
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
            {saving ? 'saving' : dirty ? 'save changes' : 'saved'}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-6">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Title / description */}
          <section className="space-y-2">
            <label className="block text-xs uppercase tracking-wide text-ink-500">Title</label>
            <input
              type="text" value={draft.name || ''}
              onChange={(e) => patchRoot({ name: e.target.value })}
              className="w-full px-3 py-2 rounded-md bg-ink-800/60 text-ink-100 placeholder-ink-500 border-0 border-b border-b-ink-700 focus:outline-none focus:border-b-accent text-base"
            />
            <label className="block text-xs uppercase tracking-wide text-ink-500 mt-3">Description</label>
            <textarea
              rows={3} value={draft.description || ''}
              onChange={(e) => patchRoot({ description: e.target.value })}
              className="w-full px-3 py-2 rounded-md bg-ink-800/60 text-ink-100 placeholder-ink-500 border-0 text-sm leading-relaxed resize-none"
            />
            <div className="text-[11px] text-ink-500 mt-2">
              Outline (read-only):
              <span className="ml-2 text-ink-400">{draft.outline || '—'}</span>
            </div>
          </section>

          {/* Scenes */}
          <section className="space-y-3">
            <header className="flex items-center gap-2">
              <h3 className="text-sm text-ink-200">Scenes</h3>
              <span className="text-[11px] text-ink-500">{draft.scenes.length}</span>
            </header>
            <StartupSelect draft={draft} onChange={(id) => patchRoot({ startup_scene: id })} />
            <div className="space-y-2">
              {draft.scenes.map((s) => (
                <SceneRow
                  key={s.id} scene={s} projectId={id}
                  open={!!openIds[`s:${s.id}`]} onToggle={() => toggle(`s:${s.id}`)}
                  busy={busyId === s.id}
                  onPatch={(p) => patchScene(s.id, p)}
                  onRegen={() => regenScene(s.id)}
                />
              ))}
            </div>
          </section>

          {/* Characters */}
          <section className="space-y-3">
            <header className="flex items-center gap-2">
              <h3 className="text-sm text-ink-200">Characters</h3>
              <span className="text-[11px] text-ink-500">{draft.characters.length}</span>
            </header>
            <div className="space-y-2">
              {draft.characters.map((c) => (
                <CharRow
                  key={c.id} char={c} projectId={id}
                  open={!!openIds[`c:${c.id}`]} onToggle={() => toggle(`c:${c.id}`)}
                  busy={busyId === c.id}
                  onPatch={(p) => patchChar(c.id, p)}
                  onRegen={() => regenPortrait(c.id)}
                />
              ))}
            </div>
          </section>

          {err ? (
            <div className="text-xs text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3" /> {err?.detail || err?.message || String(err)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function BuildBar({ build, ready, building, onBuild, onPlay }) {
  const stateDot = !build ? 'bg-ink-500' :
    ready ? 'bg-accent' :
    build.status === 'failed' ? 'bg-red-400' : 'bg-amber-400';
  const stateLabel = !build ? 'checking' :
    !build.has_build ? 'never built' :
    !build.pdx_exists ? 'pdx missing' :
    `ready · ${(build.cached_zip_bytes / (1024 * 1024)).toFixed(1)} MB`;
  return (
    <>
      <span className="inline-flex items-center gap-1 text-[11px] text-ink-300 mr-1 font-mono">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${stateDot}`} />
        {stateLabel}
      </span>
      <button type="button" className="btn text-xs" onClick={onBuild} disabled={building}>
        {building ? <Loader2 className="w-3 h-3 animate-spin" /> : <Hammer className="w-3 h-3" />}
        {building ? 'building' : 'build .pdx'}
      </button>
      {ready ? (
        <a href={build.download_url} download
           className="btn text-xs"
           title={`download .pdx.zip (${(build.cached_zip_bytes / (1024 * 1024)).toFixed(1)} MB)`}>
          <Download className="w-3 h-3" /> .pdx
        </a>
      ) : null}
      <button type="button" className="btn text-xs" onClick={onPlay} disabled={!ready}>
        <PlayCircle className="w-3 h-3" /> simulator
      </button>
    </>
  );
}

function StartupSelect({ draft, onChange }) {
  return (
    <label className="flex items-center gap-2 text-[11px] text-ink-400">
      Startup scene:
      <select
        className="bg-ink-800/60 text-ink-200 text-xs px-2 py-1 rounded-md border-0"
        value={draft.startup_scene || ''}
        onChange={(e) => onChange(e.target.value)}
      >
        {draft.scenes.map((s) => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
      </select>
    </label>
  );
}

function SceneRow({ scene, projectId, open, onToggle, busy, onPatch, onRegen }) {
  const [thumbBust, setThumbBust] = useState(0);
  async function fireRegen() {
    await onRegen();
    setThumbBust(Date.now()); // cache-bust the asset img
  }
  return (
    <div className="rounded-md bg-ink-900 ring-1 ring-ink-800">
      <button type="button" onClick={onToggle}
              className="w-full px-3 py-2.5 flex items-center gap-3 text-left hover:bg-ink-800/30 transition-colors">
        {open ? <ChevronDown className="w-3.5 h-3.5 text-ink-500" /> : <ChevronRight className="w-3.5 h-3.5 text-ink-500" />}
        <SceneThumb projectId={projectId} sceneId={scene.id} bust={thumbBust} />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-ink-100 truncate">{scene.name}</div>
          <div className="text-[11px] text-ink-500 truncate font-mono">{scene.id}</div>
        </div>
        {scene.bgm_track_id ? (
          <span className="text-[10px] text-ink-500 font-mono truncate max-w-xs hidden md:inline">♪ {scene.bgm_track_id}</span>
        ) : null}
      </button>
      {open ? (
        <div className="px-3 pb-3 pt-1 border-t border-ink-800/60 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-ink-500">Name</span>
              <input type="text" value={scene.name || ''}
                     onChange={(e) => onPatch({ name: e.target.value })}
                     className="mt-1 w-full px-2 py-1.5 rounded bg-ink-800/60 text-ink-100 border-0 text-sm" />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-ink-500">Style reference</span>
              <input type="text" value={scene.style_reference || ''}
                     placeholder="bedroom | bbs_chat_close | seckc | …"
                     onChange={(e) => onPatch({ style_reference: e.target.value || null })}
                     className="mt-1 w-full px-2 py-1.5 rounded bg-ink-800/60 text-ink-100 border-0 text-sm font-mono" />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-ink-500">Description (drives image prompt)</span>
            <textarea rows={3} value={scene.description || ''}
                      onChange={(e) => onPatch({ description: e.target.value })}
                      className="mt-1 w-full px-2 py-1.5 rounded bg-ink-800/60 text-ink-100 border-0 text-sm resize-none leading-relaxed" />
          </label>
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={fireRegen} disabled={busy}
                    className="btn text-xs disabled:opacity-50">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {busy ? 'regenerating' : 'regenerate background'}
            </button>
            <span className="text-[11px] text-ink-500">~ 60-90 sec via OpenRouter</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CharRow({ char, projectId, open, onToggle, busy, onPatch, onRegen }) {
  const [thumbBust, setThumbBust] = useState(0);
  async function fireRegen() { await onRegen(); setThumbBust(Date.now()); }
  return (
    <div className="rounded-md bg-ink-900 ring-1 ring-ink-800">
      <button type="button" onClick={onToggle}
              className="w-full px-3 py-2.5 flex items-center gap-3 text-left hover:bg-ink-800/30 transition-colors">
        {open ? <ChevronDown className="w-3.5 h-3.5 text-ink-500" /> : <ChevronRight className="w-3.5 h-3.5 text-ink-500" />}
        <CharThumb projectId={projectId} charId={char.id} bust={thumbBust} />
        <div className="flex-1 min-w-0">
          <div className="text-sm text-ink-100 truncate">{char.name}</div>
          <div className="text-[11px] text-ink-500 truncate font-mono">{char.role || char.id}</div>
        </div>
      </button>
      {open ? (
        <div className="px-3 pb-3 pt-1 border-t border-ink-800/60 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-ink-500">Name</span>
              <input type="text" value={char.name || ''}
                     onChange={(e) => onPatch({ name: e.target.value })}
                     className="mt-1 w-full px-2 py-1.5 rounded bg-ink-800/60 text-ink-100 border-0 text-sm" />
            </label>
            <label className="block">
              <span className="text-[11px] uppercase tracking-wide text-ink-500">Role</span>
              <input type="text" value={char.role || ''}
                     onChange={(e) => onPatch({ role: e.target.value })}
                     className="mt-1 w-full px-2 py-1.5 rounded bg-ink-800/60 text-ink-100 border-0 text-sm" />
            </label>
          </div>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-ink-500">Bio</span>
            <textarea rows={2} value={char.bio || ''}
                      onChange={(e) => onPatch({ bio: e.target.value })}
                      className="mt-1 w-full px-2 py-1.5 rounded bg-ink-800/60 text-ink-100 border-0 text-sm resize-none leading-relaxed" />
          </label>
          <label className="block">
            <span className="text-[11px] uppercase tracking-wide text-ink-500">Portrait prompt (drives image gen)</span>
            <textarea rows={2} value={char.portrait_prompt || ''}
                      onChange={(e) => onPatch({ portrait_prompt: e.target.value })}
                      className="mt-1 w-full px-2 py-1.5 rounded bg-ink-800/60 text-ink-100 border-0 text-sm resize-none leading-relaxed" />
          </label>
          <div className="flex items-center gap-2 pt-1">
            <button type="button" onClick={fireRegen} disabled={busy}
                    className="btn text-xs disabled:opacity-50">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              {busy ? 'regenerating' : 'regenerate portrait'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SceneThumb({ projectId, sceneId, bust }) {
  const base = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
  const src = `${base}/api/projects/${projectId}/sdk/scenes/${sceneId}/asset?_=${bust}`;
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="w-16 h-10 bg-ink-800 rounded flex items-center justify-center text-ink-600">
        <ImageIcon className="w-3 h-3" />
      </div>
    );
  }
  return (
    <img src={src} alt="" width={64} height={40}
         onError={() => setFailed(true)}
         className="w-16 h-10 object-cover bg-black rounded pixelated" />
  );
}

function CharThumb({ projectId, charId, bust }) {
  const base = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
  const src = `${base}/api/projects/${projectId}/sdk/characters/${charId}/asset?_=${bust}`;
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="w-10 h-10 bg-ink-800 rounded flex items-center justify-center text-ink-600">
        <ImageIcon className="w-3 h-3" />
      </div>
    );
  }
  return (
    <img src={src} alt="" width={40} height={40}
         onError={() => setFailed(true)}
         className="w-10 h-10 object-cover bg-black rounded pixelated" />
  );
}
