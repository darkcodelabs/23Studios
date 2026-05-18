import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Copy, Play, Pause } from 'lucide-react';
import { rasterizeFrame, emptyFrame } from '../lib/pulp_api.js';

function FramePreview({ pixels, active, onClick, onDelete, deletable }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#0d0f15';
    ctx.fillRect(0, 0, c.width, c.height);
    const tile = rasterizeFrame(pixels, 3);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tile, 0, 0);
  }, [pixels]);
  return (
    <div className="relative group">
      <button
        type="button"
        onClick={onClick}
        className={`relative rounded border ${active ? 'border-accent' : 'border-ink-600'} bg-ink-900 p-1 hover:border-ink-400 transition`}
        style={{ lineHeight: 0 }}
      >
        <canvas
          ref={ref}
          width={48}
          height={48}
          style={{ imageRendering: 'pixelated', width: 48, height: 48 }}
        />
      </button>
      {deletable ? (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-ink-800 border border-ink-600 text-ink-400 hover:text-red-400 hover:border-red-500 flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
          title="delete frame"
          aria-label="delete frame"
        >
          <Trash2 className="w-2.5 h-2.5" />
        </button>
      ) : null}
    </div>
  );
}

/**
 * Live animation preview. Walks `frames` at `fps`, honoring `loop`. Uses a
 * requestAnimationFrame loop driven by perf.now and refs so it doesn't
 * cause React rerenders.
 */
function LivePreview({ frames, fps, loop, scale = 4 }) {
  const ref = useRef(null);
  const startRef = useRef(performance.now());
  const lastIdxRef = useRef(-1);

  useEffect(() => { startRef.current = performance.now(); lastIdxRef.current = -1; }, [frames, fps, loop]);

  useEffect(() => {
    let raf = 0;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;

    function tick() {
      raf = requestAnimationFrame(tick);
      if (!frames || frames.length === 0) return;
      const fpsN = Math.max(0, Number(fps) || 0);
      let idx = 0;
      if (frames.length > 1 && fpsN > 0) {
        const elapsed = performance.now() - startRef.current;
        const raw = Math.floor(elapsed * fpsN / 1000);
        idx = loop
          ? ((raw % frames.length) + frames.length) % frames.length
          : Math.min(frames.length - 1, Math.max(0, raw));
      }
      if (idx === lastIdxRef.current) return;
      lastIdxRef.current = idx;
      ctx.fillStyle = '#0d0f15';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const tile = rasterizeFrame(frames[idx]?.pixels || '', scale);
      ctx.drawImage(tile, 0, 0);
    }

    tick();
    return () => cancelAnimationFrame(raf);
  }, [frames, fps, loop, scale]);

  const dim = frames?.[0]?.pixels?.length === 64 ? 8 : 16;
  return (
    <canvas
      ref={ref}
      width={dim * scale}
      height={dim * scale}
      style={{ imageRendering: 'pixelated', width: dim * scale, height: dim * scale, display: 'block' }}
      className="border border-ink-600 rounded bg-ink-900"
      aria-label="live animation preview"
    />
  );
}

/**
 * Props:
 *   frames      array of { pixels }
 *   currentIdx  number
 *   onSelect    (idx) => void
 *   onChange    (newFrames) => void
 *   fps         number
 *   onFpsChange (fps) => void
 *   loop        boolean (optional, defaults to true)
 *   onLoopChange (loop) => void  (optional)
 */
export default function PulpFramesStrip({
  frames, currentIdx, onSelect, onChange,
  fps, onFpsChange,
  loop, onLoopChange,
}) {
  const [previewOn, setPreviewOn] = useState(true);
  const effLoop = loop !== false;

  function addFrame() {
    const next = frames.slice();
    next.splice(currentIdx + 1, 0, emptyFrame(frames[0]?.pixels?.length === 256 ? 16 : 8));
    onChange(next);
    onSelect(currentIdx + 1);
  }
  function dupFrame() {
    const cur = frames[currentIdx];
    const next = frames.slice();
    next.splice(currentIdx + 1, 0, { pixels: cur ? cur.pixels : emptyFrame().pixels });
    onChange(next);
    onSelect(currentIdx + 1);
  }
  function delFrameAt(idx) {
    if (frames.length <= 1) return;
    const next = frames.slice();
    next.splice(idx, 1);
    onChange(next);
    const newCur = idx === currentIdx
      ? Math.max(0, idx - 1)
      : (idx < currentIdx ? currentIdx - 1 : currentIdx);
    onSelect(Math.min(newCur, next.length - 1));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="flex items-center gap-1 overflow-x-auto py-1 flex-1 min-w-0">
          {frames.map((f, i) => (
            <FramePreview
              key={i}
              pixels={f.pixels}
              active={i === currentIdx}
              onClick={() => onSelect(i)}
              onDelete={() => delFrameAt(i)}
              deletable={frames.length > 1}
            />
          ))}
          <button
            type="button"
            onClick={addFrame}
            className="ml-1 w-12 h-12 rounded border border-dashed border-ink-600 text-ink-400 hover:text-ink-200 hover:border-ink-400 flex items-center justify-center"
            title="add frame"
            aria-label="add frame"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={dupFrame}
            className="ml-1 w-12 h-12 rounded border border-ink-700 text-ink-500 hover:text-ink-200 hover:border-ink-400 flex items-center justify-center"
            title="duplicate current frame"
            aria-label="duplicate current frame"
          >
            <Copy className="w-4 h-4" />
          </button>
        </div>

        {previewOn ? (
          <div className="flex-shrink-0 flex flex-col items-center gap-1">
            <LivePreview frames={frames} fps={fps} loop={effLoop} scale={4} />
            <button
              type="button"
              onClick={() => setPreviewOn(false)}
              className="text-[9px] text-ink-500 hover:text-ink-300 font-mono inline-flex items-center gap-1"
              title="pause preview"
            >
              <Pause className="w-3 h-3" /> pause
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPreviewOn(true)}
            className="flex-shrink-0 text-[10px] text-ink-400 hover:text-ink-200 font-mono inline-flex items-center gap-1 px-2 py-1 border border-ink-700 rounded"
          >
            <Play className="w-3 h-3" /> preview
          </button>
        )}
      </div>

      <div className="flex items-center gap-3 flex-wrap text-[11px] text-ink-400 font-mono">
        <label className="flex items-center gap-2">
          <span>fps</span>
          <input
            type="range"
            min={1}
            max={30}
            value={Math.max(1, Math.min(30, Number(fps) || 6))}
            onChange={(e) => onFpsChange(Number(e.target.value))}
            className="w-32"
            aria-label="frames per second"
          />
          <input
            type="number"
            min={1}
            max={30}
            value={Math.max(1, Math.min(30, Number(fps) || 6))}
            onChange={(e) => onFpsChange(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
            className="input !w-14 !py-1 !px-2 text-xs"
          />
        </label>
        {onLoopChange ? (
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={effLoop}
              onChange={(e) => onLoopChange(e.target.checked)}
            />
            loop
          </label>
        ) : null}
        <span className="ml-auto text-ink-600">
          {frames.length} frame{frames.length === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}
