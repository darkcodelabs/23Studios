import { NavLink } from 'react-router-dom';

// Claude.ai-style collapsible left rail.
//   expanded: 240px, icon + label
//   collapsed: 48px, icon only
//
// Props:
//   items: [{ to?: string, onClick?: fn, icon: ComponentType, label: string,
//             matchEnd?: bool, active?: bool, divider?: bool }]
//   collapsed: bool
//   footer?: react node (rendered at the bottom when expanded only;
//            when collapsed renders nothing to keep the icon stack clean)

export default function Siderail({ items = [], collapsed = false, footer = null }) {
  return (
    <aside
      className="shrink-0 h-full flex flex-col bg-ink-900 border-r border-ink-800 overflow-y-auto"
      style={{ width: collapsed ? 48 : 240, transition: 'width 140ms ease' }}
      aria-label="navigation"
    >
      <nav className="flex flex-col gap-0.5 py-2 px-1.5">
        {items.map((it, i) => {
          if (it.divider) {
            return <div key={`d-${i}`} className="my-1.5 border-t border-ink-800 mx-1.5" />;
          }
          return <SideItem key={it.label + i} item={it} collapsed={collapsed} />;
        })}
      </nav>
      <div className="flex-1" />
      {!collapsed && footer ? (
        <div className="px-3 py-2 border-t border-ink-800">
          {footer}
        </div>
      ) : null}
    </aside>
  );
}

function SideItem({ item, collapsed }) {
  const { to, onClick, icon: Icon, label, matchEnd, active } = item;
  const baseCls = collapsed
    ? 'flex items-center justify-center h-9 mx-0.5 rounded-md text-ink-400 hover:text-ink-100 hover:bg-ink-800/60 transition-colors'
    : 'flex items-center gap-2 px-2.5 py-2 rounded-md text-sm text-ink-300 hover:text-ink-100 hover:bg-ink-800/60 transition-colors';
  const activeCls = collapsed
    ? 'text-ink-100 bg-ink-800/60'
    : 'text-ink-100 bg-ink-800/60';

  if (to) {
    return (
      <NavLink
        to={to}
        end={!!matchEnd}
        className={({ isActive }) => `${baseCls} ${(isActive || active) ? activeCls : ''}`}
        title={collapsed ? label : undefined}
      >
        {Icon ? <Icon className="w-4 h-4 shrink-0" /> : null}
        {!collapsed ? <span className="truncate">{label}</span> : null}
      </NavLink>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${baseCls} ${active ? activeCls : ''}`}
      title={collapsed ? label : undefined}
    >
      {Icon ? <Icon className="w-4 h-4 shrink-0" /> : null}
      {!collapsed ? <span className="truncate">{label}</span> : null}
    </button>
  );
}
