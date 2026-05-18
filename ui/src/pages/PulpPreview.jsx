import { Eye, ExternalLink } from 'lucide-react';
import { useProject } from '../lib/pulp_workspace.js';
import PulpPreviewGallery from '../components/PulpPreviewGallery.jsx';

// Page wrapper for the unified preview gallery. Lives on its own tab so the
// user can judge autopilot output at a glance without click-walking through
// every editor tab.
export default function PulpPreview({ onJumpTab }) {
  const project = useProject();
  if (!project) {
    return <div className="p-6 text-sm text-ink-400">loading project…</div>;
  }
  return (
    <div className="h-full flex flex-col p-3 gap-3">
      <header className="flex items-center gap-2">
        <Eye className="w-4 h-4 text-accent" />
        <h2 className="text-sm font-mono text-ink-100">preview</h2>
        <span className="text-[10px] text-ink-500 font-mono">
          every tile, scene, sound, and song in this project
        </span>
        <div className="flex-1" />
        <JumpLink onClick={() => onJumpTab?.('tile')}  label="tiles" />
        <JumpLink onClick={() => onJumpTab?.('room')}  label="scenes" />
        <JumpLink onClick={() => onJumpTab?.('sound')} label="sounds" />
        <JumpLink onClick={() => onJumpTab?.('song')}  label="songs" />
      </header>

      <div className="flex-1 min-h-0 border border-ink-700 rounded bg-ink-900/30 p-3">
        <PulpPreviewGallery
          projectId={project.id}
          live={false}
          onJumpTab={onJumpTab}
        />
      </div>
    </div>
  );
}

function JumpLink({ onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[10px] font-mono text-ink-400 hover:text-accent px-2 py-0.5 border border-ink-700 hover:border-accent rounded flex items-center gap-1"
    >
      <ExternalLink className="w-3 h-3" /> open {label}
    </button>
  );
}
