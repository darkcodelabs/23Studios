import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  Pencil, Eraser, PaintBucket, Minus, Square as SquareIcon,
  FlipHorizontal, FlipVertical, RotateCw, Layers
} from 'lucide-react';
import { pixelsToArray, arrayToPixels, dimForPixels } from '../lib/pulp_api.js';

// Editor canvas is a fixed ~384px square so the toolbar layout doesn't shift
// when a project switches between 8x8 and 16x16 tiles. Scale per pixel is
// chosen so SIZE * SCALE == CANVAS_PX regardless of dim.
const CANVAS_PX = 384;

const TOOLS = [
  { id: 'pencil', label: 'pencil', icon: Pencil },
  { id: 'eraser', label: 'eraser', icon: Eraser },
  { id: 'bucket', label: 'fill', icon: PaintBucket },
  { id: 'line', label: 'line', icon: Minus },
  { id: 'rect', label: 'rect', icon: SquareIcon }
];

// --- pure helpers parameterized on SIZE (8 or 16) ---

function clone(arr) { return new Uint8Array(arr); }

function bucketFill(arr, x, y, target, value, SIZE) {
  if (target === value) return arr;
  const out = clone(arr);
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= SIZE || cy >= SIZE) continue;
    const idx = cy * SIZE + cx;
    if (out[idx] !== target) continue;
    out[idx] = value;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  return out;
}

function drawLine(arr, x0, y0, x1, y1, value, SIZE) {
  const out = clone(arr);
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  while (true) {
    if (x >= 0 && y >= 0 && x < SIZE && y < SIZE) out[y * SIZE + x] = value;
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return out;
}

function drawRect(arr, x0, y0, x1, y1, value, SIZE) {
  let out = clone(arr);
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
  const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
  for (let x = xa; x <= xb; x++) {
    if (ya >= 0 && ya < SIZE && x >= 0 && x < SIZE) out[ya * SIZE + x] = value;
    if (yb >= 0 && yb < SIZE && x >= 0 && x < SIZE) out[yb * SIZE + x] = value;
  }
  for (let y = ya; y <= yb; y++) {
    if (xa >= 0 && xa < SIZE && y >= 0 && y < SIZE) out[y * SIZE + xa] = value;
    if (xb >= 0 && xb < SIZE && y >= 0 && y < SIZE) out[y * SIZE + xb] = value;
  }
  return out;
}

function flipH(arr, SIZE) {
  const out = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) out[y * SIZE + (SIZE - 1 - x)] = arr[y * SIZE + x];
  }
  return out;
}
function flipV(arr, SIZE) {
  const out = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) out[(SIZE - 1 - y) * SIZE + x] = arr[y * SIZE + x];
  }
  return out;
}
function rotate90(arr, SIZE) {
  // clockwise
  const out = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) out[x * SIZE + (SIZE - 1 - y)] = arr[y * SIZE + x];
  }
  return out;
}

/**
 * Props:
 *   pixels       string of 64 (8x8) or 256 (16x16) "0"/"1" chars
 *   onChange     (newPixels) => void
 *   previousPixels?  optional onion-skin frame (same dim as `pixels`)
 *   tileDim?     8 | 16 — explicit override; otherwise inferred from pixels
 */
