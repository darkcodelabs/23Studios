'use strict';
// v0.4.0 CARTOON pass — bigger Mario-64-scale hero + bolder cartoon fidelity
// across every scene/portrait. All via the prompt→Aseprite pipeline.
// Run from server/: node ../games/playdate/hakcd_asetest/gen_assets_v4.js [only]
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
  'HAKCD visual bar: BOLD SATURDAY-MORNING CARTOON rendered in strict 1-bit black & white.',
  'Thick confident 3-4px black outlines. Exaggerated, chunky, characterful shapes with big',
  'personality and generous clean white interiors. Playful and expressive, LucasArts SCUMM',
  'cartoon-adventure energy with Cuphead boldness reduced to pure B/W. Dithering (checkerboard',
  '/ Bayer) is ONLY for shading, depth and CRT/night glow — never flat gray fills. Isometric',
  'rooms keep a dithered dot-grid floor in 3/4 view, furniture scaled so a BIG ~64px-tall hero',
  'fits naturally (Mario-64 contextual size). No anti-aliasing, no gray midtones. Must read at',
  "arm's length on a 400x240 reflective LCD.",
].join(' ');

const IMG = (name, w, h) =>
  'kind="image" ' + (w||400) + 'x' + (h||240) + ': do NOT use ExportSpriteSheet, this is a single ' +
  'flat image not a sprite sheet. After drawing, flatten and save with ' +
  'sprite:saveAs(app.fs.joinPath(os.getenv("ASE_OUT_DIR"), "' + name + '.png")). The output ' +
  'filename must be EXACTLY ' + name + '.png (no -table- suffix). Also save the .aseprite source. ' +
  'Fill the FULL canvas edge to edge. Favor rect fills + loops so the script runs fast.';

