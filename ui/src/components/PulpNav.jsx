import { NavLink } from 'react-router-dom';
import { Grid3x3, Map, ScrollText, Music, Play, Package } from 'lucide-react';

const ITEMS = [
  { to: 'tiles', label: 'tiles', icon: Grid3x3 },
  { to: 'rooms', label: 'rooms', icon: Map },
  { to: 'scripts', label: 'scripts', icon: ScrollText },
  { to: 'sounds', label: 'sounds', icon: Music },
  { to: 'play', label: 'play', icon: Play },
  { to: 'export', label: 'export', icon: Package }
];

export default function PulpNav() {
  return (
    <nav className="border-r border-ink-700 bg-ink-900/40 w-44 shrink-0 py-2 overflow-y-auto">
      <div className="px-3 pb-2 text-[10px] uppercase tracking-wider text-ink-500 font-mono">
        pulp
      </div>
      {ITEMS.map((it) => {
        const Icon = it.icon;
        return (
          <NavLink
            key={it.to}
            to={it.to}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-2 text-xs font-mono border-l-2 transition ${
                isActive
                  ? 'border-accent text-accent bg-ink-800/60'
                  : 'border-transparent text-ink-300 hover:text-ink-100 hover:bg-ink-800/40'
              }`
            }
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{it.label}</span>
          </NavLink>
        );
      })}
    </nav>
  );
}
