import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Paperclip, ArrowRight, Minus } from 'lucide-react';
import { api } from '../lib/api.js';

// Landing — design pass 1.
//
// Hero with glove backdrop + centered prompt composer, mono "BUILT BY
// HAKCERS" belt, 4-card flow grid, and a footer strip. Fidelity
// reference: design_handoff_23_studios/screen-landing.jsx and the
// .land-* CSS in design_handoff_23_studios/styles.css.
//
// Mounted at "/" and "/dashboard" INSIDE AppShell so the studio sidebar
// + topbar paint around it. (Previously /new mounted Landing full-bleed
// — that route still works as a backward-compat alias and falls back
// into the same wrapped layout.)
//
// On "Build it":
//   POST /api/projects { name, description, game_type: 'sdk' }
//   → navigate /projects/:id/build/milestones

const SEED = '0xR23-G23S';

const EXAMPLES = [
  {
    label: 'HAKCD v2',
    prompt:
      "1998 suburban USA. Teen phreak inherits a haunted BBS modem from a dead uncle. Every coin dialled rings a different ghost. Twenty-three ghosts to collect, one antagonist to expose. Crank dials the rotary. Heavy 1-bit dither, fluorescent garage light, cathode green tint. Soundtrack: dial-tone drone + tape hiss."
  },
  {
    label: 'Haunted Modem',
    prompt:
      "A text horror set in a 1996 BBS. The player dials into a board that shouldn't exist. Each post is a memory not theirs. The crank scrolls the message thread. Monospace, 1-bit."
  },
  {
    label: 'Kitchen-Sink Tactics',
    prompt:
      "A tiny tactics RPG where every battle is in a different room of one apartment. The kitchen island is high ground. The cat is unkillable. Procedural party. 1-bit isometric."
  },
  {
    label: 'Crank Cathedral',
    prompt:
      "An atmospheric one-button platformer. The crank winds time backwards. Stained-glass parallax in 1-bit dither. No music, only the kid's footsteps and the bell."
  }
];

const FLOW_STEPS = [
  {
    n: '01 / describe',
    t: 'Type the idea',
    p: "One paragraph. As specific or unhinged as you like. The system extracts genre, mood, mechanics, art direction, audio palette."
  },
  {
    n: '02 / generate',
    t: 'Watch it build',
    p: "Story bible, scene by scene. 1-bit art frames. Tones and music synthesized to mood. Lua compiled to a runnable bundle."
  },
  {
    n: '03 / curate',
    t: "Stay in the driver's seat",
    p: "Approve, reject, regen anything. Edit prompts inline. Swap in your own art or audio. The platform respects your taste."
  },
  {
    n: '04 / ship',
    t: 'Onto real hardware',
    p: ".pdx package downloads in seconds. Sideload via Playdate Mirror or play.date. Optionally publish to GitHub."
  }
];

const STRIP_LABELS = [
  'BUILT BY HAKCERS FOR HAKCERS',
  'REV 1.0',
  'R2S-G23S-GLV-001',
  '1-BIT TARGET',
  'SIDELOAD READY',
  'MARKETPLACE PENDING',
  'BUILT BY HAKCERS FOR HAKCERS'
];

// Derive a project name from the first non-empty line/phrase of the prompt.
function deriveName(prompt) {
  const trimmed = (prompt || '').trim();
  if (!trimmed) return 'New project';
  const firstLine = trimmed.split(/\n/)[0];
  const firstSentence = firstLine.split(/[.!?]/)[0];
  const words = firstSentence.trim().split(/\s+/).slice(0, 6).join(' ');
  return words.slice(0, 60) || 'New project';
}

function FlowCard({ step }) {
  return (
    <div
      className="flex flex-col"
      style={{
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        background: 'var(--surface)',
        padding: 20,
        gap: 14,
        minHeight: 200
      }}
    >
      <div
        className="font-mono uppercase"
        style={{
          fontSize: 11,
          letterSpacing: '.14em',
          color: 'var(--accent)'
        }}
      >
        {step.n}
      </div>
      <h3 style={{ margin: 0, fontSize: 18, fontWeight: 500, letterSpacing: '-.01em', color: 'var(--text)' }}>
        {step.t}
      </h3>
      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>{step.p}</p>
      <div
        className="mt-auto grid place-items-center font-mono"
        style={{
          height: 80,
          background: 'var(--bg-2)',
          border: '1px dashed var(--border-2)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 10,
          color: 'var(--text-dim)',
          letterSpacing: '.1em'
        }}
      >
        {step.n.split(' / ')[1].toUpperCase()}
      </div>
    </div>
  );
}

