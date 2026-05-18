// IntakeForm.jsx — 4-step intake modal that collects section 1 of the
// 23 Studios master intake prompt. Only `pitch` is required; blank fields
// are filled server-side by a single Claude inference pass.

import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, Loader2, ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import { safeErr } from '../lib/format_err.js';
import { submitIntake, INTAKE_DEFAULTS, INTAKE_ENUMS } from '../lib/intake_client.js';

const STEPS = [
  { key: 'pitch', label: 'Pitch' },
  { key: 'setting', label: 'Setting + cast' },
  { key: 'visual', label: 'Visual + tone' },
  { key: 'scope', label: 'Scope' }
];

function cloneDefaults() {
  return JSON.parse(JSON.stringify(INTAKE_DEFAULTS));
}

export default function IntakeForm({ onClose, onCreated }) {
  const [form, setForm] = useState(cloneDefaults());
  const [stepIdx, setStepIdx] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const navigate = useNavigate();

  const setField = useCallback((k, v) => {
    setForm((f) => ({ ...f, [k]: v }));
  }, []);

  const ready = !!form.pitch.trim();

  async function onSubmit(e) {
    e?.preventDefault?.();
    if (!ready || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const cleaned = sanitizeForSubmit(form);
      const r = await submitIntake(cleaned);
      onCreated?.(r.project, r.intake_summary);
      onClose?.();
      navigate(`/project/${r.project.id}/sdk/edit`);
    } catch (e2) {
      setErr(safeErr(e2?.detail?.detail || e2?.detail?.error || e2?.message || 'create failed'));
    } finally {
      setBusy(false);
    }
  }

  function next() {
    if (stepIdx < STEPS.length - 1) setStepIdx((i) => i + 1);
    else onSubmit();
  }
  function back() {
    if (stepIdx > 0) setStepIdx((i) => i - 1);
  }

  const isLast = stepIdx === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-30 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={onSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-2xl bg-ink-900 ring-1 ring-ink-800 rounded-xl flex flex-col max-h-[90vh]"
      >
        <header className="flex items-center justify-between p-5 border-b border-ink-800">
          <div className="space-y-1">
            <h2 className="text-base text-ink-100 tracking-tight">Detailed intake</h2>
            <p className="text-xs text-ink-500">
              Step {stepIdx + 1} of {STEPS.length} · {STEPS[stepIdx].label}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn-icon" aria-label="close">
            <X className="w-4 h-4" />
          </button>
        </header>

        <StepDots stepIdx={stepIdx} />

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {stepIdx === 0 && <PitchStep form={form} setField={setField} />}
          {stepIdx === 1 && <SettingStep form={form} setField={setField} />}
          {stepIdx === 2 && <VisualStep form={form} setField={setField} />}
          {stepIdx === 3 && <ScopeStep form={form} setField={setField} />}
        </div>

        {err ? <div className="text-xs text-red-400 px-5 pb-2">{err}</div> : null}

        <footer className="flex items-center justify-between gap-2 p-4 border-t border-ink-800">
          <button
            type="button"
            onClick={back}
            disabled={stepIdx === 0 || busy}
            className="btn"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="flex items-center gap-2 text-[11px] text-ink-500">
            <Sparkles className="w-3 h-3" />
            <span>blank fields are filled by inference</span>
          </div>
          <button
            type={isLast ? 'submit' : 'button'}
            onClick={isLast ? undefined : next}
            disabled={!ready || busy}
            className="btn-primary"
          >
            {busy ? (
              <><Loader2 className="w-4 h-4 animate-spin" /> Creating…</>
            ) : isLast ? (
              <>Create project <ArrowRight className="w-4 h-4" /></>
            ) : (
              <>Next <ArrowRight className="w-4 h-4" /></>
            )}
          </button>
        </footer>
      </form>
    </div>
  );
}

function StepDots({ stepIdx }) {
  return (
    <div className="flex items-center gap-1.5 px-5 py-2 border-b border-ink-800/60">
      {STEPS.map((s, i) => (
        <div
          key={s.key}
          className={`h-1 flex-1 rounded-full ${i <= stepIdx ? 'bg-accent' : 'bg-ink-800'}`}
        />
      ))}
    </div>
  );
}

