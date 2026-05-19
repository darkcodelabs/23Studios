import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Play, Square, Circle, Camera, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import PlaydateDpad from './PlaydateDpad.jsx';
import PlaydateAB from './PlaydateAB.jsx';
import PlaydateCrank from './PlaydateCrank.jsx';

// B7 SimPanel — collapsible top-of-page strip on every project page.
// Shows the last sim screenshot, a virtual d-pad + A/B + crank dial, and
// a record toggle that posts to /sdk/preview/record_session.
//
// Inputs are wired to POST /api/projects/:id/sdk/preview/input with the
// abstract action names sdk_preview.mapKey() understands.

const RECORD_DEFAULT_S = 6;

export default function SimPanel({ projectId, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [running, setRunning] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSecs, setRecordSecs] = useState(RECORD_DEFAULT_S);
  const [lastRecording, setLastRecording] = useState(null);
  const [error, setError] = useState(null);
  const [frameTs, setFrameTs] = useState(0); // bust cache
  const pollRef = useRef(null);

  const sendInput = useCallback(async (action) => {
    if (!running) return;
    try { await api.post(`/api/projects/${projectId}/sdk/preview/input`, { action }); }
    catch (_e) { /* swallow; sim may have died */ }
  }, [projectId, running]);

  async function start() {
    setError(null);
    try {
      await api.post(`/api/projects/${projectId}/sdk/preview/start`, {});
      setRunning(true);
    } catch (e) {
      setError(e?.detail || e?.message || 'sim start failed');
    }
  }

  async function stop() {
    try { await api.post(`/api/projects/${projectId}/sdk/preview/stop`, {}); } catch {}
    setRunning(false);
  }

  async function toggleRecord() {
    if (recording) return; // can't cancel in-flight; controlled by duration
    setRecording(true);
    setLastRecording(null);
    setError(null);
    try {
      const r = await api.post(`/api/projects/${projectId}/sdk/preview/record_session`, { duration_s: recordSecs });
      setLastRecording(r);
    } catch (e) {
      setError(e?.detail || e?.message || 'record failed');
    } finally {
      setRecording(false);
    }
  }

  // While open + running, poll last_frame every 500ms so the strip shows a
  // live-ish thumbnail without a WebSocket. The ws preview is still available
  // separately in /sdk/play for full-fidelity capture.
  useEffect(() => {
    if (!open || !running) { if (pollRef.current) clearInterval(pollRef.current); return undefined; }
    pollRef.current = setInterval(() => setFrameTs(Date.now()), 500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [open, running]);

  const base = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
  const lastFrameUrl = running && frameTs
    ? `${base}/api/projects/${projectId}/sdk/preview/last_frame?ts=${frameTs}`
    : null;

  return (
    <div className="border-b border-ink-800 bg-ink-950">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider text-ink-400 hover:text-ink-200"
      >
        {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        Sim
        <span className={`pill ${running ? 'pill-ok' : ''}`}>{running ? 'running' : 'stopped'}</span>
        {recording && <span className="pill pill-warn">recording…</span>}
        {error && <span className="text-red-400 text-[11px] normal-case tracking-normal">{error}</span>}
      </button>
      {open && (
        <div className="px-3 pb-3 flex flex-wrap gap-4 items-start">
          <div className="flex flex-col gap-1">
            <div className="w-[400px] h-[240px] bg-black ring-1 ring-ink-800 flex items-center justify-center text-ink-600 text-[11px]">
              {lastFrameUrl ? (
                <img src={lastFrameUrl} alt="sim frame" className="w-full h-full object-contain image-render-pixel" />
              ) : (
                <span>{running ? 'waiting for frame…' : 'sim is not running'}</span>
              )}
            </div>
            <div className="flex gap-2">
              {running ? (
                <button onClick={stop} className="btn btn-xs"><Square className="w-3 h-3" /> Stop sim</button>
              ) : (
                <button onClick={start} className="btn btn-xs"><Play className="w-3 h-3" /> Start sim</button>
              )}
              <button onClick={toggleRecord} disabled={!running || recording} className="btn btn-xs">
                {recording ? <Loader2 className="w-3 h-3 animate-spin" /> : <Circle className="w-3 h-3" />}
                Record
              </button>
              <input
                type="number" min={1} max={60}
                value={recordSecs}
                onChange={(e) => setRecordSecs(Math.max(1, Math.min(60, Number(e.target.value) || RECORD_DEFAULT_S)))}
                className="w-14 bg-ink-900 ring-1 ring-ink-800 rounded px-1 text-[11px] text-ink-200"
                title="record duration (s)"
              />
              <span className="text-[10px] text-ink-500 self-center">s</span>
            </div>
            {lastRecording && (
              <div className="text-[11px] text-ink-500 flex gap-3">
                {lastRecording.gif_url && (
                  <a href={base + lastRecording.gif_url} target="_blank" rel="noreferrer" className="underline">
                    <Camera className="w-3 h-3 inline mr-1" />gif ({lastRecording.frame_count} frames)
                  </a>
                )}
                {lastRecording.mp4_url && (
                  <a href={base + lastRecording.mp4_url} target="_blank" rel="noreferrer" className="underline">mp4</a>
                )}
                {!lastRecording.gif_url && !lastRecording.mp4_url && (
                  <span>no encoder available (install ffmpeg + imagemagick)</span>
                )}
              </div>
            )}
          </div>
          <div className="flex gap-4 items-center">
            <PlaydateDpad onPress={(dir) => sendInput(dir)} />
            <PlaydateAB onPress={(b) => sendInput(b)} />
            <PlaydateCrank
              onRotate={(delta) => sendInput(delta > 0 ? 'crank_cw' : 'crank_ccw')}
              onDock={() => sendInput('dock')}
            />
          </div>
        </div>
      )}
    </div>
  );
}
