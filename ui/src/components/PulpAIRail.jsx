import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';

const CONTEXT_BY_TAB = {
  game:   { title: 'AI Assist · Game',   suggestions: ['Generate a launcher card from theme', 'Write a one-line tagline'] },
  font:   { title: 'AI Assist · Font',   suggestions: ['Generate a custom pixel font from style', 'Stylize all glyphs at once'] },
  room:   { title: 'AI Assist · Room',   suggestions: ['Generate a 25x15 layout from prompt', 'Add cover/objects to current layout'] },
  tile:   { title: 'AI Assist · Tile',   suggestions: ['Generate tile art (current frame)', 'Generate a 4-frame walk cycle', 'Suggest variations'] },
  song:   { title: 'AI Assist · Song',   suggestions: ['Compose a melody for this scene', 'Add a bass line', 'Vary instrument'] },
  sound:  { title: 'AI Assist · Sound',  suggestions: ['Generate SFX from description', 'Re-shape envelope'] },
  script: { title: 'AI Assist · Script', suggestions: ['Write event handler for confirm', 'Add interaction with key tile', 'Refactor with simpler control flow'] }
};

export default function PulpAIRail({ activeTab, onClose }) {
  const ctx = CONTEXT_BY_TAB[activeTab] || CONTEXT_BY_TAB.game;
  const [prompt, setPrompt] = useState('');

  return (
    <aside className="w-72 shrink-0 border-l border-ink-700 bg-ink-900/60 flex flex-col text-xs">
      <div className="px-3 py-2 border-b border-ink-700 flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-accent" />
        <span className="font-mono text-ink-200">{ctx.title}</span>
        <div className="flex-1" />
        <button onClick={onClose} className="text-ink-500 hover:text-ink-200" aria-label="close ai rail">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-2 space-y-2 border-b border-ink-700">
        <div className="text-[10px] uppercase tracking-wider text-ink-500">quick prompts</div>
        <div className="flex flex-col gap-1">
          {ctx.suggestions.map((s) => (
            <button
              key={s}
              onClick={() => setPrompt(s)}
              className="text-left px-2 py-1.5 rounded hover:bg-ink-800/60 text-ink-300 hover:text-ink-100 font-mono"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-ink-500 leading-relaxed">
        <p className="mb-2">
          Open the relevant tab and pick the asset you want help with. Use the
          inline AI buttons (✨) on the canvas — they call the right endpoint
          with your current selection as context.
        </p>
        <p>
          This rail is for free-form prompts. Pick a quick prompt above to
          pre-fill, then edit and send.
        </p>
      </div>

      <form
        className="p-2 border-t border-ink-700 flex gap-1"
        onSubmit={(e) => { e.preventDefault(); /* free-form ai call TBD */ }}
      >
        <input
          className="input text-xs font-mono"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="describe what you want…"
        />
        <button type="submit" className="btn-primary text-xs" disabled={!prompt.trim()}>
          <Sparkles className="w-3.5 h-3.5" />
        </button>
      </form>
    </aside>
  );
}
