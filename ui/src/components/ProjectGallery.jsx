import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Image as ImageIcon, Loader2, RefreshCw, Check, X as XIcon,
  Maximize2, Rocket, AlertCircle
} from 'lucide-react';
import { api } from '../lib/api.js';
import AssetEditModal from './AssetEditModal.jsx';
import ReferenceUploadModal from './ReferenceUploadModal.jsx';
import Handheld, { StatusPip } from './Handheld.jsx';

// ProjectGallery — design pass 2 ("taste cockpit").
//
// Three-column workspace per design_handoff_23_studios/screen-workspace.jsx:
//   ┌───────────────────────────────────────────────────────────────────┐
//   │ assets list │ stage (Playdate frame + actions) │ inspector tabs   │
//   └───────────────────────────────────────────────────────────────────┘
//
// Left  (240px): type filter pills + scrollable list with thumb + pip,
//                approved/in-review/pending counts, primary "Ship build".
// Center (1fr):  asset id mono + name H2 + meta tags + fullscreen /
//                open-in-editor / view-prompt buttons; centered Handheld
//                with the active asset image; bottom thumbstrip;
//                Reject (red) · Regenerate (amber) · Approve (green).
// Right (360px): inspector tabs (prompt / art / audio / code / refs)
//                with counts. Prompt is contenteditable w/ token coloring.
//                Art shows a 3-col variant grid + reference drops grid.
//                Audio is a stub waveform. Code is mono Lua. Refs hosts a
//                per-asset reference selector w/ checkboxes (read-only —
//                wiring lives in AssetEditModal for now).
//
// Data plumbing (GET /gallery, references, POST approve/reject,
// AssetEditModal regen) carried over from design pass 1 — only the chrome
// and layout moved. 5s polling preserved.

const POLL_MS = 5000;

// ----------------------------------------------------------------------------
// URL + path helpers
// ----------------------------------------------------------------------------

function appBase() {
  return (typeof window !== 'undefined' && window.__APP_BASE__) || '';
}

function fileRawUrl(projectId, relPath) {
  return `${appBase()}/api/projects/${projectId}/file/raw?path=${encodeURIComponent(relPath)}`;
}

function resolveImageUrl(projectId, asset) {
  if (!asset) return null;
  if (asset.imageUrl && asset.imageUrl.startsWith('/')) return appBase() + asset.imageUrl;
  if (asset.imageUrl) return asset.imageUrl;
  if (asset._rawPath) return fileRawUrl(projectId, asset._rawPath);
  return null;
}

function referenceRawUrl(projectId, filename) {
  return `${appBase()}/api/projects/${encodeURIComponent(projectId)}/references/${encodeURIComponent(filename)}/raw`;
}

function referenceImageUrl(projectId, reference) {
  if (!reference) return null;
  if (typeof reference === 'string') return referenceRawUrl(projectId, reference);
  if (reference.url) return reference.url.startsWith('/') ? appBase() + reference.url : reference.url;
  if (reference.path) return fileRawUrl(projectId, reference.path);
  if (reference.filename) return referenceRawUrl(projectId, reference.filename);
  return null;
}

function referenceLabel(reference) {
  if (typeof reference === 'string') return reference;
  if (!reference) return 'ref';
  return reference.name
      || reference.filename
      || (reference.path && reference.path.split('/').pop())
      || 'ref';
}

// ----------------------------------------------------------------------------
// Fallback enumeration (used when /gallery is unimplemented)
// ----------------------------------------------------------------------------

async function enumerateViaFiles(projectId) {
  const targets = [
    { path: 'sdk_data/scenes',     type: 'scene' },
    { path: 'sdk_data/characters', type: 'portrait' },
    { path: 'sdk_data/launcher',   type: 'launcher' }
  ];
  const assets = [];
  for (const t of targets) {
    let listing;
    try {
      listing = await api.get(`/api/projects/${projectId}/files?path=${encodeURIComponent(t.path)}`);
    } catch (_e) { continue; }
    const items = (listing && Array.isArray(listing.items)) ? listing.items : [];
    for (const it of items) {
      if (it.type !== 'file') continue;
      if (!/\.png$/i.test(it.name)) continue;
      const stem = it.name.replace(/\.png$/i, '');
      const rel = `${t.path}/${it.name}`;
      assets.push({
        id: `${t.type}:${stem}`,
        type: t.type,
        name: stem,
        imageUrl: null,
        _rawPath: rel,
        prompt: null,
        model: null,
        ditherAlgo: null,
        createdAt: it.modified ? new Date(it.modified).toISOString() : null,
        state: 'pending'
      });
    }
  }
  return assets;
}

// ----------------------------------------------------------------------------
// Type filter pills — left rail
// ----------------------------------------------------------------------------

const TYPE_FILTERS = [
  { key: 'all',       label: 'all' },
  { key: 'scenes',    label: 'scenes' },
  { key: 'portraits', label: 'portraits' },
  { key: 'sprites',   label: 'sprites' },
  { key: 'cards',     label: 'cards' },
  { key: 'audio',     label: 'audio' }
];

function matchesTypeFilter(asset, filterKey) {
  switch (filterKey) {
    case 'all':       return true;
    case 'scenes':    return asset.type === 'scene';
    case 'portraits': return asset.type === 'portrait';
    case 'sprites':   return false; // no sprite type yet
    case 'cards':     return asset.type === 'launcher' && asset.name === 'card';
    case 'audio':     return false; // backend has no audio assets in /gallery yet
    default:          return true;
  }
}

function FilterPill({ active, label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono uppercase"
      style={{
        appearance: 'none',
        background: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        border: `1px solid ${active ? 'var(--accent-dim)' : 'var(--border)'}`,
        borderRadius: 99,
        padding: '3px 9px',
        fontSize: 10,
        letterSpacing: '.08em',
        cursor: 'pointer',
        lineHeight: 1.4
      }}
    >
      {label}
    </button>
  );
}

// ----------------------------------------------------------------------------
// Left rail — asset list (per .ws-scene + sec rules)
// ----------------------------------------------------------------------------

