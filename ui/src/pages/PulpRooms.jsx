import { useCallback, useEffect, useRef, useState } from 'react';
import { useProject } from '../lib/pulp_workspace.js';
import { Trash2, Plus, Loader2, Save, Sparkles } from 'lucide-react';
import PulpRoomGrid from '../components/PulpRoomGrid.jsx';
import PulpTilePalette from '../components/PulpTilePalette.jsx';
import PulpAIAssistModal from '../components/PulpAIAssistModal.jsx';
import { pulpApi, newRoom } from '../lib/pulp_api.js';

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
  const debounceRef = useRef(null);
  const latestPatchRef = useRef(null);

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

  function updateLocal(patch) {
    if (!selectedRoom) return;
    setRooms((prev) => prev.map((r) => (r.id === selectedRoom.id ? { ...r, ...patch } : r)));
    commitPatch(selectedRoom.id, patch);
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

  async function onDeleteRoom() {
    if (!selectedRoom) return;
    if (!window.confirm(`delete room "${selectedRoom.name || selectedRoom.id}"?`)) return;
    try {
      await pulpApi.deleteRoom(project.id, selectedRoom.id);
      setRooms((prev) => prev.filter((r) => r.id !== selectedRoom.id));
      setSelectedRoomId(null);
    } catch (e) { setErr(e.detail?.error || 'delete failed'); }
  }

  return (
    <div className="h-full grid grid-cols-[220px_1fr_300px]">
      <aside className="border-r border-ink-700 overflow-y-auto p-2 space-y-1">
        <button className="btn-primary w-full text-xs" onClick={onCreateRoom}>
          <Plus className="w-3.5 h-3.5" /> new room
        </button>
        {rooms.length === 0 ? (
          <div className="text-ink-500 text-xs px-2 pt-3">no rooms yet</div>
        ) : rooms.map((r) => (
          <button
            key={r.id}
            onClick={() => setSelectedRoomId(r.id)}
            className={`w-full text-left px-2 py-1.5 text-xs font-mono rounded ${selectedRoomId === r.id ? 'bg-ink-700 text-accent' : 'text-ink-200 hover:bg-ink-700/40'}`}
          >
            <div className="truncate">{r.name || '(unnamed)'}</div>
            <div className="text-[10px] text-ink-500 truncate">{r.id}</div>
          </button>
        ))}
      </aside>

      <section className="overflow-auto p-4 flex items-start justify-center">
        {!selectedRoom ? (
          <div className="text-ink-500 text-sm pt-12">select or create a room</div>
        ) : (
          <PulpRoomGrid
            grid={selectedRoom.grid}
            onChange={(g) => updateLocal({ grid: g })}
            tiles={tiles}
            selectedTile={selectedTile}
          />
        )}
      </section>

      <aside className="border-l border-ink-700 overflow-y-auto p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-wide text-ink-400">tile palette</h3>
          <div className="text-[10px] text-ink-500 flex items-center gap-1">
            {savingState === 'saving' ? <><Loader2 className="w-3 h-3 animate-spin" /> saving</> : null}
            {savingState === 'saved' ? <><Save className="w-3 h-3" /> saved</> : null}
            {savingState === 'dirty' ? 'edited' : null}
            {savingState === 'error' ? <span className="text-red-400">error</span> : null}
          </div>
        </div>
        <PulpTilePalette
          tiles={tiles}
          selectedId={selectedTileId}
          onSelect={(t) => setSelectedTileId(t?.id || null)}
          showCreate={false}
          allowNone
          compact
        />

        {selectedRoom ? (
          <>
            <div className="border-t border-ink-700 pt-3 space-y-2">
              <Field label="name">
                <input className="input text-sm" value={selectedRoom.name || ''} onChange={(e) => updateLocal({ name: e.target.value })} />
              </Field>
              <Field label="song">
                <select className="input text-sm" value={selectedRoom.song || ''} onChange={(e) => updateLocal({ song: e.target.value || null })}>
                  <option value="">(none)</option>
                  {songs.map((s) => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}
                </select>
              </Field>
              <Field label="script">
                <textarea className="input font-mono text-xs" rows={5} value={selectedRoom.script || ''} onChange={(e) => updateLocal({ script: e.target.value })} />
              </Field>
              <button
                className="btn-primary w-full text-xs"
                onClick={() => setAiOpen(true)}
                disabled={tiles.length === 0}
                title={tiles.length === 0 ? 'create tiles first' : 'generate a room layout with ai'}
              >
                <Sparkles className="w-3.5 h-3.5" /> generate room layout
              </button>
              <button className="btn w-full text-xs text-red-400 border-red-900/60" onClick={onDeleteRoom}>
                <Trash2 className="w-3.5 h-3.5" /> delete room
              </button>
            </div>
          </>
        ) : null}

        {err ? <div className="text-xs text-red-400">{err}</div> : null}
      </aside>

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

function Field({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-wide text-ink-500">{label}</span>
      {children}
    </label>
  );
}
