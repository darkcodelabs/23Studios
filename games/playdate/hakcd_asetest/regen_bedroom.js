'use strict';
// Regen the one heavy scene that timed out at 600s, with a 20-min ceiling.
process.env.ASEPRITE_CLAUDE_TIMEOUT_MS = '1200000';
process.env.STUDIO_DRIFT_DETECT = 'log';
const fsp = require('fs/promises');
const path = require('path');
const SERVER = path.resolve(__dirname, '..', '..', '..', 'server');
const gen = require(path.join(SERVER, 'services', 'aseprite_script_gen'));
const IMAGES = path.join(__dirname, 'source', 'images');
const SRC = path.join(__dirname, 'aseprite_src');

const STYLE = [
  'HAKCD phreaker-noir canon, 1998 suburban Midwest hacker kid. ISOMETRIC rooms',
  'with a dithered dot-grid floor (checkerboard/Bayer), 3/4 view, chunky furniture',
  'with 2px black outlines, heavy black masses, CRT glow via dither. Strictly 1-bit,',
  'no gray. Must read on a 400x240 reflective LCD.',
].join(' ');

const spec = { name: 'room_bedroom', kind: 'image', frameW: 400, frameH: 240 };
const prompt =
  'ISOMETRIC bedroom, 1998 teenage hacker den, 3/4 top-down. Dithered dot-grid floor across ' +
  'the whole room, two back walls meeting at a corner. Left wall: desk with a chunky CRT monitor ' +
  '(glowing dithered screen), keyboard, external modem with a tiny LED. Right wall: an unmade bed. ' +
  'Window upper-right with dithered night sky + moon. Door lower-right. Poster on the wall. Corded ' +
  'phone on the desk. Keep the floor center (x160-260, y150-210) calm so a player sprite reads. ' +
  'kind="image": do NOT use ExportSpriteSheet. After drawing, flatten and save with ' +
  'sprite:saveAs(app.fs.joinPath(os.getenv("ASE_OUT_DIR"), "room_bedroom.png")). Also save the ' +
  '.aseprite source. Fill the FULL 400x240 canvas edge to edge. Keep the script efficient so it ' +
  'runs quickly -- prefer rect fills and loops over per-pixel work where you can.';

(async () => {
  const t0 = Date.now();
  console.log('[regen] room_bedroom ...');
  const r = await gen.generateAsset({ prompt, spec, styleGuide: STYLE, model: 'claude-code', projectId: null, maxAttempts: 3 });
  if (!r.ok) { console.log('[regen] FAILED'); console.log(JSON.stringify(r.history, null, 2)); process.exit(1); }
  for (const a of r.artifacts) {
    if (a.name.endsWith('.png')) await fsp.copyFile(a.path, path.join(IMAGES, a.name));
    else if (a.name.endsWith('.aseprite')) await fsp.copyFile(a.path, path.join(SRC, a.name));
  }
  await fsp.writeFile(path.join(SRC, 'room_bedroom.lua'), r.script, 'utf8');
  console.log('[regen] room_bedroom OK attempts=' + r.attempts + ' ' + ((Date.now()-t0)/1000) + 's');
})();
