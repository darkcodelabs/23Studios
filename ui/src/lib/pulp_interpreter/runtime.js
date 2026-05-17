// Pulp runtime + tree-walking AST interpreter.
// Mirrors server/services/pulp_runtime_lua/pulp_runtime.lua surface but
// running entirely in the browser, walking the AST directly (no Lua, no JIT).
//
// Exports `createRuntime(projectJson, hooks)` which returns a fully-wired
// runtime object. `hooks` lets the host (PulpPlay page) react to side effects
// like console writes, room changes, dialog updates.

import { parse } from './parser.js';

// Events recognised by the runtime. Anything else is logged as a warning
// when a script references it.
const KNOWN_EVENTS = new Set([
  'load', 'start', 'enter', 'exit', 'finish', 'loop', 'update', 'bump',
  'confirm', 'cancel', 'crank', 'dock', 'undock', 'draw', 'interact',
  'collect', 'change', 'select', 'dismiss', 'invalid', 'any',
]);

const QUERY_COMMANDS = new Set([
  'random', 'floor', 'ceil', 'round',
  'sine', 'cosine', 'tangent', 'radians', 'degrees',
  'solid', 'type', 'id', 'name', 'invert', 'frame',
]);

export function createRuntime(project, hooks = {}) {
  const log = (msg) => { if (hooks.onLog) hooks.onLog(String(msg)); };

  // ---- Project data normalised ----
  const tilesById = Object.create(null);
  for (const t of project.tiles || []) tilesById[t.id] = t;
  const roomsById = Object.create(null);
  for (const r of project.rooms || []) roomsById[r.id] = r;
  const soundsById = Object.create(null);
  for (const s of project.sounds || []) soundsById[s.id] = s;
  const songsById = Object.create(null);
  for (const s of project.songs || []) songsById[s.id] = s;

  // Player tile id resolution — config can specify start_tile.
  const player = {
    x: Number(project.player?.start_x) || 0,
    y: Number(project.player?.start_y) || 0,
    tile_id: project.player?.start_tile || null,
    start_room: project.player?.start_room || null,
    frame_idx: 0,
  };

  // ---- Runtime "pulp" surface ----
  const pulp = {
    vars: Object.create(null),
    event: { last: null },
    config: Object.assign({
      auto_act: true, input_repeat: true, follow_player: false, text_speed: 20,
    }, project.config || {}),
    datetime: null, // recomputed each tick when read.
  };

  // ---- Handler registry: handlers[namespace][event] = ASTNode[] ----
  // Namespaces: 'game', 'player', `tile_<id>`, `room_<id>`.
  const handlers = Object.create(null);
  function registerHandlers(namespace, source, sourceLabel) {
    if (!source) return;
    const { ast, errors } = parse(source);
    for (const e of errors) {
      log(`parse error [${sourceLabel}:${e.line}:${e.col}] ${e.message}`);
    }
    if (!ast || ast.type !== 'Program') return;
    for (const node of ast.body) {
      if (node.type !== 'EventHandler') {
        log(`warn [${sourceLabel}] ignored top-level ${node.type}`);
        continue;
      }
      if (!KNOWN_EVENTS.has(node.event) && node.event !== '<unknown>') {
        log(`warn [${sourceLabel}] unknown event '${node.event}'`);
      }
      handlers[namespace] = handlers[namespace] || Object.create(null);
      handlers[namespace][node.event] = node.body;
    }
  }

  registerHandlers('game', project.game_script, 'game');
  for (const t of project.tiles || []) {
    if (t.script) registerHandlers(`tile_${t.id}`, t.script, `tile ${t.id}`);
  }
  for (const r of project.rooms || []) {
    if (r.script) registerHandlers(`room_${r.id}`, r.script, `room ${r.id}`);
  }

  // ---- Dialog queue ----
  // Dialogs render at the bottom of the canvas. say -> { kind:'say', text }.
  // Active dialog blocks the loop's "loop" event from updating game (matches
  // the Lua runtime spec where text dismiss is required before progressing).
  let activeDialog = null;
  let dialogTimer = 0; // ms remaining for auto-advance
  const dialogQueue = [];

  function pushDialog(spec) {
    if (activeDialog) {
      dialogQueue.push(spec);
    } else {
      activeDialog = spec;
      dialogTimer = 1500;
    }
    if (hooks.onDialog) hooks.onDialog(activeDialog);
  }

  function dismissDialog() {
    if (!activeDialog) return false;
    // Run continuations attached to the dialog (say ... then ... end).
    const cont = activeDialog._cont;
    activeDialog = null;
    dialogTimer = 0;
    if (cont) safeExec(() => execBlock(cont, currentNamespace()));
    if (dialogQueue.length) {
      activeDialog = dialogQueue.shift();
      dialogTimer = 1500;
    }
    if (hooks.onDialog) hooks.onDialog(activeDialog);
    return true;
  }

  // ---- Tell stack (current target for call/emit/mimic & swap) ----
  const tellStack = [];
  function currentTarget() { return tellStack[tellStack.length - 1] || null; }
  function currentNamespace() {
    // Most handlers run in the 'game' namespace by default. tell pushes a
    // tile/room namespace.
    const tgt = currentTarget();
    if (!tgt) return 'game';
    if (typeof tgt === 'string') {
      if (tilesById[tgt]) return `tile_${tgt}`;
      if (roomsById[tgt]) return `room_${tgt}`;
    }
    return 'game';
  }

  // ---- Wait queue: { remainingMs, fn } ----
  const pendingWaits = [];

  // ---- Continuations (used by say/play/wait blocks) ----
  // The Lua runtime uses pulp.then_after; we attach the continuation directly
  // to the dialog or schedule it via pendingWaits.

  // ---- Room / player ----
  let currentRoomId = player.start_room || (project.rooms && project.rooms[0] && project.rooms[0].id) || null;

  function currentRoom() { return currentRoomId ? roomsById[currentRoomId] : null; }

  function tileAt(x, y) {
    const r = currentRoom();
    if (!r || !r.grid) return null;
    const row = r.grid[y | 0];
    if (!row) return null;
    const tid = row[x | 0];
    return tid ? tilesById[tid] || null : null;
  }

  function setRoom(roomId) {
    if (!roomId || !roomsById[roomId]) return false;
    currentRoomId = roomId;
    if (hooks.onRoomChange) hooks.onRoomChange(roomsById[roomId]);
    dispatch(`room_${roomId}`, 'enter', { room_id: roomId });
    return true;
  }

  function trySetPlayer(x, y) {
    player.x = Math.max(0, Math.min(24, x | 0));
    player.y = Math.max(0, Math.min(14, y | 0));
    dispatch('player', 'update', { x: player.x, y: player.y });
  }

  function tryMove(dx, dy) {
    const nx = player.x + (dx | 0);
    const ny = player.y + (dy | 0);
    if (nx < 0 || ny < 0 || nx > 24 || ny > 14) {
      dispatchInput('bump', { x: nx, y: ny, dx, dy });
      return false;
    }
    const t = tileAt(nx, ny);
    if (t && t.solid) {
      dispatchInput('bump', { x: nx, y: ny, dx, dy, tile_id: t.id });
      if (t) dispatch(`tile_${t.id}`, 'bump', { x: nx, y: ny, dx, dy });
      return false;
    }
    trySetPlayer(nx, ny);
    return true;
  }

  // Input events fire on both 'game' and 'player' namespaces because pulp
  // scripts conventionally write `on bump do ... end` at game scope but the
  // Lua runtime dispatches on the player namespace.
  function dispatchInput(event, payload) {
    dispatch('game', event, payload);
    dispatch('player', event, payload);
  }

  // ---- Event dispatch ----
  function dispatch(namespace, event, payload) {
    const ns = handlers[namespace];
    if (!ns) return;
    const body = ns[event];
    if (!body) return;
    const prev = pulp.event;
    pulp.event = Object.assign({}, prev, payload || {}, { kind: event });
    safeExec(() => execBlock(body, namespace));
    pulp.event = prev;
  }
  pulp.dispatch = dispatch;

  // ---- Expression evaluator ----
  function evalExpr(node) {
    if (!node) return null;
    switch (node.type) {
      case 'NumberLiteral': return node.value;
      case 'BoolLiteral': return node.value;
      case 'StringLiteral': return interpolate(node.value);
      case 'Identifier': return readIdent(node.name);
      case 'Member': return readMember(node);
      case 'Unary': return -toNum(evalExpr(node.operand));
      case 'Binary': return evalBinary(node);
      case 'TupleExpression': return node.elements.map(evalExpr);
      default: return null;
    }
  }

  function readIdent(name) {
    if (name === 'event') return pulp.event;
    if (name === 'config') return pulp.config;
    if (name === 'datetime') return currentDatetime();
    return pulp.vars[name];
  }

  function readMember(node) {
    const base = evalExpr(node.object);
    if (base == null) return undefined;
    return base[node.property];
  }

  function evalBinary(node) {
    const op = node.op;
    const l = evalExpr(node.left);
    const r = evalExpr(node.right);
    switch (op) {
      case '+':
        if (typeof l === 'string' || typeof r === 'string') return String(l ?? '') + String(r ?? '');
        return toNum(l) + toNum(r);
      case '-': return toNum(l) - toNum(r);
      case '*': return toNum(l) * toNum(r);
      case '/': {
        const d = toNum(r);
        return d === 0 ? 0 : toNum(l) / d;
      }
      case '%': {
        const d = toNum(r);
        return d === 0 ? 0 : toNum(l) % d;
      }
      case '==': return loosEq(l, r);
      case '!=': return !loosEq(l, r);
      case '<':  return toNum(l) <  toNum(r);
      case '<=': return toNum(l) <= toNum(r);
      case '>':  return toNum(l) >  toNum(r);
      case '>=': return toNum(l) >= toNum(r);
      default: return null;
    }
  }

  function toNum(v) {
    if (v === true) return 1;
    if (v === false || v == null) return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  function loosEq(a, b) {
    if (a === b) return true;
    if (a == null && b == null) return true;
    if (typeof a === 'number' || typeof b === 'number') return toNum(a) === toNum(b);
    return String(a) === String(b);
  }
  function truthy(v) {
    if (v == null || v === false) return false;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v.length > 0;
    return true;
  }

  // {var} and {n,c:var} interpolation, mirrors pulp.fmt in Lua runtime.
  function interpolate(str) {
    if (typeof str !== 'string' || str.indexOf('{') < 0) return str;
    return str.replace(/\{([^}]+)\}/g, (_m, inner) => {
      const colonIdx = inner.indexOf(':');
      let fmtSpec = null;
      let name = inner;
      if (colonIdx >= 0) {
        const left = inner.slice(0, colonIdx);
        const right = inner.slice(colonIdx + 1);
        if (left === 'embed') return ''; // tile embeds — render shows them later
        if (left.includes(',')) { fmtSpec = left; name = right; }
        else { name = left; fmtSpec = right; }
      }
      name = String(name).trim();
      const v = readIdent(name);
      let s = v == null ? '' : String(v);
      if (fmtSpec) {
        const m = /^(\d+),(.)$/.exec(fmtSpec);
        if (m) {
          const width = parseInt(m[1], 10);
          const pad = m[2];
          if (s.length < width) s = pad.repeat(width - s.length) + s;
        }
      }
      return s;
    });
  }

  function currentDatetime() {
    const d = new Date();
    return {
      year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate(),
      hour: d.getHours(), minute: d.getMinutes(), second: d.getSeconds(),
      weekday: d.getDay(),
    };
  }

  // ---- Statement executor ----
  class DoneSignal {}

  function execBlock(stmts, namespace) {
    if (!stmts) return;
    for (const s of stmts) execStmt(s, namespace);
  }

  function execStmt(s, namespace) {
    switch (s.type) {
      case 'Assignment': return doAssign(s);
      case 'IncDec': return doIncDec(s);
      case 'If': {
        if (truthy(evalExpr(s.cond))) return execBlock(s.then, namespace);
        for (const e of s.elifs || []) if (truthy(evalExpr(e.cond))) return execBlock(e.body, namespace);
        if (s.else) return execBlock(s.else, namespace);
        return;
      }
      case 'While': {
        let guard = 0;
        while (truthy(evalExpr(s.cond))) {
          execBlock(s.body, namespace);
          if (++guard > 10000) { log('while loop guard tripped — aborting'); break; }
        }
        return;
      }
      case 'Tell': return doTell(s, namespace);
      case 'Done': throw new DoneSignal();
      case 'Call': return doCall(s, namespace);
      default: return;
    }
  }

  function assignTarget(target) {
    // Returns { obj, key } such that obj[key] is writable.
    if (target.type === 'Identifier') {
      if (target.name === 'event') return { obj: pulp, key: 'event' };
      if (target.name === 'config') return { obj: pulp, key: 'config' };
      return { obj: pulp.vars, key: target.name };
    }
    if (target.type === 'Member') {
      const base = evalExpr(target.object);
      if (base == null) return { obj: {}, key: target.property };
      return { obj: base, key: target.property };
    }
    return { obj: {}, key: '_' };
  }

  function doAssign(s) {
    const { obj, key } = assignTarget(s.target);
    const v = evalExpr(s.value);
    if (s.op === '=') { obj[key] = v; return; }
    const prev = toNum(obj[key]);
    const rhs = toNum(v);
    switch (s.op) {
      case '+=': obj[key] = prev + rhs; return;
      case '-=': obj[key] = prev - rhs; return;
      case '*=': obj[key] = prev * rhs; return;
      case '/=': obj[key] = rhs === 0 ? 0 : prev / rhs; return;
    }
  }

  function doIncDec(s) {
    const { obj, key } = assignTarget(s.target);
    const prev = toNum(obj[key]);
    obj[key] = s.op === '++' ? prev + 1 : prev - 1;
  }

  function doTell(s, namespace) {
    let target = evalExpr(s.target);
    if (Array.isArray(target)) {
      // (x, y) coord tuple — resolve to tile id at that cell.
      const t = tileAt(target[0], target[1]);
      target = t ? t.id : null;
    }
    if (target == null) { execBlock(s.body, namespace); return; }
    tellStack.push(target);
    try { execBlock(s.body, currentNamespace()); }
    finally { tellStack.pop(); }
  }

  function doCall(s, namespace) {
    const name = s.name;
    const args = (s.args || []).filter(a => a.type !== 'Marker').map(evalExpr);

    switch (name) {
      // --- text ---
      case 'say': {
        const text = String(args[0] != null ? args[0] : '');
        pushDialog({ kind: 'say', text, _cont: s.block || null });
        return;
      }
      case 'fin': {
        const text = String(args[0] != null ? args[0] : '');
        pushDialog({ kind: 'fin', text });
        log('fin: ' + text);
        return;
      }
      case 'ask':
      case 'menu': {
        const opts = (s.options || []).map(op => ({ label: op.label, body: op.body }));
        pushDialog({ kind: name, text: String(args[0] != null ? args[0] : ''), options: opts });
        return;
      }

      // --- state ---
      case 'goto': {
        // goto x, y  OR  goto x, y in "room"  OR  goto "room"
        if (args.length === 1 && typeof args[0] === 'string') {
          setRoom(args[0]); return;
        }
        const x = args[0] | 0;
        const y = args[1] | 0;
        if (args.length >= 3 && typeof args[2] === 'string') setRoom(args[2]);
        trySetPlayer(x, y);
        return;
      }
      case 'swap': {
        // swap [target,] new_tile_id
        let x = player.x, y = player.y, newId;
        if (args.length >= 3) { x = args[0]|0; y = args[1]|0; newId = String(args[2]); }
        else if (args.length === 2 && Array.isArray(args[0])) { x = args[0][0]|0; y = args[0][1]|0; newId = String(args[1]); }
        else { newId = String(args[0]); }
        const r = currentRoom();
        if (r && r.grid && r.grid[y]) r.grid[y][x] = newId;
        return;
      }
      case 'frame': {
        // frame [target,] index — sets frame index for tile, or for player.
        const target = currentTarget();
        const idx = args[args.length - 1] | 0;
        if (target == null) {
          player.frame_idx = idx;
        } else {
          // For tiles, we just stash on the tile object so render reads it.
          const t = (typeof target === 'string') ? tilesById[target] : null;
          if (t) t._runtimeFrame = idx;
        }
        return;
      }

      // --- audio ---
      case 'play': {
        if (hooks.onPlaySfx && args[0] != null) hooks.onPlaySfx(String(args[0]), soundsById[args[0]] || null);
        if (s.block) execBlock(s.block, namespace);
        return;
      }
      case 'sound': {
        if (hooks.onPlaySfx && args[0] != null) hooks.onPlaySfx(String(args[0]), soundsById[args[0]] || null);
        return;
      }
      case 'once': {
        if (hooks.onPlaySong && args[0] != null) hooks.onPlaySong(String(args[0]), false);
        if (s.block) execBlock(s.block, namespace);
        return;
      }
      case 'loop': {
        if (hooks.onPlaySong && args[0] != null) hooks.onPlaySong(String(args[0]), true);
        return;
      }
      case 'stop': {
        if (hooks.onStopSong) hooks.onStopSong();
        return;
      }
      case 'bpm': return; // no-op (sound engine doesn't honor dynamic bpm yet)

      // --- persistence ---
      case 'store': {
        const k = String(args[0]); const v = args[1];
        try { localStorage.setItem('pulp.store.' + k, JSON.stringify(v)); } catch (_e) {}
        return;
      }
      case 'restore': {
        const k = String(args[0]);
        try {
          const raw = localStorage.getItem('pulp.store.' + k);
          pulp.event.last = raw == null ? null : JSON.parse(raw);
        } catch (_e) { pulp.event.last = null; }
        return;
      }
      case 'toss': {
        const k = String(args[0]);
        try { localStorage.removeItem('pulp.store.' + k); } catch (_e) {}
        return;
      }

      // --- console ---
      case 'log': {
        const text = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
        log(text);
        return;
      }
      case 'dump': {
        for (const k of Object.keys(pulp.vars)) log(`${k} = ${pulp.vars[k]}`);
        return;
      }

      // --- timing ---
      case 'wait': {
        const seconds = toNum(args[0]);
        const cont = s.block;
        if (cont) pendingWaits.push({ remainingMs: seconds * 1000, fn: () => execBlock(cont, namespace) });
        return;
      }
      case 'shake': {
        if (hooks.onShake) hooks.onShake(toNum(args[0] != null ? args[0] : 4));
        if (s.block) execBlock(s.block, namespace);
        return;
      }

      // --- input ---
      case 'listen': pulp.config.input_locked = false; return;
      case 'ignore': pulp.config.input_locked = true; return;
      case 'act': dispatch('player', 'confirm', {}); return;

      // --- drawing (mostly no-ops; render layer reads runtime state) ---
      case 'hide':
      case 'window':
      case 'label':
      case 'fill':
      case 'crop':
      case 'draw':
        // Custom draw isn't fully implemented; surface as no-op + last-call hint.
        pulp._lastDraw = { name, args };
        return;

      // --- queries (also legal as statements; stash in event.last) ---
      case 'random': case 'floor': case 'ceil': case 'round':
      case 'sine':   case 'cosine': case 'tangent': case 'radians': case 'degrees':
      case 'solid':  case 'type':   case 'id':      case 'name':    case 'invert':
        pulp.event.last = runQuery(name, args);
        return;

      // --- dispatch primitives (parser tends to reject these as statements,
      // but be safe in case the AST contains them via Calls).
      case 'call': case 'emit': case 'mimic':
        log(`warn: '${name}' encountered as call — parser usually rejects this`);
        return;

      default:
        log('unknown command: ' + name);
        return;
    }
  }

  function runQuery(name, args) {
    switch (name) {
      case 'random': {
        let a = toNum(args[0]), b = toNum(args[1]);
        if (b < a) [a, b] = [b, a];
        return Math.floor(a + Math.random() * (b - a + 1));
      }
      case 'floor': return Math.floor(toNum(args[0]));
      case 'ceil':  return Math.ceil(toNum(args[0]));
      case 'round': return Math.round(toNum(args[0]));
      case 'sine':  return Math.sin(toNum(args[0]));
      case 'cosine':return Math.cos(toNum(args[0]));
      case 'tangent':return Math.tan(toNum(args[0]));
      case 'radians':return toNum(args[0]) * Math.PI / 180;
      case 'degrees':return toNum(args[0]) * 180 / Math.PI;
      case 'solid': { const t = tileAt(args[0], args[1]); return !!(t && t.solid); }
      case 'type':  { const t = tileAt(args[0], args[1]); return t ? t.type : ''; }
      case 'id':    { const t = tileAt(args[0], args[1]); return t ? t.id : ''; }
      case 'name':  { const t = tileAt(args[0], args[1]); return t ? (t.name || '') : ''; }
      case 'invert':return false;
      case 'frame': {
        const tgt = args[0];
        if (tgt == null) return player.frame_idx || 0;
        const t = (typeof tgt === 'string') ? tilesById[tgt] : null;
        return t && t._runtimeFrame || 0;
      }
      default: return null;
    }
  }

  function safeExec(fn) {
    try { fn(); }
    catch (e) {
      if (e instanceof DoneSignal) return;
      log('runtime error: ' + (e && e.message ? e.message : e));
    }
  }

  // ---- Tick (50ms / 20FPS) ----
  function tick(dtMs) {
    // Resolve pending waits.
    for (let i = pendingWaits.length - 1; i >= 0; i--) {
      pendingWaits[i].remainingMs -= dtMs;
      if (pendingWaits[i].remainingMs <= 0) {
        const w = pendingWaits.splice(i, 1)[0];
        safeExec(w.fn);
      }
    }

    // Advance active dialog auto-dismiss timer.
    if (activeDialog) {
      dialogTimer -= dtMs;
      if (dialogTimer <= 0 && activeDialog.kind === 'say') dismissDialog();
    }

    // Don't fire game/room/player loop events while a dialog is up.
    if (activeDialog) return;

    // Fire `loop` on game, current room, player. `update` on player.
    dispatch('game', 'loop', {});
    if (currentRoomId) dispatch(`room_${currentRoomId}`, 'loop', {});
    dispatch('player', 'loop', {});
    dispatch('game', 'update', { x: player.x, y: player.y });
    dispatch('player', 'update', { x: player.x, y: player.y });
  }

  // ---- Boot ----
  function boot() {
    if (player.start_room) currentRoomId = player.start_room;
    dispatch('game', 'load', { kind: 'load' });
    dispatch('game', 'start', { kind: 'start' });
    if (currentRoomId) dispatch(`room_${currentRoomId}`, 'enter', { room_id: currentRoomId });
  }

  // ---- Input ----
  function sendInput(action) {
    if (pulp.config.input_locked) return;
    if (activeDialog) {
      if (action === 'confirm' || action === 'cancel') dismissDialog();
      return;
    }
    switch (action) {
      case 'left':    return tryMove(-1, 0);
      case 'right':   return tryMove( 1, 0);
      case 'up':      return tryMove( 0,-1);
      case 'down':    return tryMove( 0, 1);
      case 'confirm':
        dispatchInput('confirm', {});
        // auto_act: trigger interact on tile under player.
        if (pulp.config.auto_act) {
          const t = tileAt(player.x, player.y);
          if (t) dispatch(`tile_${t.id}`, 'interact', { x: player.x, y: player.y });
        }
        return;
      case 'cancel':  return dispatchInput('cancel', {});
      case 'crank':   return dispatchInput('crank', {});
      case 'dock':    return dispatchInput('dock', {});
      case 'undock':  return dispatchInput('undock', {});
      case 'menu':    return; // reserved
    }
  }

  return {
    pulp,
    project,
    tiles: tilesById,
    rooms: roomsById,
    sounds: soundsById,
    songs: songsById,
    player,
    handlers,
    boot,
    tick,
    sendInput,
    dismissDialog,
    getDialog: () => activeDialog,
    getRoom: currentRoom,
    getRoomId: () => currentRoomId,
    setRoom,
    tileAt,
  };
}
