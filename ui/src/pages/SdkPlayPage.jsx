import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertTriangle, ArrowUp, ArrowDown, ArrowLeft as ArrLeft, ArrowRight, RotateCcw, RotateCw } from 'lucide-react';
import { api } from '../lib/api.js';
import StudioLogo from '../components/StudioLogo.jsx';

// Streams the server-side Playdate Simulator's framebuffer over WebSocket
// + routes touch controls back as xdotool keystrokes. The same
// PlaydateChassis from the pulp side wraps the canvas.
export default function SdkPlayPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const imgRef = useRef(null);
  const lastUrlRef = useRef(null);
  const wsRef = useRef(null);

  const [status, setStatus] = useState('connecting');
  const [errMsg, setErrMsg] = useState(null);

  // Compute WS URL with proper base detection for code-server proxies.
  useEffect(() => {
    const base = window.__APP_BASE__ || '';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}${base}/ws/sdk/preview/${id}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => setStatus('streaming');
    ws.onerror = () => { setStatus('error'); setErrMsg('websocket error'); };
    ws.onclose = () => { setStatus('closed'); };
    ws.onmessage = (e) => {
      // Two message shapes:
      //  - text JSON: { t: 'ready' | 'error', ... }   (control msgs)
      //  - binary ArrayBuffer: raw PNG bytes           (frames)
      if (typeof e.data === 'string') {
        let msg = null;
        try { msg = JSON.parse(e.data); } catch (_e) { return; }
        if (msg.t === 'ready') setStatus('streaming');
        else if (msg.t === 'error') {
          setStatus('error');
          setErrMsg(msg.message || msg.code || 'preview error');
        }
        return;
      }
      // Binary frame -> swap <img src>. Revoke the prior blob URL so we
      // don't leak per frame.
      const blob = new Blob([e.data], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const prev = lastUrlRef.current;
      lastUrlRef.current = url;
      if (imgRef.current) imgRef.current.src = url;
      if (prev) URL.revokeObjectURL(prev);
    };

    return () => {
      try { ws.close(); } catch (_e) { /* */ }
      if (lastUrlRef.current) { URL.revokeObjectURL(lastUrlRef.current); lastUrlRef.current = null; }
      api.post(`/api/projects/${id}/sdk/preview/stop`, {}).catch(() => {});
    };
  }, [id]);

  const attachCanvas = useCallback((node) => { imgRef.current = node; }, []);

  // Input bridge — POST per press.
  const sendAction = useCallback(async (action) => {
    try { await api.post(`/api/projects/${id}/sdk/preview/input`, { action }); }
    catch (_e) { /* dropped */ }
  }, [id]);

  // Keyboard bindings: arrows + zx for A/B, comma/period for crank.
  useEffect(() => {
    const onKey = (e) => {
      const m = {
        ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
        z: 'a', Z: 'a', x: 'b', X: 'b',
        ',': 'crank_ccw', '.': 'crank_cw'
      };
      const a = m[e.key];
      if (!a) return;
      e.preventDefault();
      sendAction(a);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sendAction]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-ink-900 text-ink-100">
      <header className="flex items-center justify-between px-3 h-11 border-b border-ink-800 bg-ink-900">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => navigate(`/project/${id}`)}
            className="btn text-xs"
            title="back to project"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> project
          </button>
          <span className="text-ink-600 text-xs">/</span>
          <StudioLogo size="sm" className="h-5 w-auto" />
          <span className="text-sm text-ink-100 truncate">{id}</span>
          <span className="pill">sdk preview</span>
        </div>
        <div className="flex items-center gap-2 text-xs">
          {status === 'streaming' ? (
            <span className="inline-flex items-center text-ink-300">
              <span className="pill-dot bg-accent" /> live
            </span>
          )
            : status === 'connecting' ? <span className="text-ink-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> connecting</span>
            : status === 'error' ? <span className="text-red-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {errMsg}</span>
            : <span className="text-ink-500">{status}</span>}
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center gap-4 p-2">
        {status === 'error' ? (
          <div className="card max-w-xl text-sm space-y-2">
            <div className="text-red-400 font-medium">simulator preview failed</div>
            <div className="text-ink-400">{errMsg}</div>
            <div className="text-ink-500 text-xs">
              Common causes: no completed export yet (run build first), Xvfb / xdotool
              missing on the host, Playdate SDK not installed at PLAYDATE_SDK_PATH.
            </div>
          </div>
        ) : null}

        <img
          ref={attachCanvas}
          alt="sdk preview"
          style={{
            maxWidth: '95vw',
            maxHeight: 'calc(100vh - 180px)',
            imageRendering: 'pixelated',
            display: 'block',
            background: '#000',
            objectFit: 'contain'
          }}
        />

        <div className="flex items-center gap-6">
          <div className="grid grid-cols-3 grid-rows-3 gap-1">
            <span />
            <button type="button" className="btn p-2" onClick={() => sendAction('up')}><ArrowUp className="w-4 h-4" /></button>
            <span />
            <button type="button" className="btn p-2" onClick={() => sendAction('left')}><ArrLeft className="w-4 h-4" /></button>
            <span />
            <button type="button" className="btn p-2" onClick={() => sendAction('right')}><ArrowRight className="w-4 h-4" /></button>
            <span />
            <button type="button" className="btn p-2" onClick={() => sendAction('down')}><ArrowDown className="w-4 h-4" /></button>
            <span />
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn h-12 w-12 rounded-full text-lg" onClick={() => sendAction('b')}>B</button>
            <button type="button" className="btn h-12 w-12 rounded-full text-lg" onClick={() => sendAction('a')}>A</button>
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn p-2" title="crank CCW (,)" onClick={() => sendAction('crank_ccw')}><RotateCcw className="w-4 h-4" /></button>
            <button type="button" className="btn p-2" title="crank CW (.)" onClick={() => sendAction('crank_cw')}><RotateCw className="w-4 h-4" /></button>
            <button type="button" className="btn px-3 text-xs" onClick={() => sendAction('dock')}>DOCK</button>
          </div>
        </div>

        <div className="text-[10px] text-ink-500 font-mono text-center">
          keys: arrows · Z/X = A/B · , . = crank · real PlaydateSimulator on server
        </div>
      </main>
    </div>
  );
}
