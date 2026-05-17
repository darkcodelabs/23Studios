import { Link, useNavigate } from 'react-router-dom';
import { Hexagon, LogOut } from 'lucide-react';
import { useAuth } from '../App.jsx';

export default function Nav({ subtitle }) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <header className="border-b border-ink-700 bg-ink-800/80 backdrop-blur sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-4 h-12 flex items-center gap-3">
        <Link to="/dashboard" className="flex items-center gap-2 text-ink-100 hover:text-accent transition">
          <Hexagon className="w-4 h-4 text-accent" />
          <span className="font-mono text-sm">23 Studios</span>
        </Link>
        {subtitle ? <span className="text-ink-500 text-xs">/ {subtitle}</span> : null}
        <div className="flex-1" />
        <button onClick={onLogout} className="btn text-xs" title="log out">
          <LogOut className="w-3.5 h-3.5" /> logout
        </button>
      </div>
    </header>
  );
}
