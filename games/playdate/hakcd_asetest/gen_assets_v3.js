'use strict';
// v0.3.0 Act-1 slice assets — all authored by the prompt→Aseprite pipeline.
// Run from server/: node ../games/playdate/hakcd_asetest/gen_assets_v3.js [only]

const fsp = require('fs/promises');
const path = require('path');
const SERVER = path.resolve(__dirname, '..', '..', '..', 'server');
const gen = require(path.join(SERVER, 'services', 'aseprite_script_gen'));
const IMAGES = path.join(__dirname, 'source', 'images');
const SRC = path.join(__dirname, 'aseprite_src');

const STYLE = [
  'HAKCD phreaker-noir canon, 1998 suburban Midwest hacker kid. Reference look:',
  'ISOMETRIC rooms with a dithered dot-grid floor (checkerboard/Bayer), 3/4 view,',
  'chunky furniture with 2px black outlines, heavy black masses, CRT glow via dither.',
  'Top-down exteriors like a Game Boy overworld: houses, dashed roads, round trees.',
  'Strictly 1-bit, no gray. Must read on a 400x240 reflective LCD.',
].join(' ');

const IMG = (name) =>
  'kind="image": do NOT use ExportSpriteSheet. After drawing, flatten and save with ' +
  'sprite:saveAs(app.fs.joinPath(os.getenv("ASE_OUT_DIR"), "' + name + '.png")). ' +
  'Also save the .aseprite source. Fill the FULL canvas edge to edge.';

