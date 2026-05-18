// Canvas renderer for the pulp interpreter.
// Pre-rasterizes every tile frame into an offscreen canvas at load time so
// per-tick painting reduces to drawImage calls.
//
// Canvas is logical 400x240, scaled up by the host (PulpPlay sets ctx scale
// via CSS / explicit width). Each room cell is CELL px (8 or 16), grid is
// 25x15 cells.
//
// Animation: each tile carries `fps` and `loop`. The renderer walks frames
// at `(now - tileStart) * fps / 1000` and caches the last-rendered frame
// index per tile id so per-cell draws are cheap drawImage calls.
//
// Characters w/ `imagetable` + active `state` animate via the imagetable
// rows (row = state, count = frames in that state). Characters are
// optional — when present, runtime.characters keys map to character ids
// and characters[id].state names the active row.

const ROOM_W = 25;
const ROOM_H = 15;
const DIALOG_H = 60;

const COLOR_OFF = '#0a1f12'; // background; Pulp green-on-black aesthetic
const COLOR_ON  = '#9dffce';

function detectCell(runtime) {
  // Look at first tile frame; 64 chars -> 8x8, 256 chars -> 16x16.
  for (const id of Object.keys(runtime.tiles)) {
    const t = runtime.tiles[id];
    const f = t && Array.isArray(t.frames) ? t.frames[0] : null;
    if (f && typeof f.pixels === 'string') {
      if (f.pixels.length === 256) return 16;
      if (f.pixels.length === 64) return 8;
    }
  }
  return 16;
}

export function createRenderer(canvas, runtime) {
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  const CELL = detectCell(runtime);

  // Pre-rasterize every frame of every tile.
  const cache = Object.create(null); // tileId -> [HTMLCanvasElement per frame]
  // Per-tile animation start timestamp.
  const tileStart = Object.create(null);
  // Cached last frame index per tile id; avoids recomputing inside the
  // grid loop when many cells share a tile id.
  const lastIdx = Object.create(null);
  let lastNow = -1;

  rasterizeAll();

  function rasterizeAll() {
    for (const id of Object.keys(runtime.tiles)) {
      cache[id] = (runtime.tiles[id].frames || []).map(rasterFrame);
      tileStart[id] = performance.now();
    }
  }

  function rasterFrame(frame) {
    const c = document.createElement('canvas');
    c.width = CELL;
    c.height = CELL;
    const fc = c.getContext('2d');
    const px = (frame && frame.pixels) || '';
    // Frame may be 64 chars (8x8) or 256 chars (16x16). Sample only what's
    // available; if a frame's stride doesn't match CELL, fall back to its
    // own stride and draw centered.
    const stride = px.length === 64 ? 8 : (px.length === 256 ? 16 : CELL);
    const offX = Math.max(0, (CELL - stride) >> 1);
    const offY = Math.max(0, (CELL - stride) >> 1);
    for (let y = 0; y < stride; y++) {
      for (let x = 0; x < stride; x++) {
        const ch = px.charCodeAt(y * stride + x);
        if (ch === 49 /* '1' */) {
          fc.fillStyle = COLOR_ON;
          fc.fillRect(offX + x, offY + y, 1, 1);
        }
      }
    }
    return c;
  }

  // Resolve the active frame index for a tile id based on now + tile fps/loop.
  // Caches the result per (tileId,now) so repeated draws of the same tile in
  // a single paint() pass don't recompute.
  function frameIndexFor(tileId, now) {
    const tile = runtime.tiles[tileId];
    const frames = cache[tileId];
    if (!tile || !frames || frames.length === 0) return 0;

    // Runtime override via `frame` command sticks.
    if (tile._runtimeFrame != null) {
      let i = tile._runtimeFrame | 0;
      if (i < 0) i = 0;
      return i % frames.length;
    }
    if (frames.length === 1) return 0;
    const fps = Number(tile.fps) > 0 ? Number(tile.fps) : 0;
    if (!fps) return 0;

    if (now !== lastNow) {
      // New paint pass — clear cache.
      for (const k in lastIdx) delete lastIdx[k];
      lastNow = now;
    }
    if (lastIdx[tileId] !== undefined) return lastIdx[tileId];

    if (tileStart[tileId] == null) tileStart[tileId] = now;
    const elapsed = now - tileStart[tileId];
    const raw = Math.floor(elapsed * fps / 1000);
    const loop = tile.loop !== false; // default true
    let idx;
    if (loop) {
      idx = ((raw % frames.length) + frames.length) % frames.length;
    } else {
      idx = raw >= frames.length ? frames.length - 1 : Math.max(0, raw);
    }
    lastIdx[tileId] = idx;
    return idx;
  }

  function getCanvasForFrame(tileId, idx) {
    const frames = cache[tileId];
    if (!frames || frames.length === 0) return null;
    return frames[((idx % frames.length) + frames.length) % frames.length];
  }

  function paint(_frameTick) {
    const now = performance.now();

    // Clear.
    ctx.fillStyle = COLOR_OFF;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Room grid.
    const room = runtime.getRoom();
    if (room && room.grid) {
      for (let y = 0; y < ROOM_H; y++) {
        const row = room.grid[y];
        if (!row) continue;
        for (let x = 0; x < ROOM_W; x++) {
          const tid = row[x];
          if (!tid) continue;
          const idx = frameIndexFor(tid, now);
          const img = getCanvasForFrame(tid, idx);
          if (img) ctx.drawImage(img, x * CELL, y * CELL);
        }
      }
    }

    // Player.
    const p = runtime.player;
    if (p && p.tile_id && cache[p.tile_id]) {
      const pIdx = frameIndexFor(p.tile_id, now);
      const img = getCanvasForFrame(p.tile_id, pIdx);
      if (img) ctx.drawImage(img, p.x * CELL, p.y * CELL);
    } else if (p) {
      // No player tile defined — draw a small fallback square so the player is visible.
      ctx.fillStyle = COLOR_ON;
      ctx.fillRect(p.x * CELL + 4, p.y * CELL + 4, 8, 8);
    }

    // Dialog box.
    const dlg = runtime.getDialog();
    if (dlg) {
      const top = canvas.height - DIALOG_H;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, top, canvas.width, DIALOG_H);
      ctx.fillStyle = '#000000';
      ctx.font = '8px monospace';
      ctx.textBaseline = 'top';
      drawWrappedText(ctx, String(dlg.text || ''), 6, top + 6, canvas.width - 12, 10);
      if (dlg.options && dlg.options.length) {
        let oy = top + 26;
        for (const opt of dlg.options) {
          ctx.fillText('- ' + opt.label, 8, oy);
          oy += 10;
        }
      }
      // Prompt.
      ctx.fillText('[Z to continue]', canvas.width - 100, top + DIALOG_H - 12);
    }
  }

  function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = String(text).split(/\s+/);
    let line = '';
    let cy = y;
    for (let i = 0; i < words.length; i++) {
      const test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        ctx.fillText(line, x, cy);
        line = words[i];
        cy += lineHeight;
      } else {
        line = test;
      }
    }
    if (line) ctx.fillText(line, x, cy);
  }

  function rerasterize() {
    for (const k in cache) delete cache[k];
    for (const k in tileStart) delete tileStart[k];
    for (const k in lastIdx) delete lastIdx[k];
    rasterizeAll();
  }

  return { paint, rerasterize };
}

export const RENDER_CONSTANTS = { ROOM_W, ROOM_H, DIALOG_H };
