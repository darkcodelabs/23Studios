import { safeErr } from '../lib/format_err.js';
import { useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';

const EMPTY = {
  id: '',
  name: '',
  description: '',
  repo: '',
  local_path: '',
  platform: 'playdate',
  game_type: 'sdk',
  publisher: '',
  developer: '',
  build_command: '',
  preflight_command: '',
  captures_dir: '',
  status: 'active'
};

export default function ProjectForm({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  function up(k) { return (e) => setForm((f) => ({ ...f, [k]: e.target.value })); }

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post('/api/projects', form);
      onCreated?.(r.project);
      onClose?.();
    } catch (e2) {
      const d = e2.detail;
      if (Array.isArray(d?.detail)) setErr(d.detail.join('; '));
      else setErr(d?.error || 'create failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl bg-ink-900 ring-1 ring-ink-800 rounded-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base text-ink-100 tracking-tight">New project</h2>
          <button type="button" onClick={onClose} className="btn-icon" aria-label="close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <Field label="ID (slug)" required>
          <input className="input font-mono" value={form.id} onChange={up('id')} pattern="[a-zA-Z0-9][a-zA-Z0-9-]{0,63}" maxLength={64} required />
        </Field>
        <Field label="Name" required>
          <input className="input" value={form.name} onChange={up('name')} maxLength={200} required />
        </Field>
        <Field label="Description">
          <textarea className="input" value={form.description} onChange={up('description')} maxLength={1000} rows={2} />
        </Field>
        <Field label="Git repo URL" required>
          <input className="input font-mono" value={form.repo} onChange={up('repo')} placeholder="https://github.com/owner/repo.git" required />
        </Field>
        <Field label="Local path (must exist + be a git repo)" required>
          <input className="input font-mono" value={form.local_path} onChange={up('local_path')} placeholder="/home/hakcer/projects/..." required />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Platform">
            <select className="input" value={form.platform} onChange={up('platform')}>
              <option value="playdate">playdate</option>
            </select>
          </Field>
          <Field label="Game type">
            <select className="input" value={form.game_type} onChange={up('game_type')}>
              <option value="sdk">sdk (lua)</option>
              <option value="pulp">pulp (editor)</option>
            </select>
          </Field>
          <Field label="Status">
            <select className="input" value={form.status} onChange={up('status')}>
              <option value="active">active</option>
              <option value="paused">paused</option>
              <option value="archived">archived</option>
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Publisher">
            <input className="input" value={form.publisher} onChange={up('publisher')} maxLength={200} />
          </Field>
          <Field label="Developer">
            <input className="input" value={form.developer} onChange={up('developer')} maxLength={200} />
          </Field>
        </div>
        <Field label="Build command">
          <input className="input font-mono" value={form.build_command} onChange={up('build_command')} placeholder="./build.sh game" />
        </Field>
        <Field label="Preflight command">
          <input className="input font-mono" value={form.preflight_command} onChange={up('preflight_command')} placeholder="./tools/preflight.sh" />
        </Field>
        <Field label="Captures dir">
          <input className="input font-mono" value={form.captures_dir} onChange={up('captures_dir')} placeholder="build/recordings" />
        </Field>

        {err ? <div className="text-xs text-red-400 whitespace-pre-wrap">{safeErr(err)}</div> : null}

        <div className="flex justify-end gap-1 pt-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>cancel</button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Create
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs text-ink-400">
        {label}{required ? <span className="text-ink-300 ml-0.5">*</span> : null}
      </span>
      {children}
    </label>
  );
}
