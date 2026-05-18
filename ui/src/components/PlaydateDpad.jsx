import { useCallback, useEffect, useRef } from 'react';

// Playdate-style 4-way d-pad. Pointer events on each quadrant fire
// onPress(dir) once, then auto-repeat onPress every `repeatMs` while held.
// onRelease(dir) fires when the pointer leaves/lifts.
//
// dir ∈ 'up' | 'down' | 'left' | 'right'
export default function PlaydateDpad({ onPress, onRelease, repeatMs = 120 }) {
  const heldRef = useRef(new Map()); // dir -> { rafId, lastTs }

  const stop = useCallback((dir) => {
    const entry = heldRef.current.get(dir);
    if (!entry) return;
    if (entry.rafId) cancelAnimationFrame(entry.rafId);
    heldRef.current.delete(dir);
    onRelease?.(dir);
  }, [onRelease]);

  const start = useCallback((dir) => {
    if (heldRef.current.has(dir)) return;
    onPress?.(dir);
    const state = { rafId: 0, lastTs: performance.now() };
    const step = (ts) => {
      if (!heldRef.current.has(dir)) return;
      if (ts - state.lastTs >= repeatMs) {
        onPress?.(dir);
        state.lastTs = ts;
      }
      state.rafId = requestAnimationFrame(step);
    };
    state.rafId = requestAnimationFrame(step);
    heldRef.current.set(dir, state);
  }, [onPress, repeatMs]);

  useEffect(() => () => {
    // Clean up any held timers on unmount.
    for (const [, entry] of heldRef.current) {
      if (entry.rafId) cancelAnimationFrame(entry.rafId);
    }
    heldRef.current.clear();
  }, []);

  function bindPointer(dir) {
    return {
      onPointerDown: (e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start(dir);
      },
      onPointerUp: (e) => {
        e.preventDefault();
        try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch {}
        stop(dir);
      },
      onPointerCancel: () => stop(dir),
      onPointerLeave: (e) => {
        if (e.buttons) stop(dir);
      },
      onContextMenu: (e) => e.preventDefault(),
    };
  }

  // Layout: 3x3 grid; arms occupy the cardinal cells, center is the pivot.
  // Each arm is a button rendered as a clipped rounded rectangle.
  return (
    <div
      className="relative select-none"
      style={{ width: 110, height: 110, touchAction: 'none' }}
      aria-label="D-pad"
      role="group"
    >
      {/* Plate */}
      <div
        className="absolute inset-0 rounded-[20%]"
        style={{
          background: 'radial-gradient(circle at 30% 25%, #2a2a2a 0%, #111 60%, #050505 100%)',
          boxShadow:
            'inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -2px 6px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.5)',
        }}
      />
      {/* Cross silhouette */}
      <svg
        viewBox="0 0 110 110"
        className="absolute inset-0 pointer-events-none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="dpadFace" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3a3a3a" />
            <stop offset="100%" stopColor="#0a0a0a" />
          </linearGradient>
        </defs>
        <path
          d="M40 8 H70 V40 H102 V70 H70 V102 H40 V70 H8 V40 H40 Z"
          fill="url(#dpadFace)"
          stroke="#000"
          strokeWidth="1.5"
        />
        {/* Subtle triangular arrow hints */}
        <g fill="#666">
          <polygon points="55,18 50,28 60,28" />
          <polygon points="92,55 82,50 82,60" />
          <polygon points="55,92 50,82 60,82" />
          <polygon points="18,55 28,50 28,60" />
        </g>
      </svg>
      {/* Hit areas (positioned over each cardinal arm) */}
      <button
        type="button"
        aria-label="D-pad up"
        className="absolute"
        style={{ left: 36, top: 4, width: 38, height: 38, background: 'transparent', border: 0, borderRadius: 8, cursor: 'pointer' }}
        {...bindPointer('up')}
      />
      <button
        type="button"
        aria-label="D-pad right"
        className="absolute"
        style={{ left: 68, top: 36, width: 38, height: 38, background: 'transparent', border: 0, borderRadius: 8, cursor: 'pointer' }}
        {...bindPointer('right')}
      />
      <button
        type="button"
        aria-label="D-pad down"
        className="absolute"
        style={{ left: 36, top: 68, width: 38, height: 38, background: 'transparent', border: 0, borderRadius: 8, cursor: 'pointer' }}
        {...bindPointer('down')}
      />
      <button
        type="button"
        aria-label="D-pad left"
        className="absolute"
        style={{ left: 4, top: 36, width: 38, height: 38, background: 'transparent', border: 0, borderRadius: 8, cursor: 'pointer' }}
        {...bindPointer('left')}
      />
    </div>
  );
}
