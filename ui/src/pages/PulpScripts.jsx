import { useCallback, useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { Loader2, Save, ChevronRight, ChevronDown, Sparkles } from 'lucide-react';
import PulpAIAssistModal from '../components/PulpAIAssistModal.jsx';
import { pulpApi } from '../lib/pulp_api.js';

const SAVE_DEBOUNCE_MS = 500;

// Script scopes:
//   game   -> top-level game_script (PATCH /pulp { game_script })
//   tile:<tid> -> PATCH /pulp/tiles/<tid> { script }
//   room:<rid> -> PATCH /pulp/rooms/<rid> { script }
// "player" is currently the same as game-scope player handlers — we surface a
// dedicated entry that maps to game_script for now and let the user write
// `on update do ... end` etc.

export default function PulpScripts() {
  const { project } = useOutletContext();
  const [pulp, setPulp] = useState(null);
  const [tiles, setTiles] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [selectedKey, setSelectedKey] = useState('game');
  const [draft, setDraft] = useState('');
  const [err, setErr] = useState(null);
  const [savingState, setSavingState] = useState('idle');
  const debounceRef = useRef(null);
  const latestRef = useRef(null);
  const [openTiles, setOpenTiles] = useState(true);
  const [openRooms, setOpenRooms] = useState(true);
  const [aiOpen, setAiOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, t, r] = await Promise.all([
        pulpApi.get(project.id),
        pulpApi.listTiles(project.id),
        pulpApi.listRooms(project.id)
      ]);
      setPulp(p.project || null);
      setTiles(t.tiles || []);
      setRooms(r.rooms || []);
    } catch (_e) { setErr('failed to load scripts'); }
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  // Resolve current script text by key
  useEffect(() => {
    if (!pulp) return;
    if (selectedKey === 'game') {
      setDraft(pulp.game_script || '');
    } else if (selectedKey.startsWith('tile:')) {
      const tid = selectedKey.slice(5);
      const t = tiles.find((x) => x.id === tid);
      setDraft(t?.script || '');
    } else if (selectedKey.startsWith('room:')) {
      const rid = selectedKey.slice(5);
      const r = rooms.find((x) => x.id === rid);
      setDraft(r?.script || '');
    }
  }, [selectedKey, pulp, tiles, rooms]);

  function commitScheduledSave(text) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSavingState('dirty');
    latestRef.current = text;
    debounceRef.current = setTimeout(async () => {
      const final = latestRef.current;
      latestRef.current = null;
      setSavingState('saving');
      try {
        if (selectedKey === 'game') {
          const r = await pulpApi.patch(project.id, { game_script: final });
          setPulp(r.project || pulp);
        } else if (selectedKey.startsWith('tile:')) {
          const tid = selectedKey.slice(5);
          const r = await pulpApi.patchTile(project.id, tid, { script: final });
          setTiles((prev) => prev.map((t) => (t.id === tid ? r.tile : t)));
        } else if (selectedKey.startsWith('room:')) {
          const rid = selectedKey.slice(5);
          const r = await pulpApi.patchRoom(project.id, rid, { script: final });
          setRooms((prev) => prev.map((x) => (x.id === rid ? r.room : x)));
        }
        setSavingState('saved');
        setTimeout(() => setSavingState('idle'), 800);
      } catch (e) {
        setSavingState('error');
        setErr(e.detail?.error || 'save failed');
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function onEdit(text) {
    setDraft(text);
    commitScheduledSave(text);
  }

  return (
    <div className="h-full grid grid-cols-[240px_1fr]">
      <aside className="border-r border-ink-700 overflow-y-auto p-2 text-xs font-mono">
        <TreeEntry label="game" active={selectedKey === 'game'} onClick={() => setSelectedKey('game')} />
        <TreeGroup label="tiles" open={openTiles} onToggle={() => setOpenTiles((v) => !v)}>
          {tiles.length === 0 ? <div className="px-4 text-ink-500">none</div> : tiles.map((t) => (
            <TreeEntry
              key={t.id}
              label={t.name || t.id}
              hint={t.id}
              indent
              active={selectedKey === `tile:${t.id}`}
              onClick={() => setSelectedKey(`tile:${t.id}`)}
            />
          ))}
        </TreeGroup>
        <TreeGroup label="rooms" open={openRooms} onToggle={() => setOpenRooms((v) => !v)}>
          {rooms.length === 0 ? <div className="px-4 text-ink-500">none</div> : rooms.map((r) => (
            <TreeEntry
              key={r.id}
              label={r.name || r.id}
              hint={r.id}
              indent
              active={selectedKey === `room:${r.id}`}
              onClick={() => setSelectedKey(`room:${r.id}`)}
            />
          ))}
        </TreeGroup>
      </aside>

      <section className="flex flex-col min-h-0">
        <div className="px-3 py-2 border-b border-ink-700 flex items-center gap-2 text-xs">
          <span className="text-ink-400 font-mono">{selectedKey}</span>
          <button
            className="btn-primary text-[11px] py-1 px-2"
            onClick={() => setAiOpen(true)}
            title="generate with ai"
          >
            <Sparkles className="w-3 h-3" /> generate with ai
          </button>
          <div className="flex-1" />
          <div className="text-[10px] text-ink-500 flex items-center gap-1">
            {savingState === 'saving' ? <><Loader2 className="w-3 h-3 animate-spin" /> saving</> : null}
            {savingState === 'saved' ? <><Save className="w-3 h-3" /> saved</> : null}
            {savingState === 'dirty' ? 'edited' : null}
            {savingState === 'error' ? <span className="text-red-400">error</span> : null}
          </div>
        </div>
        <textarea
          className="flex-1 bg-ink-900 text-ink-100 font-mono text-xs p-3 outline-none resize-none"
          spellCheck={false}
          value={draft}
          onChange={(e) => onEdit(e.target.value)}
          placeholder="-- PulpScript --
on confirm do
  say &quot;hello world&quot;
end"
        />
        {err ? <div className="px-3 py-2 text-xs text-red-400 border-t border-ink-700">{err}</div> : null}
      </section>

      {aiOpen ? (
        <PulpAIAssistModal
          kind="script"
          projectId={project.id}
          context={(() => {
            if (selectedKey.startsWith('tile:')) return { scope: 'tile', tile_id: selectedKey.slice(5) };
            if (selectedKey.startsWith('room:')) return { scope: 'room', room_id: selectedKey.slice(5) };
            return { scope: 'game' };
          })()}
          onClose={() => setAiOpen(false)}
          onAccept={(result) => {
            const script = result?.script;
            if (typeof script !== 'string') return;
            onEdit(script);
          }}
        />
      ) : null}
    </div>
  );
}

function TreeGroup({ label, open, onToggle, children }) {
  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center gap-1 px-2 py-1 text-ink-400 hover:text-ink-200">
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span>{label}</span>
      </button>
      {open ? children : null}
    </div>
  );
}

function TreeEntry({ label, hint, active, onClick, indent }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-2 py-1 rounded ${indent ? 'pl-6' : ''} ${active ? 'bg-ink-700 text-accent' : 'text-ink-200 hover:bg-ink-700/40'}`}
    >
      <div className="truncate">{label}</div>
      {hint ? <div className="text-[10px] text-ink-500 truncate">{hint}</div> : null}
    </button>
  );
}
