import { FolderTree, ScrollText, MessageSquare, ShieldCheck, Music2 } from 'lucide-react';

const TRIGGERS = [
  { id: 'files',    label: 'files',    icon: FolderTree },
  { id: 'logs',     label: 'logs',     icon: ScrollText },
  { id: 'chat',     label: 'chat',     icon: MessageSquare },
  { id: 'coverage', label: 'coverage', icon: ShieldCheck },
  { id: 'music',    label: 'music',    icon: Music2 }
];

export default function PulpStatusBar({ activeDrawer, onOpenDrawer, project }) {
  return (
    <div className="h-8 border-t border-ink-800 bg-ink-900 flex items-center gap-0.5 px-2 text-[11px] shrink-0">
      {TRIGGERS.map((t) => {
        const Icon = t.icon;
        const active = activeDrawer === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onOpenDrawer(active ? null : t.id)}
            className={`inline-flex items-center gap-1 px-2 py-1 rounded transition-colors ${
              active ? 'bg-ink-800/60 text-ink-100' : 'text-ink-400 hover:text-ink-100 hover:bg-ink-800/40'
            }`}
          >
            <Icon className="w-3 h-3" /> {t.label}
          </button>
        );
      })}
      <div className="flex-1" />
      <span className="text-ink-500 font-mono">{project?.id || ''}</span>
    </div>
  );
}
