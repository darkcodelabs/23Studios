import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wand2, X, Sparkles, ArrowRight } from 'lucide-react';
import PulpAutopilotProgress from './PulpAutopilotProgress.jsx';

// One button → modal with a single textarea + GO button.
// On submit, the same modal flips to PulpAutopilotProgress (live SSE feed).
//
// Props are unchanged from the prior implementation; only visuals were
// flattened to match the new btn / btn-primary / pill conventions. The icon
// button variant still exists for the editor header bar.
export default function PulpAutopilotButton({
  project, variant = 'primary', label, onClose, onDone, defaultPitch = ''
}) {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState('idle'); // 'idle' | 'running'
  const [pitch, setPitch] = useState(defaultPitch);
  const [model] = useState(''); // reserved; default model
  const navigate = useNavigate();

  function onJumpTab(tabId, assetId) {
    if (!project?.id) return;
    const params = new URLSearchParams();
    params.set('tab', tabId);
    if (assetId) params.set('focus', assetId);
    navigate(`/project/${project.id}/edit?${params.toString()}`);
  }

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
          className="fixed inset-0 z-30 bg-black/70 flex items-center justify-center p-4"
          onClick={closeModal}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl bg-ink-900 ring-1 ring-ink-800 rounded-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-base text-ink-100 tracking-tight flex items-center gap-2">
                <Wand2 className="w-4 h-4 text-ink-300" />
                Press go
              </h2>
              <button type="button" onClick={closeModal} className="btn-icon" aria-label="close">
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
                onJumpTab={onJumpTab}
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
      <div className="text-sm text-ink-300">
        Pitch your game in one sentence. We'll handle the rest — stages, tiles, scenes, sounds, scripts.
      </div>
      <textarea
        autoFocus
        className="input text-sm"
        rows={3}
        maxLength={4000}
        placeholder="a noir detective explores a haunted carnival to find their missing partner"
        value={pitch}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="text-[10px] text-ink-500 text-right font-mono">
        {pitch.length} / 4000
      </div>
      <button
        type="button"
        className="btn-primary w-full py-3 text-sm"
        disabled={!ready}
        onClick={onGo}
      >
        <Sparkles className="w-4 h-4" />
        Generate the game
      </button>
      <div className="text-[10px] text-ink-500 text-center">
        target: <span className="font-mono text-ink-400">{project?.name || project?.id}</span> · est 5-10 min
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
        className="btn-icon"
        title="press go — autopilot"
        aria-label="autopilot"
      >
        <Wand2 className="w-4 h-4" />
      </button>
    );
  }
  if (variant === 'hero') {
    return (
      <button
        type="button"
        onClick={onClick}
        className="btn-primary px-6 py-3 text-base"
      >
        <Sparkles className="w-5 h-5" />
        {label || 'Press go'}
        <ArrowRight className="w-4 h-4" />
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} className="btn-primary text-xs">
      <Wand2 className="w-3.5 h-3.5" />
      {label || 'press go'}
    </button>
  );
}
