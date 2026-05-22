import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Loader2, BookOpen, Users, Layers, AlertTriangle,
  ChevronRight, FileText, Sparkles,
} from 'lucide-react';
import { api } from '../lib/api.js';

// Brief — Phase 4.7 bible-derived overview surface.
//
// Replaces the legacy three-concept ConceptPicker re-export. Reads the
// authoritative parsed bible (GET /api/projects/:id/bible/parsed) and
// renders a one-page summary: logline, setting, the three principal cast
// members, the four acts with beat counts + length targets, a cast strip
// (first 6 NPCs), and the coda when present.
//
// If no bible is on disk yet the page steers the user to /bible-builder.
// Route: /projects/:id/author/brief

function SectionTitle({ icon: Icon, children, sub }) {
  return (
    <div className="flex items-baseline gap-2 mb-2">
      {Icon && <Icon size={14} className="text-ink-500 translate-y-0.5" />}
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">{children}</h2>
      {sub && <span className="text-[11px] text-ink-600">{sub}</span>}
    </div>
  );
}

function PrincipalCard({ kind, name, voice, body }) {
  const tints = {
    protagonist: 'border-emerald-700/60 bg-emerald-950/20',
    antagonist:  'border-red-700/60 bg-red-950/20',
    mentor:      'border-blue-700/60 bg-blue-950/20',
  };
  return (
    <div className={`rounded-lg border p-4 space-y-2 ${tints[kind] || 'border-ink-800 bg-ink-900'}`}>
      <div className="flex items-center gap-2">
        <Users size={14} className="text-ink-500" />
        <span className="text-[10px] uppercase tracking-wider text-ink-400">{kind}</span>
      </div>
      <h3 className="text-sm font-semibold text-ink-100">{name || '—'}</h3>
      {voice && <p className="text-xs text-ink-400 italic line-clamp-2">{voice}</p>}
      {body && <p className="text-xs text-ink-300 leading-relaxed line-clamp-4">{body}</p>}
    </div>
  );
}

function ActCard({ act }) {
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900 p-4 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-100">
          Act {act.number}: {(act.name || '').replace(/^the\s+/i, (s) => s)}
        </h3>
        {act.length_target && (
          <span className="text-[11px] text-ink-500 font-mono whitespace-nowrap">{act.length_target}</span>
        )}
      </div>
      {act.setup && <p className="text-xs text-ink-400 line-clamp-3">{act.setup}</p>}
      <div className="flex items-center gap-3 text-[11px] text-ink-500 pt-1">
        <span className="flex items-center gap-1">
          <Layers size={11} />
          {act.beats.length} beat{act.beats.length === 1 ? '' : 's'}
        </span>
        {act.close && (
          <span className="truncate text-ink-600">
            <span className="text-ink-500">close:</span> {act.close.slice(0, 60)}…
          </span>
        )}
      </div>
    </div>
  );
}

function CastChip({ npc }) {
  // 32x32 placeholder portrait — initials in a circle, until pulp_portraits
  // actually generates the bible-aligned NPC art.
  const initials = (npc.name || '?')
    .split(/\s+/).map((w) => w[0]).filter(Boolean).join('').slice(0, 2).toUpperCase();
  return (
    <div className="flex flex-col items-center gap-1 w-20">
      <div className="w-12 h-12 rounded-full bg-ink-800 border border-ink-700 flex items-center justify-center text-[11px] font-mono text-ink-300">
        {initials}
      </div>
      <span className="text-[11px] text-ink-200 text-center line-clamp-1 w-full" title={npc.name}>{npc.name}</span>
      <span className="text-[10px] text-ink-500 text-center uppercase tracking-wide">{npc.role || 'npc'}</span>
    </div>
  );
}

