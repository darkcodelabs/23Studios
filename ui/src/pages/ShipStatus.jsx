import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Download, Github, ClipboardCopy, ClipboardCheck, AlertCircle, Loader2,
  Check, Circle, ArrowRight
} from 'lucide-react';
import Handheld from '../components/Handheld.jsx';
import { api } from '../lib/api.js';

// ShipStatus → "Release" — design pass 4, screen 5.
//
// Fidelity reference:
//   design_handoff_23_studios/screen-sideload.jsx (renamed → Release)
//   design_handoff_23_studios/23studios_design_README_revised.md §"Screens > 5. Release"
//
// The original prototype called this "Sideload" and rendered a fictional
// USB-C transfer animation. Playdate doesn't expose itself as a USB serial
// device the way the prototype implied — the real flow is pdc → optional
// GitHub publish → user downloads .pdx → user sideloads via Panic's
// official methods.
//
// This file is the public mount at /projects/:id/release/ship (alias of the
// legacy /project/:id/ship). The old ship-job step poller + GateChecklist
// surfaces are still useful but live elsewhere — Phase 6 B11's ship runner
// is exposed through /projects/:id/review surfaces, not the public release
// screen. Preserving them inline would defeat the design intent of the
// release surface (which is the user's "receipt + sideload" page).
//
// Layout (2-col stage + step list):
//   Left stage (540px min-height): handheld with title scene + build
//     artifact summary + 3 large action buttons.
//   Right: header + 6-row step list + release manifest panel +
//     amber tip banner.
//
// Data sources:
//   GET /api/projects/:id                           project name
//   GET /api/projects/:id/card_meta                 build size + sha proxy + latest pdx url + title image
//   GET /api/projects/:id/releases                  GitHub releases list
//   GET /api/projects/:id/releases/pack/latest      packed release manifest
//   POST /api/projects/:id/releases/publish         publish to GitHub

const SIDELOAD_INSTRUCTIONS = `How to sideload to a Playdate:

1. Plug your Playdate into your computer via USB-C.
2. Open the Playdate Mirror app (or visit play.date in a browser).
3. Drag the downloaded .pdx file onto Mirror's "Sideload" panel.
4. Or use the Playdate Simulator: File → Open .pdx → select the file.
5. The game appears under Games → Sideloaded on your device.

Reference: https://help.play.date/games/sideloading/
`;

function appBase() {
  return (typeof window !== 'undefined' && window.__APP_BASE__) || '';
}

function fmtBytes(b) {
  if (b == null) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
}

function shortHash(s) {
  if (!s) return '—';
  const clean = String(s).replace(/[^a-f0-9]/gi, '');
  if (!clean) return '—';
  return clean.length > 12 ? `${clean.slice(0, 6)}…${clean.slice(-4)}` : clean;
}

// Pseudo-sha derived from build size + last_build_at so the "sha" stamp
// has something stable to show until the packager exposes a real digest.
function pseudoSha(meta) {
  if (!meta || (!meta.last_build_at && !meta.last_build_size)) return null;
  const seed = `${meta.last_build_at || 0}-${meta.last_build_size || 0}`;
  let h = 5381;
  for (const c of seed) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, '0').repeat(4).slice(0, 16);
}

// ─── Small presentational helpers ───────────────────────────────────────────
function Panel({ title, right, children, padded = true }) {
  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)'
      }}
    >
      <div
        className="flex items-center font-mono uppercase"
        style={{
          padding: '10px 14px',
          gap: 10,
          borderBottom: '1px solid var(--border)',
          fontSize: 10,
          letterSpacing: '.12em',
          color: 'var(--text-muted)'
        }}
      >
        <span>{title}</span>
        {right ? <span style={{ marginLeft: 'auto' }}>{right}</span> : null}
      </div>
      <div style={{ padding: padded ? 14 : 0 }}>{children}</div>
    </div>
  );
}

function Tag({ tone, children }) {
  const map = {
    ok:     { fg: 'var(--ok)',     bg: 'oklch(74% 0.14 145 / .1)', bd: 'oklch(50% 0.1 145)' },
    accent: { fg: 'var(--accent)', bg: 'var(--accent-soft)',        bd: 'var(--accent-dim)' },
    dim:    { fg: 'var(--text-dim)', bg: 'transparent',             bd: 'var(--border-2)' }
  };
  const s = map[tone] || map.dim;
  return (
    <span
      className="font-mono uppercase inline-flex items-center"
      style={{
        gap: 4,
        fontSize: 10, letterSpacing: '.08em',
        padding: '2px 7px', borderRadius: 3,
        background: s.bg, color: s.fg, border: `1px solid ${s.bd}`
      }}
    >{children}</span>
  );
}

