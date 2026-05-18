import { safeErr } from '../lib/format_err.js';
import { useEffect, useState } from 'react';
import { FileText, Loader2, X } from 'lucide-react';
import { api } from '../lib/api.js';

const LANG_BY_EXT = {
  '.js': 'javascript', '.jsx': 'jsx', '.ts': 'typescript', '.tsx': 'tsx',
  '.py': 'python', '.lua': 'lua', '.sh': 'bash', '.json': 'json',
  '.md': 'markdown', '.yaml': 'yaml', '.yml': 'yaml', '.toml': 'toml',
  '.css': 'css', '.html': 'html', '.c': 'c', '.h': 'c', '.cpp': 'cpp'
};

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);

function lang(ext) { return LANG_BY_EXT[ext] || 'text'; }
function ext(path) {
  if (!path) return '';
  const i = path.lastIndexOf('.');
  if (i < 0) return '';
  return path.slice(i).toLowerCase();
}
function isImage(path) { return IMAGE_EXTS.has(ext(path)); }

// Construct an APP_BASE-aware raw asset URL. The server may not yet expose
// this endpoint; if it 404s the <img> onerror handler shows a friendly note.
function rawUrl(projectId, filePath) {
  const base = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
  return `${base}/api/projects/${projectId}/file/raw?path=${encodeURIComponent(filePath)}`;
}

export default function FileViewer({ projectId, filePath }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [imgDims, setImgDims] = useState(null);

  // Skip the text fetch entirely for images. The viewer renders the binary
  // via <img src> instead.
  useEffect(() => {
    if (!filePath) { setData(null); setErr(null); return; }
    if (isImage(filePath)) {
      setData({ image: true, ext: ext(filePath), path: filePath });
      setErr(null);
      setLoading(false);
      setImgDims(null);
      return;
    }
    let alive = true;
    setLoading(true);
    setErr(null);
    (async () => {
      try {
        const r = await api.get(`/api/projects/${projectId}/file?path=${encodeURIComponent(filePath)}`);
        if (alive) setData(r);
      } catch (e) {
        if (alive) {
          if (e.status === 413) setErr('file too large (>1 MB)');
          else if (e.status === 415) setErr('binary file');
          else if (e.status === 403) setErr('forbidden');
          else setErr('failed to load');
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [projectId, filePath]);

  // ESC closes the lightbox.
  useEffect(() => {
    if (!lightbox) return;
    function onKey(e) { if (e.key === 'Escape') setLightbox(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);

  if (!filePath) {
    return (
      <div className="h-full flex items-center justify-center text-ink-500 text-sm">
        Select a file
      </div>
    );
  }

  const showImage = data && data.image;
  // Pixelated rendering hint when the source frame is under 512px wide —
  // keeps 1-bit pixel-art crisp instead of bilinear-blurred.
  const pixelated = imgDims && imgDims.w < 512;

  return (
    <div className="h-full flex flex-col bg-ink-900">
      <div className="px-3 h-9 border-b border-ink-800 flex items-center gap-2 text-xs text-ink-400">
        <FileText className="w-3.5 h-3.5 text-ink-500" />
        <span className="truncate font-mono">{filePath}</span>
        {data && !showImage ? (
          <>
            <span className="pill ml-auto">{lang(data.ext)}</span>
            <span className="text-ink-500 font-mono">{data.size} b</span>
          </>
        ) : null}
        {showImage && imgDims ? (
          <span className="ml-auto text-ink-500 font-mono">{imgDims.w}×{imgDims.h}</span>
        ) : null}
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="p-6 flex items-center gap-2 text-ink-400 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" /> loading…
          </div>
        ) : err ? (
          <div className="p-6 text-sm text-red-400">{safeErr(err)}</div>
        ) : showImage ? (
          <ImagePanel
            src={rawUrl(projectId, filePath)}
            alt={filePath}
            pixelated={pixelated}
            onOpen={() => setLightbox(true)}
            onLoadDims={setImgDims}
          />
        ) : data ? (
          <pre className="p-4 text-xs font-mono text-ink-100 whitespace-pre overflow-x-auto leading-relaxed">
            {data.content}
          </pre>
        ) : null}
      </div>

      {lightbox && showImage ? (
        <Lightbox
          src={rawUrl(projectId, filePath)}
          alt={filePath}
          pixelated={pixelated}
          onClose={() => setLightbox(false)}
        />
      ) : null}
    </div>
  );
}

// Full-bleed image render. No button chrome around the trigger — the image
// itself is the click target. Falls back to a quiet error tile if the raw
// endpoint isn't available on the server yet.
function ImagePanel({ src, alt, pixelated, onOpen, onLoadDims }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-sm text-ink-400 text-center max-w-sm">
          Image preview unavailable.
          <div className="text-xs text-ink-500 mt-2">
            Server has not exposed a raw asset endpoint for <span className="font-mono">{alt}</span>.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="h-full w-full flex items-center justify-center p-6 bg-ink-950/50">
      <img
        src={src}
        alt={alt}
        onClick={onOpen}
        onError={() => setFailed(true)}
        onLoad={(e) => onLoadDims?.({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
        className={`max-w-full max-h-full object-contain cursor-zoom-in ${pixelated ? 'pixelated' : ''}`}
      />
    </div>
  );
}

// Click-to-preview lightbox. ESC closes. Click background closes. The image
// itself does NOT close on click — so users can scroll/pan freely.
function Lightbox({ src, alt, pixelated, onClose }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-8 animate-fade-in"
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute top-4 right-4 btn-icon text-ink-100"
        aria-label="close preview"
      >
        <X className="w-5 h-5" />
      </button>
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className={`max-w-[95vw] max-h-[95vh] object-contain cursor-default ${pixelated ? 'pixelated' : ''}`}
      />
    </div>
  );
}
