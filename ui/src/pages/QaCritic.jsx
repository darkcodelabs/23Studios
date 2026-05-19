import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Loader2, RefreshCw, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle2, XCircle, Star
} from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

// ---------------------------------------------------------------------------
// Verdict helpers
// ---------------------------------------------------------------------------

function VerdictBadge({ verdict }) {
  if (verdict === 'ship') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-emerald-900/40 border border-emerald-700 text-emerald-300">
        <CheckCircle2 className="w-3 h-3" /> SHIP
      </span>
    );
  }
  if (verdict === 'rework') {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-amber-900/30 border border-amber-700 text-amber-300">
        <AlertTriangle className="w-3 h-3" /> REWORK
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded bg-red-900/40 border border-red-700 text-red-300">
      <XCircle className="w-3 h-3" /> RESHELVE
    </span>
  );
}

function ScoreDial({ score }) {
  const color =
    score >= 7 ? 'text-emerald-400' :
    score >= 5 ? 'text-amber-400' :
                 'text-red-400';
  return (
    <span className={`text-4xl font-bold tabular-nums ${color}`}>
      {score}<span className="text-lg text-ink-500 font-normal">/10</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Persona card
// ---------------------------------------------------------------------------

const PERSONA_LABELS = {
  casual:     'Casual Gamer',
  fan:        'Playdate Superfan',
  speedrunner:'Speedrunner',
  qa:         'QA Tester',
  harsh:      'Harsh Critic'
};

const Q_LABELS = [
  '', // placeholder for 1-based indexing
  'What is boring?',
  'What is confusing?',
  'What feels too slow?',
  'What should use the crank more?',
  'What looks visually weak?',
  'What feels memorable?',
  'What should be cut?',
  'What should be expanded?'
];

function StringList({ items, label }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="mt-1.5">
      <span className="text-[10px] uppercase tracking-wider text-ink-500">{label}</span>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="text-[12px] text-ink-300 pl-2 border-l border-ink-700">{item}</li>
        ))}
      </ul>
    </div>
  );
}

