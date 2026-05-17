import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Save, Upload, Download } from 'lucide-react';
import { useProject } from '../lib/pulp_workspace.js';
import { pulpApi } from '../lib/pulp_api.js';

const SAVE_DEBOUNCE_MS = 400;
const DEFAULT_CONFIG = { auto_act: true, input_repeat: true, follow_player: false, text_speed: 20 };

export default function PulpGameTab() {
  const project = useProject();
  const [pulp, setPulp] = useState(null);
  const [savingState, setSavingState] = useState('idle');
  const [err, setErr] = useState(null);
  const debounceRef = useRef(null);
  const pendingRef = useRef({});

  const load = useCallback(async () => {
    if (!project) return;
    try {
      const r = await pulpApi.get(project.id);
      setPulp(r.project || null);
    } catch (_e) { setErr('failed to load pulp project'); }
  }, [project]);

  useEffect(() => { load(); }, [load]);

  function commit(patch) {
    pendingRef.current = { ...pendingRef.current, ...patch };
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSavingState('dirty');
    debounceRef.current = setTimeout(async () => {
      const body = pendingRef.current;
      pendingRef.current = {};
      setSavingState('saving');
      try {
        const r = await pulpApi.patch(project.id, body);
        setPulp(r.project || pulp);
        setSavingState('saved');
        setTimeout(() => setSavingState('idle'), 800);
      } catch (e) {
        setSavingState('error');
        setErr(e.detail?.error || 'save failed');
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function updateTop(patch) {
    setPulp((p) => ({ ...(p || {}), ...patch }));
    commit(patch);
  }

  function updateConfig(patch) {
    const next = { ...(pulp?.config || DEFAULT_CONFIG), ...patch };
    setPulp((p) => ({ ...(p || {}), config: next }));
    commit({ config: next });
  }

  if (!project) return null;
  const cfg = pulp?.config || DEFAULT_CONFIG;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto p-6 space-y-6">
        <div className="flex items-center gap-3">
          <div>
            <h1 className="font-mono text-lg text-ink-100">game</h1>
            <p className="text-xs text-ink-500">launcher metadata, theme, and asset import/export</p>
          </div>
          <div className="flex-1" />
          <SavingPill state={savingState} />
        </div>

        {err ? <div className="text-xs text-red-400">{err}</div> : null}

        <section className="grid grid-cols-[200px_1fr] gap-6 items-start">
          <LauncherPreview pulp={pulp} project={project} />
          <div className="space-y-3">
            <Field label="name">
              <input className="input text-sm" value={pulp?.name || ''} onChange={(e) => updateTop({ name: e.target.value })} />
            </Field>
            <Field label="author">
              <input className="input text-sm" value={pulp?.author || ''} onChange={(e) => updateTop({ author: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="version">
                <input className="input text-sm" value={pulp?.version || ''} onChange={(e) => updateTop({ version: e.target.value })} placeholder="0.1.0" />
              </Field>
              <Field label="build number">
                <input className="input text-sm" value={pulp?.build || ''} onChange={(e) => updateTop({ build: e.target.value })} placeholder="1" />
              </Field>
            </div>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wide text-ink-400">runtime config</h2>
          <div className="grid grid-cols-2 gap-3">
            <Toggle label="auto act" value={!!cfg.auto_act} onChange={(v) => updateConfig({ auto_act: v })} />
            <Toggle label="input repeat" value={!!cfg.input_repeat} onChange={(v) => updateConfig({ input_repeat: v })} />
            <Toggle label="follow player" value={!!cfg.follow_player} onChange={(v) => updateConfig({ follow_player: v })} />
            <Field label="text speed (chars/sec)">
              <input
                type="number"
                min={1} max={120}
                className="input text-sm"
                value={cfg.text_speed ?? 20}
                onChange={(e) => updateConfig({ text_speed: parseInt(e.target.value, 10) || 20 })}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-xs uppercase tracking-wide text-ink-400">assets</h2>
          <p className="text-[11px] text-ink-500">import or export individual asset groups. full .pdx is on the left-rail PDX button.</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {['tiles', 'rooms', 'sounds', 'songs'].map((k) => (
              <div key={k} className="border border-ink-700 rounded-md p-3 space-y-2 bg-ink-900/40">
                <div className="font-mono text-xs text-ink-200 capitalize">{k}</div>
                <div className="flex gap-1">
                  <button className="btn text-[11px]" disabled title="Phase 3"><Upload className="w-3 h-3" /> import</button>
                  <button className="btn text-[11px]" disabled title="Phase 3"><Download className="w-3 h-3" /> export</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function LauncherPreview({ pulp, project }) {
  return (
    <div className="space-y-2">
      <div className="aspect-[5/3] bg-ink-800 border border-ink-700 rounded-md flex items-center justify-center">
        <div className="text-center px-3">
          <div className="font-mono text-sm text-ink-100 truncate">{pulp?.name || project.name}</div>
          <div className="text-[10px] text-ink-500 mt-1 truncate">{pulp?.author || project.developer || '23 Studios'}</div>
        </div>
      </div>
      <div className="text-[10px] text-ink-500 text-center font-mono">launcher card</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-wide text-ink-500">{label}</span>
      {children}
    </label>
  );
}

function Toggle({ label, value, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink-200">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function SavingPill({ state }) {
  if (state === 'idle') return null;
  const map = {
    dirty:  <span className="text-ink-500 text-[11px]">edited</span>,
    saving: <span className="text-ink-300 text-[11px] flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> saving</span>,
    saved:  <span className="text-accent text-[11px] flex items-center gap-1"><Save className="w-3 h-3" /> saved</span>,
    error:  <span className="text-red-400 text-[11px]">error</span>
  };
  return map[state] || null;
}