const ASSETS = [
  { spec: { name: 'room_bedroom', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'ISOMETRIC bedroom, 1998 teenage hacker den, viewed 3/4 top-down. Dithered dot-grid ' +
      'floor across the whole room with two back walls meeting at a corner. Against the left wall: a ' +
      'desk with a chunky CRT computer monitor (glowing dithered screen), keyboard, and an external ' +
      'modem with tiny LED. Against the right wall: an unmade bed. A window upper-right with dithered ' +
      'night sky + moon. A door lower-right. Poster on the wall. Corded phone on the desk. Keep the ' +
      'floor center (around x160-260, y150-210) visually calm so a player sprite reads there. ' + IMG('room_bedroom') },
  { spec: { name: 'map_suburbia', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'TOP-DOWN suburban map like a Game Boy overworld. Light dithered grass. Dark asphalt roads ' +
      'with dashed white center lines winding through. Buildings seen from top-3/4: the player house ' +
      '(two-story, upper-left), a Greyhound bus depot with a small payphone sign (right side), scattered ' +
      'round bushy trees, a couple parked cars. Two walkable node clearings on the roads. ' + IMG('map_suburbia') },
  { spec: { name: 'scene_payphone', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'Night exterior: a bank of THREE 1990s payphones mounted on a brick station wall under a ' +
      'buzzing dithered light. Concrete ground with dither shadows. One phone handset off the hook. ' +
      'Graffiti tag on the wall. Star-dithered night sky sliver at top. Cinematic, lonely, high contrast. ' + IMG('scene_payphone') },
  { spec: { name: 'scene_pedestal', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'Suburban backyard at 2am. A green Bell telco utility PEDESTAL (rounded metal box on a ' +
      'concrete pad, small hinged door with a hex lock) sits center-foreground in dithered moonlit grass. ' +
      'A dark house silhouette with one lit window behind. A big dithered moon upper-left. Bushes. ' +
      'Ominous, quiet. Keep the pedestal door area readable for a lock overlay. ' + IMG('scene_pedestal') },
  { spec: { name: 'scene_bbs', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'A CRT computer monitor filling the screen, seen head-on. Thick beige-bezel monitor frame ' +
      '(drawn as heavy black outline + dither) with a dark inner screen. Faint horizontal scanlines as ' +
      'dither across the screen area. A blinking-cursor prompt hint upper-left inside the screen. Leave the ' +
      'large inner screen rectangle (roughly x40-360, y30-210) mostly EMPTY/dark so terminal text draws over it. ' + IMG('scene_bbs') },
  { spec: { name: 'newb_iso', kind: 'imagetable', frameW: 24, frameH: 32, frames: 16 },
    prompt: 'ISOMETRIC player character sprite sheet, "newb": scrawny 90s hacker teen, backwards cap, ' +
      'baggy hoodie, high-tops. FOUR ROWS of 4 frames each (SpriteSheetType.ROWS): row1 facing down/front, ' +
      'row2 facing up/back, row3 facing left, row4 facing right. Each row a 4-frame walk cycle with clear ' +
      'leg/arm swing and 1px head bob. Strong black silhouette, white face patch, dither on hoodie. ' +
      'Export exactly newb_iso-table-24-32.png with ROWS layout.' },
  { spec: { name: 'portrait_mentor', kind: 'image', frameW: 64, frameH: 64 },
    prompt: 'Dialogue portrait 64x64, head-and-shoulders: THE MENTOR — weary bearded hacker in his 40s, ' +
      'tired kind eyes, slight knowing half-smile, headset or glasses. Heavy black rim, dither shading, ' +
      'reads at 64px. High contrast face on plain dither backdrop. ' + IMG('portrait_mentor') },
  { spec: { name: 'portrait_konsole', kind: 'image', frameW: 64, frameH: 64 },
    prompt: 'Dialogue portrait 64x64, head-and-shoulders: k0nsole — gender-ambiguous operative, hood up, ' +
      'half the face in dither shadow, one sharp visible eye, mysterious. Heavy black rim, high contrast. ' + IMG('portrait_konsole') },
  { spec: { name: 'portrait_newb', kind: 'image', frameW: 64, frameH: 64 },
    prompt: 'Dialogue portrait 64x64, head-and-shoulders: the player "newb" — scrawny 17yo, backwards cap, ' +
      'headphones round neck, faint smirk, hoodie. Heavy black rim, dither shading, reads at 64px. ' + IMG('portrait_newb') },
  { spec: { name: 'portrait_mom', kind: 'image', frameW: 64, frameH: 64 },
    prompt: 'Dialogue portrait 64x64, head-and-shoulders: MOM — mid-40s tired-but-warm suburban mom, ' +
      'permed 90s hair, holding a cordless phone to her ear, mid-yell expression. Heavy black rim, dither. ' + IMG('portrait_mom') },
  { spec: { name: 'floppy', kind: 'imagetable', frameW: 16, frameH: 16, frames: 4 },
    prompt: '3.5" floppy disk pickup, 4-frame gleam loop: a dither shine sweeps across the label per frame. ' +
      'Black outline, white body, metal shutter. Export exactly floppy-table-16-16.png.' },
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
        prompt: asset.prompt, spec: asset.spec, styleGuide: STYLE,
        model: 'claude-code', projectId: null, maxAttempts: 4,
      });
      if (!r.ok) { console.log('[gen] ' + asset.spec.name + ' FAILED ' + r.attempts); results.push({ name: asset.spec.name, ok: false }); continue; }
      for (const a of r.artifacts) {
        if (a.name.endsWith('.png')) await fsp.copyFile(a.path, path.join(IMAGES, a.name));
        else if (a.name.endsWith('.aseprite')) await fsp.copyFile(a.path, path.join(SRC, a.name));
      }
      await fsp.writeFile(path.join(SRC, asset.spec.name + '.lua'), r.script, 'utf8');
      console.log('[gen] ' + asset.spec.name + ' OK attempts=' + r.attempts + ' ' + ((Date.now() - t0) / 1000) + 's');
      results.push({ name: asset.spec.name, ok: true, attempts: r.attempts });
    } catch (e) { console.log('[gen] ' + asset.spec.name + ' ERROR ' + (e.code || e.message)); results.push({ name: asset.spec.name, ok: false, error: e.code || e.message }); }
  }
  console.log('SUMMARY ' + JSON.stringify(results));
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}
main();
