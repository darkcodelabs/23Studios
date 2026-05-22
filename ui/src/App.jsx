if (typeof window !== 'undefined') { window.__BUILD = 1779196716; }
import React, { useEffect, useState, useCallback, createContext, useContext } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import { api, setCsrfToken } from './lib/api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

function AuthProvider({ children }) {
  const [loading, setLoading] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [authDisabled, setAuthDisabled] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const me = await api.get('/api/auth/me');
      if (me.authenticated) {
        setCsrfToken(me.csrf_token);
        setAuthed(true);
      } else {
        setAuthed(false);
      }
      setAuthDisabled(!!me.anon);
    } catch (_e) {
      setAuthed(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = useCallback(async (password) => {
    const r = await api.post('/api/auth/login', { password });
    if (r && r.ok && r.csrf_token) {
      setCsrfToken(r.csrf_token);
      setAuthed(true);
      return true;
    }
    return false;
  }, []);

  const logout = useCallback(async () => {
    try { await api.post('/api/auth/logout', {}); }
    catch (_e) { /* ignore */ }
    setCsrfToken(null);
    setAuthed(false);
  }, []);

  return (
    <AuthCtx.Provider value={{ loading, authed, authDisabled, login, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}

// When the server has STUDIO_AUTH_DISABLED, never render the login page —
// every visit to /login bounces straight to the dashboard.
function LoginOrBounce({ Login }) {
  const { authDisabled, loading } = useAuth();
  if (loading) return <div className="h-screen w-screen flex items-center justify-center text-ink-400 text-sm">loading…</div>;
  if (authDisabled) return <Navigate to="/dashboard" replace />;
  return <Login />;
}

function RequireAuth({ children }) {
  const { loading, authed, authDisabled } = useAuth();
  const loc = useLocation();
  if (loading) {
    return <div className="h-screen w-screen flex items-center justify-center text-ink-400 text-sm">loading…</div>;
  }
  if (authDisabled) return children;
  if (!authed) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return children;
}

import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Project from './pages/Project.jsx';
import NotFound from './pages/NotFound.jsx';
import PulpLayout from './components/PulpLayout.jsx';
import PulpTiles from './pages/PulpTiles.jsx';
import PulpRooms from './pages/PulpRooms.jsx';
import PulpScripts from './pages/PulpScripts.jsx';
import PulpSounds from './pages/PulpSounds.jsx';
import PulpExport from './pages/PulpExport.jsx';
import PulpPlay from './pages/PulpPlay.jsx';
import PulpPlayPage from './pages/PulpPlayPage.jsx';
import SdkPlayPage from './pages/SdkPlayPage.jsx';
import SdkEditPage from './pages/SdkEditPage.jsx';
import PulpEditor from './pages/PulpEditor.jsx';
import ComposerV2 from './pages/ComposerV2.jsx';
import StylePicker from './pages/StylePicker.jsx';
import AssetLibraryBrowser from './pages/AssetLibraryBrowser.jsx';
import NpcDialogEditor from './pages/NpcDialogEditor.jsx';
import LevelEditor from './pages/LevelEditor.jsx';
import LateAddPanel from './pages/LateAddPanel.jsx';
import Storyboard from './pages/Storyboard.jsx';
import DecisionsLog from './pages/DecisionsLog.jsx';
import Interview from './pages/Interview.jsx';
import CostPanel from './components/CostPanel.jsx';
import AgentsDashboard from './pages/AgentsDashboard.jsx';
import AssetApprover from './pages/AssetApprover.jsx';
import ShipStatus from './pages/ShipStatus.jsx';
import MvpWorkflow from './pages/MvpWorkflow.jsx';
import Releases from './pages/Releases.jsx';
import DesignValidator from './pages/DesignValidator.jsx';
import ConceptPicker from './pages/ConceptPicker.jsx';
import Milestones from './pages/Milestones.jsx';
import ReviewBoard from './pages/ReviewBoard.jsx';
import PerfAudit from './pages/PerfAudit.jsx';
import QaCritic from './pages/QaCritic.jsx';
import Architecture from './pages/Architecture.jsx';
import Bible from './pages/Bible.jsx';
import ReferenceLibrary from './pages/ReferenceLibrary.jsx';
import Brief from './pages/Brief.jsx';
import ProjectGallery from './components/ProjectGallery.jsx';
import ProjectShell from './layouts/ProjectShell.jsx';
import Landing from './pages/Landing.jsx';

function PulpComingSoon({ name }) {
  return (
    <div className="h-full flex items-center justify-center text-ink-500 text-sm">
      {name} arrives in Phase 2 Wave 2
    </div>
  );
}

function GatesIndex() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.get(`/api/projects/${id}/gates`).then((r) => {
      if (!cancelled) setList((r && r.gates) || []);
    }).catch(() => { if (!cancelled) setList([]); });
    return () => { cancelled = true; };
  }, [id]);
  if (list === null) return <div className="p-4 text-ink-400 text-sm">loading gates…</div>;
  return (
    <div className="max-w-3xl mx-auto p-4 space-y-2">
      <h1 className="text-base font-semibold text-ink-100 mb-2">Gates</h1>
      {list.length === 0 && <div className="text-ink-500 text-sm">no gates configured</div>}
      {list.map((g) => (
        <button
          key={g.id}
          type="button"
          onClick={() => navigate(`/project/${id}/gates/${g.id}`)}
          className="w-full text-left px-3 py-2.5 rounded-md bg-ink-900 ring-1 ring-ink-800 hover:ring-ink-700 flex items-center gap-3"
        >
          <span className={
            'pill ' + (g.status === 'signed_off' ? 'pill-ok' : g.status === 'active' ? 'pill-warn' : '')
          }>{g.status}</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-ink-100 truncate">{g.name}</div>
            <div className="text-[11px] text-ink-500">
              {g.required_resolved}/{g.required_total} required decisions
              {g.signed_off_at ? ` · signed ${new Date(g.signed_off_at).toLocaleDateString()}` : ''}
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

// Legacy /project/:id and /project/:id/batches deep links redirect into the
// new /projects/:id/... shell. Preserves shared URLs from prior phases.
function RedirectToNew() {
  const { id } = useParams();
  return <Navigate to={`/projects/${id}/author/brief`} replace />;
}

function RedirectToGallery() {
  const { id } = useParams();
  return <Navigate to={`/projects/${id}/author/gallery`} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      {/* CostPanel renders itself only when location matches /project/:id/* */}
      <CostPanel />
      <Routes>
        <Route path="/login" element={<LoginOrBounce Login={Login} />} />
        <Route path="/" element={<RequireAuth><Navigate to="/dashboard" replace /></RequireAuth>} />
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        {/* Landing — full-bleed prompt composer; mounted outside ProjectShell
            because Landing is its own world (no sidebar, no topbar). */}
        <Route path="/new" element={<RequireAuth><Landing /></RequireAuth>} />
        <Route path="/agents" element={<RequireAuth><AgentsDashboard /></RequireAuth>} />
        {/* Phase 4.5 Part 0 — nested project shell at /projects/:id.
            The legacy /project/:id routes below stay live for any deep
            links + still-canonical surfaces (sdk/play, sdk/edit, composer,
            …), but the bare /project/:id + /project/:id/batches links
            redirect into the new shell. */}
        <Route path="/projects/:id" element={<RequireAuth><ProjectShell /></RequireAuth>}>
          <Route index element={<Navigate to="author/brief" replace />} />
          <Route path="author">
            <Route index element={<Navigate to="brief" replace />} />
            <Route path="brief"      element={<Brief />} />
            <Route path="bible"      element={<Bible />} />
            <Route path="storyboard" element={<Storyboard />} />
            <Route path="gallery"    element={<ProjectGallery />} />
            <Route path="references" element={<ReferenceLibrary />} />
          </Route>
          <Route path="build">
            <Route index element={<Navigate to="files" replace />} />
            <Route path="files"        element={<Project />} />
            <Route path="architecture" element={<Architecture />} />
            <Route path="milestones"   element={<Milestones />} />
            <Route path="simulator"    element={<SdkPlayPage />} />
          </Route>
          <Route path="review">
            <Route index element={<Navigate to="board" replace />} />
            <Route path="board"  element={<ReviewBoard />} />
            <Route path="design" element={<DesignValidator />} />
            <Route path="perf"   element={<PerfAudit />} />
            <Route path="qa"     element={<QaCritic />} />
          </Route>
          <Route path="release">
            <Route index element={<Navigate to="ship" replace />} />
            <Route path="ship"    element={<ShipStatus />} />
            <Route path="history" element={<Releases />} />
            <Route path="mvp"     element={<MvpWorkflow />} />
          </Route>
        </Route>

        {/* Backward-compat redirects from the singular /project/:id space. */}
        <Route path="/project/:id" element={<RequireAuth><RedirectToNew /></RequireAuth>} />
        <Route path="/project/:id/files" element={<RequireAuth><RedirectToNew /></RequireAuth>} />
        <Route path="/project/:id/batches" element={<RequireAuth><RedirectToGallery /></RequireAuth>} />
        <Route path="/project/:id/edit" element={<RequireAuth><PulpEditor /></RequireAuth>} />
        <Route path="/project/:id/play" element={<RequireAuth><PulpPlayPage /></RequireAuth>} />
        <Route path="/project/:id/sdk/play" element={<RequireAuth><SdkPlayPage /></RequireAuth>} />
        <Route path="/project/:id/sdk/edit" element={<RequireAuth><SdkEditPage /></RequireAuth>} />
        <Route path="/project/:id/composer" element={<RequireAuth><ComposerV2 /></RequireAuth>} />
        <Route path="/project/:id/styles/:axisId" element={<RequireAuth><StylePicker /></RequireAuth>} />
        <Route path="/project/:id/asset-library" element={<RequireAuth><AssetLibraryBrowser /></RequireAuth>} />
        <Route path="/project/:id/npcs" element={<RequireAuth><NpcDialogEditor /></RequireAuth>} />
        <Route path="/project/:id/levels" element={<RequireAuth><LevelEditor /></RequireAuth>} />
        <Route path="/project/:id/late-add" element={<RequireAuth><LateAddPanel /></RequireAuth>} />
        <Route path="/project/:id/storyboard" element={<RequireAuth><Storyboard /></RequireAuth>} />
        <Route path="/project/:id/ship" element={<RequireAuth><ShipStatus /></RequireAuth>} />
        <Route path="/project/:id/decisions" element={<RequireAuth><DecisionsLog /></RequireAuth>} />
        <Route path="/project/:id/interview" element={<RequireAuth><Interview /></RequireAuth>} />
        <Route path="/project/:id/mvp" element={<RequireAuth><MvpWorkflow /></RequireAuth>} />
        <Route path="/project/:id/approve" element={<RequireAuth><AssetApprover /></RequireAuth>} />
        <Route path="/project/:id/releases" element={<RequireAuth><Releases /></RequireAuth>} />
        <Route path="/project/:id/design-validate" element={<RequireAuth><DesignValidator /></RequireAuth>} />
        <Route path="/project/:id/concepts" element={<RequireAuth><ConceptPicker /></RequireAuth>} />
        <Route path="/project/:id/milestones" element={<RequireAuth><Milestones /></RequireAuth>} />
        <Route path="/project/:id/review" element={<RequireAuth><ReviewBoard /></RequireAuth>} />
        {/* /project/:id/batches now redirects to /projects/:id/author/gallery
            via RedirectToGallery above. AssetBatches.jsx is unlinked from the
            new sidebar but kept on disk for Patch C subsumption. */}
        <Route path="/project/:id/perf" element={<RequireAuth><PerfAudit /></RequireAuth>} />
        <Route path="/project/:id/qa-critic" element={<RequireAuth><QaCritic /></RequireAuth>} />
        <Route path="/project/:id/architecture" element={<RequireAuth><Architecture /></RequireAuth>} />
        <Route path="/project/:id/bible" element={<RequireAuth><Bible /></RequireAuth>} />
        <Route path="/project/:id/references" element={<RequireAuth><ReferenceLibrary /></RequireAuth>} />
        <Route path="/project/:id/pulp" element={<RequireAuth><PulpLayout /></RequireAuth>}>
          <Route index element={<Navigate to="tiles" replace />} />
          <Route path="tiles" element={<PulpTiles />} />
          <Route path="rooms" element={<PulpRooms />} />
          <Route path="scripts" element={<PulpScripts />} />
          <Route path="sounds" element={<PulpSounds />} />
          <Route path="play" element={<PulpPlay />} />
          <Route path="export" element={<PulpExport />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AuthProvider>
  );
}
