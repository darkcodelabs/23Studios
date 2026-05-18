import { useCallback, useEffect, useState } from 'react';

// localStorage-persisted siderail collapsed state. The same key is shared by
// every page (Dashboard / Project / PulpEditor) so toggling on one page sticks
// across navigation, matching the claude.ai pattern.
//
// Returns: { collapsed, setCollapsed, toggle }
//   collapsed: boolean
//   setCollapsed(v): set explicit value
//   toggle(): flip
const KEY = 'studio:siderail-collapsed';

function read() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch (_e) { return false; }
}

function write(v) {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(KEY, v ? '1' : '0'); }
  catch (_e) { /* ignore */ }
}

export function useSiderail(defaultCollapsed = false) {
  const [collapsed, setCollapsedState] = useState(() => {
    const stored = read();
    return stored === null ? defaultCollapsed : stored;
  });

  // Sync across tabs and across mounted instances within the same tab.
  useEffect(() => {
    function onStorage(e) {
      if (e.key === KEY) setCollapsedState(e.newValue === '1');
    }
    function onCustom(e) {
      setCollapsedState(!!e.detail);
    }
    window.addEventListener('storage', onStorage);
    window.addEventListener('studio:siderail-change', onCustom);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('studio:siderail-change', onCustom);
    };
  }, []);

  const setCollapsed = useCallback((v) => {
    const next = typeof v === 'function' ? v(read()) : !!v;
    write(next);
    setCollapsedState(next);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('studio:siderail-change', { detail: next }));
    }
  }, []);

  const toggle = useCallback(() => setCollapsed((v) => !v), [setCollapsed]);

  return { collapsed, setCollapsed, toggle };
}
