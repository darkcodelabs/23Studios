import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import PulpHeaderBar from '../components/PulpHeaderBar.jsx';
import PulpLeftRail from '../components/PulpLeftRail.jsx';
import PulpTabRouter from '../components/PulpTabRouter.jsx';
import PulpAIRail from '../components/PulpAIRail.jsx';
import PulpAccessoryDrawer from '../components/PulpAccessoryDrawer.jsx';
import PulpStatusBar from '../components/PulpStatusBar.jsx';
import { api } from '../lib/api.js';
import { PulpProjectContext, TAB_IDS, DEFAULT_TAB, tabFromUrl } from '../lib/pulp_workspace.js';

export default function PulpEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [project, setProject] = useState(null);
  const [err, setErr] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [drawer, setDrawer] = useState(null);  // 'files' | 'logs' | 'chat' | null

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

  const selectTab = useCallback((tabId) => {
    if (!TAB_IDS.includes(tabId)) tabId = DEFAULT_TAB;
    const next = new URLSearchParams(searchParams);
    next.set('tab', tabId);
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
        selectTab('play');
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

  return (
    <PulpProjectContext.Provider value={{ project }}>
      <div className="h-screen flex flex-col bg-ink-900">
        <PulpHeaderBar project={project} aiOpen={aiOpen} onToggleAi={() => setAiOpen((v) => !v)} />

        <div className="flex-1 min-h-0 flex relative">
          <PulpLeftRail activeTab={activeTab} onSelectTab={selectTab} onAction={onAction} />

          <main className="flex-1 min-w-0 overflow-hidden bg-ink-900/40">
            {!project ? (
              <div className="p-6 text-sm text-ink-400">loading project…</div>
            ) : (
              <PulpTabRouter activeTab={activeTab} />
            )}
          </main>

          {aiOpen ? <PulpAIRail activeTab={activeTab} onClose={() => setAiOpen(false)} /> : null}

          {drawer ? (
            <PulpAccessoryDrawer kind={drawer} project={project} onClose={() => setDrawer(null)} />
          ) : null}
        </div>

        <PulpStatusBar activeDrawer={drawer} onOpenDrawer={setDrawer} project={project} />
      </div>
    </PulpProjectContext.Provider>
  );
}
