'use strict';
// v0.4.0 MARIO-64 pass — the whole game reimagined in a Mario-64 aesthetic,
// rendered in strict 1-bit: rounded VOLUMETRIC forms, dither ramps faking soft
// 3D shading, chunky collectathon energy, big blob-shadowed hero.
// All via the prompt→Aseprite pipeline.
// Run from server/: node ../games/playdate/hakcd_asetest/gen_assets_v5.js [only]
process.env.ASEPRITE_CLAUDE_TIMEOUT_MS = process.env.ASEPRITE_CLAUDE_TIMEOUT_MS || '1200000';
process.env.STUDIO_DRIFT_DETECT = process.env.STUDIO_DRIFT_DETECT || 'log';

const fsp = require('fs/promises');
const path = require('path');
const SERVER = path.resolve(__dirname, '..', '..', '..', 'server');
const gen = require(path.join(SERVER, 'services', 'aseprite_script_gen'));
const IMAGES = path.join(__dirname, 'source', 'images');
const LAUNCHER = path.join(__dirname, 'source', 'launcher');
const SRC = path.join(__dirname, 'aseprite_src');

const STYLE = [
  'HAKCD reimagined in a MARIO 64 aesthetic, rendered in STRICT 1-bit black & white.',
  'Everything is ROUNDED, VOLUMETRIC and 3D-LOOKING — like low-poly N64 models rendered to',
  '1-bit. The core technique: DITHER GRADIENT RAMPS (checkerboard / Bayer, light-to-dark) fake',
  'soft 3D shading, curved surfaces, ambient occlusion and glow, so every object reads as ROUND',
  'and SOLID with a clear light direction (key light upper-left). Bold 2-3px black contour',
  'outlines on outer silhouettes only. Big, playful, inviting, collectathon energy — chunky',
  'platforms, floating rounded props, soft cast shadows under objects. Characters are chunky',
  'with oversized round heads and a dark blob shadow beneath. Environments are open, dimensional,',
  'slightly surreal cartoon spaces with depth. Dither IS the shading engine: use lots of tonal',
  'ramps for volume. NEVER a flat true-gray fill and NEVER anti-aliasing — only 1-bit dither.',
  'Must read on a 400x240 reflective LCD.',
].join(' ');

const IMG = (name, w, h) =>
  'kind="image" ' + (w||400) + 'x' + (h||240) + ': do NOT use ExportSpriteSheet, this is a single ' +
  'flat image not a sprite sheet. After drawing, flatten and save with ' +
  'sprite:saveAs(app.fs.joinPath(os.getenv("ASE_OUT_DIR"), "' + name + '.png")). Output filename ' +
  'must be EXACTLY ' + name + '.png (no -table- suffix). Also save the .aseprite source. Fill the ' +
  'FULL canvas edge to edge. Favor rect fills + tight loops so the script runs fast.';

