'use strict';

// story_bible_template.js — modular bible sections, one file per category.
// Sections live at <local_path>/sdk_data/bible/<NN>_<slug>.md and are
// concatenated by sdk_bible.compile() into the legacy story_bible.md that
// the autopilot reads. Add a new section any time — drop a new file with
// the right NN prefix, recompile.

const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

// Canonical section seeds. NN prefix controls concat order. Append-only
// list — never renumber existing entries, just add new ones at the end.
const SECTIONS = [
  { id: '00_premise', title: 'Premise',
    body: (ctx) => (ctx.description || '<one-paragraph pitch goes here>').trim() },

  { id: '01_era_location', title: 'Era & Location',
    body: () => '<year, country, vibe, two sentences max. e.g.: "1998 suburban\n' +
                'USA. Beige towers, CRT monitors, payphones, mall arcade.">' },

  { id: '02_cast', title: 'Cast',
    body: () => '- **Protagonist** — <name>, <one-line who they are>\n' +
                '- **Antagonist** — <name>, <one-line>\n' +
                '- **Mentor** — <name>, <one-line>\n' +
                '- **NPC 1** — <name>, <role>\n' +
                '- **NPC 2** — <name>, <role>\n' +
                '\n' +
                '_Add a new cast member by editing this section OR by dropping\n' +
                'a new file `bible/cast_<slug>.md` — both compile in._' },

  { id: '03_conflict', title: 'Conflict & Stakes',
    body: () => '<what is at stake, what the antagonist is doing, the deadline>' },

  { id: '04_win_fail', title: 'Win & Failure States',
    body: () => '- **Win:** <concrete condition — "collect all 23 coins">\n' +
                '- **Fail:** <concrete condition — "alarm hits 100%">' },

  { id: '05_tone', title: 'Tone',
    body: () => '<2-3 reference games or films. e.g.: "Mars After Midnight\n' +
                '+ Whitewater Wipeout. Dry humor. Glitch-text on dial-tone fail.">' },

  { id: '06_mechanic_anchor', title: 'Mechanic Anchor (Playdate)',
    body: (ctx) => (
      '- **Crank** — ' + (ctx.mechanic_hook || '<crank-driven primary input>') + '\n' +
      '- **A button** — <primary action>\n' +
      '- **B button** — <secondary / cancel>\n' +
      '- **D-pad** — <navigation>\n' +
      '- **Menu button** — <pause / inventory>'
    ) },

  { id: '07_dither', title: 'Dither Palette',
    body: () => '- Primary dither: Atkinson\n' +
                '- Secondary dither: Bayer 4x4\n' +
                '- Tertiary: <Floyd-Steinberg | none>' },

  { id: '08_setting_anchors', title: 'Setting Anchors',
    body: () => '_Verbatim props/places generators must quote. Add freely._\n' +
                '\n' +
                '- <prop or place 1 — e.g. "Pringles can, beige Compaq tower">\n' +
                '- <prop or place 2>\n' +
                '- <prop or place 3>' },

  { id: '09_do_not', title: 'DO NOT',
    body: () => '- No smartphones, no flat panels, no LED everything (unless\n' +
                '  era says otherwise above)\n' +
                '- No real brand logos (no Apple, no Microsoft, no Nintendo)\n' +
                '- No "AI generated" watermarks\n' +
                '- No grayscale gradients in image generation — strict 1-bit\n' +
                '- <project-specific bans you want enforced>' }
];

function renderSection(section, ctx) {
  return `# ${section.title}\n\n${section.body(ctx)}\n`;
}

// Returns array of { id, title, filename, content } — caller writes to disk.
function seedSections(ctx) {
  return SECTIONS.map((s) => ({
    id: s.id,
    title: s.title,
    filename: s.id + '.md',
    content: renderSection(s, ctx || {})
  }));
}

// Write seed sections into <localPath>/sdk_data/bible/. Idempotent:
// existing files are NEVER overwritten — first-write wins so a user-edited
// section survives a re-seed call.
async function writeSeed(localPath, ctx) {
  const dir = path.join(localPath, 'sdk_data', 'bible');
  await fsp.mkdir(dir, { recursive: true });
  const written = [];
  for (const s of seedSections(ctx)) {
    const fp = path.join(dir, s.filename);
    if (fs.existsSync(fp)) continue;
    await fsp.writeFile(fp, s.content);
    written.push(s.filename);
  }
  return { dir, written };
}

module.exports = { SECTIONS, seedSections, renderSection, writeSeed };