function Label({ children, hint }) {
  return (
    <div className="space-y-0.5">
      <label className="block text-xs text-ink-300">{children}</label>
      {hint ? <p className="text-[11px] text-ink-500">{hint}</p> : null}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <Label hint={hint}>{label}</Label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder }) {
  return (
    <input
      type="text"
      className="w-full bg-ink-800/60 ring-1 ring-ink-800 focus:ring-ink-700 rounded-lg px-3 py-2 text-sm text-ink-100 placeholder-ink-500 outline-none"
      value={value || ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function TextArea({ value, onChange, placeholder, rows = 4 }) {
  return (
    <textarea
      rows={rows}
      className="w-full bg-ink-800/60 ring-1 ring-ink-800 focus:ring-ink-700 rounded-lg px-3 py-2 text-sm text-ink-100 placeholder-ink-500 outline-none resize-none"
      value={value || ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function NumberInput({ value, onChange, min, max }) {
  return (
    <input
      type="number"
      min={min}
      max={max}
      className="w-full bg-ink-800/60 ring-1 ring-ink-800 focus:ring-ink-700 rounded-lg px-3 py-2 text-sm text-ink-100 outline-none"
      value={value}
      onChange={(e) => {
        const n = parseInt(e.target.value, 10);
        onChange(Number.isFinite(n) ? n : value);
      }}
    />
  );
}

function Select({ value, onChange, options }) {
  return (
    <select
      className="w-full bg-ink-800/60 ring-1 ring-ink-800 focus:ring-ink-700 rounded-lg px-3 py-2 text-sm text-ink-100 outline-none"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((opt) => (
        <option key={opt || '__blank'} value={opt}>{opt === '' ? 'infer from pitch' : opt}</option>
      ))}
    </select>
  );
}

function Checkbox({ value, onChange, label }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-ink-200 cursor-pointer">
      <input
        type="checkbox"
        className="rounded bg-ink-800 border-ink-700"
        checked={!!value}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

// Repeatable list of single-line inputs.
function RefList({ values, onChange, placeholder }) {
  const arr = Array.isArray(values) ? values : [];
  function setAt(i, v) {
    const next = [...arr]; next[i] = v;
    onChange(next);
  }
  function addRow() { onChange([...arr, '']); }
  function removeRow(i) {
    const next = arr.filter((_, idx) => idx !== i);
    onChange(next.length ? next : ['']);
  }
  return (
    <div className="space-y-1.5">
      {arr.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <TextInput value={v} onChange={(nv) => setAt(i, nv)} placeholder={placeholder} />
          <button type="button" onClick={() => removeRow(i)} className="btn-icon" aria-label="remove">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addRow}
        className="text-xs text-ink-400 hover:text-ink-200"
      >
        + add row
      </button>
    </div>
  );
}

// Chip input — comma or enter to commit. Click chip to remove.
function ChipInput({ values, onChange, placeholder }) {
  const [draft, setDraft] = useState('');
  const arr = Array.isArray(values) ? values : [];
  function commit() {
    const cleaned = draft.split(',').map((s) => s.trim()).filter(Boolean);
    if (!cleaned.length) return;
    const merged = Array.from(new Set([...arr, ...cleaned]));
    onChange(merged);
    setDraft('');
  }
  function onKey(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && arr.length) {
      onChange(arr.slice(0, -1));
    }
  }
  function removeChip(i) {
    onChange(arr.filter((_, idx) => idx !== i));
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 bg-ink-800/60 ring-1 ring-ink-800 focus-within:ring-ink-700 rounded-lg px-2 py-1.5">
      {arr.map((v, i) => (
        <button
          key={i}
          type="button"
          onClick={() => removeChip(i)}
          className="inline-flex items-center gap-1 text-[11px] text-ink-200 bg-ink-800 hover:bg-ink-700 rounded-md px-2 py-0.5"
        >
          {v}
          <X className="w-3 h-3" />
        </button>
      ))}
      <input
        type="text"
        className="flex-1 min-w-[120px] bg-transparent border-0 outline-none text-sm text-ink-100 placeholder-ink-500 px-1 py-0.5"
        value={draft}
        placeholder={arr.length ? '' : placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKey}
        onBlur={commit}
      />
    </div>
  );
}

// --- Steps ---------------------------------------------------------------

function PitchStep({ form, setField }) {
  return (
    <>
      <Field
        label="Pitch (required)"
        hint="One to three sentences. Everything else can be left blank — the server fills it in."
      >
        <TextArea
          value={form.pitch}
          onChange={(v) => setField('pitch', v)}
          placeholder="a noir detective explores a haunted carnival to find their missing partner"
          rows={4}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Genre">
          <Select value={form.genre} onChange={(v) => setField('genre', v)} options={INTAKE_ENUMS.genre} />
        </Field>
        <Field label="Format">
          <Select value={form.format} onChange={(v) => setField('format', v)} options={INTAKE_ENUMS.format} />
        </Field>
      </div>
    </>
  );
}

function SettingStep({ form, setField }) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Era" hint="e.g. near-future 2049">
          <TextInput value={form.setting_era} onChange={(v) => setField('setting_era', v)} placeholder="" />
        </Field>
        <Field label="Location" hint="e.g. abandoned subway station">
          <TextInput value={form.setting_location} onChange={(v) => setField('setting_location', v)} placeholder="" />
        </Field>
        <Field label="Vibe" hint="3-6 words">
          <TextInput value={form.setting_vibe} onChange={(v) => setField('setting_vibe', v)} placeholder="" />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Protagonist name">
          <TextInput value={form.protagonist_name} onChange={(v) => setField('protagonist_name', v)} placeholder="" />
        </Field>
        <Field label="Archetype">
          <Select
            value={form.protagonist_archetype}
            onChange={(v) => setField('protagonist_archetype', v)}
            options={INTAKE_ENUMS.protagonist_archetype}
          />
        </Field>
      </div>
      <Field label="Antagonist or core obstacle" hint="Can be a force, not a person">
        <TextArea value={form.antagonist_or_obstacle} onChange={(v) => setField('antagonist_or_obstacle', v)} rows={2} placeholder="" />
      </Field>
      <Field label="Mentor or ally" hint="Optional">
        <TextArea value={form.mentor_or_ally} onChange={(v) => setField('mentor_or_ally', v)} rows={2} placeholder="" />
      </Field>
    </>
  );
}

function VisualStep({ form, setField }) {
  return (
    <>
      <Field label="Visual references" hint="Games, films, art — anything with strong 1-bit appeal">
        <RefList values={form.visual_refs} onChange={(v) => setField('visual_refs', v)} placeholder="Hotline Miami 1-bit, Return of the Obra Dinn, …" />
      </Field>
      <Field label="Visual keywords" hint="5-10 short words for the vibe">
        <ChipInput values={form.visual_keywords} onChange={(v) => setField('visual_keywords', v)} placeholder="wet asphalt, neon dither, hood up …" />
      </Field>
      <Field label="Tone references">
        <RefList values={form.tone_refs} onChange={(v) => setField('tone_refs', v)} placeholder="Annihilation, Disco Elysium …" />
      </Field>
      <Field label="Tone keywords">
        <ChipInput values={form.tone_keywords} onChange={(v) => setField('tone_keywords', v)} placeholder="melancholic, wry, dread …" />
      </Field>
      <Field label="Gameplay references">
        <RefList values={form.gameplay_refs} onChange={(v) => setField('gameplay_refs', v)} placeholder="Casino Inc lockpick, Layton puzzles …" />
      </Field>
    </>
  );
}

function ScopeStep({ form, setField }) {
  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Crank usage">
          <Select value={form.crank_usage} onChange={(v) => setField('crank_usage', v)} options={INTAKE_ENUMS.crank_usage} />
        </Field>
        <Field label="Audio direction">
          <Select value={form.audio_direction} onChange={(v) => setField('audio_direction', v)} options={INTAKE_ENUMS.audio_direction} />
        </Field>
      </div>
      <Field label="Accelerometer">
        <Checkbox
          value={form.accelerometer}
          onChange={(v) => setField('accelerometer', v)}
          label="At least one scene uses tilt"
        />
      </Field>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Scene count" hint="6-12 sane range">
          <NumberInput value={form.scene_count} onChange={(v) => setField('scene_count', v)} min={3} max={20} />
        </Field>
        <Field label="Minigames" hint="of scene_count">
          <NumberInput value={form.minigame_count} onChange={(v) => setField('minigame_count', v)} min={0} max={20} />
        </Field>
        <Field label="Playtime (min)" hint="target">
          <NumberInput value={form.playtime_target_min} onChange={(v) => setField('playtime_target_min', v)} min={5} max={300} />
        </Field>
      </div>
      <Field label="Save state">
        <Select value={form.save_state} onChange={(v) => setField('save_state', v)} options={INTAKE_ENUMS.save_state} />
      </Field>
    </>
  );
}

// Strip the placeholder empty strings from list fields before send — server
// already treats them as blank, but a tidier payload is easier to debug.
function sanitizeForSubmit(form) {
  const out = { ...form };
  for (const k of ['visual_refs', 'tone_refs', 'gameplay_refs']) {
    if (Array.isArray(out[k])) out[k] = out[k].map((s) => String(s).trim()).filter(Boolean);
  }
  out.pitch = (out.pitch || '').trim();
  return out;
}
