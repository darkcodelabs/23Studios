import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Gamepad2, Image as ImageIcon, Layers, Users, Package,
  Download, PlayCircle, BookOpen, GitBranch
} from 'lucide-react';
import { api } from '../lib/api.js';

// Studio shelf card. Sized like a marketing tile, not an admin row:
// hero art on top, title + bylines underneath, stat pills, last-build
// stamp, and a row of game-studio actions (Open / Storyboard / Releases /
// Sim). Hover lifts the whole tile with an accent ring + dither overlay.
//
// Reads card meta lazily from /api/projects/:id/card_meta — backend is
// best-effort, returns nulls when the project hasn't built/scene'd yet.

const STATUS_DOT = {
  active: 'bg-accent',
  paused: 'bg-yellow-300',
  archived: 'bg-ink-500'
};

function prefixed(url) {
  if (typeof url !== 'string' || !url.startsWith('/')) return url;
  const b = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
  return b ? b + url : url;
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return Math.round(n / 1024) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function formatRelative(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return null;
  const d = Date.now() - ts;
  if (d < 0) return 'just now';
  const m = Math.floor(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const days = Math.floor(h / 24);
  if (days < 30) return days + 'd ago';
  const months = Math.floor(days / 30);
  if (months < 12) return months + 'mo ago';
  return Math.floor(months / 12) + 'y ago';
}

// Deterministic-ish accent hue per project so the fallback tiles read as
// distinct shelf items without a real cover. 1-bit dither feel via inline
// SVG so it adapts to whatever theme accent is active.
function fallbackHueFor(id) {
  const s = String(id || 'x');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function FallbackHero({ project }) {
  const hue = fallbackHueFor(project.id);
  // Inline SVG: solid colored backdrop + 1-bit dither dots + project name.
  // No external assets — keeps CSP tight and renders instantly.
  const name = (project.name || project.id || 'untitled').slice(0, 40);
  return (
    <div className="relative w-full h-full overflow-hidden">
      <div
        className="absolute inset-0"
        style={{ background: `linear-gradient(135deg, hsl(${hue} 35% 14%) 0%, hsl(${(hue + 40) % 360} 30% 8%) 100%)` }}
      />
      <svg
        className="absolute inset-0 w-full h-full pixelated opacity-40"
        viewBox="0 0 60 40"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <defs>
          <pattern id={`dither-${project.id}`} x="0" y="0" width="4" height="4" patternUnits="userSpaceOnUse">
            <rect width="4" height="4" fill="transparent" />
            <rect x="0" y="0" width="1" height="1" fill="currentColor" />
            <rect x="2" y="2" width="1" height="1" fill="currentColor" />
          </pattern>
        </defs>
        <rect width="60" height="40" fill={`url(#dither-${project.id})`} className="text-accent" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-4">
        <div className="font-mono text-[10px] tracking-[0.3em] uppercase text-ink-400 mb-1">
          23 Studios
        </div>
        <div className="font-mono text-base text-ink-100 break-words leading-tight max-w-[80%]">
          {name}
        </div>
        <div className="mt-2 inline-flex items-center gap-1 text-[10px] text-ink-500 font-mono uppercase tracking-widest">
          <ImageIcon className="w-3 h-3" /> no cover
        </div>
      </div>
    </div>
  );
}

export default function StudioShelfCard({ project }) {
  const [meta, setMeta] = useState(null);
  const [heroError, setHeroError] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(`/api/projects/${project.id}/card_meta`)
      .then((r) => { if (alive) setMeta(r); })
      .catch(() => { if (alive) setMeta({}); });
    return () => { alive = false; };
  }, [project.id]);

  const href = project.game_type === 'pulp'
    ? `/project/${project.id}/edit`
    : `/project/${project.id}`;
  const storyboardHref = `/project/${project.id}/storyboard`;
  const releasesHref = `/project/${project.id}/releases`;
  const simHref = project.game_type === 'sdk'
    ? `/project/${project.id}/sdk/play`
    : `/project/${project.id}/pulp/play`;

  const statusDot = STATUS_DOT[project.status] || 'bg-ink-400';
  const heroUrl = useMemo(
    () => (meta && meta.title_image_url && !heroError ? prefixed(meta.title_image_url) : null),
    [meta, heroError]
  );

  const sceneCount = meta && Number.isFinite(meta.scene_count) ? meta.scene_count : null;
  const charCount = meta && Number.isFinite(meta.character_count) ? meta.character_count : null;
  const version = meta && meta.version ? meta.version : null;
  const buildSize = meta ? formatBytes(meta.last_build_size) : null;
  const buildRel = meta ? formatRelative(meta.last_build_at) : null;

  return (
    <article
      className="group relative flex flex-col rounded-xl bg-ink-900 ring-1 ring-ink-800
                 hover:ring-accent/40 hover:shadow-[0_0_0_3px_rgba(157,255,206,0.06)]
                 transition-all duration-150 overflow-hidden"
    >
      {/* hero — full-width 3:2, smooth render so original art shows
          without nearest-neighbor crush. Dithered Playdate-ready PNGs
          still look right under smooth scaling because dither is the
          art, not the rendering. */}
      <Link to={href} className="block relative" aria-label={`Open ${project.name}`}>
        <div className="relative w-full aspect-[3/2] bg-ink-800 overflow-hidden">
          {heroUrl ? (
            <img
              src={heroUrl}
              alt={`${project.name} title screen`}
              loading="lazy"
              onError={() => setHeroError(true)}
              className="absolute inset-0 w-full h-full object-cover
                         transition-transform duration-200 group-hover:scale-[1.02]"
            />
          ) : (
            <FallbackHero project={project} />
          )}
          {/* subtle dither overlay on hover so the tile feels 1-bit */}
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-30 transition-opacity duration-150 pointer-events-none mix-blend-overlay"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 3px)'
            }}
          />
          {/* status dot in corner */}
          <div className="absolute top-2 right-2 inline-flex items-center gap-1.5 bg-ink-900/70 backdrop-blur-sm rounded-full px-2 py-0.5">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${statusDot}`} />
            <span className="text-[10px] text-ink-200 font-mono uppercase tracking-wider">
              {project.status || 'active'}
            </span>
          </div>
          {/* version stamp */}
          {version ? (
            <div className="absolute top-2 left-2 bg-ink-900/70 backdrop-blur-sm rounded-full px-2 py-0.5 font-mono text-[10px] text-accent">
              v{version}
            </div>
          ) : null}
        </div>
      </Link>

      {/* body */}
      <div className="flex flex-col flex-1 p-4 gap-3">
        <div>
          <Link to={href} className="block">
            <h3 className="text-base text-ink-100 tracking-tight leading-snug truncate group-hover:text-accent transition-colors">
              {project.name}
            </h3>
          </Link>
          <div className="mt-0.5 text-[11px] text-ink-500 font-mono uppercase tracking-wider flex items-center gap-1.5 truncate">
            {project.developer ? <span>{project.developer}</span> : <span>23 Studios</span>}
            <span className="text-ink-700">·</span>
            <span>{project.publisher || '23 Studios'}</span>
          </div>
        </div>

        {project.description ? (
          <p className="text-xs text-ink-400 leading-relaxed line-clamp-3">
            {project.description}
          </p>
        ) : (
          <p className="text-xs text-ink-600 italic">no synopsis yet</p>
        )}

        {/* stat pills row — scenes · characters · vX.Y.Z · build size */}
        <div className="flex flex-wrap gap-1.5">
          <StatPill icon={Layers} label={sceneCount != null ? `${sceneCount} scenes` : 'scenes —'} />
          <StatPill icon={Users} label={charCount != null ? `${charCount} chars` : 'chars —'} />
          {buildSize ? (
            <StatPill icon={Package} label={buildSize} />
          ) : (
            <StatPill icon={Package} label="not built" muted />
          )}
          <StatPill icon={Gamepad2} label={project.platform || 'playdate'} />
        </div>

        {/* last build stamp + repo hint */}
        <div className="flex items-center gap-2 text-[10px] text-ink-500 font-mono">
          {buildRel ? (
            <span className="inline-flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-accent/70 inline-block" />
              built {buildRel}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-ink-600">
              <span className="w-1 h-1 rounded-full bg-ink-600 inline-block" />
              never built
            </span>
          )}
          {project.repo ? (
            <span className="inline-flex items-center gap-1 truncate min-w-0">
              <span className="text-ink-700">·</span>
              <GitBranch className="w-3 h-3" />
              <span className="truncate">{project.repo.replace(/^https?:\/\/github\.com\//, '')}</span>
            </span>
          ) : null}
        </div>

        {/* action row — Open / Storyboard / Releases / Sim */}
        <div className="mt-auto pt-2 flex flex-wrap items-center gap-1.5 border-t border-ink-800">
          <Link
            to={href}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-accent/10 text-accent text-xs hover:bg-accent/20 transition-colors"
          >
            <PlayCircle className="w-3.5 h-3.5" /> Open
          </Link>
          <Link
            to={storyboardHref}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-ink-300 text-xs hover:bg-ink-800/60 hover:text-ink-100 transition-colors"
            title="Storyboard"
          >
            <BookOpen className="w-3.5 h-3.5" /> Storyboard
          </Link>
          <Link
            to={releasesHref}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-ink-300 text-xs hover:bg-ink-800/60 hover:text-ink-100 transition-colors"
            title="Releases"
          >
            <Package className="w-3.5 h-3.5" /> Releases
          </Link>
          <Link
            to={simHref}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-ink-300 text-xs hover:bg-ink-800/60 hover:text-ink-100 transition-colors"
            title="Simulator"
          >
            <Gamepad2 className="w-3.5 h-3.5" /> Sim
          </Link>
          <div className="flex-1" />
          {meta && meta.latest_pdx_zip_url ? (
            <a
              href={prefixed(meta.latest_pdx_zip_url)}
              download
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md text-ink-300 text-xs hover:bg-ink-800/60 hover:text-ink-100 transition-colors"
              title={buildSize ? `download .pdx (${buildSize})` : 'download .pdx'}
            >
              <Download className="w-3.5 h-3.5" /> .pdx
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function StatPill({ icon: Icon, label, muted }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] leading-none ${
      muted ? 'bg-ink-800/40 text-ink-500' : 'bg-ink-800/60 text-ink-200'
    }`}>
      {Icon ? <Icon className="w-3 h-3" /> : null}
      <span className="font-mono">{label}</span>
    </span>
  );
}
