import { NavLink } from 'react-router-dom';
import { Grid3x3, Map, ScrollText, Music, Play, Package } from 'lucide-react';
import { useSiderail } from '../lib/use_siderail.js';

const ITEMS = [
  { to: 'tiles', label: 'tiles', icon: Grid3x3 },
  { to: 'rooms', label: 'rooms', icon: Map },
  { to: 'scripts', label: 'scripts', icon: ScrollText },
  { to: 'sounds', label: 'sounds', icon: Music },
  { to: 'play', label: 'play', icon: Play },
  { to: 'export', label: 'export', icon: Package }
];

export default function PulpNav() {
  const { collapsed } = useSiderail();
  return (
    <nav
      className="bg-ink-900 border-r border-ink-800 shrink-0 py-2 overflow-y-auto"
      style={{ width: collapsed ? 48 : 176, transition: 'width 140ms ease' }}
    >
      {!collapsed ? (
        <div className="px-3 pb-2 text-[10px] uppercase tracking-wider text-ink-500 font-mono">
          pulp
        </div>
      ) : null}
      {ITEMS.map((it) => {
        const Icon = it.icon;
        const base = collapsed
          ? 'mx-1 my-0.5 h-9 rounded-md flex items-center justify-center transition-colors'
          : 'mx-1 my-0.5 px-2 py-1.5 rounded-md flex items-center gap-2 text-xs transition-colors';
        return (
          <NavLink
            key={it.to}
            to={it.to}
            title={collapsed ? it.label : undefined}
            className={({ isActive }) =>
              `${base} ${
                isActive
                  ? 'bg-ink-800/60 text-ink-100'
                  : 'text-ink-400 hover:text-ink-100 hover:bg-ink-800/40'
              }`
            }
          >
            <Icon className="w-3.5 h-3.5 shrink-0" />
            {collapsed ? null : <span>{it.label}</span>}
          </NavLink>
        );
      })}
    </nav>
  );
}
