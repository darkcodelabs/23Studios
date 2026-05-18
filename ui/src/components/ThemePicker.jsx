import { useState, useEffect, useRef } from 'react';
import { Palette, Check } from 'lucide-react';
import { useTheme } from '../lib/use_theme.js';

// Compact theme picker. Renders a btn-icon trigger; opens a small popover
// of color swatches. Click a swatch -> theme applies + persists.
export default function ThemePicker() {
  const { theme, setTheme, themes } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    function onKey(e) { if (e.key === 'Escape') setOpen(false); }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="btn-icon"
        onClick={() => setOpen((v) => !v)}
        aria-label="change theme"
        title="change theme"
      >
        <Palette className="w-4 h-4" />
      </button>
      {open ? (
        <div className="absolute right-0 mt-1 w-44 rounded-md bg-ink-900 ring-1 ring-ink-800 shadow-lg z-30 animate-fade-in py-1">
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { setTheme(t.id); setOpen(false); }}
              className="w-full px-2 py-1.5 flex items-center gap-2 text-xs text-ink-300 hover:bg-ink-800/60 hover:text-ink-100 transition-colors"
            >
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ background: t.accent }}
              />
              <span className="flex-1 text-left">{t.name}</span>
              {theme === t.id ? <Check className="w-3 h-3 text-ink-400" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