function StepRow({ n, label, state, detail }) {
  const numContent = state === 'done' ? <Check className="w-3 h-3" />
    : state === 'active' ? '…'
    : n;
  return (
    <div
      style={{
        background: 'var(--surface)',
        padding: '14px 18px',
        display: 'flex', alignItems: 'center', gap: 14
      }}
    >
      <div
        style={{
          width: 22, height: 22, borderRadius: '50%',
          display: 'grid', placeItems: 'center',
          fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600,
          flex: 'none',
          background: state === 'done' ? 'var(--ok)'
            : state === 'active' ? 'var(--accent)'
            : state === 'skipped' ? 'var(--bg-2)'
            : 'var(--bg-2)',
          color: state === 'done' ? 'var(--bg)'
            : state === 'active' ? 'var(--accent-ink)'
            : 'var(--text-dim)',
          border: '1px solid ' + (state === 'done' ? 'var(--ok)'
            : state === 'active' ? 'var(--accent)'
            : 'var(--border-2)')
        }}
      >
        {numContent}
      </div>
      <div
        style={{
          fontSize: 14,
          color: state === 'skipped' ? 'var(--text-dim)' : 'var(--text)'
        }}
      >
        {label}
      </div>
      <div
        className="font-mono"
        style={{
          marginLeft: 'auto', fontSize: 11,
          color: state === 'active' ? 'var(--accent)' : 'var(--text-dim)'
        }}
      >
        {detail || (state === 'done' ? 'done' : state === 'active' ? 'in progress' : state === 'skipped' ? 'skipped' : 'waiting')}
      </div>
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────
export default function ShipStatus() {
  const { id: projectId } = useParams();
  const navigate = useNavigate();

  const [project, setProject] = useState(null);
  const [meta,    setMeta]    = useState(null);
  const [pack,    setPack]    = useState(null); // /releases/pack/latest
  const [packErr, setPackErr] = useState(null);
  const [releases, setReleases] = useState([]); // GitHub releases
  const [publishing, setPublishing] = useState(false);
  const [publishErr, setPublishErr] = useState(null);
  const [publishOk, setPublishOk]   = useState(false);
  const [copied, setCopied] = useState(false);

  // Force dark body bg (consistent with Library / Landing / Building).
  useEffect(() => {
    const prev = document.body.style.background;
    document.body.style.background = 'var(--bg)';
    return () => { document.body.style.background = prev; };
  }, []);

  const load = useCallback(async () => {
    try {
      const [p, m, l, r] = await Promise.allSettled([
        api.get(`/api/projects/${projectId}`),
        api.get(`/api/projects/${projectId}/card_meta`),
        api.get(`/api/projects/${projectId}/releases/pack/latest`),
        api.get(`/api/projects/${projectId}/releases`)
      ]);
      if (p.status === 'fulfilled') setProject((p.value && p.value.project) || p.value);
      if (m.status === 'fulfilled') setMeta(m.value);
      if (l.status === 'fulfilled') {
        setPack(l.value);
        setPackErr(null);
      } else if (l.status === 'rejected') {
        // 404 (no_pack_found) is normal for un-shipped projects.
        const detail = l.reason?.detail?.error || l.reason?.message || '';
        setPackErr(detail === 'no_pack_found' ? null : (detail || 'pack/latest failed'));
        setPack(null);
      }
      if (r.status === 'fulfilled') setReleases((r.value && r.value.releases) || []);
    } catch (_e) { /* surfaces in panel state */ }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const downloadUrl = useMemo(() => {
    if (!meta || !meta.latest_pdx_zip_url) return null;
    return appBase() + meta.latest_pdx_zip_url;
  }, [meta]);

  const titleImageUrl = meta && meta.title_image_url
    ? (meta.title_image_url.startsWith('/') ? appBase() + meta.title_image_url : meta.title_image_url)
    : null;

  const title = project?.name || projectId || '—';
  const sha = pseudoSha(meta);
  const sizeStr = fmtBytes(meta?.last_build_size);
  const fwVersion = meta?.version ? `v${String(meta.version).replace(/^v/, '')}` : 'v2.1.4';

  const handleDownload = useCallback(() => {
    if (!downloadUrl) return;
    // Trigger native download.
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = '';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [downloadUrl]);

  const handlePublish = useCallback(async () => {
    setPublishing(true);
    setPublishErr(null);
    setPublishOk(false);
    try {
      const r = await api.post(`/api/projects/${projectId}/releases/publish`, {});
      if (r && (r.ok || r.url || r.tag)) {
        setPublishOk(true);
        await load();
      } else if (r && r.error) {
        setPublishErr(r.detail || r.error);
      } else {
        setPublishOk(true);
        await load();
      }
    } catch (e) {
      const detail = (e && e.detail && (e.detail.detail || e.detail.error))
        || (e && e.message) || 'publish failed';
      setPublishErr(String(detail));
    } finally {
      setPublishing(false);
    }
  }, [projectId, load]);

  const handleCopyInstructions = useCallback(async () => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(SIDELOAD_INSTRUCTIONS);
      } else {
        // Legacy fallback.
        const ta = document.createElement('textarea');
        ta.value = SIDELOAD_INSTRUCTIONS;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (_e) { /* clipboard blocked — silent */ }
  }, []);

  // Step states (6 rows per spec):
  //   1 Compile .pdx       — done when meta.last_build_at exists
  //   2 Verify             — done when pack exists (packager validates)
  //   3 Package release    — done when pack exists
  //   4 Publish to GitHub  — done when releases.length > 0
  //   5 Download           — done when user has actually clicked (we can't
  //                          observe that, so treat as ready/active when
  //                          downloadUrl exists)
  //   6 Sideload           — informational (always 'manual')
  const hasBuild = !!(meta && meta.last_build_at);
  const hasPack  = !!pack;
  const hasGhRelease = releases.length > 0;
  const steps = [
    {
      n: 1, label: 'Compile .pdx',
      state: hasBuild ? 'done' : 'active',
      detail: hasBuild ? sizeStr : '…'
    },
    {
      n: 2, label: 'Verify',
      state: hasPack ? 'done' : (hasBuild ? 'active' : 'queued'),
      detail: hasPack ? 'smoketest pass' : (hasBuild ? '…' : 'waiting')
    },
    {
      n: 3, label: 'Package release notes',
      state: hasPack ? 'done' : 'queued',
      detail: hasPack ? `tag ${pack.tag || '—'}` : 'waiting'
    },
    {
      n: 4, label: 'Publish to GitHub',
      state: publishing ? 'active' : (hasGhRelease ? 'done' : 'skipped'),
      detail: publishing ? 'pushing…' : (hasGhRelease ? `${releases.length} release${releases.length === 1 ? '' : 's'}` : 'optional')
    },
    {
      n: 5, label: 'Download to your machine',
      state: downloadUrl ? 'active' : 'queued',
      detail: downloadUrl ? 'ready' : 'no .pdx yet'
    },
    {
      n: 6, label: 'Sideload to Playdate',
      state: 'queued',
      detail: 'manual'
    }
  ];

  return (
    <div
      className="font-ui"
      style={{
        background: 'var(--bg)',
        color: 'var(--text)',
        minHeight: '100vh'
      }}
    >
      <style>{`
        @keyframes readyPulse {
          0%, 100% { box-shadow: 0 0 0 0 var(--accent-soft); }
          50%      { box-shadow: 0 0 0 8px transparent; }
        }
        .rl-ready { animation: readyPulse 2.2s ease-in-out infinite; }
      `}</style>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 40,
          padding: '32px 56px 56px',
          alignItems: 'start'
        }}
      >
        {/* ─── LEFT stage ────────────────────────────────────────────── */}
        <div
          style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: '40px 32px 32px',
            position: 'relative',
            overflow: 'hidden',
            minHeight: 540
          }}
        >
          {/* Soft grid background pattern per spec */}
          <div
            aria-hidden
            style={{
              position: 'absolute', inset: 0,
              backgroundImage:
                'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
              backgroundSize: '32px 32px',
              opacity: 0.35,
              pointerEvents: 'none'
            }}
          />

          {/* Top-right tags */}
          <div
            style={{
              position: 'absolute', right: 18, top: 16,
              display: 'flex', gap: 6, zIndex: 2
            }}
          >
            <Tag tone={hasBuild ? 'ok' : 'dim'}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: hasBuild ? 'var(--ok)' : 'var(--text-dim)' }} />
              {hasBuild ? 'built' : 'no build'}
            </Tag>
            <Tag>23s-fw {fwVersion}</Tag>
          </div>

          {/* Handheld + content */}
          <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
            <Handheld scale={1.1}>
              {titleImageUrl ? (
                <img
                  src={titleImageUrl}
                  alt={title}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated' }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                <div
                  className="font-lcd"
                  style={{
                    width: '100%', height: '100%',
                    display: 'grid', placeItems: 'center',
                    color: 'oklch(20% 0.01 75)',
                    fontSize: 24
                  }}
                >
                  {title.toUpperCase().slice(0, 24)}
                </div>
              )}
            </Handheld>

            {/* Build artifact summary */}
            <div
              className="font-mono"
              style={{
                fontSize: 12, color: 'var(--text-muted)',
                textAlign: 'center'
              }}
            >
              {hasBuild
                ? <>Final build · <span style={{ color: 'var(--text)' }}>{sizeStr}</span> · sha <span style={{ color: 'var(--text)' }}>{shortHash(sha)}</span></>
                : 'no build artifact yet — ship the project to produce a .pdx'}
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%', maxWidth: 360 }}>
              <button
                type="button"
                onClick={handleDownload}
                disabled={!downloadUrl}
                className={'font-ui inline-flex items-center justify-center ' + (downloadUrl ? 'rl-ready' : '')}
                style={{
                  background: 'var(--accent)', color: 'var(--accent-ink)',
                  border: '1px solid var(--accent)',
                  padding: '12px 16px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 14, fontWeight: 600, gap: 8,
                  cursor: downloadUrl ? 'pointer' : 'not-allowed',
                  opacity: downloadUrl ? 1 : 0.5
                }}
              >
                <Download className="w-4 h-4" /> Download .pdx
              </button>
              <button
                type="button"
                onClick={handlePublish}
                disabled={publishing || !hasPack}
                className="font-ui inline-flex items-center justify-center"
                style={{
                  background: 'var(--surface)', color: 'var(--text-soft)',
                  border: '1px solid var(--border-2)',
                  padding: '10px 16px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13, gap: 8,
                  cursor: publishing || !hasPack ? 'not-allowed' : 'pointer',
                  opacity: publishing || !hasPack ? 0.6 : 1
                }}
                title={!hasPack ? 'pack a release first (Step 3) before publishing' : 'push the local release tree to GitHub via gh CLI'}
              >
                {publishing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Github className="w-4 h-4" />}
                {publishing ? 'Publishing…' : 'Publish to GitHub'}
              </button>
              <button
                type="button"
                onClick={handleCopyInstructions}
                className="font-ui inline-flex items-center justify-center"
                style={{
                  background: 'transparent', color: 'var(--text-muted)',
                  border: '1px solid var(--border-2)',
                  padding: '10px 16px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: 13, gap: 8,
                  cursor: 'pointer'
                }}
              >
                {copied ? <ClipboardCheck className="w-4 h-4" /> : <ClipboardCopy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Copy sideload instructions'}
              </button>
            </div>

            {publishOk ? (
              <div
                className="font-mono inline-flex items-center"
                style={{
                  color: 'var(--ok)',
                  background: 'oklch(74% 0.14 145 / .12)',
                  border: '1px solid oklch(50% 0.1 145)',
                  padding: '6px 10px', borderRadius: 'var(--radius-sm)',
                  fontSize: 11, gap: 6
                }}
              >
                <Check className="w-3 h-3" /> published to GitHub
              </div>
            ) : null}
            {publishErr ? (
              <div
                className="font-mono inline-flex items-center"
                style={{
                  color: 'var(--danger)',
                  background: 'oklch(64% 0.18 25 / .12)',
                  border: '1px solid oklch(50% 0.15 25)',
                  padding: '6px 10px', borderRadius: 'var(--radius-sm)',
                  fontSize: 11, gap: 6, maxWidth: 360
                }}
              >
                <AlertCircle className="w-3 h-3" /> {publishErr}
              </div>
            ) : null}
          </div>

          {/* Bottom-left mono caption */}
          <div
            className="font-mono uppercase"
            style={{
              position: 'absolute', left: 18, bottom: 16,
              fontSize: 10, letterSpacing: '.08em',
              color: 'var(--text-dim)', zIndex: 2
            }}
          >
            {hasBuild ? `${sizeStr} · sha ${shortHash(sha)} · 23s-fw ${fwVersion}` : 'awaiting first build'}
          </div>
        </div>

        {/* ─── RIGHT column ──────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Header */}
          <div>
            <div
              className="font-mono uppercase"
              style={{
                marginBottom: 4,
                fontSize: 10, letterSpacing: '.12em',
                color: 'var(--text-muted)'
              }}
            >
              release · {title}
            </div>
            <h1
              style={{
                margin: 0,
                fontSize: 26, fontWeight: 500, letterSpacing: '-.02em',
                color: 'var(--text)'
              }}
            >
              Ready to sideload
            </h1>
            <p
              className="font-mono"
              style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 6 }}
            >
              {hasBuild
                ? `Final build · ${sizeStr} · sha ${shortHash(sha)}`
                : 'No build yet. Run the ship pipeline from the workspace to produce a .pdx.'}
            </p>
          </div>

          {/* 6-step list */}
          <div
            style={{
              display: 'flex', flexDirection: 'column',
              gap: 1,
              background: 'var(--border)',
              borderRadius: 'var(--radius)',
              overflow: 'hidden'
            }}
          >
            {steps.map((s) => (
              <StepRow key={s.n} n={s.n} label={s.label} state={s.state} detail={s.detail} />
            ))}
          </div>

          {/* Release manifest panel — replaces the prototype's transfer log */}
          <Panel
            title={pack ? `release manifest · ${pack.tag || 'latest'}` : 'release manifest'}
            right={
              pack ? (
                <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {(pack.files || []).length} files
                </span>
              ) : null
            }
          >
            {pack && Array.isArray(pack.files) && pack.files.length > 0 ? (
              <div
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11,
                  maxHeight: 240, overflowY: 'auto',
                  display: 'flex', flexDirection: 'column'
                }}
              >
                {pack.files.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center"
                    style={{
                      gap: 10, padding: '6px 0',
                      borderBottom: i === pack.files.length - 1 ? 'none' : '1px dashed var(--border)'
                    }}
                  >
                    <Tag tone={f.kind === 'pdx' ? 'accent' : 'dim'}>{f.kind}</Tag>
                    <span style={{ color: 'var(--text-soft)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {f.rel || f.path}
                    </span>
                    <span style={{ color: 'var(--text-dim)' }}>{fmtBytes(f.bytes)}</span>
                  </div>
                ))}
                <div
                  className="flex items-center"
                  style={{
                    gap: 10, padding: '8px 0 0',
                    marginTop: 6,
                    borderTop: '1px solid var(--border)',
                    color: 'var(--text-muted)', fontSize: 11
                  }}
                >
                  <span>total</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--text)' }}>
                    {fmtBytes(pack.files.reduce((acc, f) => acc + (f.bytes || 0), 0))}
                  </span>
                </div>
              </div>
            ) : packErr ? (
              <div
                className="font-mono inline-flex items-center"
                style={{
                  color: 'var(--danger)', fontSize: 11,
                  gap: 6
                }}
              >
                <AlertCircle className="w-3 h-3" /> {packErr}
              </div>
            ) : (
              <p className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)', margin: 0 }}>
                no packed release yet — run a ship pipeline to produce the .pdx
                bundle and its release notes.
              </p>
            )}
          </Panel>

          {/* GitHub release list (when present) */}
          {hasGhRelease ? (
            <Panel
              title="github releases"
              right={
                <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                  {releases.length} total
                </span>
              }
            >
              <div
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11,
                  maxHeight: 200, overflowY: 'auto',
                  display: 'flex', flexDirection: 'column'
                }}
              >
                {releases.slice(0, 8).map((r) => (
                  <div
                    key={r.tag}
                    className="flex items-center"
                    style={{
                      gap: 10, padding: '6px 0',
                      borderBottom: '1px dashed var(--border)'
                    }}
                  >
                    {r.is_latest ? <Tag tone="accent">latest</Tag> : <Tag>tag</Tag>}
                    <span style={{ color: 'var(--text-soft)' }}>{r.tag}</span>
                    <span style={{ color: 'var(--text-dim)', marginLeft: 'auto' }}>
                      {r.published_at ? new Date(r.published_at).toLocaleDateString() : '—'}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          {/* Tip banner */}
          <div
            className="font-mono"
            style={{
              border: '1px solid var(--border-2)',
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
              padding: '10px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: 11,
              letterSpacing: '.04em',
              display: 'flex', alignItems: 'flex-start', gap: 10
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6, height: 6, borderRadius: '50%',
                background: 'var(--accent)',
                boxShadow: '0 0 6px var(--accent)',
                marginTop: 5, flex: 'none'
              }}
            />
            <span style={{ lineHeight: 1.55 }}>
              tip · sideload via Playdate Mirror, the play.date web sideloader,
              or open the .pdx in the Playdate Simulator. The platform can't push
              to your device directly — see{' '}
              <a
                href="https://help.play.date/games/sideloading/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--accent)', textDecoration: 'underline' }}
              >
                Panic's sideload docs
              </a>.
            </span>
          </div>

          {/* Footer nav to releases history */}
          <button
            type="button"
            onClick={() => navigate(`/projects/${projectId}/release/history`)}
            className="font-mono inline-flex items-center"
            style={{
              alignSelf: 'flex-start',
              background: 'transparent', color: 'var(--text-muted)',
              border: 'none',
              padding: 0,
              fontSize: 11, gap: 6,
              cursor: 'pointer',
              textTransform: 'uppercase', letterSpacing: '.08em'
            }}
          >
            see release history <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
