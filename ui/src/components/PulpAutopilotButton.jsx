import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, X, Sparkles } from 'lucide-react';
import PulpAutopilotProgress from './PulpAutopilotProgress.jsx';

// One button → modal with a single textarea + "GENERATE THE GAME" button.
// On submit, the same modal flips to PulpAutopilotProgress (live SSE feed).
//
// Props:
//   project: { id, ... }  required
//   variant?: 'primary' | 'icon' | 'hero'  (visual size)
//   label?: string         (button label override, ignored for icon variant)
//   onClose?: () => void   (notified when the modal closes)
//   onDone?: ({summary}) => void
//
// If `variant='icon'` we render a single rocket icon button (for the editor
// header bar). Otherwise a full button. `hero` makes it huge for empty-state.
export default function PulpAutopilotButton({
  project, variant = 'primary', label, onClose, onDone, defaultPitch = ''
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'running'
  const [pitch, setPitch] = useState(defaultPitch);
  const [model] = useState(''); // reserved; default model

  function startModal() { setOpen(true); setPhase('idle'); setPitch(defaultPitch); }
  function closeModal() { setOpen(false); setPhase('idle'); onClose?.(); }

  function onGo() {
    const cleaned = (pitch || '').trim();
    if (!cleaned) return;
    setPhase('running');
  }

  const btn = renderButton(variant, label, startModal);

  return (
    <>
      {btn}
      {open && project?.id ? (
        <div
          className="fixed inset-0 z-30 bg-ink-900/80 flex items-center justify-center p-4"
          onClick={closeModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl bg-ink-800 border border-ink-600 rounded-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-mono text-base text-ink-100 flex items-center gap-2">
                <Rocket className="w-4 h-4 text-accent" />
                Press Go
              </h2>
              <button type="button" onClick={closeModal} className="text-ink-400 hover:text-ink-200" aria-label="close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {phase === 'idle' ? (
              <PitchForm
                pitch={pitch}
                onChange={setPitch}
                onGo={onGo}
                project={project}
              />
            ) : (
              <PulpAutopilotProgress
                projectId={project.id}
                pitch={pitch.trim()}
                model={model || undefined}
                onClose={closeModal}
                onDone={onDone}
              />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function PitchForm({ pitch, onChange, onGo, project }) {
  const ready = pitch.trim().length > 0;
  return (
    <div className="space-y-3">
      <div className="text-xs text-ink-300">
        Pitch your game in one sentence. We'll handle the rest — stages, tiles, scenes, sounds, scripts.
      </div>
      <textarea
        autoFocus
        className="input font-mono text-sm"
        rows={3}
        maxLength={4000}
        placeholder="a noir detective explores a haunted carnival to find their missing partner"
        value={pitch}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="text-[10px] text-ink-500 text-right">
        {pitch.length} / 4000
      </div>
      <button
        type="button"
        className="w-full rounded-md font-mono text-base tracking-wide bg-accent text-ink-900 hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed py-4 flex items-center justify-center gap-2"
        disabled={!ready}
        onClick={onGo}
      >
        <Sparkles className="w-5 h-5" />
        GENERATE THE GAME
      </button>
      <div className="text-[10px] text-ink-500 text-center">
        target: <span className="font-mono">{project?.name || project?.id}</span> · est 5-10 min
      </div>
    </div>
  );
}

function renderButton(variant, label, onClick) {
  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={onClick}
        className="btn text-xs"
        title="press go — autopilot"
      >
        <Rocket className="w-3.5 h-3.5" />
      </button>
    );
  }
  if (variant === 'hero') {
    return (
      <button
        type="button"
        onClick={onClick}
        className="rounded-md font-mono text-base tracking-wide bg-accent text-ink-900 hover:bg-accent/90 px-6 py-3 flex items-center justify-center gap-2"
      >
        <Rocket className="w-5 h-5" />
        {label || 'PRESS GO — generate the whole thing'}
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} className="btn-primary text-xs">
      <Rocket className="w-3.5 h-3.5" />
      {label || 'press go'}
    </button>
  );
}
