import { forwardRef } from 'react';
import PlaydateDpad from './PlaydateDpad.jsx';
import PlaydateAB from './PlaydateAB.jsx';
import PlaydateCrank from './PlaydateCrank.jsx';

// Playdate front-view chassis. Renders the yellow body, screen well, brand
// marks, speaker grille, and slots for the canvas + interactive controls.
//
// Props:
//   canvasRef        — ref forwarded onto the inner <canvas>
//   canvasW, canvasH — native canvas pixel dims
//   onDpadPress / onDpadRelease(dir)
//   onABPress / onABRelease('a'|'b')
//   onCrankRotate(deltaDeg, totalDeg)
//   onCrankDock(docked: bool)
//
// The chassis itself is a flex layout with an aspect ratio matching the
// real device (~3:2 landscape). All controls remain ≥44px touch targets.
const PlaydateChassis = forwardRef(function PlaydateChassis(props, ref) {
  const {
    canvasW = 400,
    canvasH = 240,
    onDpadPress,
    onDpadRelease,
    onABPress,
    onABRelease,
    onCrankRotate,
    onCrankDock,
    children,
  } = props;

  return (
    <div
      className="relative mx-auto w-full"
      style={{ maxWidth: 720, aspectRatio: '3 / 2' }}
    >
      {/* Crank cluster sits OUTSIDE the chassis so the handle can stick out
          past the right edge naturally. Absolutely positioned. */}
      <div
        style={{
          position: 'absolute',
          right: -70,
          top: '38%',
          zIndex: 5,
        }}
      >
        <PlaydateCrank onRotate={onCrankRotate} onDock={onCrankDock} />
      </div>

      {/* Chassis body */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 100% at 30% 20%, #ffe85a 0%, #ffd400 35%, #f0c200 75%, #cfa800 100%)',
          border: '2px solid #1a1a1a',
          borderRadius: 28,
          boxShadow:
            '0 12px 28px rgba(0,0,0,0.45), inset 0 2px 0 rgba(255,255,255,0.35), inset 0 -3px 0 rgba(0,0,0,0.12)',
          overflow: 'hidden',
        }}
      >
        {/* Subtle plastic texture sheen */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 35%, rgba(0,0,0,0.06) 100%)',
            pointerEvents: 'none',
          }}
        />

        {/* Top brand: "Playdate" wordmark */}
        <div
          style={{
            position: 'absolute',
            top: '4.5%',
            left: '50%',
            transform: 'translateX(-50%)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontWeight: 700,
            fontSize: 'clamp(11px, 1.8vw, 16px)',
            letterSpacing: '0.18em',
            color: '#1a1a1a',
            textTransform: 'lowercase',
          }}
        >
          playdate
        </div>

        {/* Screen well */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: '11%',
            transform: 'translateX(-50%)',
            width: '74%',
            aspectRatio: `${canvasW} / ${canvasH}`,
            background: '#000',
            border: '3px solid #0a0a0a',
            borderRadius: 10,
            padding: 8,
            boxShadow:
              'inset 0 3px 8px rgba(0,0,0,0.85), inset 0 -1px 2px rgba(255,255,255,0.05), 0 1px 0 rgba(255,255,255,0.25)',
          }}
        >
          {/* The canvas itself. Native 400x240, scaled to fit via width:100%.
              image-rendering: pixelated keeps the chunky pixels crisp at any
              upscale factor the chassis lands on. */}
          <canvas
            ref={ref}
            width={canvasW}
            height={canvasH}
            tabIndex={0}
            aria-label="Playdate screen"
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
              imageRendering: 'pixelated',
              background: '#9bb35c', // reflective greenish LCD tint behind any unpainted areas
              outline: 'none',
            }}
          />
        </div>

        {/* "Panic" subtle mark below screen */}
        <div
          style={{
            position: 'absolute',
            top: '60%',
            left: '50%',
            transform: 'translateX(-50%)',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 9,
            letterSpacing: '0.25em',
            color: 'rgba(26,26,26,0.55)',
            textTransform: 'uppercase',
          }}
        >
          panic
        </div>

        {/* D-pad cluster — LEFT side */}
        <div
          style={{
            position: 'absolute',
            left: '6%',
            top: '60%',
          }}
        >
          <PlaydateDpad onPress={onDpadPress} onRelease={onDpadRelease} />
        </div>

        {/* A / B cluster — RIGHT side */}
        <div
          style={{
            position: 'absolute',
            right: '6%',
            top: '60%',
          }}
        >
          <PlaydateAB onPress={onABPress} onRelease={onABRelease} />
        </div>

        {/* Speaker grille — bottom center */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: '50%',
            bottom: '4%',
            transform: 'translateX(-50%)',
            display: 'flex',
            gap: 5,
          }}
        >
          {Array.from({ length: 9 }).map((_, i) => (
            <span
              key={i}
              style={{
                display: 'block',
                width: 4,
                height: 4,
                borderRadius: '50%',
                background: 'rgba(0,0,0,0.55)',
                boxShadow: 'inset 0 1px 1px rgba(0,0,0,0.6)',
              }}
            />
          ))}
        </div>

        {/* Slot for chassis-level overlay children (e.g. console drawer toggle) */}
        {children}
      </div>
    </div>
  );
});

export default PlaydateChassis;
