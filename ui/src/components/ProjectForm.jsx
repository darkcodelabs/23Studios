import { safeErr } from '../lib/format_err.js';
import { useState } from 'react';
import { X, Loader2, BookOpen, ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react';
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
  status: 'active',
  mechanic_hook: ''
};

// Modular bible section seeds. Mirror server/services/story_bible_template.js
// — kept in sync so the form previews exactly what the server will write.
// User can edit any section inline OR add new ones via "+ Add section".
function seedBibleSections(form) {
  const dev = form.developer || '<your name>';
  const desc = (form.description || '<one-paragraph pitch goes here>').trim();
  const hook = form.mechanic_hook || '<crank-driven primary input>';
  return [
    { filename: '00_premise.md', title: 'Premise',
      content: `# Premise\n\n${desc}\n` },
    { filename: '01_era_location.md', title: 'Era & Location',
      content: '# Era & Location\n\n<year, country, vibe, two sentences max.\n' +
               'e.g.: "1998 suburban USA. Beige towers, CRT monitors,\n' +
               'payphones, mall arcade.">\n' },
    { filename: '02_cast.md', title: 'Cast',
      content: '# Cast\n\n' +
               '- **Protagonist** — <name>, <one-line who they are>\n' +
               '- **Antagonist** — <name>, <one-line>\n' +
               '- **Mentor** — <name>, <one-line>\n' +
               '- **NPC 1** — <name>, <role>\n' +
               '- **NPC 2** — <name>, <role>\n' },
    { filename: '03_conflict.md', title: 'Conflict & Stakes',
      content: '# Conflict & Stakes\n\n<what is at stake, what the antagonist\n' +
               'is doing, the deadline>\n' },
    { filename: '04_win_fail.md', title: 'Win & Failure States',
      content: '# Win & Failure States\n\n' +
               '- **Win:** <concrete condition — "collect all 23 coins">\n' +
               '- **Fail:** <concrete condition — "alarm hits 100%">\n' },
    { filename: '05_tone.md', title: 'Tone',
      content: '# Tone\n\n<2-3 reference games or films. e.g.: "Mars After\n' +
               'Midnight + Whitewater Wipeout. Dry humor.">\n' },
    { filename: '06_mechanic_anchor.md', title: 'Mechanic Anchor',
      content: '# Mechanic Anchor (Playdate)\n\n' +
               `- **Crank** — ${hook}\n` +
               '- **A button** — <primary action>\n' +
               '- **B button** — <secondary / cancel>\n' +
               '- **D-pad** — <navigation>\n' +
               '- **Menu button** — <pause / inventory>\n' },
    { filename: '07_dither.md', title: 'Dither Palette',
      content: '# Dither Palette\n\n' +
               '- Primary dither: Atkinson\n' +
               '- Secondary dither: Bayer 4x4\n' +
               '- Tertiary: <Floyd-Steinberg | none>\n' },
    { filename: '08_setting_anchors.md', title: 'Setting Anchors',
      content: '# Setting Anchors\n\n' +
               '_Verbatim props/places generators must quote. Add freely._\n\n' +
               '- <prop or place 1 — e.g. "Pringles can, beige Compaq tower">\n' +
               '- <prop or place 2>\n' +
               '- <prop or place 3>\n' },
    { filename: '09_do_not.md', title: 'DO NOT',
      content: '# DO NOT\n\n' +
               '- No smartphones, no flat panels, no LED everything\n' +
               '- No real brand logos (no Apple, no Microsoft, no Nintendo)\n' +
               '- No "AI generated" watermarks\n' +
               '- No grayscale gradients — strict 1-bit\n' +
               '- <project-specific bans>\n' }
  ];
}

