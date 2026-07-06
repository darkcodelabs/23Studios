'use strict';
// gen_assets_v6.js — HAKCD v6 art, authored ENTIRELY by the Aseprite pipeline
// via the logged-in claude-code CLI (no OpenRouter/OpenAI). Detailed, heavily
// dithered 1-bit art for a WALKABLE game: a 3D-ish hero that walks around rich
// isometric rooms. Single-asset mode for parallel agent-team generation:
//   node gen_assets_v6.js <asset-name>
// or all: node gen_assets_v6.js
process.env.ASEPRITE_CLAUDE_TIMEOUT_MS = process.env.ASEPRITE_CLAUDE_TIMEOUT_MS || '1200000';

const fsp = require('fs/promises');
const path = require('path');
const SERVER = path.resolve(__dirname, '..', '..', '..', 'server');
const gen = require(path.join(SERVER, 'services', 'aseprite_script_gen'));
const IMAGES = path.join(__dirname, 'source', 'images');
const LAUNCHER = path.join(__dirname, 'source', 'launcher');
const SRC = path.join(__dirname, 'aseprite_src');

// The bar: detailed, high-density 1-bit like Return of the Obra Dinn / Playdate.
// Heavy Floyd/Bayer dithering for shading, depth and volume; fine linework;
// dense period-accurate 1998 hacker detail. NOT chunky, NOT flat, NOT cartoon.
// Isometric rooms MUST keep an open walkable floor for the hero to move on.
const STYLE = [
  'HAKCD house style: DETAILED, high-density 1-bit black-and-white pixel art in the',
  'spirit of Return of the Obra Dinn and moody Playdate games. HEAVY dithering',
  '(Floyd-Steinberg / clustered Bayer ramps) is the shading engine — use it lavishly',
  'for gradients, volume, shadow, CRT/neon glow and depth so surfaces read as solid and',
  'lit. Fine 1-2px linework, realistic-ish proportions (NOT chunky, NOT flat cartoon).',
  'Dense, period-accurate 1998 suburban-hacker detail. Strict pure black & white only —',
  'no gray, no anti-aliasing (dither ramps ARE the grays). Reads on a 400x240 LCD.',
].join(' ');

const IMG = (name, w, h) =>
  'kind="image" ' + (w||400) + 'x' + (h||240) + ': do NOT use ExportSpriteSheet (single flat image, not a sheet). ' +
  'After drawing, flatten and sprite:saveAs(app.fs.joinPath(os.getenv("ASE_OUT_DIR"), "' + name + '.png")). ' +
  'Filename EXACTLY ' + name + '.png. Also save the .aseprite source. Fill the FULL canvas edge to edge. ' +
  'Author dense detail with rect fills + tight per-region loops; use dither loops (checker/Bayer) for every shaded area.';

