import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import PulpHeaderBar from '../components/PulpHeaderBar.jsx';
import PulpAutopilotButton from '../components/PulpAutopilotButton.jsx';
import PulpLeftRail from '../components/PulpLeftRail.jsx';
import PulpTabRouter from '../components/PulpTabRouter.jsx';
import PulpAIRail from '../components/PulpAIRail.jsx';
import PulpAccessoryDrawer from '../components/PulpAccessoryDrawer.jsx';
import PulpStatusBar from '../components/PulpStatusBar.jsx';
import PulpWorkflowBar from '../components/PulpWorkflowBar.jsx';
import { api } from '../lib/api.js';
import {
  PulpProjectContext, PulpWorkflowContext,
  TAB_IDS, DEFAULT_TAB, tabFromUrl
} from '../lib/pulp_workspace.js';
import { getWorkflow, emptyWorkflow } from '../lib/pulp_workflow_client.js';

const COMPACT_HIDE_KEY = 'pulp:workflow-bar-hidden';

export default function PulpEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [project, setProject] = useState(null);
  const [err, setErr] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [drawer, setDrawer] = useState(null);  // 'files' | 'logs' | 'chat' | 'coverage' | null
  const [workflow, setWorkflow] = useState(null);
  const [compactHidden, setCompactHidden] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage?.getItem(COMPACT_HIDE_KEY) === '1';
  });

  const activeTab = tabFromUrl(searchParams.toString());

  // Load + guard: pulp-only.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await api.get(`/api/projects/${id}`);
        if (!alive) return;
        if (r.project.game_type !== 'pulp') {
          navigate(`/project/${id}/files`, { replace: true });
          return;
        }
        setProject(r.project);
      } catch (e) {
        if (alive) setErr(e.status === 404 ? 'not_found' : 'failed');
      }
    })();
    return () => { alive = false; };
  }, [id, navigate]);

  // Load workflow once project is known + cache at editor level.
  useEffect(() => {
    if (!project) return;
    let alive = true;
    (async () => {
      try {
        const r = await getWorkflow(project.id);
        if (alive) setWorkflow(r?.workflow || emptyWorkflow());
      } catch (_e) {
        if (alive) setWorkflow(emptyWorkflow());
      }
    })();
    return () => { alive = false; };
  }, [project]);

  const selectTab = useCallback((tabId) => {
    if (!TAB_IDS.includes(tabId)) tabId = DEFAULT_TAB;
    const next = new URLSearchParams(searchParams);
    next.set('tab', tabId);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const selectStageFromBar = useCallback((stageId) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'workflow');
    next.set('stage', stageId);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const onAction = useCallback((action) => {
    switch (action) {
      case 'save':
        window.dispatchEvent(new CustomEvent('pulp:save'));
        return;
      case 'undo':
        document.execCommand?.('undo');
        return;
      case 'redo':
        document.execCommand?.('redo');
        return;
      case 'play':
        navigate(`/project/${id}/play`);
        return;
      case 'pdx':
        selectTab('export');
        return;
      case 'export':
        selectTab('game');
        // surface the assets section via a hash anchor in the future
        return;
      case 'import':
        // import modal lands in phase 3
        window.alert('asset import lands in phase 3');
        return;
      default:
        return;
    }
  }, [id, navigate, selectTab]);

  if (err === 'not_found') {
    return (
      <div className="h-screen flex items-center justify-center text-ink-400 text-sm">
        project not found.
      </div>
    );
  }

  const activeStageId = searchParams.get('stage') || null;
  const workflowHasContent = !!workflow && (workflow.stage_order || []).some((sid) => {
    const s = workflow.stages?.[sid];
    return s?.input || s?.status === 'in_progress' || s?.status === 'complete';
  });
  const showCompactBar = activeTab !== 'workflow' && !!workflow && (workflowHasContent || !compactHidden);

  function hideCompactBar() {
    setCompactHidden(true);
    try { window.localStorage?.setItem(COMPACT_HIDE_KEY, '1'); } catch (_e) { /* ignore */ }
  }

  return (
    <PulpProjectContext.Provider value={{ project }}>
      <PulpWorkflowContext.Provider value={{ workflow, setWorkflow }}>
        <div className="h-screen flex flex-col bg-ink-900">
          <div className="relative">
            <PulpHeaderBar
              project={project}
              aiOpen={aiOpen}
              onToggleAi={() => setAiOpen((v) => !v)}
              onOpenCoverage={() => setDrawer('coverage')}
            />
            {project ? (
              <div className="absolute top-1.5 right-[8.5rem] z-10">
                {/* small rocket → opens the autopilot modal */}
                <PulpAutopilotButton project={project} variant="icon" />
              </div>
            ) : null}
          </div>

          <div className="flex-1 min-h-0 flex relative">
            <PulpLeftRail activeTab={activeTab} onSelectTab={selectTab} onAction={onAction} />

            <main className="flex-1 min-w-0 overflow-hidden bg-ink-900/40 flex flex-col">
              {!project ? (
                <div className="p-6 text-sm text-ink-400">loading project…</div>
              ) : (
                <>
                  {showCompactBar ? (
                    <div className="relative">
                      <PulpWorkflowBar
                        workflow={workflow}
                        activeStageId={activeStageId}
                        onSelectStage={selectStageFromBar}
                        compact
                        collapsible
                      />
                      {!workflowHasContent ? (
                        <button
                          type="button"
                          onClick={hideCompactBar}
                          title="dismiss until workflow has content"
                          className="absolute right-1 top-1 text-[10px] text-ink-500 hover:text-ink-200 px-1"
                        >
                          x
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <PulpTabRouter activeTab={activeTab} onJumpTab={selectTab} />
                  </div>
                </>
              )}
            </main>

            {aiOpen ? <PulpAIRail activeTab={activeTab} onClose={() => setAiOpen(false)} /> : null}

            {drawer ? (
              <PulpAccessoryDrawer kind={drawer} project={project} onClose={() => setDrawer(null)} />
            ) : null}
          </div>

          <PulpStatusBar activeDrawer={drawer} onOpenDrawer={setDrawer} project={project} />
        </div>
      </PulpWorkflowContext.Provider>
    </PulpProjectContext.Provider>
  );
}
