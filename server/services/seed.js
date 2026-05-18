'use strict';

const fs = require('fs');
const projects = require('./projects');

const HAKCD = {
  id: 'hakcd',
  name: 'HAKCD: A PHREAK\'S TALE',
  description: 'Cyberpunk adventure game for Playdate',
  repo: 'https://github.com/haKC-ai/hakcd.git',
  local_path: '/home/hakcer/projects/personal/hakcd',
  platform: 'playdate',
  publisher: 'DarkCode LLC',
  developer: '23 Studios',
  build_command: './build.sh game',
  preflight_command: './tools/preflight.sh',
  captures_dir: 'build/recordings',
  created_at: '2026-05-17',
  status: 'active',
  game_type: 'sdk'
};

async function seedDefaults() {
  // Default-project auto-seed disabled. The studio used to inject the
  // HAKCD reference project on first boot of an empty registry, but
  // users have wiped + don't want it back automatically. Re-enable by
  // setting STUDIO_SEED_DEFAULTS=1 in the env if the original behavior
  // is wanted.
  if (process.env.STUDIO_SEED_DEFAULTS !== '1') return false;
  const seed = [];
  if (fs.existsSync(HAKCD.local_path)) {
    seed.push(HAKCD);
  } else {
    console.warn(`[seed] HAKCD local_path missing (${HAKCD.local_path}); skipping seed`);
  }
  if (seed.length === 0) return false;
  const seeded = await projects.seedIfEmpty(seed);
  if (seeded) console.log(`[seed] inserted ${seed.length} default project(s)`);
  return seeded;
}

module.exports = { seedDefaults };
