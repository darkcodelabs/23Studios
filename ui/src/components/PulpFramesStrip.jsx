import { useEffect, useRef } from 'react';
import { Plus, Trash2, Copy } from 'lucide-react';
import { rasterizeFrame, emptyFrame } from '../lib/pulp_api.js';

function FramePreview({ pixels, active, onClick }) {
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
 */
export default function PulpFramesStrip({ frames, currentIdx, onSelect, onChange, fps, onFpsChange }) {
  function addFrame() {
    const next = frames.slice();
    next.splice(currentIdx + 1, 0, emptyFrame());
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
  function delFrame() {
    if (frames.length <= 1) return;
    const next = frames.slice();
    next.splice(currentIdx, 1);
    onChange(next);
    onSelect(Math.max(0, currentIdx - 1));
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="flex items-center gap-1 overflow-x-auto py-1">
        {frames.map((f, i) => (
          <FramePreview key={i} pixels={f.pixels} active={i === currentIdx} onClick={() => onSelect(i)} />
        ))}
      </div>
      <div className="flex items-center gap-1 ml-auto">
        <button type="button" onClick={addFrame} className="btn !px-2 !py-1" title="add frame">
          <Plus className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={dupFrame} className="btn !px-2 !py-1" title="duplicate frame">
          <Copy className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={delFrame}
          className="btn !px-2 !py-1"
          title="delete frame"
          disabled={frames.length <= 1}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <label className="flex items-center gap-1 text-[11px] text-ink-400 font-mono ml-2">
          fps
          <input
            type="number"
            min={1}
            max={60}
            value={fps}
            onChange={(e) => onFpsChange(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
            className="input !w-16 !py-1 !px-2 text-xs"
          />
        </label>
      </div>
    </div>
  );
}
