// Onboard HAKCD's existing state into the workflow surface so the studio
// breadcrumb starts populated instead of asking the user to re-pitch a game
// that already exists. Writes pulp_data/workflow.json with each canonical
// stage marked 'complete' and an `output` derived from project.json + known
// HAKCD lore. The studio's workflow service merges this with defaults on
// next GET so any future schema-added stages will appear as 'empty'.

const fs = require('fs/promises');
const path = require('path');

const HAKCD = '/home/hakcer/projects/personal/hakcd';
const PULP_DIR = path.join(HAKCD, 'pulp_data');
const PROJECT_JSON = path.join(PULP_DIR, 'project.json');
const WORKFLOW_JSON = path.join(PULP_DIR, 'workflow.json');

const STAGE_ORDER = [
  'brainstorm', 'story', 'characters', 'world',
  'mechanics', 'vibe', 'menus', 'assets', 'scripts', 'playtest'
];

const REQUIRES = {
  brainstorm: [],
  story:      ['brainstorm'],
  characters: ['story'],
  world:      ['story'],
  mechanics:  ['brainstorm'],
  vibe:       ['brainstorm'],
  menus:      ['vibe', 'mechanics'],
  assets:     ['characters', 'world', 'vibe'],
  scripts:    ['mechanics', 'world', 'characters'],
  playtest:   ['scripts', 'assets']
};

function stamp(role, content) {
  return { ts: Date.now(), role, content };
}

function aiLogSeed(stageId) {
  return [
    stamp('user', `onboarded from existing HAKCD state — ${stageId} stage seeded from project.json + design docs`)
  ];
}

