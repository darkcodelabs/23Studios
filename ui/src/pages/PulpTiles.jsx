import { safeErr } from '../lib/format_err.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useProject } from '../lib/pulp_workspace.js';
import { Trash2, Copy, Sparkles } from 'lucide-react';
import PulpTileCanvas from '../components/PulpTileCanvas.jsx';
import PulpFramesStrip from '../components/PulpFramesStrip.jsx';
import PulpTilePalette from '../components/PulpTilePalette.jsx';
import PulpAIAssistModal from '../components/PulpAIAssistModal.jsx';
import PulpActionBar from '../components/PulpActionBar.jsx';
import PulpInlineRename from '../components/PulpInlineRename.jsx';
import PulpPropertyDrawer, { DrawerSection, DrawerField } from '../components/PulpPropertyDrawer.jsx';
import { pulpApi, newTile, emptyFrame, TILE_TYPES } from '../lib/pulp_api.js';

const SAVE_DEBOUNCE_MS = 400;

export default function PulpTiles() {
  const project = useProject();
  const [tiles, setTiles] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [savingState, setSavingState] = useState('idle');
  const [err, setErr] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
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

  async function onDuplicate() {
    if (!selected) return;
    const baseId = `tile_${Date.now().toString(36)}`;
    const copy = newTile({
      ...selected,
      id: baseId,
      name: `${selected.name || 'tile'} copy`
    });
    try {
      const r = await pulpApi.createTile(project.id, copy);
      setTiles((prev) => [...prev, r.tile]);
      setSelectedId(r.tile.id);
      setFrameIdx(0);
    } catch (e) { setErr(e.detail?.error || 'duplicate failed'); }
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

  // ----- derived badges -----
  const tileBadges = (() => {
    if (!selected) return [];
    const dim = selected.frames?.[0]?.pixels?.length === 256 ? '16x16' : '8x8';
    const out = [
      { label: dim, tone: 'neutral' },
      { label: selected.type || 'world', tone: 'accent' },
      { label: `${selected.frames?.length || 0} frames`, tone: 'neutral' }
    ];
    if ((selected.frames?.length || 0) > 1 && (selected.fps || 0) > 0) {
      out.push({ label: `${selected.fps} fps${selected.loop !== false ? ' loop' : ''}`, tone: 'accent' });
    }
    if (selected.solid) out.push({ label: 'solid', tone: 'warn' });
    if ((selected.script || '').trim()) out.push({ label: 'script', tone: 'neutral' });
    return out;
  })();

  return (
    <div className="h-full flex">
      <aside className="border-r border-ink-700 overflow-y-auto" style={{ width: 260, flexShrink: 0 }}>
        <PulpTilePalette
          tiles={tiles}
          selectedId={selectedId}
          onSelect={(t) => { setSelectedId(t?.id || null); setFrameIdx(0); }}
          onCreate={onCreate}
          onDelete={onDelete}
        />
      </aside>

      <section className="flex-1 flex flex-col min-w-0">
        <PulpActionBar
          title={
            selected ? (
              <PulpInlineRename
                value={selected.name || ''}
                onSubmit={(name) => updateLocal({ name })}
                saving={savingState}
                ariaLabel="rename tile"
              />
            ) : (
              <span className="text-ink-500">no tile selected</span>
            )
          }
          badges={tileBadges}
          secondary={selected ? [
            { icon: Copy, label: 'duplicate', onClick: onDuplicate }
          ] : []}
          primary={selected ? [
            {
              icon: Sparkles, label: 'generate art',
              onClick: () => setAiOpen(true),
              title: `generate art for frame ${frameIdx + 1}`
            }
          ] : []}
          destructive={selected ? { icon: Trash2, label: 'delete', onClick: () => onDelete(selected) } : null}
        />

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center gap-4 min-w-0">
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
                <div className="text-[10px] text-ink-500 font-mono">
                  frame {frameIdx + 1}/{selected.frames?.length || 1}
                </div>
                <div className="w-full max-w-3xl border border-ink-700 rounded-md p-3 bg-ink-900/40">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-[10px] uppercase tracking-wide text-ink-500 font-mono">frames</h4>
                  </div>
                  <PulpFramesStrip
                    frames={selected.frames || []}
                    currentIdx={frameIdx}
                    onSelect={setFrameIdx}
                    onChange={(nf) => {
                      // When the user adds a second frame, bump fps to a sane
                      // default so the animation actually moves.
                      if (nf.length > 1 && (!selected.fps || selected.fps === 0)) {
                        updateLocal({ fps: 6 });
                      }
                      updateFrames(nf);
                    }}
                    fps={selected.fps || 6}
                    onFpsChange={(fps) => updateLocal({ fps })}
                    loop={selected.loop !== false}
                    onLoopChange={(lp) => updateLocal({ loop: !!lp })}
                  />
                </div>
              </>
            )}
          </div>

          <PulpPropertyDrawer
            storageKey="tiles"
            defaultOpen={false}
            title="properties"
            width={320}
          >
            {!selected ? (
              <div className="text-xs text-ink-500">select or create a tile</div>
            ) : (
              <>
                <DrawerSection title="identity">
                  <DrawerField label="id">
                    <input className="input font-mono text-xs" value={selected.id} disabled />
                  </DrawerField>
                  <DrawerField label="type">
                    <select
                      className="input text-sm"
                      value={selected.type || 'world'}
                      onChange={(e) => updateLocal({ type: e.target.value })}
                    >
                      {TILE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </DrawerField>
                  <label className="flex items-center gap-2 text-sm text-ink-200">
                    <input
                      type="checkbox"
                      checked={!!selected.solid}
                      onChange={(e) => updateLocal({ solid: e.target.checked })}
                    />
                    solid
                  </label>
                </DrawerSection>

                <DrawerSection title="animation">
                  <DrawerField label="fps">
                    <input
                      type="number"
                      min={0}
                      max={30}
                      className="input text-sm"
                      value={selected.fps || 0}
                      onChange={(e) => updateLocal({ fps: Math.max(0, Math.min(30, Number(e.target.value) || 0)) })}
                    />
                  </DrawerField>
                  <label className="flex items-center gap-2 text-sm text-ink-200">
                    <input
                      type="checkbox"
                      checked={selected.loop !== false}
                      onChange={(e) => updateLocal({ loop: !!e.target.checked })}
                    />
                    loop
                  </label>
                  <p className="text-[10px] text-ink-500">
                    set fps &gt; 0 and add more than one frame to see this tile animate live.
                  </p>
                </DrawerSection>

                <DrawerSection title="tile script">
                  <textarea
                    className="input font-mono text-xs"
                    rows={8}
                    value={selected.script || ''}
                    onChange={(e) => updateLocal({ script: e.target.value })}
                    placeholder="-- PulpScript --"
                  />
                  <p className="text-[10px] text-ink-500">
                    edit fuller scripts in the script tab.
                  </p>
                </DrawerSection>
              </>
            )}

            {err ? <div className="text-xs text-red-400">{safeErr(err)}</div> : null}
          </PulpPropertyDrawer>
        </div>
      </section>

      {aiOpen && selected ? (
        <PulpAIAssistModal
          kind="tile-art"
          projectId={project.id}
          context={{ tile_id: selected.id, frame_idx: frameIdx }}
          onClose={() => setAiOpen(false)}
          onAccept={(result) => {
            // result.pixels is the decoded 16x16 '0'/'1' string (see PulpAIAssistModal)
            if (!selected) return;
            const pixels = result?.pixels;
            if (!pixels || pixels.length !== 256) {
              setErr('ai art decode failed');
              return;
            }
            const nf = (selected.frames || []).slice();
            nf[frameIdx] = { ...(nf[frameIdx] || emptyFrame()), pixels };
            updateFrames(nf);
          }}
        />
      ) : null}
    </div>
  );
}
