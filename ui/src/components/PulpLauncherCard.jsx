import { safeErr } from '../lib/format_err.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Upload, Sparkles, X } from 'lucide-react';
import {
  uploadLauncherCard,
  generateLauncherCard,
  launcherCardUrl,
  validateFiles
} from '../lib/pulp_upload.js';

// Pulp launcher card preview + controls.
// Source priority:
//   1) live <img src=/pulp/launcher-card?v=...> if pulp.launcher_card_path
//   2) fallback "text card" mirroring the old inline LauncherPreview
//
// Controls (under the canvas):
//   - Upload  → file picker → POST /launcher-card
//   - Generate→ inline prompt → POST /launcher-card/generate
//   - Remove  → PATCH /pulp { launcher_card_path: '' } (spec has no DELETE)
//
// Calls onChange(updatedPulp) after each mutation so the parent can re-render.
export default function PulpLauncherCard({ project, pulp, onChange }) {
  const [busy, setBusy] = useState(null); // 'upload' | 'generate' | null
  const [err, setErr] = useState(null);
  const [cacheBust, setCacheBust] = useState(() => Date.now());
  const [imgFailed, setImgFailed] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // Reset failure flag whenever we bust cache so a fresh upload gets a retry.
  useEffect(() => { setImgFailed(false); }, [cacheBust]);

  const hasCard = !imgFailed;

  const refresh = useCallback(() => {
    setCacheBust(Date.now());
    // Pulp project record has no launcher_card_path field; ignore onChange.
  }, []);

  async function handleUploadFile(file) {
    if (!file) return;
    const { accepted, skipped } = validateFiles('launcher', [file]);
    if (skipped.length) {
      setErr(skipped[0].reason);
      return;
    }
    if (!accepted[0]) return;
    setBusy('upload');
    setErr(null);
    try {
      await uploadLauncherCard(project.id, accepted[0]);
      refresh();
    } catch (e) {
      setErr(e.detail?.error || e.message || 'upload failed');
    } finally {
      setBusy(null);
    }
  }

  function onPickClick() {
    fileInputRef.current?.click();
  }

  function onPickChange(e) {
    const f = e.target.files?.[0];
    if (f) handleUploadFile(f);
    // reset so picking the same file again still fires onChange
    e.target.value = '';
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && /^image\//.test(f.type)) handleUploadFile(f);
  }

  async function handleGenerate() {
    const p = prompt.trim();
    if (!p) return;
    setBusy('generate');
    setErr(null);
    try {
      await generateLauncherCard(project.id, { prompt: p });
      refresh();
      setPromptOpen(false);
      setPrompt('');
    } catch (e) {
      setErr(e.detail?.error || e.message || 'generation failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <div
        className={`relative aspect-[5/3] bg-ink-800 border rounded-md overflow-hidden ${dragOver ? 'border-accent' : 'border-ink-700'}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        title={hasCard ? 'launcher card · drag a new image to replace' : 'launcher card · drag an image here to upload'}
      >
        <img
          src={launcherCardUrl(project.id, cacheBust)}
          alt="launcher card"
          className={`absolute inset-0 w-full h-full object-cover ${imgFailed ? 'invisible' : ''}`}
          style={{ imageRendering: 'pixelated' }}
          onError={() => setImgFailed(true)}
          onLoad={() => setImgFailed(false)}
        />
        {imgFailed ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center px-3">
              <div className="font-mono text-sm text-ink-100 truncate">
                {pulp?.name || project.name}
              </div>
              <div className="text-[10px] text-ink-500 mt-1 truncate">
                {pulp?.author || project.developer || '23 Studios'}
              </div>
            </div>
          </div>
        ) : null}

        {busy ? (
          <div className="absolute inset-0 bg-ink-900/70 flex items-center justify-center text-ink-200 text-[11px] gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            {busy === 'upload' ? 'uploading…' : busy === 'generate' ? 'generating…' : 'updating…'}
          </div>
        ) : null}

        {dragOver ? (
          <div className="absolute inset-0 bg-accent/10 border-2 border-dashed border-accent flex items-center justify-center text-accent text-xs font-mono pointer-events-none">
            drop to upload
          </div>
        ) : null}
      </div>

      <div className="text-[10px] text-ink-500 text-center font-mono">launcher card · 350×155</div>

      <div className="flex items-center gap-1 flex-wrap">
        <button
          type="button"
          className="btn text-[11px]"
          onClick={onPickClick}
          disabled={!!busy}
        >
          <Upload className="w-3 h-3" /> upload
        </button>
        <button
          type="button"
          className="btn text-[11px]"
          onClick={() => setPromptOpen((v) => !v)}
          disabled={!!busy}
        >
          <Sparkles className="w-3 h-3" /> generate
        </button>
        {/* Remove: no server delete endpoint; re-upload to overwrite. */}
      </div>

      {promptOpen ? (
        <div className="border border-ink-700 rounded-md p-2 space-y-2 bg-ink-900/40">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-ink-500">prompt</span>
            <button
              type="button"
              className="text-ink-400 hover:text-ink-200"
              onClick={() => { setPromptOpen(false); setPrompt(''); }}
              disabled={busy === 'generate'}
              aria-label="close prompt"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <textarea
            className="input font-mono text-[11px]"
            rows={3}
            placeholder="a moody pixel-art title card for a haunted house adventure"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy === 'generate'}
          />
          <div className="flex justify-end">
            <button
              type="button"
              className="btn-primary text-[11px]"
              onClick={handleGenerate}
              disabled={!prompt.trim() || busy === 'generate'}
            >
              {busy === 'generate'
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : <Sparkles className="w-3 h-3" />}
              generate
            </button>
          </div>
        </div>
      ) : null}

      {err ? <div className="text-[11px] text-red-400">{safeErr(err)}</div> : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onPickChange}
      />
    </div>
  );
}