function CompChip({ children, onClick, subtle, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="font-mono inline-flex items-center"
      style={{
        appearance: 'none',
        background: 'transparent',
        border: subtle ? '1px solid var(--border)' : '1px solid var(--border-2)',
        color: subtle ? 'var(--text-dim)' : 'var(--text-muted)',
        padding: '6px 11px',
        borderRadius: 999,
        fontSize: 11,
        letterSpacing: '.04em',
        gap: 6,
        lineHeight: 1,
        cursor: onClick ? 'pointer' : 'default'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--text)';
        e.currentTarget.style.borderColor = 'var(--border-strong)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = subtle ? 'var(--text-dim)' : 'var(--text-muted)';
        e.currentTarget.style.borderColor = subtle ? 'var(--border)' : 'var(--border-2)';
      }}
    >
      {children}
    </button>
  );
}

export default function Landing() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState(EXAMPLES[0].prompt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const charCount = useMemo(() => (prompt || '').length, [prompt]);

  async function onBuild() {
    if (busy) return;
    const text = (prompt || '').trim();
    if (!text) {
      setError('Describe the game first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/api/projects', {
        name: deriveName(text),
        description: text,
        game_type: 'sdk'
      });
      const newId = r && (r.project ? r.project.id : r.id);
      if (!newId) throw new Error('no project id returned');
      navigate(`/projects/${newId}/build/milestones`);
    } catch (e) {
      const msg = (e && e.detail && e.detail.detail) || (e && e.detail) || e?.message || 'failed';
      setError(typeof msg === 'string' ? msg : 'failed to create project');
      setBusy(false);
    }
  }

  return (
    <div
      className="font-ui"
      style={{
        background: 'var(--bg)',
        color: 'var(--text)'
      }}
    >
      {/* ─── Hero (v2 — full-bleed glove + composer) ─── */}
      <section
        className="relative flex flex-col items-center justify-center"
        style={{
          padding: '56px 24px',
          gap: 20,
          minHeight: 640,
          overflow: 'hidden',
          isolation: 'isolate'
        }}
      >
        {/* Glove backdrop */}
        <div
          aria-hidden
          className="absolute inset-0 grid place-items-center"
          style={{ zIndex: 0, pointerEvents: 'none' }}
        >
          <img
            src="/assets/studio-logo.png"
            alt=""
            style={{
              width: '100%',
              maxWidth: 1400,
              height: 'auto',
              display: 'block',
              opacity: 0.55,
              filter: 'saturate(.8) contrast(1.05)',
              transform: 'translateY(-3%) scale(1.05)'
            }}
          />
        </div>
        {/* Radial vignette */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            zIndex: 1,
            pointerEvents: 'none',
            background:
              'radial-gradient(ellipse 55% 50% at 50% 50%, oklch(13% 0.005 75 / .65) 0%, transparent 75%)'
          }}
        />
        {/* Top/bottom fade to bg */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            zIndex: 1,
            pointerEvents: 'none',
            background:
              'linear-gradient(to bottom, var(--bg) 0%, transparent 14%, transparent 84%, var(--bg) 100%)'
          }}
        />

        {/* ── Eyebrow pill ── */}
        <div
          className="relative font-mono uppercase inline-flex items-center"
          style={{
            zIndex: 2,
            fontSize: 11,
            letterSpacing: '.16em',
            color: 'var(--text-muted)',
            gap: 12,
            background: 'oklch(13% 0.005 75 / .55)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            padding: '8px 16px',
            borderRadius: 999,
            border: '1px solid var(--border)'
          }}
        >
          <span>23 STUDIOS</span>
          <span aria-hidden style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
          <span>REV 1.0</span>
          <span aria-hidden style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
          <span>PROMPT → PLAYABLE</span>
        </div>

        {/* ── Prompt composer card ── */}
        <div
          className="relative w-full"
          style={{
            zIndex: 2,
            maxWidth: 760,
            background: 'oklch(17% 0.006 75 / .92)',
            backdropFilter: 'blur(20px) saturate(140%)',
            WebkitBackdropFilter: 'blur(20px) saturate(140%)',
            border: '1px solid var(--border-2)',
            borderRadius: 20,
            padding: 4,
            boxShadow:
              '0 1px 0 rgba(255,255,255,.04) inset, 0 20px 60px -20px rgba(0,0,0,.6), 0 2px 0 rgba(0,0,0,.3)'
          }}
        >
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe a game…"
            spellCheck={false}
            rows={5}
            className="font-ui w-full"
            style={{
              border: 0,
              outline: 0,
              resize: 'none',
              background: 'transparent',
              color: 'var(--text)',
              fontSize: 16,
              lineHeight: 1.55,
              padding: '18px 20px 8px',
              minHeight: 130
            }}
          />
          <div className="flex items-center" style={{ padding: '8px 10px 10px', gap: 8 }}>
            <div className="flex items-center flex-wrap" style={{ gap: 6 }}>
              <CompChip title="Attach reference">
                <Paperclip className="w-3.5 h-3.5" />
              </CompChip>
              <CompChip>target · playdate</CompChip>
              <CompChip>art · 1-bit</CompChip>
              <CompChip>length · ~9 min</CompChip>
              <CompChip>runtime · sdk</CompChip>
              <CompChip subtle>seed · {SEED}</CompChip>
            </div>
            <div className="flex items-center" style={{ marginLeft: 'auto', gap: 10 }}>
              <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {charCount} chars
              </span>
              <button
                type="button"
                onClick={onBuild}
                disabled={busy}
                className="font-ui inline-flex items-center"
                style={{
                  borderRadius: 999,
                  padding: '9px 16px',
                  background: 'var(--accent)',
                  color: 'var(--accent-ink)',
                  border: '1px solid var(--accent)',
                  fontWeight: 600,
                  fontSize: 13,
                  gap: 8,
                  cursor: busy ? 'wait' : 'pointer',
                  opacity: busy ? 0.7 : 1
                }}
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {busy ? 'Building…' : 'Build it'}
                {!busy ? <ArrowRight className="w-3.5 h-3.5" style={{ marginLeft: 2 }} /> : null}
              </button>
            </div>
          </div>
        </div>

        {error ? (
          <div
            className="relative font-mono"
            style={{
              zIndex: 2,
              fontSize: 11,
              color: 'var(--danger)',
              background: 'oklch(64% 0.18 25 / .10)',
              border: '1px solid oklch(50% 0.15 25)',
              padding: '6px 12px',
              borderRadius: 999
            }}
          >
            {error}
          </div>
        ) : null}

        {/* ── Example prompts ── */}
        <div
          className="relative flex items-center justify-center flex-wrap w-full"
          style={{
            zIndex: 2,
            maxWidth: 760,
            gap: 8,
            marginTop: 4
          }}
        >
          <span
            className="font-mono uppercase"
            style={{
              fontSize: 10,
              letterSpacing: '.12em',
              color: 'var(--text-dim)',
              marginRight: 4
            }}
          >
            try
          </span>
          {EXAMPLES.map((ex) => (
            <CompChip key={ex.label} onClick={() => setPrompt(ex.prompt)}>
              {ex.label}
            </CompChip>
          ))}
        </div>
      </section>

      {/* ─── Strip (mono belt under hero) ─── */}
      <div
        className="flex items-center overflow-x-hidden"
        style={{
          marginTop: 0,
          borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
          padding: '18px 56px',
          gap: 40,
          background: 'var(--bg-2)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          letterSpacing: '.1em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)'
        }}
      >
        {STRIP_LABELS.map((t, i) => (
          <span key={i} className="inline-flex items-center" style={{ gap: 10 }}>
            <span aria-hidden style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block' }} />
            {t}
          </span>
        ))}
      </div>

      {/* ─── Flow grid ─── */}
      <div
        className="grid"
        style={{
          padding: '64px 56px',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 18
        }}
      >
        {FLOW_STEPS.map((s) => <FlowCard key={s.n} step={s} />)}
      </div>

      {/* ─── Footer ─── */}
      <div
        className="flex items-center font-mono uppercase"
        style={{
          padding: '36px 56px 48px',
          gap: 24,
          fontSize: 11,
          color: 'var(--text-muted)',
          letterSpacing: '.08em',
          borderTop: '1px solid var(--border)'
        }}
      >
        <span style={{ color: 'var(--accent)' }}>// BUILT BY HAKCERS FOR HAKCERS //</span>
        <span>R2S-G23S-GLV-001 rev 1.0</span>
        <div className="flex" style={{ marginLeft: 'auto', gap: 22 }}>
          <span>DOCS</span>
          <span>CHANGELOG</span>
          <span>DISCORD</span>
          <span>PRESS KIT</span>
        </div>
      </div>
    </div>
  );
}

// Tiny tests-as-exports — kept light because Vite doesn't run a test runner
// here. deriveName is the only non-trivial pure helper.
export const __TEST__ = { deriveName, EXAMPLES, FLOW_STEPS };
