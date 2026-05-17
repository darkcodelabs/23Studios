import { safeErr } from '../lib/format_err.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useProject } from '../lib/pulp_workspace.js';
import {
  ChevronRight, ChevronDown, Sparkles, BookOpen, Search
} from 'lucide-react';
import PulpAIAssistModal from '../components/PulpAIAssistModal.jsx';
import PulpActionBar from '../components/PulpActionBar.jsx';
import { pulpApi } from '../lib/pulp_api.js';

const SAVE_DEBOUNCE_MS = 500;

// Script scopes:
//   game   -> top-level game_script (PATCH /pulp { game_script })
//   tile:<tid> -> PATCH /pulp/tiles/<tid> { script }
//   room:<rid> -> PATCH /pulp/rooms/<rid> { script }

export default function PulpScripts() {
  const project = useProject();
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
  const [filter, setFilter] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [docsOpen, setDocsOpen] = useState(false);

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

  // Resolve current script text by key.
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

  // ---- title + badges for the action bar ----
  const scope = useMemo(() => {
    if (selectedKey === 'game') return { kind: 'game', label: 'game', name: 'game_script' };
    if (selectedKey.startsWith('tile:')) {
      const tid = selectedKey.slice(5);
      const t = tiles.find((x) => x.id === tid);
      return { kind: 'tile', label: `tile: ${t?.name || tid}`, name: tid };
    }
    if (selectedKey.startsWith('room:')) {
      const rid = selectedKey.slice(5);
      const r = rooms.find((x) => x.id === rid);
      return { kind: 'room', label: `room: ${r?.name || rid}`, name: rid };
    }
    return { kind: 'unknown', label: selectedKey, name: selectedKey };
  }, [selectedKey, tiles, rooms]);

  const lineCount = (draft || '').split('\n').length;
  const scriptBadges = [
    { label: scope.kind, tone: 'accent' },
    { label: `${lineCount} lines`, tone: 'neutral' }
  ];

  // ---- filtered tree ----
  const filteredTiles = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return tiles;
    return tiles.filter((t) => (t.name || '').toLowerCase().includes(q) || (t.id || '').toLowerCase().includes(q));
  }, [tiles, filter]);
  const filteredRooms = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter((r) => (r.name || '').toLowerCase().includes(q) || (r.id || '').toLowerCase().includes(q));
  }, [rooms, filter]);

  return (
    <div className="h-full flex">
      <aside
        className="border-r border-ink-700 flex flex-col min-h-0"
        style={{ width: 220, flexShrink: 0 }}
      >
        <div className="p-2 border-b border-ink-700">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-ink-500" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="filter"
              className="input !py-1 !pl-7 !pr-2 text-xs"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 text-xs font-mono">
          <TreeEntry
            label="game"
            active={selectedKey === 'game'}
            onClick={() => setSelectedKey('game')}
          />
          <TreeGroup label="tiles" count={filteredTiles.length} open={openTiles} onToggle={() => setOpenTiles((v) => !v)}>
            {filteredTiles.length === 0 ? (
              <div className="px-4 text-ink-500">none</div>
            ) : filteredTiles.map((t) => (
              <TreeEntry
                key={t.id}
                label={t.name || t.id}
                hint={t.id}
                indent
                marker={(t.script || '').trim() ? '●' : ''}
                active={selectedKey === `tile:${t.id}`}
                onClick={() => setSelectedKey(`tile:${t.id}`)}
              />
            ))}
          </TreeGroup>
          <TreeGroup label="rooms" count={filteredRooms.length} open={openRooms} onToggle={() => setOpenRooms((v) => !v)}>
            {filteredRooms.length === 0 ? (
              <div className="px-4 text-ink-500">none</div>
            ) : filteredRooms.map((r) => (
              <TreeEntry
                key={r.id}
                label={r.name || r.id}
                hint={r.id}
                indent
                marker={(r.script || '').trim() ? '●' : ''}
                active={selectedKey === `room:${r.id}`}
                onClick={() => setSelectedKey(`room:${r.id}`)}
              />
            ))}
          </TreeGroup>
        </div>
      </aside>

      <section className="flex-1 flex flex-col min-w-0 min-h-0">
        <PulpActionBar
          title={
            <span className="inline-flex items-center gap-2">
              <span className="text-ink-400">scope:</span>
              <span className="text-ink-100">{scope.label}</span>
            </span>
          }
          badges={scriptBadges}
          right={<SaveIndicator state={savingState} />}
          secondary={[
            { icon: BookOpen, label: docsOpen ? 'hide docs' : 'docs',
              onClick: () => setDocsOpen((v) => !v) }
          ]}
          primary={[
            { icon: Sparkles, label: 'generate with ai', onClick: () => setAiOpen(true) }
          ]}
        />

        <div className="flex-1 flex flex-col min-h-0">
          <textarea
            className="flex-1 bg-ink-900 text-ink-100 font-mono p-4 outline-none resize-none border-0 min-h-0"
            style={{ fontSize: 13, lineHeight: 1.55, tabSize: 2 }}
            spellCheck={false}
            value={draft}
            onChange={(e) => onEdit(e.target.value)}
            placeholder={'-- PulpScript --\non confirm do\n  say "hello world"\nend'}
          />
          {err ? <div className="px-3 py-2 text-xs text-red-400 border-t border-ink-700">{safeErr(err)}</div> : null}
          <ScriptDocsPanel open={docsOpen} onClose={() => setDocsOpen(false)} />
        </div>
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

// ----- subcomponents -----

function SaveIndicator({ state }) {
  const map = {
    idle: null,
    dirty: <span className="text-[10px] text-ink-500 font-mono">edited</span>,
    saving: <span className="text-[10px] text-ink-400 font-mono">saving…</span>,
    saved: <span className="text-[10px] text-accent font-mono">saved</span>,
    error: <span className="text-[10px] text-red-400 font-mono">error</span>
  };
  return map[state] || null;
}

function TreeGroup({ label, count, open, onToggle, children }) {
  return (
    <div>
      <button onClick={onToggle} className="w-full flex items-center gap-1 px-2 py-1 text-ink-400 hover:text-ink-200">
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span>{label}</span>
        {typeof count === 'number' ? (
          <span className="ml-auto text-[10px] text-ink-600">{count}</span>
        ) : null}
      </button>
      {open ? children : null}
    </div>
  );
}

function TreeEntry({ label, hint, active, onClick, indent, marker }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-2 py-1 rounded ${indent ? 'pl-6' : ''} ${active ? 'bg-ink-700 text-accent' : 'text-ink-200 hover:bg-ink-700/40'}`}
    >
      <div className="flex items-center gap-1 min-w-0">
        <span className="truncate flex-1">{label}</span>
        {marker ? <span className="text-[8px] text-accent">{marker}</span> : null}
      </div>
      {hint ? <div className="text-[10px] text-ink-500 truncate">{hint}</div> : null}
    </button>
  );
}

// Static cheatsheet rendered below the editor.
function ScriptDocsPanel({ open, onClose }) {
  if (!open) return null;
  return (
    <div className="border-t border-ink-700 bg-ink-900/40 max-h-72 overflow-y-auto">
      <div className="px-4 py-2 flex items-center justify-between border-b border-ink-700 sticky top-0 bg-ink-900/95 backdrop-blur">
        <h3 className="text-xs uppercase tracking-wide text-ink-400 font-mono">pulpscript cheatsheet</h3>
        <button
          type="button"
          onClick={onClose}
          className="text-ink-400 hover:text-accent text-[11px]"
        >
          close
        </button>
      </div>
      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 text-[11px] text-ink-300">
        <DocsBlock title="events">
          <DocsList items={[
            'on load do … end',
            'on update do … end',
            'on confirm do … end',
            'on cancel do … end',
            'on interact do … end (tile)',
            'on collect do … end (item)',
            'on enter do … end (room)',
            'on exit do … end (room)'
          ]} />
        </DocsBlock>
        <DocsBlock title="commands">
          <DocsList items={[
            'say "text"',
            'tell <tile> to … end',
            'goto x,y in <room>',
            'swap <tile>',
            'draw <tile> at x,y',
            'fin "the end"',
            'wait <ticks>',
            'play "<song>"',
            'sound "<sfx>"'
          ]} />
        </DocsBlock>
        <DocsBlock title="vars + math">
          <DocsList items={[
            'set <var> to <value>',
            'add <n> to <var>',
            'random <var> from a,b',
            'if <var> is <value> then … end',
            'while <cond> do … end',
            'persistent vars survive reload',
            'naming: lowercase, no spaces'
          ]} />
        </DocsBlock>
      </div>
    </div>
  );
}

function DocsBlock({ title, children }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-500 mb-1 font-mono">{title}</div>
      {children}
    </div>
  );
}

function DocsList({ items }) {
  return (
    <ul className="space-y-0.5 font-mono">
      {items.map((it, i) => <li key={i} className="truncate">{it}</li>)}
    </ul>
  );
}
