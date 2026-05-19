import React, { useEffect, useState, useCallback, createContext, useContext } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
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
import SceneManager from './pages/SceneManager.jsx';

function PulpComingSoon({ name }) {
  return (
    <div className="h-full flex items-center justify-center text-ink-500 text-sm">
      {name} arrives in Phase 2 Wave 2
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginOrBounce Login={Login} />} />
        <Route path="/" element={<RequireAuth><Navigate to="/dashboard" replace /></RequireAuth>} />
        <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path="/project/:id" element={<RequireAuth><Project /></RequireAuth>} />
        <Route path="/project/:id/files" element={<RequireAuth><Project /></RequireAuth>} />
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
        <Route path="/project/:id/scenes/:sceneId" element={<RequireAuth><SceneManager /></RequireAuth>} />
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
