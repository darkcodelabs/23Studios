import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ChevronDown, ChevronUp, Play, Square, Circle, Download,
  Disc3, ArrowUp, ArrowDown, ArrowLeft, ArrowRight
} from 'lucide-react';
import { api } from '../lib/api.js';

// SimPanel — collapsible top-of-page Playdate Simulator panel.
//
// Renders an embedded sim stream + virtual d-pad / A / B / crank dial /
// record toggle. Mounted in App.jsx so it persists across /project/*
// routes. Pulls the projectId from the active route; renders nothing
// outside project routes.
//
// Triggered open by other components via a custom DOM event:
//   window.dispatchEvent(new CustomEvent('simpanel:open', {
//     detail: { sceneId: 'SC01' }   // optional — if present, runs the scene
//   }));
//
// Status flow:
//   idle → starting → streaming → (recording) → streaming → idle (on stop)
//
// One running preview per project enforced server-side.

const ACTIONS = {
  up: 'up', down: 'down', left: 'left', right: 'right',
  a: 'a', b: 'b', crank_cw: 'crank_cw', crank_ccw: 'crank_ccw', dock: 'dock'
};

function useProjectIdFromRoute() {
  const params = useParams();
  if (params && params.id) return params.id;
  // Useful when the panel sits outside the matched Route — sniff the URL.
  if (typeof window !== 'undefined') {
    const m = window.location.pathname.match(/\/project\/([A-Za-z0-9_-]{1,80})(\/|$)/);
    if (m) return m[1];
  }
  return null;
}

