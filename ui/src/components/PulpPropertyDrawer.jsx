import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, ChevronLeft, Settings } from 'lucide-react';

const LS_PREFIX = 'pulp.drawer.open.';

function readPersisted(key, fallback) {
  if (typeof window === 'undefined' || !key) return fallback;
  try {
    const v = window.localStorage.getItem(LS_PREFIX + key);
    if (v === null) return fallback;
    return v === '1';
  } catch (_e) {
    return fallback;
  }
}

function writePersisted(key, open) {
  if (typeof window === 'undefined' || !key) return;
  try {
    window.localStorage.setItem(LS_PREFIX + key, open ? '1' : '0');
  } catch (_e) { /* ignore */ }
}

/**
 * Collapsible right-rail drawer. When collapsed, renders a slim 28px vertical
 * strip with a chevron + title button. Open/closed state persists in
 * localStorage under `pulp.drawer.open.<storageKey>`.
 *
 * Props:
 *   storageKey?      string — persistence key. omit for ephemeral.
 *   defaultOpen?     bool   — default if no persisted state. true.
 *   title?           string — small heading inside the drawer + collapsed label.
 *   width?           number — open width in px. default 320.
 *   icon?            ComponentType — collapsed-state icon. default Settings.
 *   children         drawer content
 *   onOpenChange?    (bool) => void — notification for parent (e.g. layout)
 */
export default function PulpPropertyDrawer({
  storageKey,
  defaultOpen = true,
  title = 'properties',
  width = 320,
  icon: Icon = Settings,
  children,
  onOpenChange
}) {
  const [open, setOpen] = useState(() => readPersisted(storageKey, defaultOpen));

  useEffect(() => { writePersisted(storageKey, open); }, [storageKey, open]);
  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  if (!open) {
    return (
      <aside
        className="border-l border-ink-700 flex flex-col items-center py-3 bg-ink-900/40"
        style={{ width: 32 }}
      >
        <button
          type="button"
          onClick={toggle}
          title={`show ${title}`}
          className="text-ink-400 hover:text-accent p-1 rounded"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={toggle}
          title={`show ${title}`}
          className="mt-2 text-ink-400 hover:text-accent p-1 rounded"
        >
          <Icon className="w-4 h-4" />
        </button>
        <div
          className="mt-2 text-[10px] uppercase tracking-widest text-ink-500 font-mono"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
        >
          {title}
        </div>
      </aside>
    );
  }

  return (
    <aside
      className="border-l border-ink-700 flex flex-col min-h-0 bg-ink-900/40"
      style={{ width }}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-ink-700">
        <h3 className="text-xs uppercase tracking-wide text-ink-400 font-mono">{title}</h3>
        <button
          type="button"
          onClick={toggle}
          title="collapse"
          className="text-ink-400 hover:text-accent p-0.5 rounded"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {children}
      </div>
    </aside>
  );
}

/** Visual divider + section heading for use inside the drawer body. */
export function DrawerSection({ title, children, className = '' }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {title ? (
        <div className="text-[10px] uppercase tracking-wide text-ink-500 font-mono">
          {title}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Simple field/label helper to keep page files DRY. */
export function DrawerField({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-wide text-ink-500">{label}</span>
      {children}
    </label>
  );
}
