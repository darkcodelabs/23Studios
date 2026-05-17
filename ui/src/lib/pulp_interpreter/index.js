// Top-level orchestrator for the browser pulp interpreter.
// Wires together the runtime, renderer, input handler and audio engine
// into a single object exposing start / stop / sendInput / on / tick /
// getConsole. PulpPlay is the only intended consumer.

import { createRuntime } from './runtime.js';
import { createRenderer } from './render.js';
import { attachInput } from './input.js';
import { playSfx, startSong, stopSong } from './audio.js';

const TICK_MS = 50; // 20 FPS game loop, matches pulp convention.
const MAX_CONSOLE = 50;

export function createInterpreter(projectJson, opts = {}) {
  const canvas = opts.canvas || null;
  const consoleBuf = [];
  const listeners = Object.create(null); // event -> fn[]

  function emit(event, payload) {
    const arr = listeners[event];
    if (!arr) return;
    for (const fn of arr) {
      try { fn(payload); } catch (e) { /* swallow */ }
    }
  }

  const runtime = createRuntime(projectJson, {
    onLog: (msg) => {
      consoleBuf.push(msg);
      if (consoleBuf.length > MAX_CONSOLE) consoleBuf.splice(0, consoleBuf.length - MAX_CONSOLE);
      emit('log', msg);
    },
    onDialog: (dlg) => emit('dialog', dlg),
    onRoomChange: (room) => emit('room', room),
    onPlaySfx: (id, sfx) => { if (sfx) playSfx(sfx); },
    onPlaySong: (id, looped) => {
      const song = runtime.songs[id];
      if (song) startSong(song, !!looped);
    },
    onStopSong: () => stopSong(),
    onShake: (intensity) => emit('shake', intensity),
  });

  let renderer = null;
  let detachInput = null;
  let running = false;
  let raf = null;
  let lastFrameTs = 0;
  let accumMs = 0;
  let frameTick = 0;
  let fps = 0;
  let fpsFrames = 0;
  let fpsAccumMs = 0;

  function ensureRenderer() {
    if (!canvas) return null;
    if (!renderer) renderer = createRenderer(canvas, runtime);
    return renderer;
  }

  function start() {
    if (running) return;
    running = true;
    ensureRenderer();
    if (canvas) {
      // Make the canvas focusable so it gets key events. Host should also
      // call .focus() on the canvas after start().
      if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex', '0');
      detachInput = attachInput(canvas, runtime);
    }
    runtime.boot();
    lastFrameTs = performance.now();
    accumMs = 0;
    loop(lastFrameTs);
  }

  function loop(ts) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const dt = ts - lastFrameTs;
    lastFrameTs = ts;

    if (document.hidden) return;

    accumMs += dt;
    let ticks = 0;
    while (accumMs >= TICK_MS && ticks < 4 /* clamp catch-up */) {
      runtime.tick(TICK_MS);
      accumMs -= TICK_MS;
      frameTick++;
      ticks++;
    }

    if (renderer) renderer.paint(frameTick);

    // FPS tracking.
    fpsAccumMs += dt;
    fpsFrames++;
    if (fpsAccumMs >= 500) {
      fps = Math.round((fpsFrames * 1000) / fpsAccumMs);
      fpsFrames = 0;
      fpsAccumMs = 0;
      emit('fps', fps);
    }
  }

  function stop() {
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    if (detachInput) { detachInput(); detachInput = null; }
    stopSong();
  }

  function sendInput(action) { runtime.sendInput(action); }
  function tick() { runtime.tick(TICK_MS); }

  function on(event, fn) {
    listeners[event] = listeners[event] || [];
    listeners[event].push(fn);
    return () => {
      const i = listeners[event].indexOf(fn);
      if (i >= 0) listeners[event].splice(i, 1);
    };
  }

  function getConsole() { return consoleBuf.slice(); }
  function getFps() { return fps; }
  function getRuntime() { return runtime; }

  function pause() {
    if (!running) return;
    running = false;
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  function resume() {
    if (running) return;
    running = true;
    lastFrameTs = performance.now();
    accumMs = 0;
    raf = requestAnimationFrame(loop);
  }

  return {
    start, stop, pause, resume,
    sendInput, tick,
    on, getConsole, getFps, getRuntime,
  };
}
