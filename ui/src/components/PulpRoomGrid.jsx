import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Paintbrush, PaintBucket, Square as SquareIcon, Copy, ClipboardPaste, Grid as GridIcon, Hash, Image as ImageIcon
} from 'lucide-react';
import { rasterizeFrame } from '../lib/pulp_api.js';
import PulpRoomBackground from './PulpRoomBackground.jsx';

const COLS = 25;
const ROWS = 15;
const CELL = 24; // px per cell in editor
const CANVAS_W = COLS * CELL; // 600
const CANVAS_H = ROWS * CELL; // 360

const TOOLS = [
  { id: 'paint', icon: Paintbrush, label: 'paint' },
  { id: 'bucket', icon: PaintBucket, label: 'fill' },
  { id: 'rect', icon: SquareIcon, label: 'rect' },
  { id: 'select', icon: Copy, label: 'select' }
];

// pure helpers on 2D arrays (rows of length cols, values = tile id or null)

function cloneGrid(g) {
  return g.map((row) => row.slice());
}
function bucketFillGrid(g, x, y, target, value) {
  if (target === value) return g;
  const out = cloneGrid(g);
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= COLS || cy >= ROWS) continue;
    if (out[cy][cx] !== target) continue;
    out[cy][cx] = value;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  return out;
}
function rectFillGrid(g, x0, y0, x1, y1, value) {
  const out = cloneGrid(g);
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
  const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
  for (let y = ya; y <= yb; y++) {
    for (let x = xa; x <= xb; x++) {
      if (y >= 0 && y < ROWS && x >= 0 && x < COLS) out[y][x] = value;
    }
  }
  return out;
}

/**
 * Props:
 *   grid             15×25 nested array of tile_id or null
 *   onChange         (newGrid) => void
 *   tiles            tile array
 *   selectedTile     selected tile (or null = erase)
 *   projectId?       string — passed to PulpRoomBackground for scene fetch
 *   roomId?          string — passed to PulpRoomBackground for scene fetch
 *   sceneCacheKey?   number — bumped to force background re-fetch after edits
 *   showBackground?  boolean (default true) — toggles the scene layer
 */
