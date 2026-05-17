import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Upload, Sparkles, Trash2, X, Image as ImageIcon } from 'lucide-react';
import {
  uploadScene,
  generateScene,
  clearScene,
  sceneUrl,
  validateSceneFiles,
  SCENE_STYLE_LOCK
} from '../lib/pulp_scenes.js';

// PulpSceneControls
//
// Per-room background scene UI. Lives in the right-rail of PulpRooms above
// the song/script fields.
//
// Props:
//   project          { id, ... }
//   room             { id, ... }
//   onSceneChanged() callback fired on any mutation (upload/generate/clear)
//                    so the parent can bump its sceneCacheKey and the
//                    PulpRoomBackground re-fetches.
export default function PulpSceneControls({ project, room, onSceneChanged }) {
  const [busy, setBusy] = useState(null); // 'upload' | 'generate' | 'clear' | null
  const [err, setErr] = useState(null);
  const [cacheBust, setCacheBust] = useState(() => Date.now());
  const [imgFailed, setImgFailed] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [styleLock, setStyleLock] = useState(true);
  const fileInputRef = useRef(null);

  // Whenever room changes, reset transient state.
  useEffect(() => {
    setErr(null);
    setCacheBust(Date.now());
    setImgFailed(false);
    setPromptOpen(false);
    setPrompt('');
  }, [room?.id]);

  // Bump local cache on cacheBust change (so thumbnail retries after upload).
  useEffect(() => { setImgFailed(false); }, [cacheBust]);

  const bump = useCallback(() => {
    setCacheBust(Date.now());
    onSceneChanged?.();
  }, [onSceneChanged]);

  async function handleFile(file) {
    if (!file || !room) return;
    const { accepted, skipped } = validateSceneFiles([file], 'single');
    if (skipped.length) { setErr(skipped[0].reason); return; }
    if (!accepted[0]) return;
    setBusy('upload');
    setErr(null);
    try {
      await uploadScene(project.id, room.id, accepted[0]);
      bump();
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
    if (f) handleFile(f);
    e.target.value = '';
  }

  async function handleGenerate() {
    if (!room) return;
    const p = prompt.trim();
    if (!p) return;
    setBusy('generate');
    setErr(null);
    try {
      const body = { prompt: p };
      if (styleLock) body.style = SCENE_STYLE_LOCK;
      await generateScene(project.id, room.id, body);
      bump();
      setPromptOpen(false);
      setPrompt('');
    } catch (e) {
      setErr(e.detail?.error || e.message || 'generation failed');
    } finally {
      setBusy(null);
    }
  }

  async function handleClear() {
    if (!room) return;
    if (!window.confirm('clear background scene for this room?')) return;
    setBusy('clear');
    setErr(null);
    try {
      await clearScene(project.id, room.id);
      bump();
    } catch (e) {
      setErr(e.detail?.error || e.message || 'clear failed');
    } finally {
      setBusy(null);
    }
  }

  if (!room) return null;

  return (
    <div className="space-y-2 border-t border-ink-700 pt-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-wide text-ink-500 font-mono">
          background scene
        </h3>
        <span className="text-[9px] text-ink-600 font-mono">400×240</span>
      </div>

      {/* Preview thumbnail (96×57 to match 5:3 scene ratio) */}
      <div
        className="relative border border-ink-700 rounded bg-ink-900 overflow-hidden"
        style={{ width: 96, height: 57 }}
      >
        <img
          src={sceneUrl(project.id, room.id, cacheBust)}
          alt=""
          aria-hidden="true"
          className={`absolute inset-0 w-full h-full object-cover ${imgFailed ? 'invisible' : ''}`}
          style={{ imageRendering: 'pixelated' }}
          onError={() => setImgFailed(true)}
          onLoad={() => setImgFailed(false)}
        />
        {imgFailed ? (
          <div className="absolute inset-0 flex items-center justify-center text-ink-600">
            <ImageIcon className="w-4 h-4" />
          </div>
        ) : null}
        {busy ? (
          <div className="absolute inset-0 bg-ink-900/70 flex items-center justify-center text-ink-200 text-[10px] gap-1">
            <Loader2 className="w-3 h-3 animate-spin" />
            {busy}
          </div>
        ) : null}
      </div>

      <div className="flex items-center gap-1 flex-wrap">
        <button
          type="button"
          className="btn text-[11px]"
          onClick={onPickClick}
          disabled={!!busy}
          title="upload an image"
        >
          <Upload className="w-3 h-3" /> upload
        </button>
        <button
          type="button"
          className="btn text-[11px]"
          onClick={() => setPromptOpen((v) => !v)}
          disabled={!!busy}
          title="generate with ai"
        >
          <Sparkles className="w-3 h-3" /> generate
        </button>
        <button
          type="button"
          className="btn text-[11px] text-red-400 border-red-900/60"
          onClick={handleClear}
          disabled={!!busy || imgFailed}
          title="remove background"
        >
          <Trash2 className="w-3 h-3" /> clear
        </button>
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
            placeholder="a moonlit alley behind a noir speakeasy, isometric"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy === 'generate'}
          />
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setStyleLock((v) => !v)}
              disabled={busy === 'generate'}
              className={`text-[10px] font-mono px-2 py-0.5 rounded border ${
                styleLock
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-ink-700 text-ink-500'
              }`}
              title="lock the playdate isometric style"
            >
              {styleLock ? '◉' : '○'} {SCENE_STYLE_LOCK}
            </button>
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

      {err ? <div className="text-[11px] text-red-400">{err}</div> : null}

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