function AssetThumb({ projectId, asset, w = 60, h = 38 }) {
  const src = resolveImageUrl(projectId, asset);
  return (
    <div
      style={{
        width: w,
        height: h,
        background: 'oklch(85% 0.03 80)',
        borderRadius: 3,
        position: 'relative',
        overflow: 'hidden',
        flex: 'none'
      }}
    >
      {src ? (
        <img
          src={src}
          alt={asset.name}
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            imageRendering: 'pixelated',
            display: 'block'
          }}
        />
      ) : (
        <div style={{
          width: '100%', height: '100%',
          display: 'grid', placeItems: 'center',
          color: 'oklch(50% 0.01 75)'
        }}>
          <ImageIcon style={{ width: 14, height: 14 }} />
        </div>
      )}
    </div>
  );
}

function AssetRow({ projectId, asset, active, onSelect }) {
  const state = asset.state || 'pending';
  return (
    <button
      type="button"
      onClick={() => onSelect(asset.id)}
      title={`${asset.id} · ${state}`}
      style={{
        display: 'grid',
        gridTemplateColumns: '60px 1fr',
        gap: 10,
        padding: '8px 12px 8px 8px',
        margin: '0 8px',
        borderRadius: 'var(--radius-sm)',
        border: `1px solid ${active ? 'var(--border-2)' : 'transparent'}`,
        background: active ? 'var(--surface)' : 'transparent',
        cursor: 'default',
        alignItems: 'center',
        textAlign: 'left',
        appearance: 'none',
        width: 'calc(100% - 16px)'
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--surface)'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'transparent'; }}
    >
      <AssetThumb projectId={projectId} asset={asset} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
        <div
          className="font-ui"
          style={{
            fontSize: 13,
            color: 'var(--text-soft)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {asset.name || asset.id}
        </div>
        <div
          className="font-mono"
          style={{
            fontSize: 10,
            color: 'var(--text-dim)',
            display: 'flex',
            gap: 6,
            alignItems: 'center'
          }}
        >
          <StatusPip status={state} />
          <span>{asset.type || 'asset'}</span>
          <span style={{ color: 'var(--text-faint)' }}>·</span>
          <span>{state}</span>
        </div>
      </div>
    </button>
  );
}

// ----------------------------------------------------------------------------
// Inspector — tabs (prompt / art / audio / code / refs)
// ----------------------------------------------------------------------------

function smallcaps(label) {
  return {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '.12em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)'
  };
}

const PROMPT_TOKEN_RE = /\{([^}]+)\}/g;
const PROMPT_KEYWORD_RE = /\b(crank|B button|A button|d-pad|operator|player|hero|scene|background|portrait)\b/gi;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function promptHtml(txt) {
  if (!txt) return '';
  return escapeHtml(txt)
    .replace(PROMPT_TOKEN_RE,   '<span class="tok">$1</span>')
    .replace(PROMPT_KEYWORD_RE, '<span class="tok-2">$&</span>');
}

const luaCodeFallback =
`-- generated lua not yet wired into /gallery payload
-- this asset's scene_lua will appear here after Patch B/F.
function init()
  scene_manager.push("placeholder")
end`;

function highlightLua(src) {
  const safe = escapeHtml(src);
  return safe
    .replace(/(--[^\n]*)/g, '<span class="cm">$1</span>')
    .replace(/\b(function|local|if|then|else|end|return|true|false|nil|for|do|in|while|repeat|until|break)\b/g,
            '<span class="kw">$1</span>')
    .replace(/&quot;([^&]+)&quot;/g, '<span class="st">"$1"</span>')
    .replace(/\b(\d+\.?\d*)\b/g, '<span class="nm">$1</span>');
}

function InspTab({ active, label, count, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono uppercase"
      style={{
        appearance: 'none',
        border: 0,
        background: 'transparent',
        fontSize: 11,
        letterSpacing: '.08em',
        color: active ? 'var(--text)' : 'var(--text-muted)',
        padding: '12px 12px',
        cursor: 'pointer',
        position: 'relative'
      }}
    >
      {label}
      {count != null ? (
        <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-dim)' }}>{count}</span>
      ) : null}
      {active ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: 12, right: 12, bottom: -1,
            height: 2,
            background: 'var(--accent)'
          }}
        />
      ) : null}
    </button>
  );
}

function InspPrompt({ asset, onRegen }) {
  const prompt = asset.prompt || '(prompt not recorded — sidecar pending in Patch A)';
  const tokens = asset.prompt
    ? [...asset.prompt.matchAll(PROMPT_TOKEN_RE)].map((m) => m[1])
    : [];
  const subject = asset.subject || asset.name || '—';
  const styleLine = asset.style_line || asset.style || '—';
  const directive = asset.universal_directive || 'Playdate-safe 1-bit · 400×240 · pixelated · no antialiasing';

  return (
    <>
      <div style={smallcaps()}>scene prompt · editable</div>
      <div
        className="prompt-edit"
        contentEditable
        suppressContentEditableWarning
        spellCheck={false}
        dangerouslySetInnerHTML={{ __html: promptHtml(prompt) }}
      />

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          onClick={onRegen}
          className="font-ui"
          style={{
            background: 'var(--accent-soft)',
            color: 'var(--accent)',
            border: '1px solid var(--accent-dim)',
            borderRadius: 'var(--radius-sm)',
            padding: '5px 10px',
            fontSize: 12,
            cursor: 'pointer'
          }}
        >
          ↻ Regen this asset
        </button>
        <button
          type="button"
          disabled
          className="font-ui"
          style={{
            background: 'transparent',
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '5px 10px',
            fontSize: 12,
            cursor: 'not-allowed',
            opacity: 0.6
          }}
          title="TODO"
        >
          + token
        </button>
        <button
          type="button"
          disabled
          className="font-ui"
          style={{
            background: 'transparent',
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            padding: '5px 10px',
            fontSize: 12,
            cursor: 'not-allowed',
            opacity: 0.6
          }}
          title="TODO"
        >
          history
        </button>
      </div>

      <div style={{ height: 1, background: 'var(--border)' }} />

      <div style={smallcaps()}>subject</div>
      <p className="font-mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--text-soft)' }}>
        {subject}
      </p>

      <div style={smallcaps()}>style</div>
      <p className="font-mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: 'var(--text-soft)' }}>
        {styleLine}
      </p>

      <div style={smallcaps()}>universal directive</div>
      <p className="font-mono" style={{ margin: 0, fontSize: 11, lineHeight: 1.6, color: 'var(--text-dim)' }}>
        {directive}
      </p>

      <div style={smallcaps()}>tokens detected</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {tokens.length === 0 ? (
          <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>— none —</span>
        ) : tokens.map((tk, i) => (
          <span
            key={i}
            className="font-mono"
            style={{
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 99,
              border: '1px solid var(--accent-dim)',
              background: 'var(--accent-soft)',
              color: 'var(--accent)'
            }}
          >
            {tk}
          </span>
        ))}
      </div>
    </>
  );
}