export default function Brief() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [bible, setBible] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get(`/api/projects/${id}/bible/parsed`);
      setBible(r);
    } catch (e) {
      if (e.status === 404) {
        setErr('no_bible');
      } else {
        setErr(e.detail?.error || e.message || 'failed to load');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-ink-500 text-sm">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> loading brief…
      </div>
    );
  }

  if (err === 'no_bible') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <BookOpen size={28} className="text-ink-600" />
        <div>
          <h2 className="text-sm font-semibold text-ink-200">No story bible yet</h2>
          <p className="text-xs text-ink-500 mt-1 max-w-md">
            The Brief is derived from your story bible. Paste a rich source
            bible into the builder and the parser will split it into the
            modular sections the autopilot consumes.
          </p>
        </div>
        <Link
          to={`/projects/${id}/bible-builder`}
          className="inline-flex items-center gap-1 px-4 py-2 rounded-md bg-blue-700 hover:bg-blue-600 text-white text-sm"
        >
          <Sparkles size={14} /> Open Bible Builder
        </Link>
      </div>
    );
  }

  if (err) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 text-ink-400 text-sm">
        <AlertTriangle size={20} className="text-red-400" />
        <p className="text-red-400">{err}</p>
        <button onClick={load} className="text-blue-400 hover:text-blue-300 underline">retry</button>
      </div>
    );
  }

  if (!bible) return null;

  const protagonist = bible.protagonist || {};
  const antagonist = bible.antagonist || {};
  const mentor = bible.mentor || {};
  const cast = (bible.cast || []).slice(0, 6);
  const acts = bible.acts || [];

  return (
    <div className="overflow-y-auto h-full bg-ink-950">
      <div className="max-w-5xl mx-auto px-6 py-8 space-y-8">
        {/* Header / logline */}
        <header className="space-y-3">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-ink-500">
            <FileText size={12} />
            Brief
            <ChevronRight size={11} className="text-ink-700" />
            <Link
              to={`/projects/${id}/author/bible`}
              className="text-ink-500 hover:text-ink-300"
            >
              Story Bible
            </Link>
            <ChevronRight size={11} className="text-ink-700" />
            <Link
              to={`/projects/${id}/bible-builder`}
              className="text-ink-500 hover:text-ink-300"
            >
              Builder
            </Link>
          </div>
          {bible.logline ? (
            <p className="text-lg md:text-xl font-medium text-ink-100 leading-snug max-w-3xl">
              {bible.logline}
            </p>
          ) : (
            <p className="text-sm text-ink-500 italic">No logline set in bible.</p>
          )}
        </header>

        {/* Setting block */}
        {bible.setting && (
          <section>
            <SectionTitle icon={BookOpen}>Setting</SectionTitle>
            <p className="text-sm text-ink-300 leading-relaxed max-w-3xl">{bible.setting}</p>
          </section>
        )}

        {/* Principals — 3 cards */}
        <section>
          <SectionTitle icon={Users}>Principals</SectionTitle>
          <div className="grid gap-3 md:grid-cols-3">
            <PrincipalCard
              kind="protagonist"
              name={protagonist.name || 'Protagonist'}
              voice={protagonist.voice}
              body={protagonist.description}
            />
            <PrincipalCard
              kind="antagonist"
              name={antagonist.name}
              voice={antagonist.voice}
              body={antagonist.description}
            />
            <PrincipalCard
              kind="mentor"
              name={mentor.real_name}
              voice={mentor.voice_pre_reveal}
              body={mentor.description}
            />
          </div>
        </section>

        {/* Acts overview — up to 4 cards */}
        {acts.length > 0 && (
          <section>
            <SectionTitle icon={Layers} sub={`${acts.length} act${acts.length === 1 ? '' : 's'}`}>
              Acts
            </SectionTitle>
            <div className="grid gap-3 md:grid-cols-2">
              {acts.map((a) => <ActCard key={a.id} act={a} />)}
            </div>
          </section>
        )}

        {/* Cast preview — first 6 */}
        {cast.length > 0 && (
          <section>
            <SectionTitle icon={Users} sub={`showing ${cast.length} of ${bible.cast.length}`}>
              Cast preview
            </SectionTitle>
            <div className="flex gap-4 flex-wrap">
              {cast.map((c, i) => <CastChip key={c.name + i} npc={c} />)}
            </div>
            {bible.cast.length > 6 && (
              <Link
                to={`/projects/${id}/author/bible`}
                className="inline-block mt-3 text-xs text-blue-400 hover:text-blue-300"
              >
                See full cast in bible →
              </Link>
            )}
          </section>
        )}

        {/* Coda — when present */}
        {bible.coda && bible.coda.summary && (
          <section>
            <SectionTitle icon={BookOpen}>Coda</SectionTitle>
            <p className="text-sm text-ink-300 leading-relaxed max-w-3xl line-clamp-6">
              {bible.coda.summary}
            </p>
          </section>
        )}

        {/* Parser warnings — surface drift flags */}
        {bible.warnings && bible.warnings.length > 0 && (
          <section className="rounded border border-yellow-700/60 bg-yellow-950/20 p-3">
            <SectionTitle icon={AlertTriangle}>Parser warnings</SectionTitle>
            <ul className="text-xs text-yellow-300 list-disc list-inside space-y-1">
              {bible.warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
