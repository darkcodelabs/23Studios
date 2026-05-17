import { useNavigate, Link } from 'react-router-dom';
import { Hexagon, Settings, LogOut, Sparkles } from 'lucide-react';
import { useAuth } from '../App.jsx';
import GameTypeToggle from './GameTypeToggle.jsx';

export default function PulpHeaderBar({ project, aiOpen, onToggleAi }) {
  const navigate = useNavigate();
  const { logout } = useAuth();

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <header className="h-11 border-b border-ink-700 bg-ink-800/80 backdrop-blur flex items-center px-3 gap-2 shrink-0">
      <Link to="/dashboard" className="flex items-center gap-2 text-ink-100 hover:text-accent transition">
        <Hexagon className="w-4 h-4 text-accent" />
        <span className="font-mono text-sm">23 Studios</span>
      </Link>
      <span className="text-ink-500 text-xs">/</span>
      <span className="font-mono text-sm text-ink-200 truncate">{project?.name || project?.id || '…'}</span>
      <GameTypeToggle project={project} />
      <div className="flex-1" />
      <button
        onClick={onToggleAi}
        className={`btn text-xs ${aiOpen ? 'border-accent text-accent' : ''}`}
        title="toggle AI assist rail"
      >
        <Sparkles className="w-3.5 h-3.5" />
        ai
      </button>
      <Link to={`/project/${project?.id}/files`} className="btn text-xs" title="open file browser">
        <Settings className="w-3.5 h-3.5" />
      </Link>
      <button onClick={onLogout} className="btn text-xs" title="log out">
        <LogOut className="w-3.5 h-3.5" />
      </button>
    </header>
  );
}
