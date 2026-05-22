// Handheld — Playdate-shaped device illustration used as the stage frame
// across Workspace, Editor previews, Building (live preview), and
// ShipStatus (title scene).
//
// Implementation: inline SVG body (rounded yellow plastic chassis,
// black bezel, d-pad, A+B, crank, menu+lock buttons) with the actual
// 400×240 screen rendered as an absolutely-positioned <div> overlay so
// child content (img / canvas / text) stays in normal DOM and can be
// styled / sized / event-bound like any other element.
//
// API (unchanged from previous chassis):
//   <Handheld
//     scale={1.0}        // CSS transform scale, default 1
//     screenClass=""     // 'phosphor' | 'crt' | '' — tints screen bg
//     status="..."       // status key → indicator LED color (optional)
//     name="23S · GLV-001" // small mono label (kept for parity)
//   >
//     {children}        // render INSIDE the 400×240 screen area
//   </Handheld>
//
// Also exports:
//   StatusPip — 6px round indicator (unchanged API)
//   HandheldMini — compact preview chip (screen + yellow hint, no buttons)

// ---------- Palette ------------------------------------------------------
// Warm "Playdate yellow" per design handoff (line 484). Slightly desaturated
// from pure #f0ce30 so it sits next to our neutral chassis tokens without
// glaring.
const PLAYDATE_YELLOW         = '#f0ce30';
const PLAYDATE_YELLOW_HILITE  = '#fbe26a';   // top-edge specular
const PLAYDATE_YELLOW_SHADE   = '#c79f1f';   // bottom shadow / rim
const PLAYDATE_BEZEL          = '#1a1a1a';   // screen surround
const PLAYDATE_BEZEL_INNER    = '#0e0e0e';   // inner screen well
const CONTROL_DARK            = '#2c2c2c';   // d-pad + A/B body
const CONTROL_DARK_BORDER     = '#101010';
const CONTROL_LABEL           = '#e8e8e8';
const CRANK_BODY              = '#3a3a3a';
const CRANK_KNOB              = '#1e1e1e';
const MENU_BTN                = '#cf8b1e';   // amber menu button
const LOCK_BTN                = '#222';      // black lock slider

const SCREEN_BG_DEFAULT = 'oklch(85% 0.03 80)'; // cream 1-bit
const SCREEN_TINT = {
  phosphor: 'oklch(80% 0.22 145)',
  crt:      'oklch(75% 0.22 45)'
};

// Status LED color map. Falls back to brand accent. Used both for the
// in-chassis LED and (via StatusPip) for the asset row indicator.
const STATUS_LIGHT_COLOR = {
  approved:        'var(--ok)',
  awaiting_review: 'var(--accent)',
  pending:         'oklch(70% 0.10 95)',
  rejected:        'var(--danger)',
  regenerating:    'oklch(70% 0.13 245)',
  building:        'oklch(70% 0.13 245)',
  ok:              'var(--ok)'
};

// ---------- StatusPip ----------------------------------------------------
// Small 6px round indicator used in asset rows. Status keys mirror the
// gallery state machine. API unchanged.
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

// ---------- Geometry -----------------------------------------------------
// Whole device drawn inside a single viewBox. The 400×240 screen is the
// canonical anchor — everything else is sized relative to it. Numbers
// chosen so 1 svg unit ~= 1 logical px at scale=1; the inner screen ends
// up exactly 400×240 logical px, matching Playdate hardware.
//
// Layout (viewBox 540 × 540):
//   chassis:       8..532, 8..532  (524 × 524)
//   screen well:   70..470, 78..318 (400 × 240) — perfectly centered
//                  on X, sits in upper-half on Y
//   d-pad center:  (135, 410)
//   A/B center:    A=(420, 410) B=(360, 432)  (A above-right of B)
//   menu button:   (490, 50)   small amber circle, top-right
//   lock slider:   (60, 32) → (130, 38) along top edge
//   crank:         right edge, vertical knob with arm sticking out
//   wordmark:      "PLAYDATE" tiny under screen
const VB_W = 540;
const VB_H = 540;

const SCREEN_X = 70;
const SCREEN_Y = 78;
const SCREEN_W = 400;
const SCREEN_H = 240;