function refGridCell(children, key) {
  return (
    <div
      key={key}
      style={{
        aspectRatio: '5 / 3',
        background: 'var(--surface)',
        border: '1px dashed var(--border-2)',
        borderRadius: 'var(--radius-sm)',
        display: 'grid',
        placeItems: 'center',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      {children}
    </div>
  );
}

function InspArt({ projectId, asset, variants, references }) {
  const variantCells = [];
  const heroSrc = resolveImageUrl(projectId, asset);
  // variants[] may eventually carry alt picks; for now seed with the
  // hero + any items the backend already returned.
  const items = (Array.isArray(variants) && variants.length > 0) ? variants : [{ src: heroSrc, label: 'hero' }];
  for (let i = 0; i < 3; i++) {
    const v = items[i % items.length];
    variantCells.push(refGridCell(
      v && v.src ? (
        <img
          src={v.src}
          alt={v.label || asset.name}
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            imageRendering: 'pixelated'
          }}
        />
      ) : (
        <ImageIcon style={{ width: 16, height: 16, color: 'var(--text-faint)' }} />
      ),
      `v${i}`
    ));
  }

  const refCells = [];
  const refList = references || [];
  for (let i = 0; i < 3; i++) {
    const r = refList[i];
    if (!r) {
      refCells.push(refGridCell(
        <span className="font-mono" style={{ fontSize: 9, color: 'var(--text-dim)', letterSpacing: '.12em' }}>
          DROP REF
        </span>,
        `r-empty-${i}`
      ));
      continue;
    }
    const url = referenceImageUrl(projectId, r);
    refCells.push(refGridCell(
      url ? (
        <img
          src={url}
          alt={referenceLabel(r)}
          loading="lazy"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
          style={{
            width: '100%', height: '100%', objectFit: 'cover',
            imageRendering: 'pixelated'
          }}
        />
      ) : (
        <span className="font-mono" style={{ fontSize: 9, color: 'var(--text-dim)' }}>{referenceLabel(r)}</span>
      ),
      `r-${i}`
    ));
  }

  return (
    <>
      <div style={smallcaps()}>art variants · 1-bit</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {variantCells}
      </div>
      <div style={smallcaps()}>reference drop</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {refCells}
      </div>
    </>
  );
}

function InspAudio({ asset }) {
  // Stub waveform — purely cosmetic. Real audio plumbing arrives when
  // /gallery starts returning music_bed + sfx for scene assets.
  const wavePath = (sign) => {
    const pts = Array.from({ length: 120 }, (_, i) => {
      const x = i * 2;
      const h = (Math.sin(i * 0.3) * 14 + Math.sin(i * 0.7) * 8 + Math.sin(i * 0.1) * 4) * sign;
      return `L${x} ${(40 + h).toFixed(1)}`;
    }).join(' ');
    return `M0 40 ${pts}`;
  };

  const sfxList = (asset.audio && Array.isArray(asset.audio.sfx)) ? asset.audio.sfx : [];
  const music = asset.audio ? (asset.audio.music || '— no bed —') : '— no audio —';
  const duration = asset.audio ? (asset.audio.duration || 0) : 0;

  return (
    <>
      <div style={smallcaps()}>music bed</div>
      <div
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          height: 80,
          overflow: 'hidden'
        }}
      >
        <svg viewBox="0 0 240 80" preserveAspectRatio="none" style={{ width: '100%', height: '100%', display: 'block' }}>
          <path d={wavePath(1)}  fill="none" stroke="oklch(78% 0.13 75 / .9)" strokeWidth="1" />
          <path d={wavePath(-1)} fill="none" stroke="oklch(78% 0.13 75 / .9)" strokeWidth="1" />
          <line x1="60" y1="0" x2="60" y2="80" stroke="var(--accent)" strokeWidth="1" strokeDasharray="2 2" />
        </svg>
      </div>
      <div className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
        {music} · {duration}s
      </div>

      <div style={smallcaps()}>sfx</div>
      {sfxList.length === 0 ? (
        <p className="font-mono" style={{ margin: 0, fontSize: 11, color: 'var(--text-dim)' }}>
          — no sfx attached —
        </p>
      ) : (
        <div className="font-mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {sfxList.map((s, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                padding: '4px 0',
                borderBottom: i === sfxList.length - 1 ? 0 : '1px dashed var(--border)'
              }}
            >
              <span style={{ color: 'var(--text-dim)' }}>{s}</span>
              <span style={{ color: 'var(--text)' }}>▶</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function InspCode({ asset }) {
  const src = asset.code || asset.lua || luaCodeFallback;
  const lines = src.split('\n');
  return (
    <>
      <div style={smallcaps()}>generated lua · read-only</div>
      <div
        className="code-block"
        style={{
          display: 'grid',
          gridTemplateColumns: 'auto 1fr',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          overflow: 'hidden',
          maxHeight: 400
        }}
      >
        <div
          className="font-mono"
          style={{
            background: 'var(--bg)',
            padding: '14px 8px',
            color: 'var(--text-dim)',
            textAlign: 'right',
            fontSize: 11,
            userSelect: 'none',
            borderRight: '1px solid var(--border)',
            minWidth: 36,
            overflow: 'hidden'
          }}
        >
          {lines.map((_, i) => <div key={i}>{i + 1}</div>)}
        </div>
        <pre
          className="font-mono"
          style={{
            margin: 0,
            padding: '14px 16px',
            minWidth: 0,
            overflowX: 'auto',
            fontSize: 12,
            color: 'var(--text-soft)',
            lineHeight: 1.5
          }}
          dangerouslySetInnerHTML={{ __html: highlightLua(src) }}
        />
      </div>
    </>
  );
}

