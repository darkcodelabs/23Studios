import {
  Compass, Joystick, Type, Map, Grid3x3, Music, Volume2, ScrollText,
  Undo2, Redo2, Save, Play, Eye,
  Upload, Download, Package
} from 'lucide-react';
import { useSiderail } from '../lib/use_siderail.js';

const TABS = [
  { id: 'workflow', label: 'workflow', icon: Compass },
  { id: 'preview', label: 'preview', icon: Eye },
  { id: 'game',   label: 'game',   icon: Joystick },
  { id: 'font',   label: 'font',   icon: Type },
  { id: 'room',   label: 'room',   icon: Map },
  { id: 'tile',   label: 'tile',   icon: Grid3x3 },
  { id: 'song',   label: 'song',   icon: Music },
  { id: 'sound',  label: 'sound',  icon: Volume2 },
  { id: 'script', label: 'script', icon: ScrollText }
];

export default function PulpLeftRail({ activeTab, onSelectTab, onAction }) {
  const { collapsed } = useSiderail();
  return (
    <nav
      className="shrink-0 bg-ink-900 border-r border-ink-800 flex flex-col text-xs"
      style={{ width: collapsed ? 48 : 144, transition: 'width 140ms ease' }}
    >
      <div className="py-2 flex flex-col">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <Button
              key={t.id}
              active={active}
              collapsed={collapsed}
              onClick={() => onSelectTab(t.id)}
              icon={Icon}
              label={t.label}
            />
          );
        })}
      </div>

      <div className="border-t border-ink-800 my-1" />

      <ActionGroup>
        <Action collapsed={collapsed} icon={Undo2} label="undo" onClick={() => onAction('undo')} />
        <Action collapsed={collapsed} icon={Redo2} label="redo" onClick={() => onAction('redo')} />
        <Action collapsed={collapsed} icon={Save}  label="save" onClick={() => onAction('save')} />
        <Action collapsed={collapsed} icon={Play}  label="play" onClick={() => onAction('play')} primary />
      </ActionGroup>

      <div className="border-t border-ink-800 my-1" />

      <ActionGroup>
        <Action collapsed={collapsed} icon={Upload}   label="import"   onClick={() => onAction('import')} />
        <Action collapsed={collapsed} icon={Download} label="export"   onClick={() => onAction('export')} />
        <Action collapsed={collapsed} icon={Package}  label="pdx"      onClick={() => onAction('pdx')} primary />
      </ActionGroup>

      <div className="flex-1" />
      {!collapsed ? (
        <div className="px-3 py-2 text-[10px] text-ink-500 font-mono">
          v0.2.0
        </div>
      ) : null}
    </nav>
  );
}

function Button({ active, collapsed, onClick, icon: Icon, label }) {
  const base = collapsed
    ? 'mx-1 my-0.5 h-8 rounded-md flex items-center justify-center transition-colors'
    : 'mx-1 my-0.5 px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors';
  const cls = active
    ? 'bg-ink-800/60 text-ink-100'
    : 'text-ink-400 hover:text-ink-100 hover:bg-ink-800/40';
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`${base} ${cls}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" /> {collapsed ? null : <span>{label}</span>}
    </button>
  );
}

function ActionGroup({ children }) {
  return <div className="flex flex-col gap-0.5 py-1">{children}</div>;
}

function Action({ collapsed, icon: Icon, label, onClick, primary }) {
  const base = collapsed
    ? 'mx-1 my-0.5 h-8 rounded-md flex items-center justify-center transition-colors'
    : 'mx-2 px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors';
  const cls = primary
    ? 'bg-accent text-ink-900 hover:bg-accent/90'
    : 'text-ink-300 hover:text-ink-100 hover:bg-ink-800/60';
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`${base} ${cls}`}
    >
      <Icon className="w-3.5 h-3.5 shrink-0" /> {collapsed ? null : <span>{label}</span>}
    </button>
  );
}
