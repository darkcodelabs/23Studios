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
  status: 'active'
};

async function seedDefaults() {
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
