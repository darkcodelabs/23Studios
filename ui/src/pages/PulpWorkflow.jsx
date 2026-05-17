import { safeErr } from '../lib/format_err.js';
import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Compass, Sparkles, Loader2 } from 'lucide-react';
import PulpWorkflowBar from '../components/PulpWorkflowBar.jsx';
import PulpWorkflowPanel from '../components/PulpWorkflowPanel.jsx';
import {
  PulpWorkflowContext,
  useProject
} from '../lib/pulp_workspace.js';
import { getWorkflow, resetWorkflow, emptyWorkflow } from '../lib/pulp_workflow_client.js';

export default function PulpWorkflow({ onJumpTab }) {
  const project = useProject();
  const wfCtx = useContext(PulpWorkflowContext);

  const [searchParams, setSearchParams] = useSearchParams();
  const [workflow, setWorkflow] = useState(wfCtx?.workflow || null);
  const [loading, setLoading] = useState(!wfCtx?.workflow);
  const [err, setErr] = useState(null);

  const refresh = useCallback(async () => {
    if (!project) return;
    try {
      const r = await getWorkflow(project.id);
      const wf = r?.workflow || emptyWorkflow();
      setWorkflow(wf);
      wfCtx?.setWorkflow?.(wf);
    } catch (e) {
      // Server may not exist yet (parallel agent). Fall back to local empty.
      setErr(e?.status ? null : 'failed to load workflow');
      const wf = emptyWorkflow();
      setWorkflow(wf);
      wfCtx?.setWorkflow?.(wf);
    } finally {
      setLoading(false);
    }
  }, [project, wfCtx]);

  useEffect(() => { refresh(); }, [refresh]);

  const order = workflow?.stage_order || [];
  const stages = workflow?.stages || {};

  const activeStageId = useMemo(() => {
    const q = searchParams.get('stage');
    if (q && stages[q]) return q;
    return order[0] || null;
  }, [searchParams, stages, order]);

  const selectStage = useCallback((id) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'workflow');
    next.set('stage', id);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const onReset = useCallback(async () => {
    if (!project) return;
    if (!window.confirm('reset workflow? all stage inputs + outputs will be cleared.')) return;
    try {
      const r = await resetWorkflow(project.id);
      const wf = r?.workflow || emptyWorkflow();
      setWorkflow(wf);
      wfCtx?.setWorkflow?.(wf);
    } catch (_e) { /* ignore */ }
  }, [project, wfCtx]);

  if (loading) {
    return (
      <div className="h-full grid place-items-center text-ink-400 text-sm">
        <span className="inline-flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> loading workflow…</span>
      </div>
    );
  }

  const empty = !order.length || order.every((id) => {
    const s = stages[id];
    return !s?.input && s?.status !== 'complete' && s?.status !== 'in_progress';
  });

  return (
    <div className="h-full flex flex-col">
      <PulpWorkflowBar
        workflow={workflow}
        activeStageId={activeStageId}
        onSelectStage={selectStage}
        onReset={onReset}
      />
      <div className="flex-1 min-h-0">
        {empty && !activeStageId ? (
          <Hero onStart={() => selectStage('brainstorm')} />
        ) : empty ? (
          <Hero onStart={() => selectStage(order[0] || 'brainstorm')} />
        ) : (
          activeStageId ? (
            <PulpWorkflowPanel
              key={activeStageId}
              stageId={activeStageId}
              stage={stages[activeStageId]}
              project={project}
              workflow={workflow}
              onStageMutated={refresh}
              onJumpTab={onJumpTab}
            />
          ) : (
            <div className="p-6 text-sm text-ink-400">no stages defined.</div>
          )
        )}
        {err ? <div className="px-6 py-2 text-[11px] text-red-300">{safeErr(err)}</div> : null}
      </div>
    </div>
  );
}

function Hero({ onStart }) {
  return (
    <div className="h-full grid place-items-center">
      <div className="max-w-md text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-full border border-accent/60 grid place-items-center text-accent">
          <Compass className="w-6 h-6" />
        </div>
        <h2 className="text-xl text-ink-50 font-mono">Start the workflow</h2>
        <p className="text-sm text-ink-300">
          A guided 10-stage flow takes you from a one-line pitch to a playable Pulp game.
          Each stage can be filled by you or generated with AI.
        </p>
        <button type="button" onClick={onStart} className="btn-primary mt-2">
          <Sparkles className="w-4 h-4" /> Begin with Brainstorm
        </button>
      </div>
    </div>
  );
}
