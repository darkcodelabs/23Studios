import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api.js';
import PlaydateChassis from '../components/PlaydateChassis.jsx';
import StudioLogo from '../components/StudioLogo.jsx';

// Streams the server-side Playdate Simulator's framebuffer over WebSocket
// + routes touch controls back as xdotool keystrokes. The same
// PlaydateChassis from the pulp side wraps the canvas.
export default function SdkPlayPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
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
      // Binary frame.
      const blob = new Blob([e.data], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        if (ctxRef.current) {
          ctxRef.current.imageSmoothingEnabled = false;
          ctxRef.current.drawImage(img, 0, 0, 400, 240);
        }
        URL.revokeObjectURL(url);
      };
      img.src = url;
    };

    return () => {
      try { ws.close(); } catch (_e) { /* */ }
      // Best-effort stop on unmount.
      api.post(`/api/projects/${id}/sdk/preview/stop`, {}).catch(() => {});
    };
  }, [id]);

  // Bind canvas ctx ref.
  const attachCanvas = useCallback((node) => {
    canvasRef.current = node;
    if (node) {
      const ctx = node.getContext('2d');
      ctxRef.current = ctx;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 400, 240);
    }
  }, []);

  // Input bridge — POST per press.
  const sendAction = useCallback(async (action) => {
    try { await api.post(`/api/projects/${id}/sdk/preview/input`, { action }); }
    catch (_e) { /* dropped */ }
  }, [id]);

  const onDpadPress = useCallback((dir) => sendAction(dir), [sendAction]);
  const onDpadRelease = useCallback(() => {}, []);
  const onABPress = useCallback((which) => sendAction(which === 'a' ? 'a' : 'b'), [sendAction]);
  const onABRelease = useCallback(() => {}, []);

  // Crank ticks: aggregate degrees, fire CCW/CW key per CRANK_DEG threshold.
  const crankAccumRef = useRef(0);
  const onCrankRotate = useCallback((deltaDeg) => {
    crankAccumRef.current += deltaDeg;
    while (Math.abs(crankAccumRef.current) >= 18) {
      const dir = crankAccumRef.current > 0 ? 'crank_cw' : 'crank_ccw';
      sendAction(dir);
      crankAccumRef.current -= Math.sign(crankAccumRef.current) * 18;
    }
  }, [sendAction]);
  const onCrankDock = useCallback(() => sendAction('dock'), [sendAction]);

  return (
    <div className="h-screen overflow-auto bg-ink-900 text-ink-100">
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

      <main className="p-4 md:p-8 flex flex-col items-center gap-4">
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

        <div className="relative w-full" style={{ maxWidth: 780, paddingRight: 70 }}>
          <PlaydateChassis
            ref={attachCanvas}
            canvasW={400}
            canvasH={240}
            onDpadPress={onDpadPress}
            onDpadRelease={onDpadRelease}
            onABPress={onABPress}
            onABRelease={onABRelease}
            onCrankRotate={onCrankRotate}
            onCrankDock={onCrankDock}
          />
        </div>

        <div className="text-[10px] text-ink-500 font-mono text-center">
          touch d-pad / a / b / crank · running real PlaydateSimulator on the server
        </div>
      </main>
    </div>
  );
}
