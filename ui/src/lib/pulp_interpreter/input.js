// Keyboard input wiring for the pulp interpreter.
// Maps PC keys to Playdate-style inputs the runtime understands.
//
// Bindings:
//   Arrows  -> d-pad (left/right/up/down)
//   Z       -> A    (confirm)
//   X       -> B    (cancel)
//   C       -> menu
//   V       -> dock
//   wheel   -> crank

const KEY_MAP = {
  'ArrowLeft':  'left',
  'ArrowRight': 'right',
  'ArrowUp':    'up',
  'ArrowDown':  'down',
  'KeyZ':       'confirm',
  'KeyX':       'cancel',
  'KeyC':       'menu',
  'KeyV':       'dock',
  // WASD fallback for laptops without arrow keys.
  'KeyA':       'left',
  'KeyD':       'right',
  'KeyW':       'up',
  'KeyS':       'down',
  'Enter':      'confirm',
  'Space':      'confirm',
  'Escape':     'cancel',
};

export function attachInput(target, runtime, opts = {}) {
  const repeatRate = opts.repeatRate || 110; // ms between repeats while held
  const held = new Map(); // code -> last fire ms
  let raf = null;
  let lastTs = 0;

  function onKeyDown(e) {
    const action = KEY_MAP[e.code];
    if (!action) return;
    e.preventDefault();
    if (!held.has(e.code)) {
      runtime.sendInput(action);
      held.set(e.code, performance.now());
      startRepeatLoop();
    }
  }

  function onKeyUp(e) {
    if (KEY_MAP[e.code]) {
      held.delete(e.code);
      if (held.size === 0) stopRepeatLoop();
      e.preventDefault();
    }
  }

  function onWheel(e) {
    // Treat any vertical wheel motion as a crank tick.
    if (Math.abs(e.deltaY) > 1) {
      runtime.sendInput('crank');
      e.preventDefault();
    }
  }

  function startRepeatLoop() {
    if (raf) return;
    lastTs = performance.now();
    const step = () => {
      const now = performance.now();
      for (const [code, lastFire] of held.entries()) {
        // Only directional keys auto-repeat.
        const action = KEY_MAP[code];
        if (action !== 'left' && action !== 'right' && action !== 'up' && action !== 'down') continue;
        if (now - lastFire >= repeatRate) {
          runtime.sendInput(action);
          held.set(code, now);
        }
      }
      lastTs = now;
      if (held.size > 0) raf = requestAnimationFrame(step);
      else raf = null;
    };
    raf = requestAnimationFrame(step);
  }

  function stopRepeatLoop() {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
  }

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('wheel', onWheel, { passive: false });

  return function detach() {
    target.removeEventListener('keydown', onKeyDown);
    target.removeEventListener('keyup', onKeyUp);
    target.removeEventListener('wheel', onWheel);
    stopRepeatLoop();
    held.clear();
  };
}
