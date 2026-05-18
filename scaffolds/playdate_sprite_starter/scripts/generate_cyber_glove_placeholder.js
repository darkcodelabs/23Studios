#!/usr/bin/env node
'use strict';

// Generates a placeholder cyber_glove imagetable so the scaffold compiles
// out-of-the-box. Each row is a distinguishable per-state silhouette built
// from geometric primitives (NOT stick figures). Real artists are expected
// to overwrite this with hand-drawn 80×40 frames; see README §6.
//
// Layout (per references/imagetable-conventions.md + scaffold README):
//   320 × 200 px,  4 cols × 5 rows of 80 × 40 frames
//   row 0  idle      (closed glove, 4 idle frames w/ subtle breathing dot)
//   row 1  activate  (open palm, fingers spreading)
//   row 2  scan      (glove + radiating scan-line cone)
//   row 3  overload  (glove + lightning bolts crackling)
//   row 4  damaged   (glove with crack lines, 3 frames + icon)
//
// Run:
//   node scripts/generate_cyber_glove_placeholder.js
//
// Output: source/images/cyber_glove-table-80-40.png

const path = require('path');
const fs = require('fs');
const { buildSheet } = require(path.resolve(__dirname, '..', '..', '..', 'server', 'services', 'imagetable_builder.js'));

const W = 80;
const H = 40;
const COLS = 4;
const ROWS = 5;

function blank() {
  // RGBA, fully transparent.
  return Buffer.alloc(W * H * 4);
}

function setPx(buf, x, y, on) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const off = (y * W + x) * 4;
  if (on) {
    buf[off] = 0; buf[off + 1] = 0; buf[off + 2] = 0; buf[off + 3] = 255;
  } else {
    buf[off + 3] = 0;
  }
}

function rect(buf, x, y, w, h, on) {
  for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) setPx(buf, x + dx, y + dy, on);
}

function rectOutline(buf, x, y, w, h) {
  for (let dx = 0; dx < w; dx++) { setPx(buf, x + dx, y, true); setPx(buf, x + dx, y + h - 1, true); }
  for (let dy = 0; dy < h; dy++) { setPx(buf, x, y + dy, true); setPx(buf, x + w - 1, y + dy, true); }
}

function line(buf, x1, y1, x2, y2) {
  // Bresenham.
  let dx = Math.abs(x2 - x1), dy = -Math.abs(y2 - y1);
  let sx = x1 < x2 ? 1 : -1, sy = y1 < y2 ? 1 : -1;
  let err = dx + dy;
  let x = x1, y = y1;
  while (true) {
    setPx(buf, x, y, true);
    if (x === x2 && y === y2) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

function circle(buf, cx, cy, r, filled) {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d2 = x * x + y * y;
      const r2 = r * r;
      if (filled ? d2 <= r2 : (d2 <= r2 && d2 >= (r - 1) * (r - 1))) {
        setPx(buf, cx + x, cy + y, true);
      }
    }
  }
}

// ---- Base glove silhouette (shared) -------------------------------------
//
// Glove body: 24 wide × 20 tall, anchored at (28, 12). Forearm bar:
// 18 wide × 6 tall at (4, 19). Ribbon cable: 8 wide × 12 tall trailing
// off the wrist at (50, 14). Module dot: 4×4 at (62, 18).
function drawBase(buf) {
  rectOutline(buf, 4, 19, 18, 6);      // forearm
  rect(buf, 7, 21, 12, 2, true);       // forearm shading band
  rectOutline(buf, 22, 12, 24, 20);    // glove cuff/body
  // Thumb knuckle
  rect(buf, 22, 18, 2, 4, true);
  // Finger separators (4 fingers)
  for (let i = 0; i < 4; i++) {
    rect(buf, 26 + i * 5, 13, 1, 6, true);
  }
  // Ribbon cable
  for (let x = 46; x <= 54; x += 2) line(buf, x, 14, x, 26);
  // Wrist module
  rectOutline(buf, 60, 16, 8, 8);
  rect(buf, 62, 18, 4, 4, true);
}

// ---- Per-state decorators -----------------------------------------------

function frameIdle(i) {
  const buf = blank();
  drawBase(buf);
  // Breathing dot pulses on/off across frames.
  if (i % 2 === 0) setPx(buf, 64, 20, false); // clear
  if (i === 1 || i === 2) circle(buf, 64, 20, 1, true);
  return buf;
}

function frameActivate(i) {
  const buf = blank();
  drawBase(buf);
  // Fingers spread upward: vertical lines extend by `i` px.
  for (let f = 0; f < 4; f++) {
    line(buf, 27 + f * 5, 12, 27 + f * 5, 12 - (i + 1) * 2);
  }
  // Energy dot above palm.
  if (i >= 1) circle(buf, 34, 6, i, false);
  return buf;
}

function frameScan(i) {
  const buf = blank();
  drawBase(buf);
  // Radiating cone of scan lines that rotates per frame.
  const cx = 34, cy = 22;
  const angles = [-30, -10, 10, 30].map(a => a + i * 5);
  for (const a of angles) {
    const rad = a * Math.PI / 180;
    const x2 = Math.round(cx + Math.cos(rad) * 26);
    const y2 = Math.round(cy + Math.sin(rad) * 18);
    line(buf, cx, cy, x2, y2);
  }
  return buf;
}

function frameOverload(i) {
  const buf = blank();
  drawBase(buf);
  // Lightning bolts: zigzag lines around the glove.
  const offsets = [[6, 4], [44, 6], [16, 36], [48, 32]];
  for (let k = 0; k < offsets.length; k++) {
    const [ox, oy] = offsets[k];
    const phase = (i + k) % 4;
    let x = ox, y = oy;
    for (let step = 0; step < 4; step++) {
      const nx = x + (step % 2 === 0 ? 3 : -3) + phase;
      const ny = y + 2;
      line(buf, x, y, nx, ny);
      x = nx; y = ny;
    }
  }
  // Solid flash band on alternate frames.
  if (i % 2 === 1) rect(buf, 24, 14, 20, 2, true);
  return buf;
}

function frameDamaged(i) {
  const buf = blank();
  drawBase(buf);
  // Diagonal crack across glove.
  line(buf, 22 + i, 14, 44 - i, 30);
  // Splinter cracks.
  line(buf, 30, 18, 30 + i, 14);
  line(buf, 38, 24, 38 - i, 28);
  return buf;
}

function iconFrame() {
  const buf = blank();
  // Compact 1-frame icon: just the glove silhouette, no decoration.
  drawBase(buf);
  return buf;
}

async function main() {
  const frames = [];
  for (let i = 0; i < COLS; i++) frames.push(frameIdle(i));
  for (let i = 0; i < COLS; i++) frames.push(frameActivate(i));
  for (let i = 0; i < COLS; i++) frames.push(frameScan(i));
  for (let i = 0; i < COLS; i++) frames.push(frameOverload(i));
  // Damaged: 3 frames + icon = 4
  for (let i = 0; i < 3; i++) frames.push(frameDamaged(i));
  frames.push(iconFrame());

  if (frames.length !== COLS * ROWS) {
    throw new Error(`expected ${COLS * ROWS} frames, got ${frames.length}`);
  }

  const png = await buildSheet({ frames, frameW: W, frameH: H, cols: COLS });
  const outDir = path.resolve(__dirname, '..', 'source', 'images');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'cyber_glove-table-80-40.png');
  fs.writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${png.length} bytes, ${COLS}x${ROWS} grid of ${W}x${H} frames)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