export default function PulpTileCanvas({ pixels, onChange, previousPixels, tileDim }) {
  const canvasRef = useRef(null);
  const [tool, setTool] = useState('pencil');
  const [onion, setOnion] = useState(false);

  // Tile dim source of truth: explicit prop wins, otherwise infer from the
  // pixel string. Default 8 (new pulp canonical).
  const SIZE = useMemo(() => {
    if (tileDim === 8 || tileDim === 16) return tileDim;
    return dimForPixels(pixels);
  }, [tileDim, pixels]);
  const SCALE = CANVAS_PX / SIZE; // 8 -> 48px/px, 16 -> 24px/px

  // committed arr drives the persistent pixel state
  const arr = pixelsToArray(pixels, SIZE);

  // preview state for line/rect drag
  const dragRef = useRef(null); // { startX, startY, value, lastX, lastY, snapshot }
  const [, force] = useState(0); // re-render trigger for preview overlay

  const repaint = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    // bg
    ctx.fillStyle = '#0d0f15';
    ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX);

    // onion skin layer
    if (onion && previousPixels) {
      const prev = pixelsToArray(previousPixels, SIZE);
      ctx.globalAlpha = 0.2;
      ctx.fillStyle = '#9dffce';
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          if (prev[y * SIZE + x]) ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
        }
      }
      ctx.globalAlpha = 1;
    }

    // committed pixels (with optional drag preview overlay)
    let displayArr = arr;
    const drag = dragRef.current;
    if (drag && (tool === 'line' || tool === 'rect')) {
      if (tool === 'line') {
        displayArr = drawLine(drag.snapshot, drag.startX, drag.startY, drag.lastX, drag.lastY, drag.value, SIZE);
      } else {
        displayArr = drawRect(drag.snapshot, drag.startX, drag.startY, drag.lastX, drag.lastY, drag.value, SIZE);
      }
    }
    ctx.fillStyle = '#9dffce';
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (displayArr[y * SIZE + x]) ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
      }
    }

    // grid
    ctx.strokeStyle = 'rgba(122,128,147,0.18)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= SIZE; i++) {
      const p = i * SCALE + 0.5;
      ctx.beginPath();
      ctx.moveTo(p, 0); ctx.lineTo(p, CANVAS_PX); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p); ctx.lineTo(CANVAS_PX, p); ctx.stroke();
    }
    // chunkier guide every quarter (4 on 8x8, 8 on 16x16)
    const guideStep = Math.max(1, SIZE / 2);
    ctx.strokeStyle = 'rgba(157,255,206,0.18)';
    for (let i = 0; i <= SIZE; i += guideStep) {
      const p = i * SCALE + 0.5;
      ctx.beginPath();
      ctx.moveTo(p, 0); ctx.lineTo(p, CANVAS_PX); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p); ctx.lineTo(CANVAS_PX, p); ctx.stroke();
    }
  }, [arr, onion, previousPixels, tool, SIZE, SCALE]);

  useEffect(() => { repaint(); }, [repaint]);

  function eventToCell(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / (rect.width / SIZE));
    const y = Math.floor((e.clientY - rect.top) / (rect.height / SIZE));
    return { x: Math.max(0, Math.min(SIZE - 1, x)), y: Math.max(0, Math.min(SIZE - 1, y)) };
  }

  function commit(newArr) {
    onChange(arrayToPixels(newArr, SIZE));
  }

  function onMouseDown(e) {
    e.preventDefault();
    const { x, y } = eventToCell(e);
    const rightClick = e.button === 2;
    const value = (tool === 'eraser' || rightClick) ? 0 : 1;

    if (tool === 'bucket') {
      const target = arr[y * SIZE + x];
      commit(bucketFill(arr, x, y, target, value, SIZE));
      return;
    }
    if (tool === 'line' || tool === 'rect') {
      dragRef.current = { startX: x, startY: y, lastX: x, lastY: y, value, snapshot: clone(arr) };
      force((n) => n + 1);
      return;
    }
    // pencil / eraser (or right-click)
    const next = clone(arr);
    next[y * SIZE + x] = value;
    dragRef.current = { paint: true, value, lastIdx: y * SIZE + x };
    commit(next);
  }

  function onMouseMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const { x, y } = eventToCell(e);
    if (tool === 'line' || tool === 'rect') {
      if (drag.lastX === x && drag.lastY === y) return;
      drag.lastX = x; drag.lastY = y;
      force((n) => n + 1);
      return;
    }
    if (drag.paint) {
      const idx = y * SIZE + x;
      if (idx === drag.lastIdx) return;
      drag.lastIdx = idx;
      const next = clone(arr);
      next[idx] = drag.value;
      commit(next);
    }
  }

  function onMouseUp(e) {
    const drag = dragRef.current;
    if (!drag) return;
    if (tool === 'line') {
      commit(drawLine(drag.snapshot, drag.startX, drag.startY, drag.lastX, drag.lastY, drag.value, SIZE));
    } else if (tool === 'rect') {
      commit(drawRect(drag.snapshot, drag.startX, drag.startY, drag.lastX, drag.lastY, drag.value, SIZE));
    }
    dragRef.current = null;
    force((n) => n + 1);
  }

  function onMouseLeave() {
    if (dragRef.current && (tool === 'line' || tool === 'rect')) {
      // cancel preview
      dragRef.current = null;
      force((n) => n + 1);
    } else {
      dragRef.current = null;
    }
  }

  function transform(fn) {
    commit(fn(arr, SIZE));
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
        <button type="button" onClick={() => transform(flipH)} className="btn !px-2 !py-1" title="flip horizontal">
          <FlipHorizontal className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={() => transform(flipV)} className="btn !px-2 !py-1" title="flip vertical">
          <FlipVertical className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={() => transform(rotate90)} className="btn !px-2 !py-1" title="rotate 90">
          <RotateCw className="w-3.5 h-3.5" />
        </button>
        <div className="w-px h-5 bg-ink-700 mx-1" />
        <button
          type="button"
          onClick={() => setOnion((v) => !v)}
          className={`btn !px-2 !py-1 ${onion ? '!border-accent !text-accent' : ''}`}
          title="onion skin"
          disabled={!previousPixels}
        >
          <Layers className="w-3.5 h-3.5" />
        </button>
        <span className="text-[10px] text-ink-500 font-mono ml-2">right-click = erase</span>
      </div>
      <canvas
        ref={canvasRef}
        width={CANVAS_PX}
        height={CANVAS_PX}
        style={{ width: CANVAS_PX, height: CANVAS_PX, imageRendering: 'pixelated' }}
        className="border border-ink-600 rounded bg-ink-900 cursor-crosshair select-none"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseLeave}
        onContextMenu={(e) => e.preventDefault()}
      />
    </div>
  );
}
