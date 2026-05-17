import { useMemo, useState } from 'react';
import { ChevronRight, Circle, CircleDot, CheckCircle2, Lock, Settings2, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import { STAGE_META } from '../lib/pulp_workflow_client.js';

// status: 'empty' | 'in_progress' | 'complete' | 'locked'
function StatusIcon({ status, className = 'w-3.5 h-3.5' }) {
  if (status === 'complete') return <CheckCircle2 className={`${className} text-accent`} />;
  if (status === 'in_progress') return <CircleDot className={`${className} text-accent/80`} />;
  if (status === 'locked') return <Lock className={`${className} text-ink-500`} />;
  return <Circle className={`${className} text-ink-400`} />;
}

function labelFor(id) {
  return STAGE_META[id]?.label || id;
}

function unmetRequires(stage, workflow) {
  if (!stage?.requires?.length) return [];
  return stage.requires.filter((r) => {
    const s = workflow?.stages?.[r];
    return !s || s.status !== 'complete';
  });
}

function StageChip({ id, stage, active, compact, locked, unmet, onSelect }) {
  const tooltip = locked
    ? `locked — needs: ${unmet.map(labelFor).join(', ')}`
    : compact ? labelFor(id) : '';
  const base = compact
    ? 'px-2 py-1 text-[11px] gap-1'
    : 'px-2.5 py-1.5 text-xs gap-1.5';
  const ring = active
    ? 'border-accent text-accent bg-ink-800'
    : locked
      ? 'border-ink-700 text-ink-500 bg-ink-900/30 cursor-not-allowed'
      : 'border-ink-600 text-ink-200 bg-ink-900/40 hover:border-ink-400 hover:text-ink-50';
  return (
    <button
      type="button"
      title={tooltip}
      onClick={() => { if (!locked) onSelect?.(id); }}
      className={`inline-flex items-center rounded-md border font-mono whitespace-nowrap transition ${base} ${ring}`}
    >
      <StatusIcon status={stage?.status || 'empty'} className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      {!compact && <span>{labelFor(id)}</span>}
    </button>
  );
}

export default function PulpWorkflowBar({
  workflow,
  activeStageId,
  onSelectStage,
  onReset,
  compact = false,
  collapsible = false
}) {
  const [collapsed, setCollapsed] = useState(false);

  const order = workflow?.stage_order || [];
  const stages = workflow?.stages || {};

  const { complete, total, nextId } = useMemo(() => {
    let c = 0;
    const t = order.length;
    let next = null;
    for (const id of order) {
      const s = stages[id];
      if (s?.status === 'complete') c += 1;
      else if (!next) {
        const um = unmetRequires(s, workflow);
        if (um.length === 0) next = id;
      }
    }
    return { complete: c, total: t, nextId: next };
  }, [order, stages, workflow]);

  if (!total) return null;

  if (collapsible && collapsed) {
    return (
      <div className="flex items-center gap-2 px-3 py-1 border-b border-ink-700 bg-ink-900/60 text-[11px] font-mono text-ink-300">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="inline-flex items-center gap-1 hover:text-ink-100"
          title="show workflow progress"
        >
          <ChevronDown className="w-3 h-3" />
          workflow {complete}/{total}
        </button>
        {nextId ? (
          <button
            type="button"
            onClick={() => onSelectStage?.(nextId)}
            className="inline-flex items-center gap-1 ml-auto text-accent hover:underline"
          >
            next: {labelFor(nextId)} <ArrowRight className="w-3 h-3" />
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-1.5 border-b border-ink-700 bg-ink-900/60 ${compact ? 'px-2 py-1' : 'px-3 py-2'}`}>
      <div className="flex items-center gap-1 overflow-x-auto min-w-0 flex-1 scrollbar-thin">
        {order.map((id, i) => {
          const s = stages[id];
          const um = unmetRequires(s, workflow);
          const locked = s?.status === 'locked' || um.length > 0;
          return (
            <div key={id} className="flex items-center gap-1 shrink-0">
              <StageChip
                id={id}
                stage={s}
                active={activeStageId === id}
                compact={compact}
                locked={locked && activeStageId !== id}
                unmet={um}
                onSelect={onSelectStage}
              />
              {i < order.length - 1 ? (
                <ChevronRight className={`shrink-0 text-ink-600 ${compact ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className={`flex items-center gap-2 shrink-0 ${compact ? 'text-[10px]' : 'text-[11px]'} font-mono text-ink-400`}>
        <span>{complete}/{total} complete</span>
        {nextId ? (
          <button
            type="button"
            onClick={() => onSelectStage?.(nextId)}
            className="text-accent hover:underline inline-flex items-center gap-1"
          >
            next: {labelFor(nextId)} <ArrowRight className="w-3 h-3" />
          </button>
        ) : null}
        {!compact && onReset ? (
          <button
            type="button"
            onClick={onReset}
            title="reset workflow"
            className="text-ink-500 hover:text-ink-200 p-1"
          >
            <Settings2 className="w-3.5 h-3.5" />
          </button>
        ) : null}
        {collapsible ? (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            title="hide workflow"
            className="text-ink-500 hover:text-ink-200 p-1"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
