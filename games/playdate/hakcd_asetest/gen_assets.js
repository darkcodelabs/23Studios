'use strict';

// Asset generation driver for the HAKCD AseTest build.
// Every visual asset in this game comes from the prompt→Aseprite pipeline:
// LLM writes an Aseprite Lua script, aseprite -b runs it in the bwrap jail,
// validators enforce 1-bit + dims, winning script is kept in aseprite_src/.
//
// Run from server/: node ../games/playdate/hakcd_asetest/gen_assets.js [only-name]

const fsp = require('fs/promises');
const path = require('path');

const SERVER = path.resolve(__dirname, '..', '..', '..', 'server');
const gen = require(path.join(SERVER, 'services', 'aseprite_script_gen'));

const GAME = __dirname;
const IMAGES = path.join(GAME, 'source', 'images');
const LAUNCHER = path.join(GAME, 'source', 'launcher');
const SRC = path.join(GAME, 'aseprite_src');

const STYLE = [
  'HAKCD phreaker-noir canon: 1998 hacker kid bedroom-to-street world. Chunky',
  'silhouettes, heavy black masses, 2px outlines, Bayer/checkerboard dither for',
  'shadow and CRT glow. Perspective: three-quarter side view. No modern UI',
  'chrome. Everything must read on a 400x240 reflective 1-bit screen.',
].join(' ');

// Single images save via sprite:saveAs(joinPath(out, "<name>.png")) — spelled
// out per-asset because the shared cheatsheet only documents imagetables.
const IMAGE_SAVE = (name) =>
  'This is kind="image": do NOT use ExportSpriteSheet. After drawing, flatten ' +
  'and save with sprite:saveAs(app.fs.joinPath(os.getenv("ASE_OUT_DIR"), "' + name + '.png")). ' +
  'Also save the .aseprite source next to it.';

const ASSETS = [
  {
    out: IMAGES,
    spec: { name: 'newb', kind: 'imagetable', frameW: 32, frameH: 32, frames: 4 },
    prompt:
      'Player sprite "newb": scrawny 90s hacker kid, backwards cap, baggy hoodie, ' +
      'high-top sneakers. 4-frame walk cycle, side view, legs and arms clearly ' +
      'swinging between frames, head bobbing 1px. Strong black silhouette, white face patch, ' +
      'dither shading on hoodie. Export exactly newb-table-32-32.png.',
  },
  {
    out: IMAGES,
    spec: { name: 'pwnglove', kind: 'imagetable', frameW: 80, frameH: 40, frames: 4 },
    prompt:
      'Hero hardware sprite "PWNGLOVE": chunky cyber power-glove on a museum pedestal, ' +
      'thick ribbon cable trailing left, LED studs on knuckles. 4-frame idle pulse: LEDs ' +
      'blink in sequence frame to frame, faint dither aura grows/shrinks. Wide 80x40 frames. ' +
      'Export exactly pwnglove-table-80-40.png.',
  },
  {
    out: IMAGES,
    spec: { name: 'payphone', kind: 'imagetable', frameW: 32, frameH: 32, frames: 4 },
    prompt:
      'Prop sprite: 1990s street payphone, boxy body, handset on hook, coin slot. ' +
      '4-frame ring animation: handset rattles 1px and bell waves radiate as dither arcs ' +
      'that expand per frame. Export exactly payphone-table-32-32.png.',
  },
  {
    out: IMAGES,
    spec: { name: 'coin', kind: 'imagetable', frameW: 16, frameH: 16, frames: 4 },
    prompt:
      'Pickup sprite: quarter coin spin loop, 4 frames: full circle, narrow ellipse, ' +
      'edge-on line, narrow ellipse. Black outline, white face, tiny dither glint. ' +
      'Export exactly coin-table-16-16.png.',
  },
  {
    out: IMAGES,
    spec: { name: 'bg_playground', kind: 'image', frameW: 400, frameH: 240 },
    prompt:
      'Full-screen scene background 400x240: PWNGLOVE playground — indoor hacker den at night. ' +
      'Checkerboard-dithered floor with perspective, brick back wall, three station alcoves ' +
      'along the top wall (empty — sprites are composited later), window with city skyline ' +
      'and dithered moon glow upper right, cables running along the floor edges. Keep the ' +
      'central floor area (y 120-220) visually quiet so the player sprite reads. ' +
      IMAGE_SAVE('bg_playground'),
  },
  {
    out: IMAGES,
    spec: { name: 'title_card', kind: 'image', frameW: 400, frameH: 240 },
    prompt:
      'Full-screen title card 400x240: "HAKCD" in massive blocky pixel letters (each stroke ' +
      '8px+ thick, white letters with black outline on dithered dark city skyline), ' +
      'subtitle "ASEPRITE PIPELINE TEST" in 12px-cap blocky letters below, a small ' +
      'power-glove silhouette in the lower right corner. Draw every letter as rectangles — ' +
      'no font rendering exists. Leave a quiet 200x20 strip at y=200 for a "PRESS A" prompt ' +
      'drawn at runtime. ' + IMAGE_SAVE('title_card'),
  },
  {
    out: LAUNCHER,
    spec: { name: 'card', kind: 'image', frameW: 350, frameH: 155 },
    prompt:
      'Playdate launcher card 350x155. MUST contain the game name "HAKCD" as huge blocky ' +
      'pixel letters filling most of the card (launcher shows no text label — the art IS ' +
      'the label). White letters, black dithered background, small glove icon right side. ' +
      'Draw letters as rectangles. ' + IMAGE_SAVE('card'),
  },
];

async function main() {
  process.env.STUDIO_DRIFT_DETECT = process.env.STUDIO_DRIFT_DETECT || 'log';
  const only = process.argv[2] || null;
  const results = [];
  for (const asset of ASSETS) {
    if (only && asset.spec.name !== only) continue;
    const t0 = Date.now();
    console.log('[gen] ' + asset.spec.name + ' ...');
    try {
      const r = await gen.generateAsset({
        prompt: asset.prompt,
        spec: asset.spec,
        styleGuide: STYLE,
        model: 'claude-code',
        projectId: null,
        maxAttempts: 4,
      });
      if (!r.ok) {
        console.log('[gen] ' + asset.spec.name + ' FAILED after ' + r.attempts + ' attempts');
        console.log(JSON.stringify(r.history, null, 2));
        results.push({ name: asset.spec.name, ok: false });
        continue;
      }
      await fsp.mkdir(asset.out, { recursive: true });
      for (const a of r.artifacts) {
        if (a.name.endsWith('.png')) {
          await fsp.copyFile(a.path, path.join(asset.out, a.name));
        } else if (a.name.endsWith('.aseprite')) {
          await fsp.copyFile(a.path, path.join(SRC, a.name));
        }
      }
      await fsp.writeFile(path.join(SRC, asset.spec.name + '.lua'), r.script, 'utf8');
      console.log('[gen] ' + asset.spec.name + ' OK attempts=' + r.attempts + ' ' + ((Date.now() - t0) / 1000) + 's');
      results.push({ name: asset.spec.name, ok: true, attempts: r.attempts });
    } catch (e) {
      console.log('[gen] ' + asset.spec.name + ' ERROR ' + (e.code || e.message));
      results.push({ name: asset.spec.name, ok: false, error: e.code || e.message });
    }
  }
  console.log('SUMMARY ' + JSON.stringify(results));
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}

main();
