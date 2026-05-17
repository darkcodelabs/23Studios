import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { RotateCw, Pause, Play, RefreshCw } from 'lucide-react';
import { pulpApi } from '../lib/pulp_api.js';
import { createInterpreter } from '../lib/pulp_interpreter/index.js';

// Logical canvas dimensions. Render layer paints into this size; CSS scales
// it 2x for display so we get crunchy chunky pixels.
const CANVAS_W = 400;
const CANVAS_H = 240;
const DISPLAY_SCALE = 2;

export default function PulpPlay() {
  const { project } = useOutletContext();
  const [pulpData, setPulpData] = useState(null);
  const [exists, setExists] = useState(null); // null=loading, true/false
  const [err, setErr] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hudState, setHudState] = useState({ x: 0, y: 0, fps: 0, roomName: '' });
  const [consoleLines, setConsoleLines] = useState([]);
  const canvasRef = useRef(null);
  const interpRef = useRef(null);

  // Load (and reload-on-disk) the pulp project JSON.
  useEffect(() => {
    let alive = true;
    setExists(null);
    pulpApi.get(project.id).then((r) => {
      if (!alive) return;
      setExists(!!r.exists);
      setPulpData(r.project || null);
    }).catch((e) => {
      if (!alive) return;
      setErr(e.detail?.error || 'failed to load pulp project');
      setExists(false);
    });
    return () => { alive = false; };
  }, [project.id, reloadKey]);

  // Spin up the interpreter once the project is loaded.
  useEffect(() => {
    if (!pulpData || !canvasRef.current) return undefined;
    const interp = createInterpreter(pulpData, { canvas: canvasRef.current });
    interpRef.current = interp;

    const offLog = interp.on('log', () => {
      setConsoleLines(interp.getConsole());
    });
    const offRoom = interp.on('room', (room) => {
      setHudState((h) => ({ ...h, roomName: room?.name || '' }));
    });
    const offFps = interp.on('fps', (fps) => {
      const rt = interp.getRuntime();
      setHudState({
        x: rt.player.x,
        y: rt.player.y,
        fps,
        roomName: rt.getRoom()?.name || '',
      });
    });

    interp.start();
    // Surface initial HUD state.
    const rt = interp.getRuntime();
    setHudState({ x: rt.player.x, y: rt.player.y, fps: 0, roomName: rt.getRoom()?.name || '' });
    canvasRef.current.focus();

    return () => {
      offLog(); offRoom(); offFps();
      interp.stop();
      interpRef.current = null;
    };
  }, [pulpData]);

  // Pause on visibility change.
  useEffect(() => {
    const onVis = () => {
      const interp = interpRef.current;
      if (!interp) return;
      if (document.hidden) interp.pause();
      else if (!paused) interp.resume();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [paused]);

  function onReset() {
    setConsoleLines([]);
    setReloadKey((k) => k + 1);
  }
  function onReloadFromDisk() {
    setConsoleLines([]);
    setReloadKey((k) => k + 1);
  }
  function onTogglePause() {
    const interp = interpRef.current;
    if (!interp) return;
    if (paused) { interp.resume(); setPaused(false); }
    else { interp.pause(); setPaused(true); }
  }

  if (exists === false && !pulpData) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-6 text-ink-400 text-sm space-y-2">
        <div className="text-base text-ink-200">no pulp data yet</div>
        <div>go define some tiles, then come back to playtest.</div>
        {err ? <div className="text-red-400 text-xs">{err}</div> : null}
      </div>
    );
  }

  if (!pulpData) {
    return <div className="h-full flex items-center justify-center text-sm text-ink-400">loading…</div>;
  }

  const hasContent = (pulpData.rooms || []).length > 0 && (pulpData.tiles || []).length > 0;

  return (
    <div className="h-full overflow-auto p-4 space-y-3">
      {!hasContent ? (
        <div className="rounded border border-amber-700 bg-amber-950/40 text-amber-200 text-xs p-2">
          this project has no rooms or tiles yet — the canvas will render an empty room.
        </div>
      ) : null}

      <div className="flex flex-col items-start gap-3">
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          tabIndex={0}
          style={{
            width: CANVAS_W * DISPLAY_SCALE,
            height: CANVAS_H * DISPLAY_SCALE,
            imageRendering: 'pixelated',
            background: '#000',
            outline: 'none',
            border: '1px solid #2a2a2a',
          }}
        />

        <div className="flex items-center gap-3 text-xs font-mono text-ink-300">
          <span>room: <span className="text-accent">{hudState.roomName || '(none)'}</span></span>
          <span>x:{hudState.x} y:{hudState.y}</span>
          <span>fps:{hudState.fps}</span>
          <button className="btn text-xs" onClick={onTogglePause}>
            {paused
              ? (<><Play className="w-3.5 h-3.5" /> resume</>)
              : (<><Pause className="w-3.5 h-3.5" /> pause</>)}
          </button>
          <button className="btn text-xs" onClick={onReset}>
            <RotateCw className="w-3.5 h-3.5" /> reset
          </button>
          <button className="btn text-xs" onClick={onReloadFromDisk}>
            <RefreshCw className="w-3.5 h-3.5" /> reload from disk
          </button>
        </div>

        <div className="text-[10px] text-ink-500 font-mono">
          arrows = move · Z = confirm · X = cancel · C = menu · V = dock · wheel = crank
        </div>
      </div>

      <section className="border border-ink-700 rounded p-2 bg-black/40 max-h-64 overflow-auto">
        <h4 className="text-[10px] uppercase tracking-wide text-ink-500 mb-1">console</h4>
        {consoleLines.length === 0 ? (
          <div className="text-ink-600 text-xs italic">(empty)</div>
        ) : (
          <pre className="text-xs text-ink-200 font-mono whitespace-pre-wrap">
            {consoleLines.join('\n')}
          </pre>
        )}
      </section>
    </div>
  );
}