const A = [
  { out: IMAGES, spec: { name: 'newb_hero', kind: 'imagetable', frameW: 48, frameH: 64, frames: 16 },
    prompt: 'BIG CARTOON HERO sprite sheet "newb", Mario-64 contextual size (~60px of the 64px frame tall, ' +
      'the sprite should fill about a quarter of a 240px screen). Exaggerated cartoon proportions: oversized ' +
      'expressive head, backwards cap, baggy hoodie with big pocket, chunky high-top sneakers. FOUR ROWS of 4 ' +
      'frames (SpriteSheetType.ROWS): row1 facing front/down, row2 facing back/up, row3 facing left, row4 ' +
      'facing right. Each row a BOUNCY 4-frame walk cycle: big alternating leg strides, arm swing, 2px head ' +
      'bob, squash-and-stretch feel. Thick 3px black outline, bold clean white face with simple dot eyes, ' +
      'dither only on hoodie folds and cap. Unmistakable silhouette in every direction. ' +
      'Export exactly newb_hero-table-48-64.png with ROWS layout.' },

  { out: IMAGES, spec: { name: 'room_bedroom', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'ISOMETRIC cartoon bedroom, 1998 teenage hacker den, 3/4 top-down, BOLD cartoon style. Dithered ' +
      'dot-grid floor across the room, two back walls meeting at a corner with fat 3px outlines. Left wall: ' +
      'a chunky cartoon desk with an exaggerated fat CRT monitor (glowing dithered screen), keyboard, and a ' +
      'big external modem with a blinking LED. Right wall: a rumpled cartoon bed with a lumpy blanket. Big ' +
      'window upper-right with a dithered night sky + fat crescent moon. Cartoon door lower-right. A band ' +
      'poster with bold shapes on the wall. Corded phone on the desk. Keep the floor CENTER (x150-270, ' +
      'y140-215) open and calm so a big 64px hero reads clearly there. ' + IMG('room_bedroom') },

  { out: IMAGES, spec: { name: 'map_suburbia', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'TOP-DOWN cartoon suburb map, bold Game-Boy-Zelda overworld energy. Light dithered grass, fat ' +
      'dark asphalt roads with chunky dashed center lines winding through. Cartoon buildings from top-3/4 with ' +
      'thick outlines: a two-story player house (upper-left), a Greyhound bus depot with a payphone sign ' +
      '(right), fat round bushy trees, a couple stubby parked cars. Three clear road-side clearings as travel ' +
      'nodes. Playful and readable. ' + IMG('map_suburbia') },

  { out: IMAGES, spec: { name: 'scene_payphone', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'Cartoon night exterior: a bank of THREE chunky 1990s payphones on a brick station wall under a ' +
      'buzzing dithered lamp, bold outlines. Concrete ground with dither shadows. One handset dangling off the ' +
      'hook. A goofy graffiti tag on the wall. Star-dithered night sky sliver up top. Lonely but cartoony, high ' +
      'contrast. Keep the lower-center ground open for the hero. ' + IMG('scene_payphone') },

  { out: IMAGES, spec: { name: 'scene_pedestal', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'Cartoon suburban backyard at 2am. A fat green Bell telco PEDESTAL (rounded metal box on a concrete ' +
      'pad, little hinged door with a hex lock) sits center-foreground in dithered moonlit grass, bold 3px ' +
      'outline. A dark cartoon house silhouette with one lit window behind. A big dithered moon upper-left. ' +
      'Chunky bushes. Spooky-but-playful. Keep the pedestal door + lower-center ground readable. ' + IMG('scene_pedestal') },

  { out: IMAGES, spec: { name: 'scene_bbs', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'A fat cartoon CRT computer monitor filling the screen head-on. Chunky beige-bezel frame drawn as ' +
      'heavy 4px black outline + dither, with a dark inner screen. Faint dither scanlines across the screen. A ' +
      'blinking cursor hint upper-left inside. Leave the large inner screen rectangle (x40-360, y30-210) mostly ' +
      'EMPTY/dark so terminal text draws over it. Bold, iconic. ' + IMG('scene_bbs') },

  { out: IMAGES, spec: { name: 'title_card', kind: 'image', frameW: 400, frameH: 240 },
    prompt: 'Cartoon title card 400x240: "HAKCD" in HUGE bold blocky pixel letters (each stroke 10px+ thick, ' +
      'white letters with fat 3px black outline) over a dithered dark city skyline. Subtitle "PHREAKER NOIR" in ' +
      'chunky 12px letters below. A bold cartoon power-glove icon in the lower-right corner. Draw every letter ' +
      'as rectangles (no font rendering). Leave a quiet strip at y=196-216 for a runtime PRESS A prompt. ' + IMG('title_card') },

  { out: LAUNCHER, spec: { name: 'card', kind: 'image', frameW: 350, frameH: 155 },
    prompt: 'Playdate launcher card 350x155, bold cartoon. MUST show "HAKCD" as huge blocky pixel letters ' +
      'filling most of the card (the launcher shows no text label, so the art IS the label). White letters, ' +
      'fat black outline, dithered dark background, a cartoon glove icon on the right. Draw letters as ' +
      'rectangles. ' + IMG('card', 350, 155) },

  { out: IMAGES, spec: { name: 'portrait_mentor', kind: 'image', frameW: 64, frameH: 64 },
    prompt: 'Bold CARTOON dialogue portrait 64x64, head-and-shoulders: THE MENTOR — weary bearded hacker in his ' +
      '40s, tired kind eyes, knowing half-smile, glasses. Exaggerated cartoon features, thick 3px outline, ' +
      'expressive, dither shading, reads big at 64px. High contrast face on a simple dither backdrop. ' + IMG('portrait_mentor', 64, 64) },

  { out: IMAGES, spec: { name: 'portrait_konsole', kind: 'image', frameW: 64, frameH: 64 },
    prompt: 'Bold CARTOON dialogue portrait 64x64: k0nsole — gender-ambiguous operative, hood up, half the face ' +
      'in dither shadow, one sharp expressive visible eye, mysterious. Thick 3px outline, high contrast, cartoon. ' + IMG('portrait_konsole', 64, 64) },

  { out: IMAGES, spec: { name: 'portrait_newb', kind: 'image', frameW: 64, frameH: 64 },
    prompt: 'Bold CARTOON dialogue portrait 64x64: the player "newb" — scrawny 17yo, backwards cap, headphones ' +
      'round neck, cocky smirk, hoodie. Oversized cartoon head, thick 3px outline, expressive, dither shading. ' + IMG('portrait_newb', 64, 64) },

  { out: IMAGES, spec: { name: 'portrait_mom', kind: 'image', frameW: 64, frameH: 64 },
    prompt: 'Bold CARTOON dialogue portrait 64x64: MOM — mid-40s tired-but-warm suburban mom, big permed 90s ' +
      'hair, cordless phone to her ear, exasperated mid-yell face. Exaggerated cartoon features, thick 3px ' +
      'outline, dither. ' + IMG('portrait_mom', 64, 64) },
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
