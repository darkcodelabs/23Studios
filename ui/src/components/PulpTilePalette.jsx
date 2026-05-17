import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { TILE_TYPES, rasterizeFrame } from '../lib/pulp_api.js';

function TilePreview({ tile, size = 36 }) {
  const ref = useRef(null);
  const pixels = tile.frames && tile.frames[0] ? tile.frames[0].pixels : '0'.repeat(256);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#0d0f15';
    ctx.fillRect(0, 0, c.width, c.height);
    const t = rasterizeFrame(pixels, Math.max(1, Math.floor(size / 16)));
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(t, 0, 0);
  }, [pixels, size]);
  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      style={{ imageRendering: 'pixelated', width: size, height: size }}
    />
  );
}

/**
 * Props:
 *   tiles            array
 *   selectedId       string | null
 *   onSelect         (tile | null) => void
 *   onCreate?        () => void
 *   onDelete?        (tile) => void   — optional, only shown if provided
 *   allowNone?       bool             — show a "no tile / erase" option (useful for rooms)
 *   showCreate?      bool
 *   compact?         bool             — smaller previews
 */
export default function PulpTilePalette({
  tiles,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
  allowNone = false,
  showCreate = true,
  compact = false
}) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('all');

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (tiles || []).filter((t) => {
      if (type !== 'all' && t.type !== type) return false;
      if (ql && !(t.name || '').toLowerCase().includes(ql) && !(t.id || '').toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [tiles, q, type]);

  const size = compact ? 28 : 36;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="p-2 border-b border-ink-700 space-y-2">
        <div className="flex items-center gap-1">
          <div className="relative flex-1">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-ink-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="search"
              className="input !py-1 !pl-7 !pr-2 text-xs"
            />
          </div>
          {showCreate && onCreate ? (
            <button type="button" onClick={onCreate} className="btn !px-2 !py-1" title="new tile">
              <Plus className="w-3.5 h-3.5" />
            </button>
          ) : null}
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <button
            type="button"
            onClick={() => setType('all')}
            className={`pill !text-[10px] ${type === 'all' ? '!border-accent !text-accent' : ''}`}
          >
            all
          </button>
          {TILE_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`pill !text-[10px] ${type === t ? '!border-accent !text-accent' : ''}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size + 14}px, 1fr))` }}>
        {allowNone ? (
          <button
            type="button"
            onClick={() => onSelect(null)}
            className={`flex flex-col items-center gap-1 p-1.5 rounded border ${
              selectedId == null ? 'border-accent text-accent' : 'border-ink-600 text-ink-300'
            } hover:border-ink-400 transition`}
            title="erase"
          >
            <div
              className="grid place-items-center text-[10px] text-ink-500"
              style={{ width: size, height: size, background: '#0d0f15' }}
            >
              none
            </div>
            <span className="text-[10px] font-mono truncate w-full text-center">erase</span>
          </button>
        ) : null}

        {filtered.map((t) => {
          const selected = t.id === selectedId;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t)}
              onContextMenu={(e) => {
                if (onDelete) { e.preventDefault(); onDelete(t); }
              }}
              className={`flex flex-col items-center gap-1 p-1.5 rounded border ${
                selected ? 'border-accent' : 'border-ink-700'
              } hover:border-ink-400 transition bg-ink-900/40`}
              title={`${t.name} (${t.type}) — right-click to delete`}
            >
              <TilePreview tile={t} size={size} />
              <span className={`text-[10px] font-mono truncate w-full text-center ${selected ? 'text-accent' : 'text-ink-300'}`}>
                {t.name}
              </span>
            </button>
          );
        })}
        {filtered.length === 0 && !allowNone ? (
          <div className="col-span-full text-center text-ink-500 text-xs py-6">no tiles</div>
        ) : null}
      </div>
    </div>
  );
}