export default function ProjectForm({ onClose, onCreated }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [sections, setSections] = useState(() => seedBibleSections(EMPTY));
  const [openSection, setOpenSection] = useState(null);
  const [bibleOpen, setBibleOpen] = useState(true);

  function up(k) {
    return (e) => {
      const v = e.target.value;
      setForm((f) => {
        const next = { ...f, [k]: v };
        // Re-seed premise/mechanic from form fields if user hasn't edited them
        // yet (heuristic: section content still matches the auto-generated body)
        if (k === 'description' || k === 'mechanic_hook' || k === 'developer') {
          setSections((prev) => prev.map((s) => {
            const auto = seedBibleSections(next).find((x) => x.filename === s.filename);
            const original = seedBibleSections(f).find((x) => x.filename === s.filename);
            if (auto && original && s.content === original.content) return auto;
            return s;
          }));
        }
        return next;
      });
    };
  }

  function updateSection(filename, content) {
    setSections((prev) => prev.map((s) => s.filename === filename ? { ...s, content } : s));
  }

  function addCustomSection() {
    const n = sections.filter((s) => s.filename.startsWith('custom_')).length + 1;
    const filename = `custom_${String(n).padStart(2, '0')}_section.md`;
    setSections((prev) => [...prev, {
      filename, title: 'Custom section',
      content: `# Custom section\n\n<your content>\n`
    }]);
    setOpenSection(filename);
  }

  function removeSection(filename) {
    setSections((prev) => prev.filter((s) => s.filename !== filename));
    if (openSection === filename) setOpenSection(null);
  }

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const bible_sections = Object.fromEntries(sections.map((s) => [s.filename, s.content]));
      const r = await api.post('/api/projects', { ...form, bible_sections });
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
        className="w-full max-w-2xl bg-ink-900 ring-1 ring-ink-800 rounded-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto"
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
        <Field label="Description (1-paragraph pitch — seeds the bible Premise)">
          <textarea className="input" value={form.description} onChange={up('description')} maxLength={1000} rows={2} />
        </Field>
        <Field label="Crank / mechanic hook (one line — seeds the Mechanic Anchor section)">
          <input className="input" value={form.mechanic_hook} onChange={up('mechanic_hook')} maxLength={200} placeholder="crank = dial rotor; A = dial; B = hang up" />
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

        {form.game_type !== 'pulp' && (
          <div className="rounded-lg ring-1 ring-ink-800 bg-ink-950/50">
            <button
              type="button"
              onClick={() => setBibleOpen((v) => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-ink-100 hover:bg-ink-800/40"
            >
              <BookOpen className="w-4 h-4 text-accent" />
              <span className="flex-1">Story Bible — {sections.length} modular sections</span>
              {bibleOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
            {bibleOpen && (
              <div className="p-3 space-y-2 border-t border-ink-800">
                <div className="text-[11px] text-ink-500 leading-relaxed">
                  Every section becomes a file under <code>sdk_data/bible/</code>.
                  They concat (sorted) into <code>sdk_data/story_bible.md</code> which
                  every autopilot Claude call receives as system context. Add or
                  remove sections any time — the bible grows with the idea.
                </div>
                <ul className="space-y-1">
                  {sections.map((s) => {
                    const open = openSection === s.filename;
                    const isCustom = s.filename.startsWith('custom_');
                    return (
                      <li key={s.filename} className="rounded border border-ink-800 bg-ink-900">
                        <div className="flex items-center gap-2 px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => setOpenSection(open ? null : s.filename)}
                            className="flex-1 text-left text-xs text-ink-200 flex items-center gap-2"
                          >
                            {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            <span className="font-mono text-[10px] text-ink-500">{s.filename}</span>
                            <span>{s.title}</span>
                          </button>
                          {isCustom && (
                            <button
                              type="button"
                              onClick={() => removeSection(s.filename)}
                              className="text-ink-500 hover:text-red-400"
                              aria-label="remove"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                        {open && (
                          <textarea
                            value={s.content}
                            onChange={(e) => updateSection(s.filename, e.target.value)}
                            className="input font-mono text-xs w-full m-2"
                            style={{ width: 'calc(100% - 16px)' }}
                            rows={Math.min(20, Math.max(6, s.content.split('\n').length))}
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
                <button
                  type="button"
                  onClick={addCustomSection}
                  className="text-xs text-accent hover:text-accent/80 inline-flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add custom section
                </button>
              </div>
            )}
          </div>
        )}

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
