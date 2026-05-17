import { safeErr } from '../lib/format_err.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useProject } from '../lib/pulp_workspace.js';
import {
  Trash2, Plus, Copy, Sparkles, ImagePlus, Image as ImageIcon
} from 'lucide-react';
import PulpRoomGrid from '../components/PulpRoomGrid.jsx';
import PulpTilePalette from '../components/PulpTilePalette.jsx';
import PulpAIAssistModal from '../components/PulpAIAssistModal.jsx';
import PulpSceneControls from '../components/PulpSceneControls.jsx';
import PulpActionBar from '../components/PulpActionBar.jsx';
import PulpInlineRename from '../components/PulpInlineRename.jsx';
import PulpPropertyDrawer, { DrawerSection, DrawerField } from '../components/PulpPropertyDrawer.jsx';
import { pulpApi, newRoom } from '../lib/pulp_api.js';
import { sceneUrl } from '../lib/pulp_scenes.js';

const SAVE_DEBOUNCE_MS = 400;

export default function PulpRooms() {
  const project = useProject();
  const [rooms, setRooms] = useState([]);
  const [tiles, setTiles] = useState([]);
  const [songs, setSongs] = useState([]);
  const [selectedRoomId, setSelectedRoomId] = useState(null);
  const [selectedTileId, setSelectedTileId] = useState(null);
  const [err, setErr] = useState(null);
  const [savingState, setSavingState] = useState('idle');
  const [aiOpen, setAiOpen] = useState(false);
  const [sceneModalOpen, setSceneModalOpen] = useState(false);
  const [sceneCacheKey, setSceneCacheKey] = useState(() => Date.now());
  const debounceRef = useRef(null);
  const latestPatchRef = useRef(null);

  const bumpSceneCache = useCallback(() => {
    setSceneCacheKey(Date.now());
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [r, t, s] = await Promise.all([
          pulpApi.listRooms(project.id),
          pulpApi.listTiles(project.id),
          pulpApi.listSongs(project.id)
        ]);
        if (!alive) return;
        setRooms(r.rooms || []);
        setTiles(t.tiles || []);
        setSongs(s.songs || []);
        if (!selectedRoomId && r.rooms?.[0]) setSelectedRoomId(r.rooms[0].id);
      } catch (_e) { if (alive) setErr('failed to load rooms'); }
    })();
    return () => { alive = false; };
  }, [project.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedRoom = rooms.find((r) => r.id === selectedRoomId) || null;
  const selectedTile = tiles.find((t) => t.id === selectedTileId) || null;

  function commitPatch(rid, patch) {
    latestPatchRef.current = { rid, patch: { ...(latestPatchRef.current?.patch || {}), ...patch } };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSavingState('dirty');
    debounceRef.current = setTimeout(async () => {
      const job = latestPatchRef.current;
      latestPatchRef.current = null;
      if (!job) return;
      setSavingState('saving');
      try {
        const r = await pulpApi.patchRoom(project.id, job.rid, job.patch);
        setRooms((prev) => prev.map((x) => (x.id === job.rid ? r.room : x)));
        setSavingState('saved');
        setTimeout(() => setSavingState('idle'), 800);
      } catch (e) {
        setSavingState('error');
        setErr(e.detail?.error || 'save failed');
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function updateLocal(patch, rid = selectedRoomId) {
    if (!rid) return;
    setRooms((prev) => prev.map((r) => (r.id === rid ? { ...r, ...patch } : r)));
    commitPatch(rid, patch);
  }

  async function onCreateRoom() {
    const baseId = `room_${Date.now().toString(36)}`;
    const room = newRoom({ id: baseId, name: 'new room' });
    try {
      const r = await pulpApi.createRoom(project.id, room);
      setRooms((prev) => [...prev, r.room]);
      setSelectedRoomId(r.room.id);
    } catch (e) { setErr(e.detail?.error || 'create failed'); }
  }

  async function onDuplicateRoom() {
    if (!selectedRoom) return;
    const baseId = `room_${Date.now().toString(36)}`;
    const copy = newRoom({
      ...selectedRoom,
      id: baseId,
      name: `${selectedRoom.name || 'room'} copy`
    });
    // strip server-managed fields
    delete copy.background_image;
    try {
      const r = await pulpApi.createRoom(project.id, copy);
      setRooms((prev) => [...prev, r.room]);
      setSelectedRoomId(r.room.id);
    } catch (e) { setErr(e.detail?.error || 'duplicate failed'); }
  }

  async function onDeleteRoom() {
    if (!selectedRoom) return;
    if (!window.confirm(`delete room "${selectedRoom.name || selectedRoom.id}"?`)) return;
    try {
      await pulpApi.deleteRoom(project.id, selectedRoom.id);
      setRooms((prev) => prev.filter((r) => r.id !== selectedRoom.id));
      setSelectedRoomId(null);
    } catch (e) { setErr(e.detail?.error || 'delete failed'); }
  }

  // ---- derived stats for the badge row ----
  const roomBadges = (() => {
    if (!selectedRoom) return [];
    const grid = selectedRoom.grid || [];
    const rows = grid.length;
    const cols = grid[0]?.length || 0;
    const used = new Set();
    for (const row of grid) {
      for (const cell of row) {
        if (cell) used.add(cell);
      }
    }
    const hasScene = !!selectedRoom.background_image;
    const badges = [
      { label: `${rows}x${cols} grid`, tone: 'neutral' },
      { label: `${used.size} tile types`, tone: 'neutral' }
    ];
    if (hasScene) badges.push({ label: 'scene set', tone: 'accent' });
    if (selectedRoom.song) badges.push({ label: `song: ${selectedRoom.song}`, tone: 'neutral' });
    return badges;
  })();

  return (
    <div className="h-full flex">
      <aside className="border-r border-ink-700 overflow-y-auto p-2 space-y-1" style={{ width: 240, flexShrink: 0 }}>
        <button className="btn-primary w-full text-xs" onClick={onCreateRoom}>
          <Plus className="w-3.5 h-3.5" /> new room
        </button>
        {rooms.length === 0 ? (
          <div className="text-ink-500 text-xs px-2 pt-3">no rooms yet</div>
        ) : rooms.map((r) => (
          <RoomListEntry
            key={r.id}
            room={r}
            projectId={project.id}
            sceneCacheKey={sceneCacheKey}
            active={selectedRoomId === r.id}
            onClick={() => setSelectedRoomId(r.id)}
          />
        ))}
      </aside>

      <section className="flex-1 flex flex-col min-w-0">
        <PulpActionBar
          title={
            selectedRoom ? (
              <PulpInlineRename
                value={selectedRoom.name || ''}
                onSubmit={(name) => updateLocal({ name })}
                saving={savingState}
                ariaLabel="rename room"
              />
            ) : (
              <span className="text-ink-500">no room selected</span>
            )
          }
          badges={roomBadges}
          secondary={selectedRoom ? [
            { icon: ImagePlus, label: 'scene', onClick: () => setSceneModalOpen(true), title: 'change background scene' },
            { icon: Copy, label: 'duplicate', onClick: onDuplicateRoom }
          ] : []}
          primary={selectedRoom ? [
            {
              icon: Sparkles, label: 'generate layout',
              onClick: () => setAiOpen(true),
              disabled: tiles.length === 0,
              title: tiles.length === 0 ? 'create tiles first' : 'generate a room layout with ai'
            }
          ] : []}
          destructive={selectedRoom ? { icon: Trash2, label: 'delete', onClick: onDeleteRoom } : null}
        />

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-auto p-4 flex items-start justify-center min-w-0">
            {!selectedRoom ? (
              <div className="text-ink-500 text-sm pt-12">select or create a room</div>
            ) : (
              <PulpRoomGrid
                grid={selectedRoom.grid}
                onChange={(g) => updateLocal({ grid: g })}
                tiles={tiles}
                selectedTile={selectedTile}
                projectId={project.id}
                roomId={selectedRoom.id}
                sceneCacheKey={sceneCacheKey}
              />
            )}
          </div>

          {/* Tile palette — permanent right rail per design brief. */}
          <aside
            className="border-l border-ink-700 flex flex-col min-h-0 bg-ink-900/40"
            style={{ width: 280, flexShrink: 0 }}
          >
            <div className="px-3 py-2 border-b border-ink-700 flex items-center justify-between">
              <h3 className="text-xs uppercase tracking-wide text-ink-400 font-mono">tile palette</h3>
              <span className="text-[10px] text-ink-500 font-mono">{tiles.length} tiles</span>
            </div>
            <div className="flex-1 min-h-0">
              <PulpTilePalette
                tiles={tiles}
                selectedId={selectedTileId}
                onSelect={(t) => setSelectedTileId(t?.id || null)}
                showCreate={false}
                allowNone
                compact
              />
            </div>
          </aside>

          {/* Collapsible property drawer — defaults closed so palette has more room. */}
          <PulpPropertyDrawer
            storageKey="rooms"
            defaultOpen={false}
            title="properties"
            width={320}
          >
            {selectedRoom ? (
              <>
                <DrawerSection title="metadata">
                  <DrawerField label="id">
                    <input className="input font-mono text-xs" value={selectedRoom.id} disabled />
                  </DrawerField>
                  <DrawerField label="song">
                    <select
                      className="input text-sm"
                      value={selectedRoom.song || ''}
                      onChange={(e) => updateLocal({ song: e.target.value || null })}
                    >
                      <option value="">(none)</option>
                      {songs.map((s) => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
                    </select>
                  </DrawerField>
                </DrawerSection>

                <DrawerSection title="room script">
                  <textarea
                    className="input font-mono text-xs"
                    rows={6}
                    value={selectedRoom.script || ''}
                    onChange={(e) => updateLocal({ script: e.target.value })}
                    placeholder="-- room PulpScript --"
                  />
                  <p className="text-[10px] text-ink-500">
                    edit fuller scripts in the script tab.
                  </p>
                </DrawerSection>
              </>
            ) : (
              <div className="text-xs text-ink-500">select a room</div>
            )}

            {err ? <div className="text-xs text-red-400">{safeErr(err)}</div> : null}
          </PulpPropertyDrawer>
        </div>
      </section>

      {sceneModalOpen && selectedRoom ? (
        <SceneModal onClose={() => setSceneModalOpen(false)}>
          <PulpSceneControls
            project={project}
            room={selectedRoom}
            onSceneChanged={bumpSceneCache}
          />
        </SceneModal>
      ) : null}

      {aiOpen && selectedRoom ? (
        <PulpAIAssistModal
          kind="room-layout"
          projectId={project.id}
          context={{
            room_id: selectedRoom.id,
            available_tile_ids: tiles.map((t) => t.id),
            tilesById: Object.fromEntries(tiles.map((t) => [t.id, t]))
          }}
          onClose={() => setAiOpen(false)}
          onAccept={(result) => {
            const grid = result?.grid;
            if (!Array.isArray(grid) || grid.length !== 15 || !Array.isArray(grid[0]) || grid[0].length !== 25) {
              setErr('ai room layout: expected 15x25 grid');
              return;
            }
            updateLocal({ grid });
          }}
        />
      ) : null}
    </div>
  );
}

// ----- subcomponents -----

function RoomListEntry({ room, projectId, sceneCacheKey, active, onClick }) {
  const [failed, setFailed] = useState(false);
  // reset thumb fail state when the cache key bumps
  useEffect(() => { setFailed(false); }, [sceneCacheKey, room.id]);
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 p-1.5 rounded ${active ? 'bg-ink-700 ring-1 ring-accent text-accent' : 'text-ink-200 hover:bg-ink-700/40'}`}
      title={room.id}
    >
      <div
        className="border border-ink-700 bg-ink-900 rounded overflow-hidden flex items-center justify-center text-ink-600 flex-shrink-0"
        style={{ width: 48, height: 28 }}
      >
        {failed ? (
          <ImageIcon className="w-3 h-3" />
        ) : (
          <img
            src={sceneUrl(projectId, room.id, sceneCacheKey)}
            alt=""
            className="w-full h-full object-cover"
            style={{ imageRendering: 'pixelated' }}
            onError={() => setFailed(true)}
          />
        )}
      </div>
      <div className="min-w-0 text-left">
        <div className="text-xs truncate font-mono">{room.name || '(unnamed)'}</div>
        <div className="text-[10px] text-ink-500 truncate font-mono">{room.id}</div>
      </div>
    </button>
  );
}

function SceneModal({ onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-ink-900/70 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-ink-800 border border-ink-700 rounded-lg p-4 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-mono text-ink-100">background scene</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-400 hover:text-accent text-xs"
          >
            close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