const A = [
  { out: IMAGES, spec: { name: 'newb_hero', kind: 'imagetable', frameW: 48, frameH: 64, frames: 16 },
    prompt: 'MARIO-64 style HERO sprite sheet "newb": a chunky rounded low-poly-looking teen hacker, big round ' +
      'head, backwards cap, puffy rounded hoodie, fat rounded sneakers — like an N64 character model rendered ' +
      'to 1-bit with DITHER GRADIENT shading giving him roundness and volume (lit from upper-left). ~60px tall ' +
      'in the 64px frame (Mario-64 contextual size). FOUR ROWS of 4 frames (SpriteSheetType.ROWS): row1 ' +
      'front/down, row2 back/up, row3 left, row4 right. Each row a bouncy 4-frame walk with big squash-stretch ' +
      'stride, arm swing and 2px head bob. 3px black outer outline, dither ramps for the rounded body shading, ' +
      'bold white face with dot eyes. Clear silhouette each way. Export exactly newb_hero-table-48-64.png ROWS.' },

  { out: IMAGES, spec: { name: 'room_bedroom', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'MARIO-64 style ISOMETRIC bedroom-hub, 1998 hacker den as a chunky rounded 3D-cartoon space. ' +
      'Dither-gradient floor with soft depth, rounded walls meeting at a corner. A fat rounded desk with a ' +
      'bulbous CRT monitor (dither-glow screen), keyboard, chunky modem with a light. A puffy rounded bed. A ' +
      'round window upper-right with a dithered moon glow. A rounded door lower-right that reads like a level ' +
      'portal. Everything volumetric via dither ramps, soft cast shadows under furniture, key light upper-left. ' +
      'Keep the floor CENTER (x150-270, y140-215) open for a big hero. ' + IMG('room_bedroom') },

  { out: IMAGES, spec: { name: 'map_suburbia', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'MARIO-64 style overworld hub map, top-3/4: a chunky rounded suburban world floating in soft ' +
      'dither space. Rounded grassy mounds with dither-gradient shading for volume, fat winding road with ' +
      'dashed lines, a bulbous two-story player house (upper-left), a rounded Greyhound depot with a payphone ' +
      'sign (right), puffy round trees casting soft blob shadows, stubby rounded cars. Three glowing round ' +
      'travel nodes on the road like level-entry pads. Open, inviting, dimensional. ' + IMG('map_suburbia') },

  { out: IMAGES, spec: { name: 'scene_payphone', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'MARIO-64 style night exterior: three chunky ROUNDED payphones bulging off a curved brick station ' +
      'wall under a soft dither-glow lamp. Rounded concrete ground with soft cast shadows, dither-gradient ' +
      'volume everywhere, key light from the lamp. One rounded handset dangles. Dithered starry sky sliver. ' +
      'Dimensional and playful. Keep lower-center ground open for the hero. ' + IMG('scene_payphone') },

  { out: IMAGES, spec: { name: 'scene_pedestal', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'MARIO-64 style backyard at 2am: a fat ROUNDED green Bell telco pedestal (bulbous metal box, little ' +
      'hinged door + hex lock) sits center-foreground on a rounded concrete pad in dither-gradient moonlit ' +
      'grass, with a soft blob shadow. A rounded dark house with one glowing window behind. A big dithered ' +
      'moon upper-left as key light. Puffy round bushes. Volumetric, moody-but-playful. Keep pedestal door + ' +
      'lower-center ground readable. ' + IMG('scene_pedestal') },

  { out: IMAGES, spec: { name: 'scene_bbs', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'MARIO-64 style: a big BULBOUS rounded CRT computer monitor filling the screen head-on, like a ' +
      'chunky 3D model. Thick rounded beige bezel with dither-gradient shading for its curved plastic volume ' +
      '(lit upper-left), a dark inner screen with faint dither scanlines and a blinking cursor upper-left. ' +
      'Leave the inner screen rectangle (x40-360, y30-210) mostly EMPTY/dark for terminal text. ' + IMG('scene_bbs') },

  { out: IMAGES, spec: { name: 'title_card', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'MARIO-64 style title card 400x240: "HAKCD" in HUGE chunky ROUNDED 3D-looking block letters, each ' +
      'letter a beveled solid with dither-gradient shading so it looks extruded and dimensional (lit upper-left, ' +
      'soft drop shadow), white faces with 3px black outline, floating over a dithered night skyline. Subtitle ' +
      '"PHREAKER NOIR" in chunky rounded letters below. A rounded power-glove icon lower-right. Draw letters as ' +
      'rectangles/bevels. Leave y=196-216 quiet for a runtime PRESS A. ' + IMG('title_card') },

  { out: LAUNCHER, spec: { name: 'card', kind: 'image', frameW: 350, frameH: 155 },
    prompt: 'MARIO-64 style Playdate launcher card 350x155: "HAKCD" as huge chunky ROUNDED extruded 3D-look ' +
      'block letters filling the card (the art IS the label), dither-gradient beveled shading, white faces + ' +
      'black outline + soft drop shadow, dithered dark background, a rounded glove icon on the right. Draw ' +
      'letters as rectangles/bevels. ' + IMG('card', 350, 155) },

  { out: IMAGES, spec: { name: 'portrait_mentor', kind: 'image', frameW: 64, frameH: 64 },
    prompt: 'MARIO-64 style dialogue portrait 64x64, head-and-shoulders: THE MENTOR — weary bearded 40s hacker, ' +
      'big rounded head, tired kind eyes, knowing half-smile, glasses. Chunky volumetric 3D-cartoon head shaded ' +
      'with dither gradients (lit upper-left) so it looks round and solid, 3px outline, reads big at 64px. ' + IMG('portrait_mentor', 64, 64) },

  { out: IMAGES, spec: { name: 'portrait_konsole', kind: 'image', frameW: 64, frameH: 64 },
    prompt: 'MARIO-64 style dialogue portrait 64x64: k0nsole — gender-ambiguous operative, rounded hood up, half ' +
      'the round face in dither shadow, one sharp visible eye. Volumetric dither-gradient shading for the ' +
      'rounded hood + face, 3px outline, high contrast, mysterious. ' + IMG('portrait_konsole', 64, 64) },

  { out: IMAGES, spec: { name: 'portrait_newb', kind: 'image', frameW: 64, frameH: 64 },
    prompt: 'MARIO-64 style dialogue portrait 64x64: the player "newb" — scrawny 17yo, big round head, backwards ' +
      'cap, headphones round neck, cocky smirk, hoodie. Chunky volumetric 3D-cartoon head with dither-gradient ' +
      'shading (lit upper-left), 3px outline, expressive. ' + IMG('portrait_newb', 64, 64) },

  { out: IMAGES, spec: { name: 'portrait_mom', kind: 'image', frameW: 64, frameH: 64 },
    prompt: 'MARIO-64 style dialogue portrait 64x64: MOM — mid-40s warm-but-tired suburban mom, big rounded ' +
      'permed hair, cordless phone to her ear, exasperated mid-yell. Chunky volumetric 3D-cartoon head, ' +
      'dither-gradient shading, 3px outline. ' + IMG('portrait_mom', 64, 64) },

  { out: IMAGES, spec: { name: 'star', kind: 'imagetable', frameW: 24, frameH: 24, frames: 4 },
    prompt: 'MARIO-64 POWER STAR pickup, 24x24, 4-frame spin loop: a chunky rounded 5-point star with a happy ' +
      'simple face, dither-gradient shading giving it 3D volume and a sparkle. Frame to frame it rotates and a ' +
      'dither glint sweeps across it. 2px black outline, white body. Export exactly star-table-24-24.png.' },

  { out: IMAGES, spec: { name: 'coin', kind: 'imagetable', frameW: 16, frameH: 16, frames: 4 },
    prompt: 'MARIO-64 style COIN pickup, 16x16, 4-frame spin: a chunky rounded coin, dither-gradient shading ' +
      'for 3D roundness, spinning from full-face to edge-on and back, dither glint. 2px black outline. ' +
      'Export exactly coin-table-16-16.png.' },
];

async function main() {
  const only = process.argv[2] || null;
  const results = [];
  for (const asset of A) {
    if (only && asset.spec.name !== only) continue;
    const t0 = Date.now();
    console.log('[gen] ' + asset.spec.name + ' ...');
    try {
      const r = await gen.generateAsset({ prompt: asset.prompt, spec: asset.spec, styleGuide: STYLE,
        model: 'claude-code', projectId: null, maxAttempts: 4 });
      if (!r.ok) { console.log('[gen] ' + asset.spec.name + ' FAILED ' + r.attempts); results.push({ name: asset.spec.name, ok: false }); continue; }
      for (const a of r.artifacts) {
        if (a.name.endsWith('.png')) await fsp.copyFile(a.path, path.join(asset.out, a.name));
        else if (a.name.endsWith('.aseprite')) await fsp.copyFile(a.path, path.join(SRC, a.name));
      }
      await fsp.writeFile(path.join(SRC, asset.spec.name + '.lua'), r.script, 'utf8');
      console.log('[gen] ' + asset.spec.name + ' OK attempts=' + r.attempts + ' ' + ((Date.now()-t0)/1000) + 's');
      results.push({ name: asset.spec.name, ok: true, attempts: r.attempts });
    } catch (e) { console.log('[gen] ' + asset.spec.name + ' ERROR ' + (e.code||e.message)); results.push({ name: asset.spec.name, ok: false, error: e.code||e.message }); }
  }
  console.log('SUMMARY ' + JSON.stringify(results));
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}
main();