export default function PulpRoomGrid({
  grid,
  onChange,
  tiles,
  selectedTile,
  projectId,
  roomId,
  sceneCacheKey,
  showBackground = true
}) {
  const canvasRef = useRef(null);
  const [tool, setTool] = useState('paint');
  const [showGrid, setShowGrid] = useState(true);
  const [showIds, setShowIds] = useState(false);
  const [bgVisible, setBgVisible] = useState(true);

  // Build a tileId -> rasterized canvas (at CELL px) cache.
  // Tile dim is inferred from each tile's pixel-string length: 64 -> 8x8
  // (new pulp default), 256 -> 16x16 (legacy / SDK). Empty tiles fall back
  // to the existing 16x16 placeholder so legacy projects render the same.
  const tileCache = useMemo(() => {
    const m = new Map();
    for (const t of tiles || []) {
      const pixels = t.frames && t.frames[0] ? t.frames[0].pixels : '0'.repeat(256);
      const tileDim = pixels.length === 64 ? 8 : 16;
      // CELL px per cell, regardless of source tile dim. rasterizeFrame
      // returns a canvas at (tileDim * scale) — pick the integer scale
      // closest to CELL/tileDim so pixels stay crisp.
      const scale = Math.max(1, Math.floor(CELL / tileDim));
      const c = rasterizeFrame(pixels, scale);
      m.set(t.id, c);
    }
    return m;
  }, [tiles]);

  const dragRef = useRef(null); // for rect / select drag preview
  const paintRef = useRef(null); // for paint drag
  const [clipboard, setClipboard] = useState(null); // { w, h, cells: 2d }
  const [selRect, setSelRect] = useState(null); // { x0,y0,x1,y1 } in cell coords
  const [, force] = useState(0);

  const bgActive = showBackground && bgVisible && !!projectId && !!roomId;

  const repaint = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    // When a scene background is showing, keep the canvas transparent so the
    // <img> behind it bleeds through empty cells. Otherwise paint the usual
    // dark editor fill.
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    if (!bgActive) {
      ctx.fillStyle = '#0d0f15';
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }

    // tiles
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const tid = grid[y][x];
        if (!tid) continue;
        const img = tileCache.get(tid);
        if (img) {
          ctx.drawImage(img, x * CELL, y * CELL, CELL, CELL);
        } else {
          // unknown tile id — draw red marker
          ctx.fillStyle = 'rgba(255,80,80,0.4)';
          ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      }
    }

    // rect tool preview
    const drag = dragRef.current;
    if (drag && (tool === 'rect' || tool === 'select')) {
      const xa = Math.min(drag.startX, drag.lastX);
      const xb = Math.max(drag.startX, drag.lastX);
      const ya = Math.min(drag.startY, drag.lastY);
      const yb = Math.max(drag.startY, drag.lastY);
      ctx.strokeStyle = tool === 'select' ? '#9dffce' : 'rgba(157,255,206,0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(xa * CELL + 1, ya * CELL + 1, (xb - xa + 1) * CELL - 2, (yb - ya + 1) * CELL - 2);
    } else if (selRect) {
      const { x0, y0, x1, y1 } = selRect;
      const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
      const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
      ctx.strokeStyle = '#9dffce';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(xa * CELL + 1, ya * CELL + 1, (xb - xa + 1) * CELL - 2, (yb - ya + 1) * CELL - 2);
      ctx.setLineDash([]);
    }

    if (showGrid) {
      ctx.strokeStyle = 'rgba(122,128,147,0.18)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= COLS; i++) {
        const p = i * CELL + 0.5;
        ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, CANVAS_H); ctx.stroke();
      }
      for (let i = 0; i <= ROWS; i++) {
        const p = i * CELL + 0.5;
        ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(CANVAS_W, p); ctx.stroke();
      }
    }

    if (showIds) {
      ctx.fillStyle = 'rgba(157,255,206,0.9)';
      ctx.font = '9px monospace';
      ctx.textBaseline = 'top';
      for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
          const tid = grid[y][x];
          if (!tid) continue;
          const short = String(tid).slice(0, 4);
          ctx.fillText(short, x * CELL + 2, y * CELL + 2);
        }
      }
    }
  }, [grid, tileCache, tool, showGrid, showIds, selRect, bgActive]);

  useEffect(() => { repaint(); }, [repaint]);

  function eventToCell(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / (rect.width / COLS));
    const y = Math.floor((e.clientY - rect.top) / (rect.height / ROWS));
    return { x: Math.max(0, Math.min(COLS - 1, x)), y: Math.max(0, Math.min(ROWS - 1, y)) };
  }

  function commit(newGrid) { onChange(newGrid); }

  function valueForClick(e) {
    if (e.button === 2) return null; // right-click erase
    return selectedTile ? selectedTile.id : null;
  }

  function onMouseDown(e) {
    e.preventDefault();
    const { x, y } = eventToCell(e);
    const isShift = e.shiftKey;
    const value = valueForClick(e);

    if (tool === 'select' || isShift) {
      dragRef.current = { startX: x, startY: y, lastX: x, lastY: y, mode: 'select' };
      setSelRect(null);
      force((n) => n + 1);
      return;
    }
    if (tool === 'bucket') {
      const target = grid[y][x];
      commit(bucketFillGrid(grid, x, y, target, value));
      return;
    }
    if (tool === 'rect') {
      dragRef.current = { startX: x, startY: y, lastX: x, lastY: y, value, mode: 'rect' };
      force((n) => n + 1);
      return;
    }
    // paint
    const next = cloneGrid(grid);
    next[y][x] = value;
    paintRef.current = { value, lastIdx: y * COLS + x };
    commit(next);
  }

  function onMouseMove(e) {
    if (paintRef.current) {
      const { x, y } = eventToCell(e);
      const idx = y * COLS + x;
      if (idx === paintRef.current.lastIdx) return;
      paintRef.current.lastIdx = idx;
      const next = cloneGrid(grid);
      next[y][x] = paintRef.current.value;
      commit(next);
      return;
    }
    if (dragRef.current) {
      const { x, y } = eventToCell(e);
      if (dragRef.current.lastX === x && dragRef.current.lastY === y) return;
      dragRef.current.lastX = x;
      dragRef.current.lastY = y;
      force((n) => n + 1);
    }
  }

  function onMouseUp() {
    if (paintRef.current) { paintRef.current = null; return; }
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.mode === 'rect') {
      commit(rectFillGrid(grid, drag.startX, drag.startY, drag.lastX, drag.lastY, drag.value));
    } else if (drag.mode === 'select') {
      setSelRect({ x0: drag.startX, y0: drag.startY, x1: drag.lastX, y1: drag.lastY });
    }
    dragRef.current = null;
    force((n) => n + 1);
  }

  function doCopy() {
    if (!selRect) return;
    const xa = Math.min(selRect.x0, selRect.x1), xb = Math.max(selRect.x0, selRect.x1);
    const ya = Math.min(selRect.y0, selRect.y1), yb = Math.max(selRect.y0, selRect.y1);
    const cells = [];
    for (let y = ya; y <= yb; y++) {
      const row = [];
      for (let x = xa; x <= xb; x++) row.push(grid[y][x]);
      cells.push(row);
    }
    setClipboard({ w: xb - xa + 1, h: yb - ya + 1, cells });
  }
  function doPaste() {
    if (!clipboard || !selRect) return;
    const xa = Math.min(selRect.x0, selRect.x1);
    const ya = Math.min(selRect.y0, selRect.y1);
    const next = cloneGrid(grid);
    for (let dy = 0; dy < clipboard.h; dy++) {
      for (let dx = 0; dx < clipboard.w; dx++) {
        const x = xa + dx, y = ya + dy;
        if (x < COLS && y < ROWS) next[y][x] = clipboard.cells[dy][dx];
      }
    }
    commit(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1 flex-wrap">
        {TOOLS.map((t) => {
          const Icon = t.icon;
          const active = tool === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTool(t.id)}
              className={`btn !px-2 !py-1 ${active ? '!border-accent !text-accent' : ''}`}
              title={t.label}
            >
              <Icon className="w-3.5 h-3.5" />
            </button>
          );
        })}
        <div className="w-px h-5 bg-ink-700 mx-1" />
        <button type="button" onClick={doCopy} className="btn !px-2 !py-1" title="copy selection" disabled={!selRect}>
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={doPaste} className="btn !px-2 !py-1" title="paste" disabled={!clipboard || !selRect}>
          <ClipboardPaste className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-5 bg-ink-700 mx-1" />
        <button
          type="button"
          onClick={() => setShowGrid((v) => !v)}
          className={`btn !px-2 !py-1 ${showGrid ? '!border-accent !text-accent' : ''}`}
          title="grid"
        >
          <GridIcon className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setShowIds((v) => !v)}
          className={`btn !px-2 !py-1 ${showIds ? '!border-accent !text-accent' : ''}`}
          title="show tile ids"
        >
          <Hash className="w-3.5 h-3.5" />
        </button>
        {showBackground && projectId && roomId ? (
          <button
            type="button"
            onClick={() => setBgVisible((v) => !v)}
            className={`btn !px-2 !py-1 ${bgVisible ? '!border-accent !text-accent' : ''}`}
            title="toggle scene background"
          >
            <ImageIcon className="w-3.5 h-3.5" />
          </button>
        ) : null}
        <span className="text-[10px] text-ink-500 font-mono ml-2">
          {selectedTile ? `painting ${selectedTile.name}` : 'painting: erase'} · right-click=erase · shift-drag=select
        </span>
      </div>
      <div
        className="relative border border-ink-600 rounded bg-ink-900 overflow-hidden"
        style={{ width: CANVAS_W, height: CANVAS_H }}
      >
        {showBackground && bgVisible && projectId && roomId ? (
          <PulpRoomBackground
            projectId={projectId}
            roomId={roomId}
            cacheBust={sceneCacheKey}
            opacity={0.3}
          />
        ) : null}
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          style={{
            width: CANVAS_W,
            height: CANVAS_H,
            imageRendering: 'pixelated',
            position: 'relative',
            zIndex: 1,
            background: 'transparent'
          }}
          className="cursor-crosshair select-none"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={() => { paintRef.current = null; }}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    </div>
  );
}
