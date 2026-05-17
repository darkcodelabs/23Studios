// Canvas renderer for the pulp interpreter.
// Pre-rasterizes every tile frame into an offscreen canvas at load time so
// per-tick painting reduces to drawImage calls.
//
// Canvas is logical 400x240, scaled up by the host (PulpPlay sets ctx scale
// via CSS / explicit width). Each room cell is 16x16, grid is 25x15.

const CELL = 16;
const ROOM_W = 25;
const ROOM_H = 15;
const DIALOG_H = 60;

const COLOR_OFF = '#0a1f12'; // background; Pulp green-on-black aesthetic
const COLOR_ON  = '#9dffce';

export function createRenderer(canvas, runtime, opts = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  // Pre-rasterize every frame of every tile.
  const cache = Object.create(null); // tileId -> [HTMLCanvasElement per frame]
  rasterizeAll();

  function rasterizeAll() {
    for (const id of Object.keys(runtime.tiles)) {
      cache[id] = (runtime.tiles[id].frames || []).map(rasterFrame);
    }
  }

  function rasterFrame(frame) {
    const c = document.createElement('canvas');
    c.width = CELL;
    c.height = CELL;
    const fc = c.getContext('2d');
    const px = (frame && frame.pixels) || '';
    for (let y = 0; y < CELL; y++) {
      for (let x = 0; x < CELL; x++) {
        const ch = px.charCodeAt(y * CELL + x);
        if (ch === 49 /* '1' */) {
          fc.fillStyle = COLOR_ON;
          fc.fillRect(x, y, 1, 1);
        }
      }
    }
    return c;
  }

  function pickFrame(tileId, fallbackIdx) {
    const frames = cache[tileId];
    if (!frames || frames.length === 0) return null;
    const t = runtime.tiles[tileId];
    let idx = (t && t._runtimeFrame != null) ? t._runtimeFrame : (fallbackIdx | 0);
    if (idx < 0) idx = 0;
    idx %= frames.length;
    return frames[idx];
  }

  function paint(frameTick) {
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
          // Animate world tiles by fps if set.
          const tile = runtime.tiles[tid];
          let idx = 0;
          if (tile && tile.fps > 0 && tile.frames && tile.frames.length > 1) {
            idx = Math.floor(frameTick * tile.fps / 20) % tile.frames.length;
          }
          const img = pickFrame(tid, idx);
          if (img) ctx.drawImage(img, x * CELL, y * CELL);
        }
      }
    }

    // Player.
    const p = runtime.player;
    if (p && p.tile_id && cache[p.tile_id]) {
      const playerTile = runtime.tiles[p.tile_id];
      let pIdx = 0;
      if (playerTile && playerTile.fps > 0 && playerTile.frames && playerTile.frames.length > 1) {
        pIdx = Math.floor(frameTick * playerTile.fps / 20) % playerTile.frames.length;
      }
      const img = pickFrame(p.tile_id, pIdx);
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

  return { paint, rerasterize: rasterizeAll };
}

export const RENDER_CONSTANTS = { CELL, ROOM_W, ROOM_H, DIALOG_H };
