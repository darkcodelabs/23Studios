import { safeErr } from '../lib/format_err.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useProject } from '../lib/pulp_workspace.js';
import { ChevronUp, ChevronDown, RotateCw, RefreshCw, ArrowLeft, Pause, Play } from 'lucide-react';
import { pulpApi } from '../lib/pulp_api.js';
import { createInterpreter } from '../lib/pulp_interpreter/index.js';
import PlaydateChassis from '../components/PlaydateChassis.jsx';

// Logical canvas dims. The chassis screen well is a fixed ratio container,
// the canvas inside is upscaled via CSS — image-rendering: pixelated keeps
// pixels crunchy at any output size the viewport lands on.
const CANVAS_W = 400;
const CANVAS_H = 240;

// One crank "tick" the interpreter expects. We accumulate degrees from
// drags/wheel and flush a single 'crank' input each time we cross this
// threshold, so a 5° wheel tick + an 80° drag both produce sensible counts.
const CRANK_DEG_PER_TICK = 12;

export default function PulpPlay() {
  const project = useProject();
  const [pulpData, setPulpData] = useState(null);
  const [exists, setExists] = useState(null);
  const [err, setErr] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [paused, setPaused] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [consoleLines, setConsoleLines] = useState([]);

  const canvasRef = useRef(null);
  const interpRef = useRef(null);
  const crankAccumRef = useRef(0);

  // Load (and reload-on-disk) the pulp project JSON.
  useEffect(() => {
    let alive = true;
    setExists(null);
    pulpApi
      .get(project.id)
      .then((r) => {
        if (!alive) return;
        setExists(!!r.exists);
        setPulpData(r.project || null);
      })
      .catch((e) => {
        if (!alive) return;
        setErr(e.detail?.error || 'failed to load pulp project');
        setExists(false);
      });
    return () => {
      alive = false;
    };
  }, [project.id, reloadKey]);

  // Spin up the interpreter once the project + canvas are ready. The
  // interpreter's own attachInput() wires keyboard/wheel on the canvas, so
  // PC controls keep working in parallel with the touch chassis.
  useEffect(() => {
    if (!pulpData || !canvasRef.current) return undefined;
    const interp = createInterpreter(pulpData, { canvas: canvasRef.current });
    interpRef.current = interp;

    const offLog = interp.on('log', () => setConsoleLines(interp.getConsole()));
    interp.start();
    canvasRef.current.focus();

    return () => {
      offLog();
      interp.stop();
      interpRef.current = null;
    };
  }, [pulpData]);

  // Pause on tab visibility change.
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

  // --- Touch -> interpreter bridge ---
  // We dispatch directly to interp.sendInput(action) — same surface the
  // keyboard handler in input.js calls into. This avoids round-tripping
  // through synthetic KeyboardEvents (cleaner + no focus quirks).
  const dispatch = useCallback((action) => {
    const interp = interpRef.current;
    if (!interp) return;
    interp.sendInput(action);
  }, []);

  const onDpadPress = useCallback((dir) => dispatch(dir), [dispatch]);
  const onDpadRelease = useCallback(() => {
    // Pulp inputs are edge-triggered; nothing to send on release.
  }, []);
  const onABPress = useCallback(
    (which) => dispatch(which === 'a' ? 'confirm' : 'cancel'),
    [dispatch]
  );
  const onABRelease = useCallback(() => {}, []);

  // Crank: accumulate degrees, flush one 'crank' tick per CRANK_DEG_PER_TICK
  // crossed in either direction.
  const onCrankRotate = useCallback((deltaDeg /* , totalDeg */) => {
    crankAccumRef.current += deltaDeg;
    while (Math.abs(crankAccumRef.current) >= CRANK_DEG_PER_TICK) {
      dispatch('crank');
      crankAccumRef.current -= Math.sign(crankAccumRef.current) * CRANK_DEG_PER_TICK;
    }
  }, [dispatch]);

  const onCrankDock = useCallback(
    (docked) => {
      // The 'dock' input is edge-triggered; fire on every state change so
      // the interpreter can toggle whatever it wants.
      dispatch('dock');
      // Also reset accumulated rotation when docking, so the next deploy
      // starts from zero.
      if (docked) crankAccumRef.current = 0;
    },
    [dispatch]
  );

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
    if (paused) {
      interp.resume();
      setPaused(false);
    } else {
      interp.pause();
      setPaused(true);
    }
  }

  if (exists === false && !pulpData) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-6 text-ink-400 text-sm space-y-2">
        <div className="text-base text-ink-200">no pulp data yet</div>
        <div>go define some tiles, then come back to playtest.</div>
        {err ? <div className="text-red-400 text-xs">{safeErr(err)}</div> : null}
      </div>
    );
  }

  if (!pulpData) {
    return <div className="h-full flex items-center justify-center text-sm text-ink-400">loading…</div>;
  }

  const hasContent = (pulpData.rooms || []).length > 0 && (pulpData.tiles || []).length > 0;

  return (
    <div className="h-full overflow-auto">
      {/* Slim header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-ink-700/60 bg-ink-900/40">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            to={`/project/${project.id}/edit`}
            className="inline-flex items-center gap-1 text-xs text-ink-300 hover:text-accent transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            editor
          </Link>
          <span className="text-ink-500 text-xs">/</span>
          <span className="text-sm text-ink-100 truncate">{project?.name || 'untitled'}</span>
          <span className="pill">play</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn text-xs"
            onClick={onTogglePause}
            aria-label={paused ? 'Resume' : 'Pause'}
          >
            {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
            {paused ? 'resume' : 'pause'}
          </button>
        </div>
      </header>

      <main className="p-4 md:p-8 flex flex-col items-center gap-4">
        {!hasContent ? (
          <div className="w-full max-w-[720px] rounded border border-amber-700 bg-amber-950/40 text-amber-200 text-xs p-2">
            this project has no rooms or tiles yet — the canvas will render an empty room.
          </div>
        ) : null}

        {/* Chassis wrapper: leaves room on the right for the protruding crank */}
        <div className="relative w-full" style={{ maxWidth: 780, paddingRight: 70 }}>
          <PlaydateChassis
            ref={canvasRef}
            canvasW={CANVAS_W}
            canvasH={CANVAS_H}
            onDpadPress={onDpadPress}
            onDpadRelease={onDpadRelease}
            onABPress={onABPress}
            onABRelease={onABRelease}
            onCrankRotate={onCrankRotate}
            onCrankDock={onCrankDock}
          >
            {/* Drawer toggle — pinned inside chassis top-right corner */}
            <button
              type="button"
              onClick={() => setDrawerOpen((v) => !v)}
              aria-label={drawerOpen ? 'Hide console drawer' : 'Show console drawer'}
              className="absolute"
              style={{
                top: 8,
                right: 10,
                padding: '2px 6px',
                fontSize: 10,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                color: '#1a1a1a',
                background: 'rgba(0,0,0,0.08)',
                border: '1px solid rgba(0,0,0,0.4)',
                borderRadius: 4,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              {drawerOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              console
            </button>
          </PlaydateChassis>
        </div>

        {/* Help line */}
        <div className="text-[10px] text-ink-500 font-mono text-center">
          touch d-pad / a / b / crank · or arrows · z=a · x=b · v=dock · wheel=crank
        </div>

        {/* Collapsible drawer: console + reset/reload */}
        {drawerOpen ? (
          <section className="w-full max-w-[720px] border border-ink-700 rounded p-3 bg-black/40 space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-[10px] uppercase tracking-wide text-ink-500">console</h4>
              <div className="flex items-center gap-2">
                <button type="button" className="btn text-xs" onClick={onReset}>
                  <RotateCw className="w-3.5 h-3.5" /> reset
                </button>
                <button type="button" className="btn text-xs" onClick={onReloadFromDisk}>
                  <RefreshCw className="w-3.5 h-3.5" /> reload from disk
                </button>
              </div>
            </div>
            <div className="max-h-64 overflow-auto">
              {consoleLines.length === 0 ? (
                <div className="text-ink-600 text-xs italic">(empty)</div>
              ) : (
                <pre className="text-xs text-ink-200 font-mono whitespace-pre-wrap">
                  {consoleLines.join('\n')}
                </pre>
              )}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