function InspRefs({ projectId, references, asset, onAdd }) {
  const refs = references || [];
  return (
    <>
      <div style={smallcaps()}>references for this asset</div>
      <p className="font-mono" style={{ margin: 0, fontSize: 11, color: 'var(--text-dim)' }}>
        Pick which references guide the next regen of <b style={{ color: 'var(--text-soft)' }}>{asset.name || asset.id}</b>.
        Final selection is committed via the editor regen panel.
      </p>

      {refs.length === 0 ? (
        <div
          style={{
            border: '1px dashed var(--border-2)',
            borderRadius: 'var(--radius-sm)',
            padding: 18,
            textAlign: 'center',
            color: 'var(--text-muted)',
            fontSize: 12
          }}
        >
          No project references uploaded yet.
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={onAdd}
              className="font-ui"
              style={{
                appearance: 'none',
                background: 'var(--accent)',
                color: 'var(--accent-ink)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Upload references
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {refs.map((r, idx) => {
            const url = referenceImageUrl(projectId, r);
            const label = referenceLabel(r);
            return (
              <label
                key={(typeof r === 'string' ? r : (r?.path || r?.filename || r?.name)) || idx}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '20px 48px 1fr',
                  gap: 10,
                  alignItems: 'center',
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  cursor: 'pointer'
                }}
              >
                <input
                  type="checkbox"
                  defaultChecked
                  disabled
                  title="commit selection via the regen panel"
                  style={{ accentColor: 'var(--accent)' }}
                />
                <div
                  style={{
                    width: 48, height: 30,
                    background: 'oklch(85% 0.03 80)',
                    borderRadius: 3,
                    overflow: 'hidden',
                    display: 'grid', placeItems: 'center'
                  }}
                >
                  {url ? (
                    <img
                      src={url}
                      alt={label}
                      loading="lazy"
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                      style={{
                        width: '100%', height: '100%', objectFit: 'cover',
                        imageRendering: 'pixelated'
                      }}
                    />
                  ) : (
                    <ImageIcon style={{ width: 12, height: 12, color: 'var(--text-faint)' }} />
                  )}
                </div>
                <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-soft)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {label}
                </span>
              </label>
            );
          })}
        </div>
      )}

      <button
        type="button"
        onClick={onAdd}
        className="font-ui"
        style={{
          appearance: 'none',
          background: 'transparent',
          color: 'var(--text)',
          border: '1px solid var(--border-2)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 10px',
          fontSize: 12,
          cursor: 'pointer',
          alignSelf: 'flex-start'
        }}
      >
        + Add reference
      </button>
    </>
  );
}

// ----------------------------------------------------------------------------
// Toast (transient bottom-right msg used for unwired buttons)
// ----------------------------------------------------------------------------

function Toast({ msg, onDismiss }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onDismiss, 2400);
    return () => clearTimeout(t);
  }, [msg, onDismiss]);
  if (!msg) return null;
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        background: 'var(--surface)',
        color: 'var(--text)',
        border: '1px solid var(--border-2)',
        borderRadius: 'var(--radius-sm)',
        padding: '8px 12px',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        boxShadow: '0 6px 18px rgba(0,0,0,.5)',
        zIndex: 60
      }}
    >
      {msg}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Data fetchers (carried over from pass 1)
// ----------------------------------------------------------------------------

async function fetchAssets(projectId) {
  try {
    const r = await api.get(`/api/projects/${projectId}/gallery`);
    if (r && Array.isArray(r.assets) && r.assets.length > 0) {
      return { assets: r.assets, source: 'gallery' };
    }
    if (r && Array.isArray(r.assets)) {
      const fb = await enumerateViaFiles(projectId);
      if (fb.length > 0) return { assets: fb, source: 'files' };
      return { assets: [], source: 'empty' };
    }
  } catch (e) {
    if (!(e && (e.status === 404 || e.status === 501))) {
      console.warn('[gallery] /gallery error', e);
    }
  }
  try {
    const assets = await enumerateViaFiles(projectId);
    return { assets, source: assets.length > 0 ? 'files' : 'empty' };
  } catch (e) {
    console.warn('[gallery] file enumeration failed', e);
    return { assets: [], source: 'empty' };
  }
}

async function fetchReferences(projectId) {
  try {
    const r = await api.get(`/api/projects/${projectId}/references/manifest`);
    if (r && Array.isArray(r.items)) return r.items;
    if (r && typeof r === 'object') {
      const seen = new Set();
      const out = [];
      const push = (name) => {
        if (!name || seen.has(name)) return;
        seen.add(name);
        out.push({ filename: name, name });
      };
      if (Array.isArray(r.default_set)) r.default_set.forEach(push);
      for (const key of ['scene_references', 'portrait_references', 'card_references']) {
        const group = r[key];
        if (group && typeof group === 'object') {
          for (const arr of Object.values(group)) {
            if (Array.isArray(arr)) arr.forEach(push);
          }
        }
      }
      if (out.length > 0) return out;
    }
  } catch (_e) { /* fall through */ }
  try {
    const r = await api.get(`/api/projects/${projectId}/references`);
    if (r && Array.isArray(r.items)) {
      return r.items.map((it) => ({
        path: it.path,
        name: it.name || (it.path && it.path.split('/').pop())
      }));
    }
  } catch (_e) { /* swallow */ }
  return [];
}

// ----------------------------------------------------------------------------
// Main component
// ----------------------------------------------------------------------------

