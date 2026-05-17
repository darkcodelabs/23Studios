#!/usr/bin/env node
'use strict';

/**
 * import_hakcd_concepts.js — one-off CLI for the lead.
 *
 * Reads /home/hakcer/projects/personal/hakcd/hakcd_pixel_collection/*.png and
 * assigns each PNG to a HAKCD room. Uses a hand-tuned mapping table over the
 * filename + the room IDs actually present in HAKCD's pulp_data/project.json.
 *
 * Conversion: cover-fit 400x240 -> greyscale -> threshold(128) -> 1-bit PNG.
 * Writes into <hakcd>/pulp_data/scenes/<room_id>.png and patches each matched
 * room's `background_image` to `scenes/<room_id>.png`. Idempotent (overwrite).
 *
 * Usage:
 *   node server/scripts/import_hakcd_concepts.js           # apply
 *   node server/scripts/import_hakcd_concepts.js --dry-run # preview only
 *
 * NOTE: This script edits HAKCD's pulp_data/project.json directly via the same
 * patchRoom path used by the server. It does NOT go through HTTP.
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const sharp = require('sharp');

const HAKCD_PIXEL_DIR = '/home/hakcer/projects/personal/hakcd/hakcd_pixel_collection';
const HAKCD_ROOT = '/home/hakcer/projects/personal/hakcd';
const HAKCD_PULP_DIR = path.join(HAKCD_ROOT, 'pulp_data');
const HAKCD_PROJECT_JSON = path.join(HAKCD_PULP_DIR, 'project.json');
const HAKCD_SCENES_DIR = path.join(HAKCD_PULP_DIR, 'scenes');

const SCENE_DIM = [400, 240];

const DRY_RUN = process.argv.includes('--dry-run');

// ---- Mapping rules (in priority order). First rule whose regex matches the
// normalized filename slug wins. The slug lowercases and turns runs of
// non-alnum into single underscores; use (?:^|_) / (?:_|$) as word
// boundaries since '_' is a word char in regex \b.
// Edit as new concept art lands.
const B = '(?:^|_)';
const E = '(?:_|$)';
function r(body) { return new RegExp(B + '(?:' + body + ')' + E); }

const RULES = [
  // Title / menus
  { re: r('seckc|meetup'), room: 'title' },
  { re: /chatgpt_image_may_17_2026_06_19/, room: 'title' },
  { re: r('main_menu|menu'), room: 'main_menu' },

  // PwnGlove
  { re: r('pwnglove|pwn_glove|power_glove'), room: 'pwnglove_mode' },

  // Wardialer / phreaking
  { re: r('dialer|phreak|wardialer|war_dialer|modem'), room: 'wardialer_detail' },

  // Catch-the-wav / signals  (check BEFORE world rules so "radio" wins)
  { re: r('catch_the_wav|catch_wav|signal_catch|radio_wav'), room: 'catch_the_wav' },

  // World explorer (isometric establishing shots).
  { re: r('isometric|isome|overworld|world_explorer'), room: 'world_explorer' },

  // NFO stash / greetz / options
  { re: r('nfo|stash|warez'), room: 'nfo_stash' },
  { re: r('greetz|shout'), room: 'greetz' },
  { re: r('options|settings|config'), room: 'options' },

  // Minigames
  { re: r('lockpick|lock_pick'), room: 'minigame_lockpick' },
  { re: r('pwn_hack|pwnhack|hack_minigame'), room: 'minigame_pwn_hack' },

  // Panels (HAKCD hardware reveal screens)
  { re: r('wrist'), room: 'panel_wrist' },
  { re: r('neopixels?|neo_pixel'), room: 'panel_neopixels' },
  { re: r('buttons?'), room: 'panel_buttons' },
  { re: r('raspi|raspberry|pi_zero|rpi'), room: 'panel_raspi' },
  { re: r('wires?|wiring'), room: 'panel_wires' },
  { re: r('history|origin|backstory'), room: 'panel_history' },
  { re: r('fingers?|skin_pad|touch'), room: 'panel_fingers' },

  // Skillz / coins menus
  { re: r('skillz?'), room: 'skillz_menu' },
  { re: r('coins_menu|coins|coin'), room: 'coins_menu' },
];

function slugifyName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function pickRoom(filename, validRoomIds) {
  const slug = slugifyName(filename);
  for (const rule of RULES) {
    if (rule.re.test(slug) && validRoomIds.has(rule.room)) {
      return rule.room;
    }
  }
  return null;
}

async function convertScene(buffer) {
  const [w, h] = SCENE_DIM;
  return await sharp(buffer)
    .resize(w, h, { fit: 'cover', position: 'centre' })
    .greyscale()
    .threshold(128)
    .toColourspace('b-w')
    .png()
    .toBuffer();
}

async function atomicWriteFile(file, buf) {
  const tmp = file + '.' + process.pid + '.' + Date.now() + '.tmp';
  await fsp.writeFile(tmp, buf, { mode: 0o600 });
  await fsp.rename(tmp, file);
}

async function patchProjectRooms(updates) {
  // updates: Map<room_id, rel_path>
  const raw = await fsp.readFile(HAKCD_PROJECT_JSON, 'utf8');
  const proj = JSON.parse(raw);
  if (!Array.isArray(proj.rooms)) {
    throw new Error('project.json has no rooms array');
  }
  let touched = 0;
  for (const room of proj.rooms) {
    if (updates.has(room.id)) {
      room.background_image = updates.get(room.id);
      touched++;
    }
  }
  await atomicWriteFile(HAKCD_PROJECT_JSON, JSON.stringify(proj, null, 2));
  return touched;
}

async function main() {
  // Load project + room ids first so we know what's valid.
  if (!fs.existsSync(HAKCD_PROJECT_JSON)) {
    console.error('Missing HAKCD project.json at:', HAKCD_PROJECT_JSON);
    process.exit(2);
  }
  const proj = JSON.parse(fs.readFileSync(HAKCD_PROJECT_JSON, 'utf8'));
  const validRoomIds = new Set(
    (proj.rooms || []).map((r) => r && r.id).filter(Boolean)
  );

  if (!fs.existsSync(HAKCD_PIXEL_DIR)) {
    console.error('Missing HAKCD pixel dir:', HAKCD_PIXEL_DIR);
    process.exit(2);
  }
  const entries = (await fsp.readdir(HAKCD_PIXEL_DIR))
    .filter((n) => /\.png$/i.test(n))
    .sort();

  const planned = []; // { file, room_id, rel }
  const skipped = []; // { file, reason }

  for (const name of entries) {
    const roomId = pickRoom(name, validRoomIds);
    if (!roomId) {
      skipped.push({ file: name, reason: 'no_rule_match' });
      continue;
    }
    planned.push({ file: name, room_id: roomId, rel: `scenes/${roomId}.png` });
  }

  // Print plan
  console.log('HAKCD concept-art import plan' + (DRY_RUN ? ' (dry-run)' : ''));
  console.log('  pixel dir:   ' + HAKCD_PIXEL_DIR);
  console.log('  project:     ' + HAKCD_PROJECT_JSON);
  console.log('  scenes dir:  ' + HAKCD_SCENES_DIR);
  console.log('  files seen:  ' + entries.length);
  console.log('  planned:     ' + planned.length);
  console.log('  skipped:     ' + skipped.length);
  console.log('');
  for (const p of planned) {
    console.log('  MAP   ' + p.file + '  ->  ' + p.room_id);
  }
  for (const s of skipped) {
    console.log('  SKIP  ' + s.file + '  (' + s.reason + ')');
  }

  if (DRY_RUN) {
    console.log('\nDry run: no files written, no project.json modified.');
    return;
  }

  if (planned.length === 0) {
    console.log('\nNothing to import.');
    return;
  }

  // Create scenes dir
  await fsp.mkdir(HAKCD_SCENES_DIR, { recursive: true, mode: 0o700 });

  // Convert + write each PNG
  const updates = new Map(); // room_id -> rel
  for (const p of planned) {
    const src = path.join(HAKCD_PIXEL_DIR, p.file);
    const dst = path.join(HAKCD_SCENES_DIR, `${p.room_id}.png`);
    try {
      const buf = await fsp.readFile(src);
      const out = await convertScene(buf);
      await atomicWriteFile(dst, out);
      updates.set(p.room_id, p.rel);
      console.log('WROTE ' + dst + ' (' + out.length + ' B)');
    } catch (e) {
      console.error('FAIL  ' + p.file + ': ' + (e && e.message));
    }
  }

  const touched = await patchProjectRooms(updates);
  console.log(`\nPatched ${touched} room(s) in project.json.`);
}

main().catch((e) => {
  console.error('fatal:', e && e.stack || e);
  process.exit(1);
});
