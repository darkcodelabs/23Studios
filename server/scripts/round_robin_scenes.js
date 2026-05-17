// Spread HAKCD's unmatched concept PNGs round-robin across rooms that don't
// yet have a background scene. Reads project.json + scenes/ on disk, converts
// each PNG to 400x240 1-bit via sharp, writes scenes/<room_id>.png, patches
// room.background_image. Idempotent.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const sharp = require('/home/hakcer/projects/23studios/server/node_modules/sharp');

const HAKCD = '/home/hakcer/projects/personal/hakcd';
const PULP_DIR = path.join(HAKCD, 'pulp_data');
const SCENES_DIR = path.join(PULP_DIR, 'scenes');
const PROJECT_JSON = path.join(PULP_DIR, 'project.json');
const SRC_DIR = path.join(HAKCD, 'hakcd_pixel_collection');

// Per importer report, these filenames already matched and are claimed.
const ALREADY_MAPPED_BY_NAME = new Set([
  'ChatGPT Image May 17, 2026, 06_19_23 PM.png',
  'ChatGPT Image May 17, 2026, 06_19_48 PM.png',
  'ChatGPT Image May 17, 2026, 06_19_54 PM.png',
  'ChatGPT Image May 17, 2026, 06_19_58 PM.png',
  'a_black_and_white_1_bit_dithering_isometric_pi.png',
  'a_monochrome_pixel_art_retro_game_boy_style_isome.png',
]);

async function main() {
  const project = JSON.parse(await fsp.readFile(PROJECT_JSON, 'utf8'));
  await fsp.mkdir(SCENES_DIR, { recursive: true, mode: 0o700 });

  // Rooms ordered as in project; round-robin into the ones without a scene.
  const empty = (project.rooms || []).filter(r => !r.background_image);
  if (empty.length === 0) {
    console.log('all rooms already have a background_image — nothing to do');
    return;
  }

  // Source PNGs not yet mapped.
  const allPngs = (await fsp.readdir(SRC_DIR)).filter(f => f.toLowerCase().endsWith('.png'));
  const queue = allPngs.filter(f => !ALREADY_MAPPED_BY_NAME.has(f));
  if (queue.length === 0) {
    console.log('no unmatched concept art remaining');
    return;
  }

  console.log(`distributing ${queue.length} png(s) across ${empty.length} room(s)`);
  let cursor = 0;
  const assigned = [];
  for (const room of empty) {
    const fname = queue[cursor % queue.length];
    cursor++;
    const src = path.join(SRC_DIR, fname);
    const dstName = `${room.id}.png`;
    const dst = path.join(SCENES_DIR, dstName);
    const tmp = dst + '.' + process.pid + '.tmp';

    try {
      const buf = await sharp(src)
        .resize(400, 240, { fit: 'cover', kernel: 'nearest' })
        .greyscale()
        .threshold(128)
        .toColourspace('b-w')
        .png()
        .toBuffer();
      await fsp.writeFile(tmp, buf, { mode: 0o600 });
      await fsp.rename(tmp, dst);
      room.background_image = `scenes/${dstName}`;
      assigned.push({ room: room.id, src: fname, bytes: buf.length });
      console.log(`  ${room.id.padEnd(22)} <- ${fname}  (${buf.length}B)`);
    } catch (e) {
      console.error(`  FAIL ${room.id}: ${e.message}`);
    }
  }

  // Atomic write of patched project.json.
  const tmp = PROJECT_JSON + '.' + process.pid + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(project, null, 2), { mode: 0o600 });
  await fsp.rename(tmp, PROJECT_JSON);

  console.log(`\nassigned ${assigned.length} scene(s); patched project.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