function PersonaCard({ persona }) {
  const [open, setOpen] = useState(persona.verdict !== 'ship');
  const label = PERSONA_LABELS[persona.persona] || persona.persona;
  const Chevron = open ? ChevronDown : ChevronRight;

  const borderColor =
    persona.verdict === 'ship'     ? 'border-emerald-900/50' :
    persona.verdict === 'rework'   ? 'border-amber-900/40'   :
                                     'border-red-900/50';

  return (
    <div className={`rounded-md border ${borderColor} bg-ink-900 overflow-hidden`}>
      {/* Card header — always visible */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-3 py-3 text-left hover:bg-ink-800/40 transition-colors"
      >
        <Chevron className="w-3.5 h-3.5 text-ink-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink-100">{label}</span>
            <VerdictBadge verdict={persona.verdict} />
          </div>
          <div className="flex items-center gap-1 mt-0.5">
            {Array.from({ length: 10 }).map((_, i) => (
              <Star
                key={i}
                className={`w-2.5 h-2.5 ${i < persona.score_1_to_10 ? 'text-amber-400 fill-amber-400' : 'text-ink-700'}`}
              />
            ))}
            <span className="text-[11px] text-ink-500 ml-1">{persona.score_1_to_10}/10</span>
          </div>
        </div>
      </button>

      {/* Expanded detail */}
      {open && (
        <div className="px-4 pb-4 pt-1 border-t border-ink-800 space-y-3">
          <StringList items={persona.top_issues} label="Top issues" />
          <StringList items={persona.top_strengths} label="Top strengths" />

          {persona.answers && Object.keys(persona.answers).length > 0 && (
            <div className="mt-3 space-y-2">
              <span className="text-[10px] uppercase tracking-wider text-ink-500">Full Q&amp;A</span>
              {Array.from({ length: 8 }).map((_, idx) => {
                const key = `q${idx + 1}`;
                const answer = persona.answers[key];
                if (!answer) return null;
                return (
                  <div key={key} className="space-y-0.5">
                    <div className="text-[11px] font-medium text-ink-400">{Q_LABELS[idx + 1]}</div>
                    <div className="text-[12px] text-ink-300 pl-2 border-l border-ink-700">{answer}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aggregate summary strip
// ---------------------------------------------------------------------------

function AggregateSummary({ aggregate, recommendation }) {
  return (
    <div className="rounded-md bg-ink-900 border border-ink-800 px-4 py-3 space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-end gap-3">
          <ScoreDial score={aggregate.avg_score} />
          <VerdictBadge verdict={recommendation} />
        </div>
        <div className="flex gap-4 text-sm">
          <span className="text-emerald-400 font-medium">{aggregate.ship_count} ship</span>
          <span className="text-amber-400 font-medium">{aggregate.rework_count} rework</span>
          <span className="text-red-400 font-medium">{aggregate.reshelve_count} reshelve</span>
        </div>
      </div>

      {aggregate.common_issues && aggregate.common_issues.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500 mb-1">Common issues</div>
          <div className="flex flex-wrap gap-1.5">
            {aggregate.common_issues.map((issue, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-red-900/20 border border-red-900/40 text-red-300">
                {issue}
              </span>
            ))}
          </div>
        </div>
      )}

      {aggregate.common_strengths && aggregate.common_strengths.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-ink-500 mb-1">Common strengths</div>
          <div className="flex flex-wrap gap-1.5">
            {aggregate.common_strengths.map((s, i) => (
              <span key={i} className="text-[11px] px-2 py-0.5 rounded bg-emerald-900/20 border border-emerald-900/40 text-emerald-300">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function QaCritic() {
  const { id: projectId } = useParams();
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState(null);

  const loadLatest = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get(`/api/projects/${projectId}/qa/critique/latest`);
      setReport(r);
    } catch (e) {
      if (e.status === 404) setReport(null);
      else setErr(e.message || 'failed to load critique');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadLatest(); }, [loadLatest]);

  async function runCritique() {
    setRunning(true);
    setErr(null);
    try {
      const r = await api.post(`/api/projects/${projectId}/qa/critique`, {});
      setReport(r);
    } catch (e) {
      setErr(e.message || 'critique failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="h-screen flex flex-col bg-ink-950 text-ink-100">
      <Nav subtitle="AI game critic" />

      <div className="flex-1 min-h-0 overflow-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-semibold text-ink-100">Multi-Persona AI Game Critic</h1>
              <p className="text-[12px] text-ink-500 mt-0.5">
                5 personas — 8 questions each — scored + aggregated into a ship recommendation.
              </p>
            </div>
            <button
              type="button"
              onClick={runCritique}
              disabled={running}
              className="btn btn-primary flex items-center gap-2 text-sm self-start sm:self-auto"
            >
              {running
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
              {running ? 'Running critique…' : 'Run critique'}
            </button>
          </div>

          {/* Error banner */}
          {err && (
            <div className="rounded-md bg-red-900/30 border border-red-700 px-3 py-2.5 text-sm text-red-300">
              {err}
            </div>
          )}

          {/* Running hint */}
          {running && (
            <div className="rounded-md bg-ink-900 border border-ink-800 px-4 py-3 text-sm text-ink-400 flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
              Firing 5 parallel Claude calls — this takes 30-90 seconds…
            </div>
          )}

          {/* Loading */}
          {loading && !running && (
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <Loader2 className="w-4 h-4 animate-spin" /> loading last critique…
            </div>
          )}

          {/* No report yet — first-run CTA */}
          {!loading && !running && !report && !err && (
            <div className="rounded-md bg-ink-900 border border-ink-800 px-4 py-8 text-center space-y-3">
              <p className="text-sm text-ink-300 font-medium">No critique report yet.</p>
              <p className="text-[12px] text-ink-500">
                Run the 5-persona AI critic pass. This calls Claude 5 times — small cost.
              </p>
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={runCritique}
                  disabled={running}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded bg-accent hover:bg-accent/90 text-white text-sm font-medium disabled:opacity-50"
                >
                  {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  Run the 5-persona AI critic pass
                </button>
              </div>
            </div>
          )}

          {/* Report */}
          {report && (
            <div className="space-y-4">
              {/* Timestamp */}
              {report.critiqued_at && (
                <div className="text-[11px] text-ink-600">
                  Last critique: {new Date(report.critiqued_at).toLocaleString()}
                </div>
              )}

              {/* Aggregate summary */}
              {report.aggregate && (
                <AggregateSummary
                  aggregate={report.aggregate}
                  recommendation={report.recommendation}
                />
              )}

              {/* Persona grid */}
              {report.personas && report.personas.length > 0 && (
                <div>
                  <h2 className="text-[11px] uppercase tracking-wider text-ink-500 mb-2">
                    Persona critiques ({report.personas.length})
                  </h2>
                  <div className="grid grid-cols-1 gap-3">
                    {report.personas.map((p) => (
                      <PersonaCard key={p.persona} persona={p} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Back link */}
          <div className="pt-2">
            <Link
              to={`/project/${projectId}/ship`}
              className="text-[12px] text-ink-500 hover:text-ink-300 transition-colors"
            >
              back to ship status
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}