export default function SimPanel() {
  const id = useProjectIdFromRoute();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | starting | streaming | error
  const [errMsg, setErrMsg] = useState(null);
  const [recordState, setRecordState] = useState({ recording: false });
  const [duration, setDuration] = useState(10);

  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const wsRef = useRef(null);
  const recPollRef = useRef(null);

  // Open + run-scene event from other components.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handler = (e) => {
      setOpen(true);
      const sceneId = e && e.detail && e.detail.sceneId;
      if (sceneId && id) runScene(sceneId);
    };
    window.addEventListener('simpanel:open', handler);
    return () => window.removeEventListener('simpanel:open', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const attachCanvas = useCallback((node) => {
    canvasRef.current = node;
    if (node) {
      const ctx = node.getContext('2d');
      ctxRef.current = ctx;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 400, 240);
    }
  }, []);

  // Open + connect WS when panel becomes visible.
  const connect = useCallback(() => {
    if (!id) return;
    if (wsRef.current) return;
    const base = window.__APP_BASE__ || '';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${proto}//${window.location.host}${base}/ws/sdk/preview/${id}`;
    setStatus('starting');
    setErrMsg(null);
    const ws = new WebSocket(url);
    wsRef.current = ws;
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => setStatus('streaming');
    ws.onerror = () => { setStatus('error'); setErrMsg('websocket error'); };
    ws.onclose = () => {
      wsRef.current = null;
      setStatus((s) => (s === 'error' ? 'error' : 'idle'));
    };
    ws.onmessage = (e) => {
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
      const blob = new Blob([e.data], { type: 'image/png' });
      const url2 = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        if (ctxRef.current) {
          ctxRef.current.imageSmoothingEnabled = false;
          ctxRef.current.drawImage(img, 0, 0, 400, 240);
        }
        URL.revokeObjectURL(url2);
      };
      img.src = url2;
    };
  }, [id]);

  const disconnect = useCallback(() => {
    try { wsRef.current && wsRef.current.close(); } catch (_e) { /* */ }
    wsRef.current = null;
    if (recPollRef.current) {
      clearInterval(recPollRef.current);
      recPollRef.current = null;
    }
  }, []);

  // Connect when opening, disconnect when closing.
  useEffect(() => {
    if (open && id) connect();
    if (!open) disconnect();
    return undefined;
  }, [open, id, connect, disconnect]);

  // Cleanup on unmount or project change.
  useEffect(() => {
    return () => {
      disconnect();
      if (id) api.post(`/api/projects/${id}/sdk/preview/stop`, {}).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const sendAction = useCallback(async (action) => {
    if (!id) return;
    try { await api.post(`/api/projects/${id}/sdk/preview/input`, { action }); }
    catch (_e) { /* */ }
  }, [id]);

  // Crank: accumulate degrees, fire CW/CCW per 18deg threshold (matches sim mapping).
  const crankAccumRef = useRef(0);
  const onCrankDrag = useCallback((deltaDeg) => {
    crankAccumRef.current += deltaDeg;
    while (Math.abs(crankAccumRef.current) >= 18) {
      const dir = crankAccumRef.current > 0 ? 'crank_cw' : 'crank_ccw';
      sendAction(dir);
      crankAccumRef.current -= Math.sign(crankAccumRef.current) * 18;
    }
  }, [sendAction]);

  const runScene = useCallback(async (sceneId) => {
    if (!id) return;
    setStatus('starting');
    setErrMsg(null);
    try {
      // Stop preview first so the rebuild is loaded fresh.
      disconnect();
      await api.post(`/api/projects/${id}/sdk/preview/run_scene`, { scene_id: sceneId });
      // Small delay before reconnecting to let the simulator render.
      setTimeout(() => connect(), 500);
    } catch (e) {
      setStatus('error');
      setErrMsg((e && e.detail && (e.detail.detail || e.detail.error)) || e.message || 'run_scene failed');
    }
  }, [id, connect, disconnect]);

  const startRecord = useCallback(async () => {
    if (!id) return;
    try {
      const r = await api.post(`/api/projects/${id}/sdk/preview/record_session`, { duration_s: duration });
      setRecordState({ recording: true, id: r.id, duration_s: r.duration_s, started_at: Date.now() });
      // Poll status every 500ms; on finished, stop polling.
      if (recPollRef.current) clearInterval(recPollRef.current);
      recPollRef.current = setInterval(async () => {
        try {
          const s = await api.get(`/api/projects/${id}/sdk/preview/record_session/status`);
          setRecordState(s);
          if (!s.recording || s.finished) {
            clearInterval(recPollRef.current);
            recPollRef.current = null;
          }
        } catch (_e) { /* */ }
      }, 500);
    } catch (e) {
      setErrMsg((e && e.detail && (e.detail.detail || e.detail.error)) || e.message || 'record failed');
    }
  }, [id, duration]);

  const stopRecord = useCallback(async () => {
    if (!id) return;
    try {
      await api.post(`/api/projects/${id}/sdk/preview/record_session/stop`, {});
      // Status poll will pick up finished=true on next tick.
    } catch (_e) { /* */ }
  }, [id]);

  // Pull a static screenshot when collapsed (so the user has a peek even
  // when the WS isn't connected). 5s poll, only when panel is closed.
  const [thumbUrl, setThumbUrl] = useState(null);
  useEffect(() => {
    if (open || !id) return undefined;
    let mounted = true;
    const tick = async () => {
      const base = window.__APP_BASE__ || '';
      const url = `${base}/api/projects/${id}/sdk/preview/screenshot?t=${Date.now()}`;
      // We don't actually fetch — just point img src; the route returns 404
      // if no preview is running, browsers will show broken image which we
      // hide via onerror.
      if (mounted) setThumbUrl(url);
    };
    tick();
    const iv = setInterval(tick, 5000);
    return () => { mounted = false; clearInterval(iv); };
  }, [open, id]);

  if (!id) return null;

  const recPct = recordState.recording && recordState.duration_s
    ? Math.min(100, Math.round(((recordState.elapsed_ms || 0) / (recordState.duration_s * 1000)) * 100))
    : 0;

  return (
    <div
      className="border-b border-ink-800 bg-ink-900 text-ink-100 sticky top-0 z-40"
      style={{ boxShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
    >
      <div className="flex items-center gap-2 px-3 h-9 text-xs">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded hover:bg-ink-800"
          title={open ? 'collapse sim panel' : 'expand sim panel'}
        >
          {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span className="font-medium">sim</span>
        </button>
        <span className={`pill ${status === 'streaming' ? 'pill-ok' : status === 'error' ? 'pill-err' : ''}`}>
          {status}
        </span>
        {errMsg && <span className="text-red-400 truncate max-w-[280px]" title={errMsg}>{errMsg}</span>}
        {!open && thumbUrl && (
          <img
            src={thumbUrl}
            alt="last sim frame"
            className="ml-auto h-7 w-auto rounded border border-ink-800"
            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
            onLoad={(e) => { e.currentTarget.style.visibility = 'visible'; }}
            style={{ imageRendering: 'pixelated' }}
          />
        )}
      </div>
      {open && (
        <div className="flex items-start gap-4 px-3 pb-3">
          <div className="shrink-0">
            <canvas
              ref={attachCanvas}
              width={400}
              height={240}
              className="rounded border border-ink-700 bg-black"
              style={{ width: 400, height: 240, imageRendering: 'pixelated' }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1">
              <DpadButton onClick={() => sendAction(ACTIONS.up)} label="up"><ArrowUp className="w-3.5 h-3.5" /></DpadButton>
              <DpadButton onClick={() => sendAction(ACTIONS.left)} label="left"><ArrowLeft className="w-3.5 h-3.5" /></DpadButton>
              <DpadButton onClick={() => sendAction(ACTIONS.down)} label="down"><ArrowDown className="w-3.5 h-3.5" /></DpadButton>
              <DpadButton onClick={() => sendAction(ACTIONS.right)} label="right"><ArrowRight className="w-3.5 h-3.5" /></DpadButton>
              <div className="w-2" />
              <AbButton onClick={() => sendAction(ACTIONS.a)}>A</AbButton>
              <AbButton onClick={() => sendAction(ACTIONS.b)}>B</AbButton>
            </div>
            <CrankDial onRotate={onCrankDrag} onDock={() => sendAction(ACTIONS.dock)} />
            <div className="flex items-center gap-2 mt-1">
              <label className="text-[11px] text-ink-400">duration</label>
              <input
                type="number"
                min="1"
                max="60"
                value={duration}
                onChange={(e) => setDuration(Math.max(1, Math.min(60, Number(e.target.value) || 10)))}
                className="w-12 px-1 py-0.5 bg-ink-800 border border-ink-700 rounded text-xs text-right"
              />
              <span className="text-[11px] text-ink-400">s</span>
              {!recordState.recording ? (
                <button
                  type="button"
                  onClick={startRecord}
                  className="flex items-center gap-1 text-xs px-2 py-1 bg-red-700 hover:bg-red-600 text-white rounded"
                  disabled={status !== 'streaming'}
                  title="record gif + mp4"
                >
                  <Circle className="w-3 h-3 fill-current" /> rec
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopRecord}
                  className="flex items-center gap-1 text-xs px-2 py-1 bg-ink-700 hover:bg-ink-600 text-white rounded"
                  title="stop recording"
                >
                  <Square className="w-3 h-3 fill-current" /> stop
                </button>
              )}
              {recordState.recording && (
                <div className="flex items-center gap-2 text-[11px] text-ink-400">
                  <div className="h-1.5 w-20 bg-ink-800 rounded overflow-hidden">
                    <div className="h-full bg-red-500 transition-all" style={{ width: recPct + '%' }} />
                  </div>
                  {recordState.frame_count || 0} fr
                </div>
              )}
              {recordState.finished && (recordState.gif || recordState.mp4) && (
                <div className="flex items-center gap-1 text-[11px]">
                  {recordState.gif && (
                    <a
                      href={(window.__APP_BASE__ || '') + recordState.gif_url}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 px-1.5 py-0.5 bg-ink-800 hover:bg-ink-700 rounded text-ink-100"
                    ><Download className="w-3 h-3" /> gif</a>
                  )}
                  {recordState.mp4 && (
                    <a
                      href={(window.__APP_BASE__ || '') + recordState.mp4_url}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 px-1.5 py-0.5 bg-ink-800 hover:bg-ink-700 rounded text-ink-100"
                    ><Download className="w-3 h-3" /> mp4</a>
                  )}
                </div>
              )}
              {recordState.encode_error && (
                <span className="text-[11px] text-red-400" title={recordState.encode_error}>encode failed</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function DpadButton({ onClick, label, children }) {
  return (
    <button
      type="button"
      onMouseDown={onClick}
      title={label}
      className="w-7 h-7 rounded bg-ink-800 hover:bg-ink-700 border border-ink-700 flex items-center justify-center"
    >
      {children}
    </button>
  );
}

function AbButton({ onClick, children }) {
  return (
    <button
      type="button"
      onMouseDown={onClick}
      className="w-7 h-7 rounded-full bg-amber-700 hover:bg-amber-600 border border-amber-900 text-[11px] font-bold text-white flex items-center justify-center"
    >
      {children}
    </button>
  );
}

function CrankDial({ onRotate, onDock }) {
  const ref = useRef(null);
  const draggingRef = useRef(false);
  const lastAngleRef = useRef(0);
  const [angle, setAngle] = useState(0);

  const getAngle = (e) => {
    const el = ref.current;
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;
    return Math.atan2(dy, dx) * 180 / Math.PI;
  };

  const onDown = (e) => {
    draggingRef.current = true;
    lastAngleRef.current = getAngle(e);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const onMove = (e) => {
    if (!draggingRef.current) return;
    const a = getAngle(e);
    let delta = a - lastAngleRef.current;
    // Normalize for ±180 wrap.
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    lastAngleRef.current = a;
    setAngle((p) => p + delta);
    onRotate(delta);
  };
  const onUp = () => {
    draggingRef.current = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };

  return (
    <div className="flex items-center gap-2">
      <div
        ref={ref}
        onMouseDown={onDown}
        className="w-12 h-12 rounded-full bg-ink-800 border-2 border-ink-700 flex items-center justify-center cursor-grab"
        title="drag to crank"
      >
        <Disc3
          className="w-6 h-6 text-ink-400"
          style={{ transform: `rotate(${angle}deg)`, transition: draggingRef.current ? 'none' : 'transform 80ms' }}
        />
      </div>
      <button
        type="button"
        onClick={onDock}
        className="text-[11px] px-2 py-1 bg-ink-800 hover:bg-ink-700 border border-ink-700 rounded"
        title="dock / undock crank"
      >
        dock
      </button>
    </div>
  );
}