const ASSETS = [
  { out: IMAGES, spec: { name: 'newb_hero', kind: 'imagetable', frameW: 48, frameH: 64, frames: 16 },
    prompt: 'A WALKABLE hero sprite sheet "newb": a lanky 1998 teenage hacker in a hooded sweatshirt, backwards ' +
      'cap, baggy jeans, high-tops, small backpack. Realistic-ish proportions (NOT chunky), detailed with fine ' +
      'dither shading on the hoodie folds, jeans and face for volume and a clear light from upper-left. ~58px of ' +
      'the 64px frame tall. FOUR ROWS of 4 frames (SpriteSheetType.ROWS): row1 facing front/down, row2 back/up, ' +
      'row3 left, row4 right. Each row a believable 4-frame walk cycle with weighted stride, arm swing, subtle ' +
      'head bob. Strong readable silhouette each direction. Export exactly newb_hero-table-48-64.png ROWS.' },

  { out: IMAGES, spec: { name: 'room_bedroom', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'A DETAILED isometric 1998 teenage-hacker bedroom, 3/4 top-down, dense and atmospheric. Dither-shaded ' +
      'wood-panel walls meeting at a corner. Left wall: a cluttered desk with a fat CRT monitor (glowing dithered ' +
      'screen), keyboard, mouse, a beige tower PC and an external modem with LEDs. A corded phone. Above the desk: ' +
      'a HACKERS movie poster, a periodic-table chart, a pinned 2600 note. Right: an unmade bed with a lumpy ' +
      'dithered blanket, a window with venetian blinds and moonlight. Foreground floor: scattered floppy disks, a ' +
      'stack of PHRACK zines, a soda can, a desk chair. HEAVY dithering for every shadow and surface. CRITICAL: ' +
      'keep the CENTER FLOOR (roughly x140-270, y150-215) relatively open and flat so the walkable hero reads there. ' + IMG('room_bedroom') },

  { out: IMAGES, spec: { name: 'scene_bbs', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'A detailed head-on beige CRT monitor filling the frame, showing a green-screen BBS. Chunky dithered ' +
      'plastic bezel with volume and screen glare. On-screen: an ASCII double-line border, a title area reading ' +
      '"DEADLINE BBS  555-0142", a few log lines, and a small ASCII skull. Faint dither scanlines. Leave the inner ' +
      'screen (x40-360, y28-205) mostly dark/quiet so live terminal text draws over it. ' + IMG('scene_bbs') },

  { out: IMAGES, spec: { name: 'map_suburbia', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'A detailed top-down 1998 suburban night map. Dither-textured lawns and asphalt roads with dashed ' +
      'lines winding between: a two-story house (upper-left) with lit windows, a Greyhound depot with a payphone ' +
      'sign (right), a fenced yard (lower-center). Parked cars, streetlamps casting dithered light pools, mailboxes, ' +
      'hedges, telephone poles with wires. Three small open clearings on the roadside as travel nodes. Rich, moody. ' + IMG('map_suburbia') },

  { out: IMAGES, spec: { name: 'scene_payphone', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'A detailed night exterior: a bank of three 1990s payphones on a grimy brick Greyhound-station wall ' +
      'under a buzzing dithered lamp. Wet concrete with reflective dither, a bench, a trash can, taped flyers, ' +
      'graffiti, one handset off the hook. Deep shadows, heavy dithering, lonely film-noir mood. Keep the lower-' +
      'center ground open for the walkable hero. ' + IMG('scene_payphone') },

  { out: IMAGES, spec: { name: 'scene_pedestal', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'A detailed suburban backyard at 2am. A green Bell telco pedestal (metal box on a concrete pad, hinged ' +
      'door with a hex lock) center-foreground in dither-shaded moonlit grass. A dark house with one lit window ' +
      'behind, a chain-link fence, bushes, a garden hose, a big dithered moon and drifting clouds. Tense, quiet, ' +
      'heavy shadow dithering. Keep the pedestal door and lower-center ground readable for the hero + a lock overlay. ' + IMG('scene_pedestal') },

  { out: IMAGES, spec: { name: 'portrait_newb', kind: 'image', frameW: 64, frameH: 64 },
    prompt: 'A detailed dialogue portrait 64x64, head-and-shoulders: "newb", a scrawny 17-year-old hacker, hood up, ' +
      'headphones round the neck, faint wary smirk. Fine dither shading for facial volume and the hood folds, ' +
      'realistic-ish, high contrast, reads at 64px. ' + IMG('portrait_newb', 64, 64) },

  { out: IMAGES, spec: { name: 'portrait_mentor', kind: 'image', frameW: 64, frameH: 64 },
    prompt: 'A detailed dialogue portrait 64x64: THE MENTOR, a faceless figure in a deep hood — the face is a dark ' +
      'dithered void (mysterious, dead-mans-daemon). Fine dither on the hood fabric for volume, ominous, high ' +
      'contrast. ' + IMG('portrait_mentor', 64, 64) },

  { out: IMAGES, spec: { name: 'portrait_konsole', kind: 'image', frameW: 64, frameH: 64 },
    prompt: 'A detailed dialogue portrait 64x64: k0nsole, a gender-ambiguous operative, hood up, half the face in ' +
      'dither shadow, one sharp visible eye. Fine dither shading, mysterious, high contrast. ' + IMG('portrait_konsole', 64, 64) },

  { out: IMAGES, spec: { name: 'portrait_mom', kind: 'image', frameW: 64, frameH: 64 },
    prompt: 'A detailed dialogue portrait 64x64: MOM, mid-40s tired-but-warm suburban mom, permed 90s hair, a ' +
      'cordless phone to her ear, exasperated. Fine dither shading for volume, realistic-ish, high contrast. ' + IMG('portrait_mom', 64, 64) },

  { out: IMAGES, spec: { name: 'floppy', kind: 'imagetable', frameW: 16, frameH: 16, frames: 4 },
    prompt: 'A detailed 3.5" floppy disk pickup, 16x16, 4-frame gleam loop: a dither shine sweeps across the label. ' +
      'Black outline, white body, metal shutter, tiny label lines. Export exactly floppy-table-16-16.png.' },

  { out: IMAGES, spec: { name: 'star', kind: 'imagetable', frameW: 24, frameH: 24, frames: 4 },
    prompt: 'A detailed collectible star token, 24x24, 4-frame spin: a chunky 5-point star with dither-shaded 3D ' +
      'facets and a sweeping glint, rotating frame to frame. 2px outline, white body. Export exactly star-table-24-24.png.' },

  { out: IMAGES, spec: { name: 'coin', kind: 'imagetable', frameW: 16, frameH: 16, frames: 4 },
    prompt: 'A detailed quarter coin, 16x16, 4-frame spin: dither-shaded round faces spinning to edge-on and back, ' +
      'a glint sweep. 2px outline. Export exactly coin-table-16-16.png.' },
];

async function one(asset) {
  const t0 = Date.now();
  const r = await gen.generateAsset({ prompt: asset.prompt, spec: asset.spec, styleGuide: STYLE,
    model: 'claude-code', projectId: null, maxAttempts: 4 });
  if (!r.ok) { console.log('FAIL ' + asset.spec.name + ' after ' + r.attempts); return false; }
  for (const a of r.artifacts) {
    if (a.name.endsWith('.png')) await fsp.copyFile(a.path, path.join(asset.out, a.name));
    else if (a.name.endsWith('.aseprite')) await fsp.copyFile(a.path, path.join(SRC, a.name));
  }
  await fsp.writeFile(path.join(SRC, asset.spec.name + '.lua'), r.script, 'utf8');
  console.log('OK ' + asset.spec.name + ' attempts=' + r.attempts + ' ' + ((Date.now()-t0)/1000).toFixed(0) + 's');
  return true;
}

(async () => {
  const only = process.argv[2] || null;
  const list = only ? ASSETS.filter(a => a.spec.name === only) : ASSETS;
  if (only && list.length === 0) { console.log('no such asset: ' + only); process.exit(2); }
  let allOk = true;
  for (const a of list) { const ok = await one(a); if (!ok) allOk = false; }
  process.exitCode = allOk ? 0 : 1;
})();
