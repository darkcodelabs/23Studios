import { useCallback, useEffect, useRef, useState } from 'react';

// Folding crank attached to the right edge of the Playdate.
// - Drag the handle to rotate. Emits onRotate(deltaDeg, totalDeg).
// - Mouse wheel over the crank rotates by 5° per tick.
// - "Deploy" toggle button folds/unfolds. Folded = pointing down (180°
//   from horizontal); deployed = sticking out horizontally (0°).
// - Visible handle rotates with totalDegrees + deploy state.

const WHEEL_STEP_DEG = 5;

export default function PlaydateCrank({ onRotate, onDock, initialDocked = true }) {
  const [docked, setDocked] = useState(initialDocked);
  const [angle, setAngle] = useState(0); // degrees of cumulative rotation
  const totalRef = useRef(0); // cumulative degrees (can exceed ±360)
  const dragRef = useRef(null); // { lastAngle, cx, cy }
  const hostRef = useRef(null);
  const reducedMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const setDockedSafe = useCallback((next) => {
    setDocked(next);
    onDock?.(next);
  }, [onDock]);

  const applyDelta = useCallback((deltaDeg) => {
    if (!Number.isFinite(deltaDeg) || deltaDeg === 0) return;
    totalRef.current += deltaDeg;
    setAngle(totalRef.current);
    onRotate?.(deltaDeg, totalRef.current);
  }, [onRotate]);

  function pointFromEvent(e) {
    const host = hostRef.current;
    if (!host) return null;
    const r = host.getBoundingClientRect();
    // Pivot is the left-center of the crank host (where the handle attaches
    // to the chassis edge).
    const cx = r.left + 10;
    const cy = r.top + r.height / 2;
    const a = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
    return { angle: a, cx, cy };
  }

  function onHandlePointerDown(e) {
    if (docked) return; // can't drag while docked
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const p = pointFromEvent(e);
    if (!p) return;
    dragRef.current = { lastAngle: p.angle };
  }

  function onHandlePointerMove(e) {
    if (!dragRef.current) return;
    const p = pointFromEvent(e);
    if (!p) return;
    let d = p.angle - dragRef.current.lastAngle;
    // unwrap so a rollover from +179 to -179 doesn't register as -358
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    dragRef.current.lastAngle = p.angle;
    applyDelta(d);
  }

  function onHandlePointerUp(e) {
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch {}
    dragRef.current = null;
  }

  function onWheel(e) {
    if (docked) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    applyDelta(dir * WHEEL_STEP_DEG);
  }

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return undefined;
    // Attach wheel listener as non-passive so we can preventDefault.
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docked]);

  // When docked, handle points DOWN (90°). When deployed, points along the
  // user's current rotation angle (0° == straight right == perpendicular to
  // chassis). We layer the rotation transforms accordingly.
  const handleRotation = docked ? 90 : angle;
  const transitionMs = reducedMotion ? 0 : 220;

  return (
    <div
      ref={hostRef}
      className="select-none"
      style={{
        position: 'relative',
        width: 110,
        height: 110,
        touchAction: 'none',
      }}
      aria-label="Crank"
    >
      {/* Anchor: black puck where the crank attaches */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: '50%',
          width: 22,
          height: 22,
          marginTop: -11,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, #2c2c2c, #050505)',
          border: '1px solid #000',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.18), 0 1px 2px rgba(0,0,0,0.6)',
        }}
      />
      {/* Handle: a thin black arm with a knob on the end. Rotates around the
          left-center pivot. */}
      <div
        style={{
          position: 'absolute',
          left: 10,
          top: '50%',
          width: 70,
          height: 12,
          marginTop: -6,
          transformOrigin: '0% 50%',
          transform: `rotate(${handleRotation}deg)`,
          transition: `transform ${transitionMs}ms ease-out`,
          pointerEvents: 'none',
        }}
        aria-hidden="true"
      >
        {/* arm */}
        <div
          style={{
            position: 'absolute',
            left: 4,
            top: 3,
            width: 52,
            height: 6,
            background: 'linear-gradient(180deg, #2a2a2a, #050505)',
            borderRadius: 3,
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15)',
          }}
        />
        {/* knob */}
        <div
          style={{
            position: 'absolute',
            right: -4,
            top: -4,
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'radial-gradient(circle at 30% 30%, #3a3a3a, #050505)',
            border: '1px solid #000',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.2)',
          }}
        />
      </div>
      {/* Hit area on the handle for dragging */}
      {!docked && (
        <button
          type="button"
          aria-label="Rotate crank"
          onPointerDown={onHandlePointerDown}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            position: 'absolute',
            left: 10,
            top: '50%',
            width: 80,
            height: 30,
            marginTop: -15,
            transformOrigin: '0% 50%',
            transform: `rotate(${handleRotation}deg)`,
            transition: `transform ${transitionMs}ms ease-out`,
            background: 'transparent',
            border: 0,
            cursor: 'grab',
          }}
        />
      )}
      {/* Deploy/dock toggle */}
      <button
        type="button"
        aria-label={docked ? 'Deploy crank' : 'Dock crank'}
        onClick={() => setDockedSafe(!docked)}
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          padding: '2px 6px',
          fontSize: 9,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          color: '#1a1a1a',
          background: '#ffd400',
          border: '1px solid #1a1a1a',
          borderRadius: 4,
          cursor: 'pointer',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {docked ? 'deploy' : 'dock'}
      </button>
    </div>
  );
}
