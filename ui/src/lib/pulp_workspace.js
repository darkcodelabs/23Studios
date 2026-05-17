import { createContext, useContext } from 'react';

// Shared project context. PulpEditor and PulpLayout both provide a value;
// page components consume via useProject() so they work in either shell.
export const PulpProjectContext = createContext(null);

export function useProject() {
  const ctx = useContext(PulpProjectContext);
  return ctx?.project || null;
}

// Workflow cache context. PulpEditor populates it so the compact breadcrumb
// in non-workflow tabs renders without a fetch every time the user changes
// tabs, and so PulpWorkflow can prime itself from the cache.
export const PulpWorkflowContext = createContext(null);

export function useWorkflow() {
  return useContext(PulpWorkflowContext);
}

export const TAB_IDS = ['workflow', 'game', 'font', 'room', 'tile', 'song', 'sound', 'script', 'play', 'export'];
export const DEFAULT_TAB = 'workflow';

export function tabFromUrl(search) {
  const params = new URLSearchParams(search || '');
  const t = params.get('tab');
  return TAB_IDS.includes(t) ? t : DEFAULT_TAB;
}
