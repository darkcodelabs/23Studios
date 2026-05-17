import { Type } from 'lucide-react';

export default function PulpFontTab() {
  return (
    <div className="h-full flex flex-col items-center justify-center text-ink-500 text-sm gap-3">
      <Type className="w-8 h-8 text-ink-600" />
      <div className="font-mono text-base text-ink-300">font editor</div>
      <p className="max-w-md text-center text-xs">
        glyph grid + custom font import lands in phase 3. for now games use the
        playdate system font.
      </p>
    </div>
  );
}