async function main() {
  const project = JSON.parse(await fs.readFile(PROJECT_JSON, 'utf8'));

  const rooms = project.rooms || [];
  const tiles = project.tiles || [];
  const sounds = project.sounds || [];
  const songs = project.songs || [];

  // ---- brainstorm ------------------------------------------------------
  const brainstorm = {
    pitch: 'HAKCD: A PHREAK\'S TALE — a 1-bit hacker adventure on Playdate spanning a 1999 bedroom phreak\'s rise to a 2026 SecKC meetup. Crank-driven minigames, isometric scenes, PwnGlove payoff.',
    genre: 'cyberpunk adventure / minigame anthology',
    hooks: [
      'crank-as-dial for war-dialer + tuning minigames',
      'PwnGlove as in-game gadget mirroring real haKCers project',
      'community coda — present-day Kansas City hacker meetup as Act 3',
      '1-bit isometric scenes (Mars After Midnight aesthetic)',
      '24 collectible coins across the story (23 coins motif)'
    ],
    target_audience: 'Playdate owners who lurked phreak BBSes in the 90s, present-day infosec community, retro-pixel art fans'
  };

  // ---- story ----------------------------------------------------------
  const story = {
    premise: 'A teen phreaker (newb) explores BBSes, war-dials, and builds the haKCers PwnGlove. Decades later they time-jump to 2026 and find their tribe at the SecKC meetup at Knuckleheads Garage.',
    acts: [
      { name: 'Act 1 — Bedroom',
        beats: ['boot tutorial', 'first BBS dial', 'discover phreak culture', 'collect first coins'] },
      { name: 'Act 2 — Hax Headroom',
        beats: ['catch_the_wav minigame', 'lockpick minigame', 'pwn_hack minigame', 'PwnGlove built'] },
      { name: 'Act 3 — Present-day coda',
        beats: ['time-jump to 2026', 'SecKC meetup at Knuckleheads', 'Cory K cameo + sticker handoff', 'PwnGlove payoff shot', 'the work continues'] }
    ],
    themes: ['community over isolation', 'gear nostalgia', 'the work continues', 'phreak culture preservation']
  };

  // ---- characters -----------------------------------------------------
  const characters = {
    cast: [
      { id: 'newb', name: 'newb (protagonist)', role: 'player', bio: 'Teen phreaker in 1999; older version in 2026 coda. Glasses, hoodie, laptop bag, beer.',
        portrait_prompt: 'pixel portrait, 16x16, 1-bit, phreaker teen with hoodie, intense focused eyes' },
      { id: 'cory_k', name: 'Cory K.', role: 'mentor/cameo', bio: 'SecKC organizer, goatee, baseball cap, plaid over a t-shirt. Hands out a skull-and-crossbones SECKC sticker.',
        portrait_prompt: 'pixel portrait, 16x16, 1-bit, bearded hacker with baseball cap, slight smile' },
      { id: 'knuckleheads', name: 'Knuckleheads (composite)', role: 'community NPCs', bio: 'Multi-colored-hair BSidesKC hoodie, leather-vest patches elder, sleeve-tattoo woman, fedora "not a fed", soldering trio, PwnGlove demo trio.',
        portrait_prompt: 'pixel ensemble, 16x16 per character, 1-bit, varied hacker community archetypes' },
      { id: 'security_guard', name: 'Oblivious Guard', role: 'antagonist (passive)', bio: 'Walks past in the PwnGlove badge-clone scene, never notices.',
        portrait_prompt: 'pixel portrait, 16x16, 1-bit, generic security guard in profile' }
    ]
  };

  // ---- world (from existing rooms) ------------------------------------
  const world = {
    locations: rooms.map(r => ({
      id: r.id,
      name: r.name || r.id.replace(/_/g, ' '),
      description: r.script ? r.script.split('\n').slice(0, 3).join(' ').replace(/\/\/\s*/g, '').trim().slice(0, 220) : '',
      room_id: r.id
    }))
  };

  // ---- mechanics ------------------------------------------------------
  const mechanics = {
    game_type: 'adventure with crank-driven minigames',
    verbs: ['walk', 'confirm (A)', 'cancel (B)', 'crank (dial/tune)', 'select menu item'],
    primary_loop: 'enter scene → read situation → activate device or NPC → solve mini-puzzle → collect coin / progress story → return to main menu',
    win_condition: 'collect all 24 coins + complete Act 3 SecKC meetup scene + earn the PwnGlove payoff'
  };

  // ---- vibe -----------------------------------------------------------
  const vibe = {
    aesthetic_lock: '1-bit black-and-white isometric pixel art, Atkinson or Bayer dithering for shading, NO grayscale gradients, NO color, classic dimetric projection at 30 degrees, thick 2-px black outlines, 5:3 horizontal (Playdate 400x240 native).',
    palette_notes: 'pure black + pure white only. Dither density implies surface and lighting.',
    soundscape_notes: 'tracker-music background (keygenmusic-style .xm/.mod), terse Playdate-synth SFX for clicks/picks/coin mints. Music fades on cancel transitions.',
    style_refs: ['Mars After Midnight (Playdate)', 'International Synapse', 'Whitewater Wipeout', 'classic Game Boy isometric titles']
  };

  // ---- menus ----------------------------------------------------------
  const menus = {
    title: {
      layout: 'centered HAKCD logo + "PRESS A" blink + faint version label; auto-advances after 4s or on A.',
      prompt: 'a 1-bit title splash for a 1999 hacker adventure, isometric desk with CRT + modem + can of soda, dithered glow, Playdate aspect 400x240'
    },
    main_menu: {
      items: [
        { id: 'coins',    label: '1 COINS',    goto_room: 'coins_menu' },
        { id: 'skillz',   label: '2 SKILLZ',   goto_room: 'skillz_menu' },
        { id: 'pwnglove', label: '3 PWNGLOVE', goto_room: 'pwnglove_mode' },
        { id: 'nfo',      label: '4 NFO STASH',goto_room: 'nfo_stash' },
        { id: 'greetz',   label: '5 GREETZ',   goto_room: 'greetz' },
        { id: 'options',  label: '6 OPTIONS',  goto_room: 'options' }
      ]
    }
  };

  // ---- assets ---------------------------------------------------------
  const assets = {
    tile_ids_planned: tiles.map(t => t.id),
    scene_room_ids: rooms.filter(r => r.background_image).map(r => r.id),
    sound_ids: sounds.map(s => s.id).concat(songs.map(s => s.id)),
    generation_log: [
      { ts: Date.now(), kind: 'tile_import_from_hakcd_repo', count: 11, source: 'tools/AGENT-IMG sprite scan' },
      { ts: Date.now(), kind: 'tile_synthesis_from_scripts', count: 8,  source: 'studio synth defs' },
      { ts: Date.now(), kind: 'scene_import_from_concept_dir', count: 18 + 6 - 12, source: 'hakcd_pixel_collection auto-match + round-robin' }
    ]
  };

  // ---- scripts (mirror what's already in project) ---------------------
  const scripts = {
    game_script: (project.game_script || '').slice(0, 4000),
    per_tile: tiles.filter(t => t.script).map(t => ({ tile_id: t.id, script: t.script.slice(0, 4000) })),
    per_room: rooms.filter(r => r.script).map(r => ({ room_id: r.id, script: r.script.slice(0, 4000) }))
  };

  // ---- playtest (open issues) -----------------------------------------
  const playtest = {
    issues: [
      'menus.main_menu cursor wraps but no visible cursor indicator yet — add a left-margin arrow tile or invert the selected label.',
      'wardialer_detail, pwnglove_mode, catch_the_wav had `if x=1` parse errors before lead patched to `if x==1` — verify all scripts re-parse clean.',
      'player.start_tile=hakcd_player synthesized as a placeholder cross — replace with a 16x16 portrait sprite when art lands.',
      'scenes/ backgrounds are round-robined across rooms; some matches are arbitrary — assign deliberately when the user picks per-room.',
      'no font defined yet — Font tab is a placeholder. Pulp falls back to playdate system font.',
      'no song actually plays in PulpPlay yet — Web Audio synth stub only.'
    ],
    notes: 'Onboarded from existing HAKCD state on 2026-05-17. Workflow stages are pre-filled; the user can edit any of them and re-run AI to expand.'
  };

  const STAGE_DATA = {
    brainstorm, story, characters, world, mechanics, vibe, menus, assets, scripts, playtest
  };

  const stages = {};
  for (const id of STAGE_ORDER) {
    stages[id] = {
      id,
      status: 'complete',
      input: `Onboarded from HAKCD state on first studio open. Edit + regenerate to expand the ${id} stage with AI.`,
      output: STAGE_DATA[id],
      requires: REQUIRES[id] || [],
      last_updated_ts: Date.now(),
      ai_log: aiLogSeed(id)
    };
  }

  const workflow = {
    stage_order: STAGE_ORDER,
    stages,
    onboarded_at: new Date().toISOString().slice(0, 10),
    onboarded_from: 'HAKCD pulp_data + repo introspection (studio onboarding script)'
  };

  await fs.mkdir(PULP_DIR, { recursive: true });
  const tmp = WORKFLOW_JSON + '.' + process.pid + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(workflow, null, 2), { mode: 0o600 });
  await fs.rename(tmp, WORKFLOW_JSON);

  console.log('wrote', WORKFLOW_JSON);
  for (const id of STAGE_ORDER) {
    const s = stages[id];
    const bytes = JSON.stringify(s.output).length;
    console.log(`  ${id.padEnd(12)} status=${s.status}  output=${bytes}B`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
