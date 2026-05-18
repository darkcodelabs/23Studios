import { Link, useNavigate } from 'react-router-dom';
import { LogOut, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useAuth } from '../App.jsx';
import StudioLogo from './StudioLogo.jsx';
import ThemePicker from './ThemePicker.jsx';
import { useSiderail } from '../lib/use_siderail.js';

// Shared top header. Hosts:
//   - siderail collapse toggle (chevron) — persisted via useSiderail
//   - studio mark (cyber-glove logo + wordmark)
//   - page title in regular weight (no bold)
//   - logout
//
// Props:
//   subtitle?: string  page title rendered after the wordmark
//   showSiderailToggle?: bool  default true; pages without a siderail can hide
export default function Nav({ subtitle, showSiderailToggle = true }) {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const { collapsed, toggle } = useSiderail();

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;

  return (
    <header className="bg-ink-900 border-b border-ink-800 sticky top-0 z-10">
      <div className="px-3 h-12 flex items-center gap-2">
        {showSiderailToggle ? (
          <button
            type="button"
            onClick={toggle}
            className="btn-icon"
            aria-label={collapsed ? 'open sidebar' : 'collapse sidebar'}
            title={collapsed ? 'open sidebar' : 'collapse sidebar'}
          >
            <ToggleIcon className="w-4 h-4" />
          </button>
        ) : null}
        <Link
          to="/dashboard"
          className="flex items-center gap-2 text-ink-100 hover:text-ink-50 transition-colors"
        >
          <StudioLogo size="sm" className="h-5 w-auto" />
          <span className="text-sm text-ink-100">23 Studios</span>
        </Link>
        {subtitle ? (
          <>
            <span className="text-ink-600 text-xs">/</span>
            <span className="text-sm text-ink-300 truncate font-normal">{subtitle}</span>
          </>
        ) : null}
        <div className="flex-1" />
        <ThemePicker />
        <button onClick={onLogout} className="btn-icon" title="log out" aria-label="log out">
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
