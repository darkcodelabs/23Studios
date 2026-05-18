import {
  Compass, Joystick, Type, Map, Grid3x3, Music, Volume2, ScrollText,
  Undo2, Redo2, Save, Play, Eye,
  Upload, Download, Package
} from 'lucide-react';

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
  return (
    <nav className="w-36 shrink-0 border-r border-ink-700 bg-ink-900/40 flex flex-col text-xs font-mono">
      <div className="py-2 flex flex-col">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onSelectTab(t.id)}
              className={`flex items-center gap-2 px-3 py-2 border-l-2 transition ${
                active
                  ? 'border-accent text-accent bg-ink-800/60'
                  : 'border-transparent text-ink-300 hover:text-ink-100 hover:bg-ink-800/40'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          );
        })}
      </div>

      <div className="border-t border-ink-700 my-1" />

      <ActionGroup>
        <Action icon={Undo2} label="undo" onClick={() => onAction('undo')} />
        <Action icon={Redo2} label="redo" onClick={() => onAction('redo')} />
        <Action icon={Save}  label="save" onClick={() => onAction('save')} />
        <Action icon={Play}  label="play" onClick={() => onAction('play')} primary />
      </ActionGroup>

      <div className="border-t border-ink-700 my-1" />

      <ActionGroup>
        <Action icon={Upload}   label="import"   onClick={() => onAction('import')} />
        <Action icon={Download} label="export"   onClick={() => onAction('export')} />
        <Action icon={Package}  label="pdx"      onClick={() => onAction('pdx')} primary />
      </ActionGroup>

      <div className="flex-1" />
      <div className="px-3 py-2 text-[10px] text-ink-500">
        v0.2.0
      </div>
    </nav>
  );
}

function ActionGroup({ children }) {
  return <div className="flex flex-col gap-0.5 py-1">{children}</div>;
}

function Action({ icon: Icon, label, onClick, primary }) {
  return (
    <button
      onClick={onClick}
      className={`mx-2 px-2 py-1.5 rounded flex items-center gap-2 transition ${
        primary
          ? 'bg-accent text-ink-900 hover:bg-accent/90'
          : 'text-ink-200 hover:bg-ink-800/60'
      }`}
    >
      <Icon className="w-3.5 h-3.5" /> {label}
    </button>
  );
}
