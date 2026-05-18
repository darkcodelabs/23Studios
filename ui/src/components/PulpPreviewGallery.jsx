import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Loader2 } from 'lucide-react';
import PulpAssetThumb from './PulpAssetThumb.jsx';
import { listAll, KIND_TO_TAB } from '../lib/pulp_preview_client.js';

const POLL_MS = 3000;
const MAX_TILES = 200;

const FILTERS = [
  { id: 'all',    label: 'all' },
  { id: 'tile',   label: 'tiles' },
  { id: 'scene',  label: 'scenes' },
  { id: 'sound',  label: 'sounds' },
  { id: 'song',   label: 'songs' }
];

const SORTS = [
  { id: 'newest', label: 'newest' },
  { id: 'name',   label: 'name' }
];

// Public: unified preview wall.
// Props:
//   projectId   — required
//   live        — true while autopilot is running; enables 3s polling
//   onJumpTab   — (tabId, assetId) → switch to editor tab focused on asset
//   compact     — smaller thumbs (used inside the autopilot modal)
//   maxItems    — cap the rendered list (used by the live-wall sub-grid)
//   header      — show the counts/filter/sort header (default true)
export default function PulpPreviewGallery({
  projectId,
  live = false,
  onJumpTab,
  compact = false,
  maxItems,
  header = true
}) {
  const [data, setData] = useState({ tiles: [], scenes: [], sounds: [], songs: [] });
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('newest');
  const [cacheBust, setCacheBust] = useState(() => Date.now());
  const aliveRef = useRef(true);
  const timerRef = useRef(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const { tiles, sounds, songs, rooms } = await listAll(projectId);
      if (!aliveRef.current) return;
      // Only rooms with a background_image become scene thumbs; rooms
      // without art collapse to a "no scene" tile inside the thumb.
      // We surface every room so the user sees the *intent* even when
      // the binary hasn't landed.
      setData({
        tiles: tiles.slice(0, MAX_TILES),
        scenes: rooms,
        sounds,
        songs
      });
      setCacheBust(Date.now());
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [projectId]);

  // Initial load.
  useEffect(() => {
    aliveRef.current = true;
    refresh();
    return () => { aliveRef.current = false; };
  }, [refresh]);

  // Polling loop, paused when the tab isn't visible.
  useEffect(() => {
    if (!live) return undefined;
    function tick() {
      if (document.hidden) return;
      refresh();
    }
    timerRef.current = setInterval(tick, POLL_MS);
    function onVis() { if (!document.hidden) refresh(); }
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [live, refresh]);

  const counts = useMemo(() => ({
    tile: data.tiles.length,
    scene: data.scenes.length,
    sound: data.sounds.length,
    song: data.songs.length
  }), [data]);

  // Build a flat, ordered list of { kind, asset } for the grid.
  const items = useMemo(() => {
    const rows = [];
    if (filter === 'all' || filter === 'tile')
      for (const t of data.tiles) rows.push({ kind: 'tile', asset: t });
    if (filter === 'all' || filter === 'scene')
      for (const r of data.scenes) rows.push({ kind: 'scene', asset: r });
    if (filter === 'all' || filter === 'sound')
      for (const s of data.sounds) rows.push({ kind: 'sound', asset: s });
    if (filter === 'all' || filter === 'song')
      for (const s of data.songs) rows.push({ kind: 'song', asset: s });
    if (sort === 'name') {
      rows.sort((a, b) => (a.asset.name || a.asset.id || '')
        .localeCompare(b.asset.name || b.asset.id || ''));
    } else {
      // newest: use updated_at / created_at if present, else preserve order.
      rows.sort((a, b) => ts(b.asset) - ts(a.asset));
    }
    return maxItems ? rows.slice(0, maxItems) : rows;
  }, [data, filter, sort, maxItems]);

  function handleClick(kind, asset) {
    const tab = KIND_TO_TAB[kind];
    if (tab && onJumpTab) onJumpTab(tab, asset?.id);
  }

  const size = compact ? 56 : 96;
  const minColPx = compact ? 70 : 110;

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      {header ? (
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono">
          <div className="text-ink-300">
            <span className="text-ink-100">{counts.tile}</span> tiles
            <span className="text-ink-600 mx-1">·</span>
            <span className="text-ink-100">{counts.scene}</span> scenes
            <span className="text-ink-600 mx-1">·</span>
            <span className="text-ink-100">{counts.sound}</span> sounds
            <span className="text-ink-600 mx-1">·</span>
            <span className="text-ink-100">{counts.song}</span> songs
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`px-2 py-0.5 rounded border text-[10px] transition ${
                  filter === f.id
                    ? 'border-accent text-accent bg-ink-800/60'
                    : 'border-ink-700 text-ink-400 hover:text-ink-200'
                }`}
              >{f.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-1 ml-1">
            {SORTS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSort(s.id)}
                className={`px-2 py-0.5 rounded border text-[10px] transition ${
                  sort === s.id
                    ? 'border-accent text-accent bg-ink-800/60'
                    : 'border-ink-700 text-ink-400 hover:text-ink-200'
                }`}
              >{s.label}</button>
            ))}
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            title="refresh"
            className="ml-1 px-2 py-0.5 border border-ink-700 hover:border-accent rounded text-ink-300 hover:text-accent text-[10px] flex items-center gap-1"
          >
            {loading
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <RefreshCw className="w-3 h-3" />}
            refresh
          </button>
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {items.length === 0 ? (
          <EmptyState filter={filter} />
        ) : (
          <div
            className="grid gap-2"
            style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minColPx}px, 1fr))` }}
          >
            {items.map(({ kind, asset }) => (
              <PulpAssetThumb
                key={`${kind}:${asset.id}`}
                kind={kind}
                projectId={projectId}
                asset={asset}
                size={size}
                cacheBust={cacheBust}
                onClick={handleClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ts(a) {
  return (
    Number(a?.updated_at) ||
    Number(a?.created_at) ||
    (typeof a?.updated_at === 'string' ? Date.parse(a.updated_at) : 0) ||
    (typeof a?.created_at === 'string' ? Date.parse(a.created_at) : 0) ||
    0
  );
}

function EmptyState({ filter }) {
  const msg = ({
    tile:  'no tiles yet — run autopilot or import via the assets card on the Game tab',
    scene: 'no scenes yet — run autopilot or upload one from the Room tab',
    sound: 'no sounds yet — run autopilot or create one in the Sound tab',
    song:  'no songs yet — run autopilot or create one in the Song tab',
    all:   'nothing here yet — run the autopilot or add assets from the editor tabs'
  })[filter] || 'no results';
  return (
    <div className="h-full flex items-center justify-center text-ink-500 text-xs font-mono px-4 text-center">
      {msg}
    </div>
  );
}
