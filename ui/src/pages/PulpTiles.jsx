import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Save, Trash2, Plus, Loader2 } from 'lucide-react';
import PulpTileCanvas from '../components/PulpTileCanvas.jsx';
import PulpFramesStrip from '../components/PulpFramesStrip.jsx';
import PulpTilePalette from '../components/PulpTilePalette.jsx';
import { pulpApi, newTile, emptyFrame, TILE_TYPES } from '../lib/pulp_api.js';

const SAVE_DEBOUNCE_MS = 400;

export default function PulpTiles() {
  const { project } = useOutletContext();
  const [tiles, setTiles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [savingState, setSavingState] = useState('idle');
  const [err, setErr] = useState(null);
  const debounceRef = useRef(null);
  const latestPatchRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await pulpApi.listTiles(project.id);
      const list = r.tiles || [];
      setTiles(list);
      if (!selectedId && list[0]) setSelectedId(list[0].id);
    } catch (_e) { setErr('failed to load tiles'); }
  }, [project.id, selectedId]);

  useEffect(() => { load(); }, [load]);

  const selected = tiles.find((t) => t.id === selectedId) || null;

  function commitPatch(tid, patch) {
    latestPatchRef.current = { tid, patch: { ...(latestPatchRef.current?.patch || {}), ...patch } };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSavingState('dirty');
    debounceRef.current = setTimeout(async () => {
      const job = latestPatchRef.current;
      latestPatchRef.current = null;
      if (!job) return;
      setSavingState('saving');
      try {
        const r = await pulpApi.patchTile(project.id, job.tid, job.patch);
        setTiles((prev) => prev.map((t) => (t.id === job.tid ? r.tile : t)));
        setSavingState('saved');
        setTimeout(() => setSavingState('idle'), 800);
      } catch (e) {
        setSavingState('error');
        setErr(e.detail?.error || 'save failed');
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function updateLocal(patch) {
    if (!selected) return;
    setTiles((prev) => prev.map((t) => (t.id === selected.id ? { ...t, ...patch } : t)));
    commitPatch(selected.id, patch);
  }

  function updateFrames(newFrames) {
    if (!selected) return;
    setTiles((prev) => prev.map((t) => (t.id === selected.id ? { ...t, frames: newFrames } : t)));
    commitPatch(selected.id, { frames: newFrames });
  }

  async function onCreate() {
    const baseId = `tile_${Date.now().toString(36)}`;
    const tile = newTile({ id: baseId, name: 'new tile' });
    try {
      const r = await pulpApi.createTile(project.id, tile);
      setTiles((prev) => [...prev, r.tile]);
      setSelectedId(r.tile.id);
      setFrameIdx(0);
    } catch (e) { setErr(e.detail?.error || 'create failed'); }
  }

  async function onDelete(tile) {
    if (!tile) return;
    if (!window.confirm(`delete tile "${tile.name || tile.id}"?`)) return;
    try {
      await pulpApi.deleteTile(project.id, tile.id);
      setTiles((prev) => prev.filter((t) => t.id !== tile.id));
      if (selectedId === tile.id) setSelectedId(null);
    } catch (e) { setErr(e.detail?.error || 'delete failed'); }
  }

  const currentFrame = selected?.frames?.[frameIdx];
  const prevFrame = selected?.frames?.[(frameIdx - 1 + (selected?.frames?.length || 1)) % (selected?.frames?.length || 1)];

  return (
    <div className="h-full grid grid-cols-[260px_1fr_320px]">
      <aside className="border-r border-ink-700 overflow-y-auto">
        <PulpTilePalette
          tiles={tiles}
          selectedId={selectedId}
          onSelect={(t) => { setSelectedId(t?.id || null); setFrameIdx(0); }}
          onCreate={onCreate}
          onDelete={onDelete}
        />
      </aside>

      <section className="overflow-y-auto p-4 flex flex-col items-center gap-4">
        {!selected ? (
          <div className="text-ink-500 text-sm pt-12">no tile selected</div>
        ) : !currentFrame ? (
          <div className="text-ink-500 text-sm pt-12">tile has no frames</div>
        ) : (
          <>
            <PulpTileCanvas
              pixels={currentFrame.pixels}
              previousPixels={prevFrame ? prevFrame.pixels : null}
              onChange={(newPixels) => {
                const nf = (selected.frames || []).slice();
                nf[frameIdx] = { ...(nf[frameIdx] || emptyFrame()), pixels: newPixels };
                updateFrames(nf);
              }}
            />
            <PulpFramesStrip
              frames={selected.frames || []}
              currentIdx={frameIdx}
              onSelect={setFrameIdx}
              onChange={updateFrames}
              fps={selected.fps || 0}
              onFpsChange={(fps) => updateLocal({ fps })}
            />
          </>
        )}
      </section>

      <aside className="border-l border-ink-700 overflow-y-auto p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wide text-ink-400">properties</h3>
          <div className="text-[10px] text-ink-500 flex items-center gap-1">
            {savingState === 'saving' ? <><Loader2 className="w-3 h-3 animate-spin" /> saving</> : null}
            {savingState === 'saved' ? <><Save className="w-3 h-3" /> saved</> : null}
            {savingState === 'dirty' ? 'edited' : null}
            {savingState === 'error' ? <span className="text-red-400">error</span> : null}
          </div>
        </div>

        {!selected ? (
          <div className="text-xs text-ink-500">select or create a tile</div>
        ) : (
          <>
            <Field label="id"><input className="input font-mono text-xs" value={selected.id} disabled /></Field>
            <Field label="name">
              <input className="input text-sm" value={selected.name || ''} onChange={(e) => updateLocal({ name: e.target.value })} />
            </Field>
            <Field label="type">
              <select className="input text-sm" value={selected.type || 'world'} onChange={(e) => updateLocal({ type: e.target.value })}>
                {TILE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 text-sm text-ink-200">
              <input type="checkbox" checked={!!selected.solid} onChange={(e) => updateLocal({ solid: e.target.checked })} />
              solid
            </label>
            <Field label="script">
              <textarea
                className="input font-mono text-xs"
                rows={8}
                value={selected.script || ''}
                onChange={(e) => updateLocal({ script: e.target.value })}
                placeholder="-- PulpScript --"
              />
            </Field>
            <button className="btn w-full text-xs text-red-400 border-red-900/60" onClick={() => onDelete(selected)}>
              <Trash2 className="w-3.5 h-3.5" /> delete tile
            </button>
          </>
        )}

        {err ? <div className="text-xs text-red-400">{err}</div> : null}
      </aside>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-wide text-ink-500">{label}</span>
      {children}
    </label>
  );
}
