// Handheld — generic 1-bit handheld bezel ported from
// design_handoff_23_studios/device.jsx. NOT branded. Used as the
// "Playdate-shaped" stage frame in Workspace + Editor previews.
//
// The chassis paint, controls, and screen border are all rendered with
// inline styles so the component is self-contained — no extra global CSS
// required.  The CSS variables it consumes (--accent, --font-mono, etc.)
// are defined in styles/tokens.css.
//
// Usage:
//   <Handheld scale={1.4}><img src={assetUrl} ... /></Handheld>
//
// Inner screen is 320×200 (50px short of true 400×240 — the design uses
// 320×200 because the cream 1-bit composition + 6px bezel renders the
// recognisable shape at lower DPI). Children are clipped + image-rendered
// pixelated.

const CHASSIS = 'oklch(88% 0.006 75)';
const CHASSIS_BORDER = 'oklch(70% 0.008 75)';
const INK = 'oklch(15% 0.01 75)';
const INK_TEXT = 'oklch(20% 0.01 75)';
const CHASSIS_LABEL = 'oklch(40% 0.01 75)';
const SCREEN_BG = 'oklch(85% 0.03 80)'; // cream 1-bit
const CONTROL_INK = 'oklch(28% 0.01 75)';
const CONTROL_INK_BORDER = 'oklch(50% 0.008 75)';
const ABX_LABEL = 'oklch(86% 0.008 75)';
const CRANK_BODY = 'oklch(76% 0.008 75)';
const CRANK_BORDER = 'oklch(60% 0.008 75)';

const STATUS_LIGHT_GLOW = '0 0 6px var(--accent)';

const SCREEN_TINT = {
  phosphor: 'oklch(80% 0.22 145)',
  crt:      'oklch(75% 0.22 45)'
};

// --- StatusPip ----------------------------------------------------------
// Small 6px round indicator used in asset rows. Status keys mirror the
// gallery state machine.
const PIP_BG = {
  approved:        'var(--ok)',
  awaiting_review: 'var(--accent)',
  pending:         'oklch(70% 0.10 95)',
  rejected:        'var(--danger)',
  regenerating:    'oklch(70% 0.13 245)'
};

export function StatusPip({ status, size = 6 }) {
  const bg = PIP_BG[status] || 'var(--text-dim)';
  const glow = status === 'regenerating'
    ? '0 0 4px oklch(70% 0.13 245 / .8)'
    : 'none';
  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: bg,
        boxShadow: glow,
        display: 'inline-block',
        flex: 'none'
      }}
    />
  );
}

// --- Handheld -----------------------------------------------------------
export default function Handheld({ children, scale = 1, screenClass = '', name = '23S · GLV-001' }) {
  const screenBg = SCREEN_TINT[screenClass] || SCREEN_BG;
  return (
    <div
      className="dev"
      style={{
        position: 'relative',
        display: 'inline-block',
        transform: `scale(${scale})`,
        transformOrigin: 'center'
      }}
    >
      <div
        style={{
          background: CHASSIS,
          borderRadius: 14,
          padding: '22px 24px 32px',
          position: 'relative',
          border: `1px solid ${CHASSIS_BORDER}`,
          color: INK_TEXT
        }}
      >
        {/* Status light */}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 12,
            left: 16,
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: 'var(--accent)',
            boxShadow: STATUS_LIGHT_GLOW
          }}
        />
        {/* Chassis label */}
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 16,
            fontFamily: 'var(--font-mono)',
            fontSize: 8,
            letterSpacing: '.12em',
            textTransform: 'uppercase',
            color: CHASSIS_LABEL
          }}
        >
          {name}
        </div>

        {/* Screen */}
        <div
          style={{
            background: screenBg,
            borderRadius: 3,
            width: 320,
            height: 200,
            padding: 0,
            overflow: 'hidden',
            border: `6px solid ${INK}`,
            imageRendering: 'pixelated',
            position: 'relative'
          }}
        >
          {children}
        </div>

        {/* Controls row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 22
          }}
        >
          {/* d-pad */}
          <div style={{ position: 'relative', width: 56, height: 56 }}>
            <span style={{
              position: 'absolute',
              left: 0, right: 0, top: 19, height: 18,
              background: CONTROL_INK,
              borderRadius: 2
            }} />
            <span style={{
              position: 'absolute',
              top: 0, bottom: 0, left: 19, width: 18,
              background: CONTROL_INK,
              borderRadius: 2
            }} />
          </div>
          {/* A / B */}
          <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
            {['B', 'A'].map((k) => (
              <div
                key={k}
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: CONTROL_INK,
                  border: `1px solid ${CONTROL_INK_BORDER}`,
                  position: 'relative',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: ABX_LABEL,
                  display: 'grid',
                  placeItems: 'center',
                  textTransform: 'uppercase',
                  fontWeight: 600
                }}
              >
                {k}
              </div>
            ))}
          </div>
        </div>

        {/* Crank */}
        <div
          style={{
            position: 'absolute',
            right: -6,
            top: 60,
            width: 14,
            height: 56,
            background: CRANK_BODY,
            borderRadius: 2,
            border: `1px solid ${CRANK_BORDER}`
          }}
        >
          <span
            aria-hidden
            style={{
              content: '""',
              position: 'absolute',
              right: -10,
              top: 4,
              width: 18,
              height: 6,
              background: 'oklch(40% 0.01 75)',
              borderRadius: 2,
              display: 'block'
            }}
          />
        </div>
      </div>
    </div>
  );
}