export default function ProjectGallery() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [assets, setAssets] = useState(null);
  const [source, setSource] = useState('empty');
  const [references, setReferences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('all');
  const [activeId, setActiveId] = useState(null);
  const [tab, setTab] = useState('prompt');
  const [editing, setEditing] = useState(null);   // { asset, mode }
  const [fullscreen, setFullscreen] = useState(null);
  const [uploadingRefs, setUploadingRefs] = useState(false);
  const [cardErrors, setCardErrors] = useState({});
  const [toast, setToast] = useState(null);
  const [busy, setBusy] = useState(false);

  const assetsRef = useRef([]);
  useEffect(() => { assetsRef.current = assets || []; }, [assets]);

  // Initial + polling load. Identical merge semantics to design pass 1 so
  // optimistic state isn't clobbered by a stale poll.
  const refresh = useCallback(async (silent) => {
    if (!silent) setLoading(true);
    try {
      const [a, refs] = await Promise.all([
        fetchAssets(id),
        fetchReferences(id)
      ]);
      setReferences(refs);
      if (silent) {
        const cur = assetsRef.current || [];
        const byId = new Map(cur.map((x) => [x.id, x]));
        for (const incoming of a.assets) {
          const prev = byId.get(incoming.id);
          if (!prev) { byId.set(incoming.id, incoming); continue; }
          const prevTs = prev.createdAt ? Date.parse(prev.createdAt) || 0 : 0;
          const newTs = incoming.createdAt ? Date.parse(incoming.createdAt) || 0 : 0;
          if (newTs > prevTs) {
            byId.set(incoming.id, incoming);
          } else {
            byId.set(incoming.id, { ...incoming, state: prev.state || incoming.state });
          }
        }
        const incomingIds = new Set(a.assets.map((x) => x.id));
        const merged = [];
        for (const [aid, v] of byId.entries()) {
          if (incomingIds.has(aid)) merged.push(v);
        }
        setAssets(merged);
        setSource(a.source);
      } else {
        setAssets(a.assets);
        setSource(a.source);
      }
    } catch (e) {
      if (!silent) console.warn('[gallery] refresh failed', e);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setAssets(null);
    setActiveId(null);
    refresh(false);
  }, [refresh]);

  useEffect(() => {
    if (fullscreen) return;
    const handle = setInterval(() => { refresh(true); }, POLL_MS);
    return () => clearInterval(handle);
  }, [refresh, fullscreen]);

  // Filtered list driven by the left rail type pills.
  const visibleAssets = useMemo(() => {
    if (!assets) return [];
    return assets.filter((a) => matchesTypeFilter(a, typeFilter));
  }, [assets, typeFilter]);

  // Auto-pick first visible asset when active id falls out of view.
  useEffect(() => {
    if (!assets || assets.length === 0) return;
    const stillThere = activeId && visibleAssets.some((a) => a.id === activeId);
    if (!stillThere && visibleAssets.length > 0) {
      setActiveId(visibleAssets[0].id);
    } else if (!stillThere && visibleAssets.length === 0) {
      setActiveId(null);
    }
  }, [assets, visibleAssets, activeId]);

  const activeAsset = useMemo(
    () => (activeId ? (assets || []).find((a) => a.id === activeId) || null : null),
    [assets, activeId]
  );

  // Counts for left rail footer
  const counts = useMemo(() => {
    const out = { approved: 0, review: 0, pending: 0 };
    for (const a of (assets || [])) {
      const s = a.state || 'pending';
      if (s === 'approved')      out.approved++;
      else if (s === 'rejected') out.review++; // surface rejected under "in review" rollup
      else                       out.pending++;
    }
    return out;
  }, [assets]);

  // Approve / reject with optimistic state — copied 1:1 from pass 1.
  const handleApprove = useCallback(async (asset) => {
    const prevState = asset.state;
    setAssets((cur) => (cur || []).map((a) =>
      a.id === asset.id ? { ...a, state: 'approved' } : a));
    setCardErrors((m) => { const n = { ...m }; delete n[asset.id]; return n; });
    setBusy(true);
    try {
      const enc = encodeURIComponent(asset.id);
      await api.post(`/api/projects/${id}/gallery/assets/${enc}/approve`, {});
    } catch (e) {
      setAssets((cur) => (cur || []).map((a) =>
        a.id === asset.id ? { ...a, state: prevState } : a));
      const msg = (e && e.detail && (e.detail.error || e.detail.detail)) || e?.message || 'approve failed';
      setCardErrors((m) => ({ ...m, [asset.id]: String(msg) }));
    } finally {
      setBusy(false);
    }
  }, [id]);

  const handleReject = useCallback(async (asset, reason) => {
    const prevState = asset.state;
    setAssets((cur) => (cur || []).map((a) =>
      a.id === asset.id ? { ...a, state: 'rejected' } : a));
    setCardErrors((m) => { const n = { ...m }; delete n[asset.id]; return n; });
    setBusy(true);
    try {
      const enc = encodeURIComponent(asset.id);
      await api.post(`/api/projects/${id}/gallery/assets/${enc}/reject`,
        reason ? { reason } : {});
    } catch (e) {
      setAssets((cur) => (cur || []).map((a) =>
        a.id === asset.id ? { ...a, state: prevState } : a));
      const msg = (e && e.detail && (e.detail.error || e.detail.detail)) || e?.message || 'reject failed';
      setCardErrors((m) => ({ ...m, [asset.id]: String(msg) }));
    } finally {
      setBusy(false);
    }
  }, [id]);

  const handleRegenComplete = useCallback((updatedAsset) => {
    setAssets((cur) => {
      if (!cur || !updatedAsset || !updatedAsset.id) return cur;
      return cur.map((a) => (a.id === updatedAsset.id ? { ...a, ...updatedAsset } : a));
    });
  }, []);

  // Keyboard shortcuts — Backspace=reject, R=regen, Enter=approve.
  // Skip when modal is open or the user is typing in an editable surface.
  useEffect(() => {
    function onKey(e) {
      if (!activeAsset) return;
      if (editing || fullscreen || uploadingRefs) return;
      const t = e.target;
      const tag = (t && t.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (t && t.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Backspace') {
        e.preventDefault();
        handleReject(activeAsset, null);
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        setEditing({ asset: activeAsset, mode: 'regen' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleApprove(activeAsset);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [activeAsset, editing, fullscreen, uploadingRefs, handleApprove, handleReject]);

  if (loading && assets === null) {
    return (
      <div className="flex items-center gap-2 p-6 font-ui" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
        <Loader2 className="w-4 h-4 animate-spin" /> loading workspace…
      </div>
    );
  }

  // Helpers
  const openInEditor = () => {
    if (!activeAsset) return;
    // Pass 3 will register the route — for now log + toast.
    console.log('[workspace] open in editor →', `/projects/${id}/author/gallery/${activeAsset.id}/edit`);
    setToast('TODO — full-page editor lands in pass 3');
  };

  const openFullscreen = () => {
    if (!activeAsset) return;
    setFullscreen(activeAsset);
  };

  const openRegen = () => {
    if (!activeAsset) return;
    setEditing({ asset: activeAsset, mode: 'regen' });
  };

  const openViewPrompt = () => {
    setTab('prompt');
    setToast('Prompt tab opened in inspector →');
  };

  const goShip = () => navigate(`/projects/${id}/release/ship`);

  // counts per inspector tab — only rough; backend doesn't ship these yet.
  const promptCt = activeAsset && activeAsset.prompt ? activeAsset.prompt.length : 0;
  const variantCt = 3;
  const audioCt = (activeAsset && activeAsset.audio && Array.isArray(activeAsset.audio.sfx))
    ? activeAsset.audio.sfx.length : 0;
  const codeCt = 1;
  const refsCt = references.length;

  const stage = (
    <div className="flex flex-col min-w-0" style={{ background: 'var(--bg)' }}>
      {/* Top bar — id + name + tags + actions */}
      <div
        className="flex items-center gap-3.5"
        style={{
          padding: '12px 24px',
          borderBottom: '1px solid var(--border)',
          minHeight: 56
        }}
      >
        {activeAsset ? (
          <>
            <span
              className="font-mono"
              style={{ fontSize: 11, color: 'var(--text-dim)' }}
              title={activeAsset.id}
            >
              {activeAsset.id}
            </span>
            <h2 className="font-ui" style={{ fontSize: 17, fontWeight: 500, margin: 0, letterSpacing: '-.01em' }}>
              {activeAsset.name || activeAsset.id}
            </h2>
            <span
              className="font-mono uppercase"
              style={{
                fontSize: 10,
                padding: '3px 8px',
                borderRadius: 99,
                background: 'var(--accent-soft)',
                color: 'var(--accent)',
                border: '1px solid var(--accent-dim)',
                letterSpacing: '.08em'
              }}
            >
              {activeAsset.type || 'asset'}
            </span>
            {activeAsset.model ? (
              <span
                className="font-mono"
                style={{
                  fontSize: 10,
                  padding: '3px 8px',
                  borderRadius: 99,
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  border: '1px solid var(--border)',
                  letterSpacing: '.04em'
                }}
              >
                {activeAsset.model}
              </span>
            ) : null}
          </>
        ) : (
          <span className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            no asset selected
          </span>
        )}
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openFullscreen}
            disabled={!activeAsset}
            className="font-ui"
            style={{
              appearance: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              border: 0,
              padding: '5px 10px',
              fontSize: 12,
              cursor: activeAsset ? 'pointer' : 'not-allowed',
              opacity: activeAsset ? 1 : 0.4,
              borderRadius: 'var(--radius-sm)'
            }}
            title="fullscreen"
          >
            <Maximize2 className="w-3 h-3 inline-block mr-1" />
            fullscreen
          </button>
          <button
            type="button"
            onClick={openInEditor}
            disabled={!activeAsset}
            className="font-ui"
            style={{
              appearance: 'none',
              background: 'transparent',
              color: 'var(--text)',
              border: '1px solid var(--border-2)',
              padding: '5px 10px',
              fontSize: 12,
              cursor: activeAsset ? 'pointer' : 'not-allowed',
              opacity: activeAsset ? 1 : 0.4,
              borderRadius: 'var(--radius-sm)'
            }}
          >
            Open in editor →
          </button>
          <button
            type="button"
            onClick={openViewPrompt}
            disabled={!activeAsset}
            className="font-ui"
            style={{
              appearance: 'none',
              background: 'transparent',
              color: 'var(--text-muted)',
              border: 0,
              padding: '5px 10px',
              fontSize: 12,
              cursor: activeAsset ? 'pointer' : 'not-allowed',
              opacity: activeAsset ? 1 : 0.4,
              borderRadius: 'var(--radius-sm)'
            }}
          >
            View prompt
          </button>
        </div>
      </div>

      {/* Stage area — Handheld */}
      <div
        className="flex-1 grid place-items-center"
        style={{ padding: 24, minHeight: 0 }}
      >
        {activeAsset ? (
          <Handheld scale={1.4}>
            {(() => {
              const src = resolveImageUrl(id, activeAsset);
              if (src) {
                return (
                  <img
                    src={src}
                    alt={activeAsset.name}
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    style={{
                      width: '100%', height: '100%',
                      objectFit: 'contain',
                      imageRendering: 'pixelated',
                      display: 'block',
                      background: 'oklch(85% 0.03 80)'
                    }}
                  />
                );
              }
              return (
                <div style={{
                  width: '100%', height: '100%',
                  display: 'grid', placeItems: 'center',
                  color: 'oklch(40% 0.01 75)',
                  fontFamily: 'var(--font-mono)', fontSize: 11
                }}>
                  no image
                </div>
              );
            })()}
          </Handheld>
        ) : (
          <div className="font-mono" style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            pick an asset on the left to begin
          </div>
        )}
      </div>

      {/* Thumbstrip */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          padding: '10px 24px 14px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-2)',
          overflowX: 'auto'
        }}
      >
        {visibleAssets.length === 0 ? (
          <div className="font-mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
            no assets in this filter
          </div>
        ) : visibleAssets.map((a) => {
          const isActive = a.id === activeId;
          const src = resolveImageUrl(id, a);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => setActiveId(a.id)}
              title={`${a.name || a.id} · ${a.state || 'pending'}`}
              style={{
                flex: 'none',
                width: 76,
                height: 48,
                background: 'oklch(85% 0.03 80)',
                borderRadius: 3,
                position: 'relative',
                overflow: 'hidden',
                border: `1px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
                boxShadow: isActive ? '0 0 0 2px var(--accent-soft)' : 'none',
                padding: 0,
                cursor: 'pointer'
              }}
            >
              {src ? (
                <img
                  src={src}
                  alt={a.name || a.id}
                  loading="lazy"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  style={{
                    width: '100%', height: '100%',
                    objectFit: 'cover',
                    imageRendering: 'pixelated',
                    display: 'block'
                  }}
                />
              ) : null}
              <span
                className="font-mono"
                style={{
                  position: 'absolute',
                  bottom: 1, right: 3,
                  fontSize: 9,
                  color: 'oklch(20% 0.01 75)',
                  background: 'oklch(85% 0.03 80)',
                  padding: '0 2px'
                }}
              >
                {a.type ? a.type[0].toUpperCase() : '?'}
              </span>
            </button>
          );
        })}
      </div>

      {/* Action bar — reject / regen / approve with kbd hints */}
      <div
        className="flex items-center gap-2.5"
        style={{
          borderTop: '1px solid var(--border)',
          padding: '14px 24px',
          background: 'var(--bg-2)'
        }}
      >
        {cardErrors[activeAsset?.id] ? (
          <span
            className="font-mono inline-flex items-center gap-1"
            style={{ color: 'var(--danger)', fontSize: 11 }}
          >
            <AlertCircle className="w-3 h-3" /> {cardErrors[activeAsset.id]}
          </span>
        ) : (
          <span className="font-mono" style={{ color: 'var(--text-dim)', fontSize: 11 }}>
            rev {(activeAsset && activeAsset.revs) || 0} · {(activeAsset && activeAsset.refs) || references.length} refs
          </span>
        )}
        <div className="flex-1 flex justify-center items-center gap-2.5">
          <ActionButton
            kind="reject"
            label="Reject"
            kbd="⌫"
            onClick={() => activeAsset && handleReject(activeAsset, null)}
            disabled={!activeAsset || busy || activeAsset.state === 'rejected'}
          />
          <ActionButton
            kind="regen"
            label="Regenerate"
            kbd="R"
            onClick={openRegen}
            disabled={!activeAsset || busy}
          />
          <ActionButton
            kind="accept"
            label="Approve"
            kbd="↵"
            onClick={() => activeAsset && handleApprove(activeAsset)}
            disabled={!activeAsset || busy || activeAsset.state === 'approved'}
          />
        </div>
        <span className="font-mono" style={{ color: 'var(--text-dim)', fontSize: 11, width: 90, textAlign: 'right' }}>
          {visibleAssets.length}/{(assets || []).length}
        </span>
      </div>
    </div>
  );

  const inspector = (
    <div
      className="flex flex-col"
      style={{
        borderLeft: '1px solid var(--border)',
        background: 'var(--bg-2)',
        overflowY: 'auto'
      }}
    >
      <div
        className="flex"
        style={{
          padding: '0 12px',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg)'
        }}
      >
        <InspTab active={tab === 'prompt'} label="prompt" count={promptCt} onClick={() => setTab('prompt')} />
        <InspTab active={tab === 'art'}    label="art"    count={variantCt} onClick={() => setTab('art')} />
        <InspTab active={tab === 'audio'}  label="audio"  count={audioCt}   onClick={() => setTab('audio')} />
        <InspTab active={tab === 'code'}   label="code"   count={codeCt}    onClick={() => setTab('code')} />
        <InspTab active={tab === 'refs'}   label="refs"   count={refsCt}    onClick={() => setTab('refs')} />
      </div>
      <div
        className="flex flex-col"
        style={{ padding: 16, gap: 18, minHeight: 0 }}
      >
        {!activeAsset ? (
          <div className="font-mono" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
            select an asset to inspect.
          </div>
        ) : tab === 'prompt' ? (
          <InspPrompt asset={activeAsset} onRegen={openRegen} />
        ) : tab === 'art' ? (
          <InspArt projectId={id} asset={activeAsset} variants={activeAsset.variants} references={references} />
        ) : tab === 'audio' ? (
          <InspAudio asset={activeAsset} />
        ) : tab === 'code' ? (
          <InspCode asset={activeAsset} />
        ) : (
          <InspRefs projectId={id} references={references} asset={activeAsset} onAdd={() => setUploadingRefs(true)} />
        )}
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        .prompt-edit {
          border: 1px solid var(--border-2);
          background: var(--surface);
          border-radius: var(--radius-sm);
          padding: 12px;
          font-family: var(--font-mono);
          font-size: 12px;
          color: var(--text-soft);
          line-height: 1.6;
          min-height: 110px;
          white-space: pre-wrap;
          outline: none;
        }
        .prompt-edit:focus { border-color: var(--accent-dim); }
        .prompt-edit .tok   { color: var(--accent);   background: var(--accent-soft);             padding: 0 3px; border-radius: 2px; }
        .prompt-edit .tok-2 { color: var(--phosphor); background: oklch(85% 0.20 145 / .12);      padding: 0 3px; border-radius: 2px; }
        .code-block .kw  { color: oklch(74% 0.14 245); }
        .code-block .st  { color: oklch(76% 0.13 145); }
        .code-block .cm  { color: var(--text-dim); font-style: italic; }
        .code-block .nm  { color: var(--accent); }
      `}</style>

      <div
        className="grid"
        style={{
          gridTemplateColumns: '240px minmax(0, 1fr) 360px',
          height: 'calc(100vh - 52px - 33px)' // topbar 52 + chips strip ~33
        }}
      >
        {/* LEFT — assets rail */}
        <div
          className="flex flex-col"
          style={{
            borderRight: '1px solid var(--border)',
            background: 'var(--bg-2)',
            overflowY: 'auto'
          }}
        >
          <div
            className="flex flex-wrap gap-1.5"
            style={{
              padding: '14px 12px 10px',
              borderBottom: '1px dashed var(--border)'
            }}
          >
            {TYPE_FILTERS.map((f) => (
              <FilterPill
                key={f.key}
                active={typeFilter === f.key}
                label={f.label}
                onClick={() => setTypeFilter(f.key)}
              />
            ))}
          </div>

          <div
            className="flex justify-between font-mono uppercase"
            style={{
              padding: '12px 16px 6px',
              fontSize: 10,
              letterSpacing: '.12em',
              color: 'var(--text-dim)'
            }}
          >
            <span>{typeFilter === 'all' ? 'assets' : typeFilter}</span>
            <span style={{ color: 'var(--text-faint)' }}>
              {visibleAssets.length}/{(assets || []).length}
            </span>
          </div>

          <div className="flex flex-col" style={{ gap: 2, paddingBottom: 8 }}>
            {visibleAssets.length === 0 ? (
              <div
                className="font-mono"
                style={{
                  margin: 12,
                  padding: '20px 12px',
                  textAlign: 'center',
                  border: '1px dashed var(--border-2)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-dim)',
                  fontSize: 11,
                  lineHeight: 1.6
                }}
              >
                {typeFilter === 'sprites'
                  ? 'no sprites yet — sprite assets land when the storyboard stage emits them.'
                  : typeFilter === 'audio'
                  ? 'no audio assets in /gallery yet — sfx + music wiring pending.'
                  : 'no assets match this filter.'}
              </div>
            ) : visibleAssets.map((a) => (
              <AssetRow
                key={a.id || `${a.type}:${a.name}`}
                projectId={id}
                asset={a}
                active={a.id === activeId}
                onSelect={setActiveId}
              />
            ))}
          </div>

          <div style={{ flex: 1 }} />

          <div
            className="font-mono"
            style={{
              padding: '12px 16px',
              borderTop: '1px dashed var(--border)',
              fontSize: 10,
              color: 'var(--text-muted)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--border)' }}>
              <span style={{ color: 'var(--text-dim)' }}>approved</span>
              <span style={{ color: 'var(--ok)' }}>{counts.approved}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px dashed var(--border)' }}>
              <span style={{ color: 'var(--text-dim)' }}>in review</span>
              <span style={{ color: 'var(--accent)' }}>{counts.review}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
              <span style={{ color: 'var(--text-dim)' }}>pending</span>
              <span style={{ color: 'var(--text)' }}>{counts.pending}</span>
            </div>
            <button
              type="button"
              onClick={goShip}
              className="font-ui"
              style={{
                width: '100%',
                marginTop: 10,
                appearance: 'none',
                background: 'var(--accent)',
                color: 'var(--accent-ink)',
                border: '1px solid var(--accent)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 12px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8
              }}
            >
              <Rocket className="w-3 h-3" />
              Ship build
              <span
                className="font-mono"
                style={{
                  marginLeft: 4,
                  fontSize: 9,
                  padding: '1px 5px',
                  borderRadius: 3,
                  background: 'rgba(0,0,0,.18)',
                  color: 'var(--accent-ink)',
                  border: '1px solid transparent'
                }}
              >
                ⌘S
              </span>
            </button>
          </div>
        </div>

        {/* CENTER — stage */}
        {stage}

        {/* RIGHT — inspector */}
        {inspector}
      </div>

      {source === 'files' ? (
        <p className="font-mono" style={{ padding: '4px 16px', color: 'var(--accent)', fontSize: 11 }}>
          Backend gallery API not yet live — showing best-effort listing from sdk_data/.
        </p>
      ) : null}

      {/* Fullscreen modal — simple dimming overlay around the same Handheld. */}
      {fullscreen ? (
        <div
          role="dialog"
          aria-modal="true"
          onClick={() => setFullscreen(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,.78)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 70,
            padding: 32
          }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'relative' }}>
            <Handheld scale={2.2}>
              {(() => {
                const src = resolveImageUrl(id, fullscreen);
                if (!src) return null;
                return (
                  <img
                    src={src}
                    alt={fullscreen.name}
                    style={{
                      width: '100%', height: '100%',
                      objectFit: 'contain',
                      imageRendering: 'pixelated',
                      display: 'block',
                      background: 'oklch(85% 0.03 80)'
                    }}
                  />
                );
              })()}
            </Handheld>
            <button
              type="button"
              onClick={() => setFullscreen(null)}
              style={{
                position: 'absolute',
                top: -36, right: 0,
                appearance: 'none',
                background: 'transparent',
                color: 'var(--text)',
                border: '1px solid var(--border-2)',
                borderRadius: 'var(--radius-sm)',
                padding: '5px 10px',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 6
              }}
            >
              <XIcon className="w-3 h-3" /> close
            </button>
          </div>
        </div>
      ) : null}

      {editing ? (
        <AssetEditModal
          projectId={id}
          asset={editing.asset}
          onClose={() => setEditing(null)}
          onRegenComplete={(updated) => {
            if (updated) handleRegenComplete(updated);
            setEditing(null);
          }}
        />
      ) : null}

      {uploadingRefs ? (
        <ReferenceUploadModal
          projectId={id}
          onClose={() => setUploadingRefs(false)}
          onUploadComplete={() => { refresh(true); }}
        />
      ) : null}

      <Toast msg={toast} onDismiss={() => setToast(null)} />
    </>
  );
}

// ----------------------------------------------------------------------------
// ActionButton — green/amber/red mini variant of design `.btn.{accept|regen|reject}`
// ----------------------------------------------------------------------------

function ActionButton({ kind, label, kbd, onClick, disabled }) {
  const palette = {
    accept: {
      bg:    'oklch(74% 0.14 145 / .15)',
      bgH:   'oklch(74% 0.14 145 / .25)',
      fg:    'var(--ok)',
      bd:    'oklch(50% 0.10 145)',
      kbdBg: 'oklch(74% 0.14 145 / .12)'
    },
    reject: {
      bg:    'oklch(64% 0.18 25 / .12)',
      bgH:   'oklch(64% 0.18 25 / .22)',
      fg:    'var(--danger)',
      bd:    'oklch(50% 0.15 25)',
      kbdBg: 'oklch(64% 0.18 25 / .12)'
    },
    regen: {
      bg:    'var(--accent-soft)',
      bgH:   'oklch(78% 0.13 75 / .28)',
      fg:    'var(--accent)',
      bd:    'var(--accent-dim)',
      kbdBg: 'oklch(78% 0.13 75 / .12)'
    }
  }[kind];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="font-ui"
      style={{
        appearance: 'none',
        background: palette.bg,
        color: palette.fg,
        border: `1px solid ${palette.bd}`,
        borderRadius: 'var(--radius-sm)',
        padding: '8px 16px',
        fontSize: 13,
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        minWidth: 116,
        justifyContent: 'center'
      }}
      onMouseEnter={(e) => { if (!disabled) e.currentTarget.style.background = palette.bgH; }}
      onMouseLeave={(e) => { if (!disabled) e.currentTarget.style.background = palette.bg; }}
    >
      {kind === 'accept' ? <Check className="w-3 h-3" /> :
       kind === 'reject' ? <XIcon className="w-3 h-3" /> :
       <RefreshCw className="w-3 h-3" />}
      {label}
      <span
        className="font-mono"
        style={{
          marginLeft: 4,
          fontSize: 10,
          padding: '1px 6px',
          borderRadius: 3,
          background: palette.kbdBg,
          color: palette.fg,
          border: `1px solid ${palette.bd}`
        }}
      >
        {kbd}
      </span>
    </button>
  );
}
