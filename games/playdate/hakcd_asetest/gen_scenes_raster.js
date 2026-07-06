'use strict';
// gen_scenes_raster.js — generate HAKCD scenes in the design_handoff aesthetic
// using OpenAI gpt-image-1, then process each to strict 1-bit 400x240.
//
// This is the raster-gen path chosen for HAKCD's illustrated scenes (the
// procedural Aseprite pipeline cannot author Obra-Dinn-grade dithered art).
// A handoff reference is passed as a STYLE ANCHOR via the images/edits endpoint
// so new scenes match the established look.
//
// REQUIRES a working image API key. Reads OPENAI_API_KEY from env/.env.
// If absent it prints the blocker and exits 2 (no silent placeholder).
//
// Usage (from repo root, key in .env):
//   node games/playdate/hakcd_asetest/gen_scenes_raster.js [only-scene]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const GAME = __dirname;
const IMAGES = path.join(GAME, 'source', 'images');
const REF = path.resolve(GAME, '../../../design_handoff_23_studios/assets');
const RAW = path.join(GAME, 'raster_raw');

function loadEnvKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const env = fs.readFileSync(path.resolve(GAME, '../../../.env'), 'utf8');
    const m = env.match(/^OPENAI_API_KEY=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch (_e) {}
  return '';
}

const STYLE = [
  '1-bit black-and-white pixel-art illustration, heavy Floyd-Steinberg dithering',
  'in the style of Return of the Obra Dinn and Playdate games. Detailed, cinematic,',
  'high-contrast hacker-noir, 1998 suburban Midwest. Dense period-accurate',
  'environmental detail. Pure black and white only, no gray, no color. Full-frame',
  '4:3 adventure-game scene, no text, no dialogue bar, no UI.',
].join(' ');

// each scene: filename, prompt, style-anchor reference, crop+dither recipe
const SCENES = [
  { name: 'room_bedroom', anchor: 'scene-bedroom.png',
    prompt: STYLE + ' SCENE: a teenage hackers bedroom at night — CRT computer + tower + modem on a desk, corded phone, HACKERS movie poster, periodic table, 2600 magazine cutout, unmade bed, window blinds, stack of Phrack zines, scattered floppy disks, backpack, desk chair. The kid stands at the desk, back to us. Isometric 3/4 view.',
    crop: '1536x795+0+0', blur: '0x0.5' },
  { name: 'scene_bbs', anchor: 'scene-pins.png',
    prompt: STYLE + ' SCENE: a beige CRT monitor filling the frame showing a green-screen BBS terminal, ASCII border, "DEADLINE BBS - 555-0142", a chat log, an ASCII skull avatar labelled THE MENTOR, a bottom menu bar. Head-on view.',
    crop: '1536x795+0+0', blur: '0x0.3' },
];

async function genOne(key, sc) {
  const FormData = global.FormData;
  const fd = new FormData();
  fd.append('model', 'gpt-image-1');
  fd.append('prompt', sc.prompt);
  fd.append('size', '1536x1024');
  const anchorPath = path.join(REF, sc.anchor);
  const buf = fs.readFileSync(anchorPath);
  fd.append('image[]', new Blob([buf], { type: 'image/png' }), sc.anchor);
  const res = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST', headers: { Authorization: 'Bearer ' + key }, body: fd,
  });
  if (!res.ok) throw new Error('OpenAI ' + res.status + ': ' + (await res.text()).slice(0, 300));
  const j = await res.json();
  const b64 = j.data[0].b64_json;
  fs.mkdirSync(RAW, { recursive: true });
  const rawPng = path.join(RAW, sc.name + '.png');
  fs.writeFileSync(rawPng, Buffer.from(b64, 'base64'));
  // process → strict 1-bit 400x240 (same recipe as the interim art)
  const out = path.join(IMAGES, sc.name + '.png');
  execFileSync('convert', [rawPng, '-crop', sc.crop, '+repage', '-colorspace', 'Gray',
    '-resize', '400x240^', '-gravity', 'North', '-extent', '400x240',
    '-blur', sc.blur, '-normalize', '-monochrome', out]);
  return out;
}

(async () => {
  const key = loadEnvKey();
  if (!key) {
    console.error('BLOCKED: no OPENAI_API_KEY. Set it in .env (or env) then re-run.');
    console.error('  This driver refuses to ship placeholder art.');
    process.exit(2);
  }
  const only = process.argv[2] || null;
  for (const sc of SCENES) {
    if (only && sc.name !== only) continue;
    process.stdout.write('[raster] ' + sc.name + ' ... ');
    try { const out = await genOne(key, sc); console.log('OK -> ' + out); }
    catch (e) { console.log('FAIL ' + e.message); process.exitCode = 1; }
  }
})();
