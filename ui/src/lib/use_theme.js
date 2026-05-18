// Theme registry + hook. Each theme overrides --accent on :root.
// Persists the chosen theme in localStorage so the choice survives reloads.

import { useEffect, useState, useCallback } from 'react';

export const THEMES = [
  { id: 'green',   name: 'Terminal Green', accent: '#9dffce' },
  { id: 'amber',   name: 'CRT Amber',      accent: '#ffb849' },
  { id: 'magenta', name: 'Cyber Magenta',  accent: '#ff5fb1' },
  { id: 'ice',     name: 'Ice Blue',       accent: '#7cd3ff' },
  { id: 'mono',    name: 'Monochrome',     accent: '#e3e6ec' },
  { id: 'blood',   name: 'Blood Red',      accent: '#ff5454' }
];

const STORAGE_KEY = 'studio:theme';

function applyAccent(themeId) {
  const t = THEMES.find((x) => x.id === themeId) || THEMES[0];
  document.documentElement.style.setProperty('--accent', t.accent);
  document.documentElement.dataset.theme = t.id;
}

export function useTheme() {
  const [themeId, setThemeIdState] = useState(() => {
    if (typeof window === 'undefined') return 'green';
    return window.localStorage?.getItem(STORAGE_KEY) || 'green';
  });

  useEffect(() => { applyAccent(themeId); }, [themeId]);

  const setTheme = useCallback((next) => {
    setThemeIdState(next);
    try { window.localStorage?.setItem(STORAGE_KEY, next); } catch (_e) { /* ignore */ }
  }, []);

  return { theme: themeId, setTheme, themes: THEMES };
}

// Pre-paint the accent on first JS execution so there's no flash of the
// default green when a user with a saved non-green theme reloads.
if (typeof window !== 'undefined') {
  try {
    const saved = window.localStorage?.getItem(STORAGE_KEY);
    if (saved) applyAccent(saved);
  } catch (_e) { /* ignore */ }
}
