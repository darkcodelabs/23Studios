// Theme registry + hook. Each theme overrides --accent on :root.
// Persists the chosen theme in localStorage so the choice survives reloads.

import { useEffect, useState, useCallback } from 'react';

// Each theme provides accent as both a hex (for swatches) and an
// RGB-triplet string ("R G B" — space-separated, no commas, no rgb()) so
// Tailwind's alpha modifier syntax (`bg-accent/90`) keeps working.
export const THEMES = [
  { id: 'green',    name: 'Terminal Green', hex: '#9dffce', rgb: '157 255 206' },
  { id: 'amber',    name: 'CRT Amber',      hex: '#ffb849', rgb: '255 184 73' },
  { id: 'magenta',  name: 'Cyber Magenta',  hex: '#ff5fb1', rgb: '255 95 177' },
  { id: 'ice',      name: 'Ice Blue',       hex: '#7cd3ff', rgb: '124 211 255' },
  { id: 'mono',     name: 'Monochrome',     hex: '#e3e6ec', rgb: '227 230 236' },
  { id: 'blood',    name: 'Blood Red',      hex: '#ff5454', rgb: '255 84 84' },
  // Pulled directly from devforum.play.date — Discourse light theme with
  // a violet accent on near-white surfaces. This is the ONLY light theme
  // in the picker; surface + text overrides in index.css flip the dark-
  // default app to a bright Playdate-dev-forum look.
  { id: 'playdate', name: 'Playdate',       hex: '#7b5ce7', rgb: '123 92 231' }
];

const STORAGE_KEY = 'studio:theme';

function applyAccent(themeId) {
  const t = THEMES.find((x) => x.id === themeId) || THEMES[0];
  document.documentElement.style.setProperty('--accent-rgb', t.rgb);
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
