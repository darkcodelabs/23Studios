'use strict';

// v0.2.0 expansion assets — same pipeline, 4 new station sprites.
// Run from server/: node ../games/playdate/hakcd_asetest/gen_assets_v2.js [only-name]

const fsp = require('fs/promises');
const path = require('path');

const SERVER = path.resolve(__dirname, '..', '..', '..', 'server');
const gen = require(path.join(SERVER, 'services', 'aseprite_script_gen'));

const IMAGES = path.join(__dirname, 'source', 'images');
const SRC = path.join(__dirname, 'aseprite_src');

const STYLE = [
  'HAKCD phreaker-noir canon: 1998 hacker kid bedroom-to-street world. Chunky',
  'silhouettes, heavy black masses, 2px outlines, Bayer/checkerboard dither for',
  'shadow and CRT glow. Perspective: three-quarter side view. No modern UI',
  'chrome. Everything must read on a 400x240 reflective 1-bit screen.',
].join(' ');

const ASSETS = [
  {
    spec: { name: 'lockpick', kind: 'imagetable', frameW: 32, frameH: 32, frames: 4 },
    prompt:
      'Station sprite: workbench lockpick rig — big padlock in a bench vise, two pick tools ' +
      'crossed in the keyway. 4-frame animation: picks wiggle 1px alternately, one lock pin ' +
      'glints per frame. Export exactly lockpick-table-32-32.png.',
  },
  {
    spec: { name: 'rfid', kind: 'imagetable', frameW: 32, frameH: 32, frames: 4 },
    prompt:
      'Station sprite: RFID reader pedestal — short column with a card reader panel on top, ' +
      'an ID badge hovering above it. 4-frame animation: badge bobs 1px and three dither ' +
      'radio arcs pulse outward from the reader in sequence. Export exactly rfid-table-32-32.png.',
  },
  {
    spec: { name: 'subghz', kind: 'imagetable', frameW: 32, frameH: 32, frames: 4 },
    prompt:
      'Station sprite: SubGHz radio tuner — boxy bench radio with whip antenna, round dial, ' +
      'small speaker grille. 4-frame animation: dial needle sweeps positions, tiny signal ' +
      'dots ripple off the antenna tip. Export exactly subghz-table-32-32.png.',
  },
  {
    spec: { name: 'vault', kind: 'imagetable', frameW: 48, frameH: 48, frames: 4 },
    prompt:
      'Station sprite: coin vault — squat bank-vault door in a wall frame, big spoked wheel ' +
      'handle, rivets around the rim. 4-frame animation: wheel rotates 15 degrees per frame, ' +
      'coin glint sweeps across the seam. Export exactly vault-table-48-48.png.',
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
      for (const a of r.artifacts) {
        if (a.name.endsWith('.png')) await fsp.copyFile(a.path, path.join(IMAGES, a.name));
        else if (a.name.endsWith('.aseprite')) await fsp.copyFile(a.path, path.join(SRC, a.name));
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
