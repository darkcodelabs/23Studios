import { useNavigate, Link } from 'react-router-dom';
import { Settings, LogOut, Sparkles, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from '../App.jsx';
import GameTypeToggle from './GameTypeToggle.jsx';
import PulpCoverageBadge from './PulpCoverageBadge.jsx';
import StudioLogo from './StudioLogo.jsx';
import { useSiderail } from '../lib/use_siderail.js';

export default function PulpHeaderBar({ project, aiOpen, onToggleAi, onOpenCoverage, coverageHint }) {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { collapsed, toggle } = useSiderail();

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <header className="h-11 bg-ink-900 border-b border-ink-800 flex items-center px-2 gap-2 shrink-0">
      <button
        type="button"
        onClick={toggle}
        className="btn-icon"
        aria-label={collapsed ? 'open sidebar' : 'collapse sidebar'}
        title={collapsed ? 'open sidebar' : 'collapse sidebar'}
      >
        <ToggleIcon className="w-4 h-4" />
      </button>
      <Link to="/dashboard" className="flex items-center gap-2 text-ink-100 hover:text-ink-50 transition-colors">
        <StudioLogo size="sm" className="h-5 w-auto" />
        <span className="text-sm">23 Studios</span>
      </Link>
      <span className="text-ink-600 text-xs">/</span>
      <span className="text-sm text-ink-300 truncate">{project?.name || project?.id || '…'}</span>
      <GameTypeToggle project={project} />
      <div className="flex-1" />
      {project?.id ? (
        <PulpCoverageBadge
          projectId={project.id}
          onOpen={onOpenCoverage}
          refreshHint={coverageHint}
        />
      ) : null}
      <button
        onClick={onToggleAi}
        className={`btn text-xs ${aiOpen ? 'text-accent' : ''}`}
        title="toggle AI assist rail"
      >
        <Sparkles className="w-3.5 h-3.5" />
        ai
      </button>
      <Link to={`/project/${project?.id}/files`} className="btn-icon" title="open file browser" aria-label="open file browser">
        <Settings className="w-4 h-4" />
      </Link>
      <button onClick={onLogout} className="btn-icon" title="log out" aria-label="log out">
        <LogOut className="w-4 h-4" />
      </button>
    </header>
  );
}