// ---------- Handheld -----------------------------------------------------
export default function Handheld({
  children,
  scale = 1,
  screenClass = '',
  status,
  name = '23S · GLV-001'
}) {
  const screenBg = SCREEN_TINT[screenClass] || SCREEN_BG_DEFAULT;
  const ledColor = STATUS_LIGHT_COLOR[status] || 'var(--accent)';

  // Width of the rendered card in CSS pixels at scale=1. Picking 360 so
  // the whole device renders ~360×360 — comparable to the previous CSS
  // chassis footprint (~370×280 incl. crank) without surprising callers.
  const CARD_PX = 360;

  // Inner screen as a fraction of the card so the absolute overlay lines
  // up with the SVG <rect> below. Convert SVG-unit coords → percentages.
  const screenLeftPct   = (SCREEN_X / VB_W) * 100;
  const screenTopPct    = (SCREEN_Y / VB_H) * 100;
  const screenWidthPct  = (SCREEN_W / VB_W) * 100;
  const screenHeightPct = (SCREEN_H / VB_H) * 100;

  return (
    <div
      className="dev"
      style={{
        position: 'relative',
        display: 'inline-block',
        width: CARD_PX,
        height: CARD_PX,
        transform: `scale(${scale})`,
        transformOrigin: 'center',
        // tiny mono label sits above the chassis like a part number
        color: 'oklch(40% 0.01 75)'
      }}
      aria-label={name}
    >
      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        height="100%"
        role="img"
        aria-hidden="true"
        style={{ display: 'block' }}
      >
        <defs>
          {/* Soft top→bottom gradient on the yellow chassis: highlight at
              the top edge, body color through the middle, slight shade at
              the bottom. Avoids a flat plastic look. */}
          <linearGradient id="hh-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor={PLAYDATE_YELLOW_HILITE} />
            <stop offset="14%"  stopColor={PLAYDATE_YELLOW} />
            <stop offset="86%"  stopColor={PLAYDATE_YELLOW} />
            <stop offset="100%" stopColor={PLAYDATE_YELLOW_SHADE} />
          </linearGradient>

          {/* Subtle inner-screen vignette for the 1-bit display well. */}
          <radialGradient id="hh-screen-well" cx="0.5" cy="0.5" r="0.7">
            <stop offset="0%"  stopColor={PLAYDATE_BEZEL_INNER} />
            <stop offset="100%" stopColor="#000" />
          </radialGradient>
        </defs>

        {/* Body — rounded square slab. */}
        <rect
          x="8" y="8" width="524" height="524"
          rx="34" ry="34"
          fill="url(#hh-body)"
          stroke={PLAYDATE_YELLOW_SHADE}
          strokeWidth="2"
        />

        {/* Inner panel inset — a hair-thin line that suggests the
            seam where the front shell meets the back shell. */}
        <rect
          x="14" y="14" width="512" height="512"
          rx="30" ry="30"
          fill="none"
          stroke="#d8b520"
          strokeOpacity="0.45"
          strokeWidth="1"
        />

        {/* Screen bezel (raised black surround). */}
        <rect
          x={SCREEN_X - 18}
          y={SCREEN_Y - 18}
          width={SCREEN_W + 36}
          height={SCREEN_H + 36}
          rx="10" ry="10"
          fill={PLAYDATE_BEZEL}
        />

        {/* Screen well (the actual display recess). The <div> overlay
            renders on top of this so the children draw the picture. */}
        <rect
          x={SCREEN_X}
          y={SCREEN_Y}
          width={SCREEN_W}
          height={SCREEN_H}
          fill="url(#hh-screen-well)"
        />

        {/* Tiny PLAYDATE wordmark below the screen. Kept low contrast
            so it reads at small sizes without shouting at larger ones. */}
        <text
          x={VB_W / 2}
          y={SCREEN_Y + SCREEN_H + 34}
          textAnchor="middle"
          fontFamily="ui-monospace, SFMono-Regular, monospace"
          fontSize="11"
          letterSpacing="2.4"
          fontWeight="700"
          fill="#7a5a10"
          opacity="0.7"
        >
          PLAYDATE
        </text>

        {/* ---------- Top-edge controls ---------- */}
        {/* Lock slider (top-left). Two soft pills on a recessed track. */}
        <rect x="60"  y="32" width="74" height="10" rx="5" fill="#b69623" opacity="0.55" />
        <rect x="68"  y="30" width="26" height="14" rx="4" fill={LOCK_BTN} />

        {/* Menu button (top-right). Small amber circle. */}
        <circle cx="490" cy="40" r="9" fill={MENU_BTN} stroke="#7a5208" strokeWidth="1" />
        <circle cx="487" cy="37" r="2" fill="#fff" opacity="0.35" />

        {/* ---------- D-pad (lower-left) ---------- */}
        {/* Drawn as two overlapping rounded rects forming a +. */}
        <g transform="translate(135 412)">
          <rect x="-44" y="-14" width="88" height="28" rx="6" fill={CONTROL_DARK}
                stroke={CONTROL_DARK_BORDER} strokeWidth="1" />
          <rect x="-14" y="-44" width="28" height="88" rx="6" fill={CONTROL_DARK}
                stroke={CONTROL_DARK_BORDER} strokeWidth="1" />
          {/* Center hub — slight raise. */}
          <rect x="-12" y="-12" width="24" height="24" rx="3"
                fill="#3a3a3a" stroke={CONTROL_DARK_BORDER} strokeWidth="1" />
          {/* Direction nubs — tiny tick on each arm. */}
          <line x1="-32" y1="0"  x2="-28" y2="0"  stroke="#5a5a5a" strokeWidth="2" strokeLinecap="round" />
          <line x1="28"  y1="0"  x2="32"  y2="0"  stroke="#5a5a5a" strokeWidth="2" strokeLinecap="round" />
          <line x1="0"   y1="-32" x2="0"  y2="-28" stroke="#5a5a5a" strokeWidth="2" strokeLinecap="round" />
          <line x1="0"   y1="28"  x2="0"  y2="32"  stroke="#5a5a5a" strokeWidth="2" strokeLinecap="round" />
        </g>

        {/* ---------- A / B (lower-right, A higher than B) ---------- */}
        {/* B is the lower-left of the pair, A is the upper-right. */}
        <g>
          {/* B */}
          <circle cx="365" cy="436" r="22" fill={CONTROL_DARK}
                  stroke={CONTROL_DARK_BORDER} strokeWidth="1.5" />
          <text x="365" y="441" textAnchor="middle"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                fontSize="14" fontWeight="700" fill={CONTROL_LABEL}>B</text>
          {/* A */}
          <circle cx="430" cy="402" r="22" fill={CONTROL_DARK}
                  stroke={CONTROL_DARK_BORDER} strokeWidth="1.5" />
          <text x="430" y="407" textAnchor="middle"
                fontFamily="ui-monospace, SFMono-Regular, monospace"
                fontSize="14" fontWeight="700" fill={CONTROL_LABEL}>A</text>
        </g>

        {/* ---------- Crank (right edge) ---------- */}
        {/* Vertical knob anchored to the right edge with a small arm
            and end-cap protruding past the chassis silhouette. */}
        <g>
          {/* Pivot collar on the body */}
          <circle cx="520" cy="270" r="14" fill="#d6b020" stroke={PLAYDATE_YELLOW_SHADE} strokeWidth="1" />
          {/* Crank arm */}
          <rect x="514" y="208" width="12" height="68" rx="3"
                fill={CRANK_BODY} stroke={CRANK_KNOB} strokeWidth="1" />
          {/* Knob cap at the top of the arm */}
          <circle cx="520" cy="206" r="9" fill={CRANK_KNOB} stroke="#000" strokeWidth="0.5" />
          <circle cx="518" cy="204" r="2" fill="#666" opacity="0.6" />
        </g>

        {/* ---------- Indicator LED (above the screen, left) ---------- */}
        <circle cx="86" cy="60" r="3.5" fill={ledColor}>
          {status === 'building' || status === 'regenerating' ? (
            <animate attributeName="opacity" values="0.4;1;0.4" dur="1.4s" repeatCount="indefinite" />
          ) : null}
        </circle>

        {/* ---------- Chassis label (above the screen, right) ---------- */}
        <text
          x={VB_W - 90}
          y="58"
          textAnchor="end"
          fontFamily="ui-monospace, SFMono-Regular, monospace"
          fontSize="9"
          letterSpacing="1.2"
          fill="#6a5012"
          opacity="0.75"
        >
          {String(name).toUpperCase().slice(0, 16)}
        </text>
      </svg>

      {/* Live screen overlay: real DOM positioned exactly over the
          SVG screen well. Children render here. Background = screen tint
          when no child paints fully opaque (e.g. text-only fallbacks). */}
      <div
        style={{
          position: 'absolute',
          left:   `${screenLeftPct}%`,
          top:    `${screenTopPct}%`,
          width:  `${screenWidthPct}%`,
          height: `${screenHeightPct}%`,
          background: screenBg,
          overflow: 'hidden',
          imageRendering: 'pixelated',
          // No border — the SVG bezel already paints the surround. A
          // CSS border here would double-up and shrink the live pixels.
          // pointer-events stays default so children can capture clicks.
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ---------- HandheldMini -------------------------------------------------
// Compact preview chip used in asset thumbnails / inline previews. Just
// the screen with a hint of the yellow chassis border — no buttons, no
// crank. Children render inside the 400×240 screen area at whatever the
// caller sizes the chip to.
//
// API:
//   <HandheldMini w={60} h={38} screenClass="">{children}</HandheldMini>
//
// The default 60×38 footprint matches AssetThumb's current size so it
// can be dropped in without layout churn. Screen aspect (5:3) is
// preserved by the inner overlay; the yellow frame is just a 2px band.
export function HandheldMini({ children, w = 60, h = 38, screenClass = '', title }) {
  const screenBg = SCREEN_TINT[screenClass] || SCREEN_BG_DEFAULT;
  return (
    <div
      title={title}
      style={{
        position: 'relative',
        width: w,
        height: h,
        background: PLAYDATE_YELLOW,
        borderRadius: 4,
        padding: 2,
        boxShadow: `inset 0 -1px 0 ${PLAYDATE_YELLOW_SHADE}, inset 0 1px 0 ${PLAYDATE_YELLOW_HILITE}`,
        flex: 'none'
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 2,
          background: PLAYDATE_BEZEL,
          borderRadius: 2,
          padding: 1,
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            background: screenBg,
            overflow: 'hidden',
            imageRendering: 'pixelated'
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
