import { createContext, useContext } from 'react';

// Shared project context. PulpEditor and PulpLayout both provide a value;
// page components consume via useProject() so they work in either shell.
export const PulpProjectContext = createContext(null);

export function useProject() {
  const ctx = useContext(PulpProjectContext);
  return ctx?.project || null;
}

export const TAB_IDS = ['game', 'font', 'room', 'tile', 'song', 'sound', 'script', 'play', 'export'];
export const DEFAULT_TAB = 'game';

export function tabFromUrl(search) {
  const params = new URLSearchParams(search || '');
  const t = params.get('tab');
  return TAB_IDS.includes(t) ? t : DEFAULT_TAB;
}
