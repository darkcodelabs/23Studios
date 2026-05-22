'use strict';

// story_bible_parser.js — parse a rich source story bible (HAKCD shape)
// into typed sections + split into modular .md files the autopilot consumes.
//
// Entry points:
//   parseBible(rawMarkdown)                -> BibleObject
//   splitToFiles(bibleObj, outDir)         -> { written: [filenames] }
//
// Design: heuristic, regex-driven, tolerant. Source bibles are author-written
// so we cannot assume well-formed structure. Every field is optional — the
// parser fills what it can find and skips what it cannot. Drift / sanity
// flags get pushed onto bibleObj.warnings rather than aborting the parse.
//
// Reference: /tmp/hakcd_v3_kickoff.js has working scene + cast regex that
// we lift, clean up, and generalize here. The HAKCD source bible at
// /home/hakcer/projects/23studios/HAKCD_story_bible_v0.1.md is the canonical
// shape this parser targets — see ## SECTION headers in that doc.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

// ---------------------------------------------------------------------------
// Section header scanning
// ---------------------------------------------------------------------------

// Top-level sections appear as `## <ALL CAPS NAME>` lines, sometimes with
// embedded punctuation (`## ANTAGONIST: REDHOOK`, `## THE MENTOR / THE DAEMON`,
// `## ACT 1: THE BOARDS`, `## CAST LIST (15 named NPCs across 4 acts + coda)`).
// We slurp the raw body between consecutive `## ` lines and tag it by a
// normalized key derived from the header text.

function normalizeHeader(raw) {
  if (!raw) return '';
  return raw
    .replace(/\([^)]*\)/g, '')           // strip parenthetical notes
    .replace(/[/:].*$/, '')              // strip after first / or :
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function splitTopSections(md) {
  // Returns [{ header: 'CAST LIST', body: '...' }, ...] in document order.
  const lines = String(md || '').split(/\r?\n/);
  const sections = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m && !line.startsWith('### ')) {
      if (cur) sections.push(cur);
      cur = { header: m[1].trim(), key: normalizeHeader(m[1]), body: '' };
    } else if (cur) {
      cur.body += line + '\n';
    }
  }
  if (cur) sections.push(cur);
  return sections;
}

// Pull section body for a given normalized key. Returns '' if absent.
function sectionBody(sections, key) {
  for (const s of sections) {
    if (s.key === key) return s.body.trim();
  }
  return '';
}

// Variant matcher — section keys that start with one of the prefixes
// (e.g. ANTAGONIST: REDHOOK → ANTAGONIST). Used for the named-villain
// + named-mentor headers in HAKCD.
function sectionBodyStartsWith(sections, prefix) {
  for (const s of sections) {
    if (s.key === prefix || s.key.startsWith(prefix + ' ') || s.key.startsWith(prefix + '_')) {
      return s.body.trim();
    }
  }
  return '';
}

// Header lookup — same matching rule as sectionBodyStartsWith but returns
// the raw human header text (`ANTAGONIST: REDHOOK`) instead of the body.
// Used to recover the named antagonist / mentor from the section heading.
function sectionHeaderStartsWith(sections, prefix) {
  for (const s of sections) {
    if (s.key === prefix || s.key.startsWith(prefix + ' ') || s.key.startsWith(prefix + '_')) {
      return s.header;
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// CAST LIST parser
// ---------------------------------------------------------------------------
//
// Shape inside CAST LIST body:
//   ### Act 1
//   1. **Mom (offscreen voice).** description...
//   2. **The Mentor.** description...
//   ### Act 2
//   ...
//   ### Coda
//   15. **Cory K.** description...
//
// Each cast entry: number-dot **Name.** Bio. Bio may span multiple lines
// until the next numbered entry or a `###` or `##` line.

function parseCast(castBody) {
  const out = [];
  if (!castBody) return out;
  // Split into subgroups by ### header (Act 1 / Act 2 / Act 3 / Act 4 / Coda).
  const subgroups = [];
  let curGroup = { act: 'general', body: '' };
  for (const line of castBody.split(/\r?\n/)) {
    const m = line.match(/^###\s+(.+?)\s*$/);
    if (m) {
      if (curGroup.body.trim()) subgroups.push(curGroup);
      curGroup = { act: m[1].trim(), body: '' };
    } else {
      curGroup.body += line + '\n';
    }
  }
  if (curGroup.body.trim()) subgroups.push(curGroup);

  // Per-subgroup entry regex.
  // Matches `N. **Name.** Bio` where bio may run across lines until next
  // `\n\d+. **` or end of body.
  const entryRe = /^\s*(\d+)\.\s+\*\*([^*]+?)\*\*\s*(.+?)(?=\n\s*\d+\.\s+\*\*|\n###|\n##|$)/gms;

  for (const g of subgroups) {
    let m;
    entryRe.lastIndex = 0;
    while ((m = entryRe.exec(g.body)) !== null) {
      const nameRaw = m[2].trim().replace(/\.$/, '');
      const bio = m[3].trim().replace(/\s+/g, ' ');
      const role = inferRole(nameRaw, bio);
      out.push({
        act: g.act,
        index: parseInt(m[1], 10),
        name: nameRaw,
        role,
        bio,
      });
    }
  }
  return out;
}

function inferRole(name, bio) {
  // Order matters: antagonist + mentor checks first because villain/mentor
  // bios often mention "the protagonist" in their descriptions, which would
  // otherwise trip the catch-all protagonist branch.
  const hay = (name + ' ' + (bio || '')).toLowerCase();
  if (hay.includes('antagonist') || hay.includes('redhook')) return 'antagonist';
  if (name.toLowerCase().includes('mentor')) return 'mentor';
  if (hay.includes('fed plant') || hay.includes('the fed')) return 'antagonist_minor';
  if (hay.startsWith('protagonist') || / is the protagonist\b/.test(hay)
      || /\bplayer\b/.test(name.toLowerCase())) return 'protagonist';
  return 'npc';
}

// ---------------------------------------------------------------------------
// SCENE LIST parser
// ---------------------------------------------------------------------------
//
// Shape inside SCENE LIST body:
//   ### Act 1: The Boards (8 beats, 5 locations)
//   **SC01. Bedroom (recurring hub).** Active throughout. Mom (offscreen voice).
//   Computer, modem, phone, bed, desk... Primary mechanic: command terminal
//   access, save game, inventory check. Exit: A press on the computer to go
//   online, or walk around to inspect objects.
//
//   **SC02. DEADLINE BBS.** ...
//
// Each entry: **SCNN. Name.** body. Body parses into when_active / npcs /
// interactables / primary_mechanic / exit by keyword splitting where possible.

function parseScenes(sceneBody) {
  const out = [];
  if (!sceneBody) return out;
  // Match SCNN. **Name (suffix).** description. The description may span
  // multiple lines until the next **SCNN entry or a section break.
  const re = /\*\*SC(\d+)\.\s+([^*]+?)\*\*\s+([^\n]+(?:\n(?!\s*\n|\*\*SC\d+|###\s|##\s|---)[^\n]*)*)/g;
  let m;
  while ((m = re.exec(sceneBody)) !== null) {
    const num = parseInt(m[1], 10);
    const nameRaw = m[2].trim().replace(/\.$/, '');
    const blob = m[3].trim().replace(/\s+/g, ' ');
    // Derive snake_case id from first meaningful name words.
    const slug = nameRaw
      .toLowerCase()
      .replace(/[()]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .join('_');
    out.push({
      id: `sc${String(num).padStart(2, '0')}_${slug || 'scene'}`,
      code: `SC${String(num).padStart(2, '0')}`,
      name: nameRaw,
      when_active: extractField(blob, /Active\s+([^.]+)\./i),
      npcs: extractField(blob, /(?:NPCs?|Characters?):\s*([^.]+)\./i),
      interactables: extractField(blob, /Interactables?:\s*([^.]+)\./i),
      primary_mechanic: extractField(blob, /Primary mechanic:\s*([^.]+)\./i),
      exit: extractField(blob, /Exit(?:\s+condition)?s?:\s*([^.]+)\./i),
      raw: blob,
    });
  }
  return out;
}

function extractField(blob, re) {
  const m = (blob || '').match(re);
  return m ? m[1].trim() : '';
}

// ---------------------------------------------------------------------------
// ACT parser
// ---------------------------------------------------------------------------
//
// Each `## ACT N: <NAME>` body looks like:
//   **Length target:** 60-75 minutes.
//   **Setup:** Player wakes their machine at 11pm. ...
//   **Opening scene:** ...
//   **Beat 1:** Player creates an account on DEADLINE. ...
//   **Beat 2:** ...
//   ...
//   **Act 1 hinge:** ...
//   **Act 1 close:** ...

function parseAct(sectionHeader, body) {
  const m = sectionHeader.match(/^ACT\s+(\d+)\s*:?\s*(.*)$/i);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  const name = (m[2] || '').trim() || `Act ${num}`;
  const beats = [];
  const lengthTarget = pickBold(body, /^\*\*Length target:?\*\*\s*(.+)$/im);
  const setup = pickBold(body, /^\*\*Setup:?\*\*\s*(.+(?:\n(?!\*\*)[^\n]+)*)/im);
  const opening = pickBold(body, /^\*\*Opening scene:?\*\*\s*(.+(?:\n(?!\*\*)[^\n]+)*)/im);
  const hinge = pickBold(body, new RegExp(`^\\*\\*Act ${num} hinge:?\\*\\*\\s*(.+(?:\\n(?!\\*\\*)[^\\n]+)*)`, 'im'));
  const close = pickBold(body, new RegExp(`^\\*\\*Act ${num} close:?\\*\\*\\s*(.+(?:\\n(?!\\*\\*)[^\\n]+)*)`, 'im'));

  const beatRe = /^\*\*Beat\s+(\d+)(?:\s*\([^)]*\))?:?\*\*\s*(.+(?:\n(?!\*\*)[^\n]+)*)/gim;
  let bm;
  while ((bm = beatRe.exec(body)) !== null) {
    beats.push({
      id: `beat_${parseInt(bm[1], 10)}`,
      index: parseInt(bm[1], 10),
      summary: bm[2].trim().replace(/\s+/g, ' '),
    });
  }

  return {
    id: `act_${num}`,
    number: num,
    name,
    length_target: lengthTarget,
    setup,
    opening_scene: opening,
    beats,
    hinge,
    close,
  };
}

function pickBold(body, re) {
  const m = (body || '').match(re);
  return m ? m[1].trim().replace(/\s+/g, ' ') : '';
}

function parseCoda(body) {
  if (!body) return null;
  return {
    summary: body.trim().replace(/\s+/g, ' ').slice(0, 1200),
  };
}

// ---------------------------------------------------------------------------
// Free-text body extraction (skill gates / items / tone map / etc.)
// ---------------------------------------------------------------------------
//
// These sections are bullet-list or table heavy; we don't try to fully
// type them — just keep the raw body so the splitter can re-emit them as
// their own .md file. Counts get computed for the preview pane.

function parseBulletList(body) {
  if (!body) return [];
  const out = [];
  for (const line of body.split(/\r?\n/)) {
    const m = line.match(/^\s*[-*]\s+\*\*([^*]+)\*\*\s*(.*)$/);
    if (m) {
      out.push({ name: m[1].trim().replace(/[.:]\s*$/, ''), description: m[2].trim() });
      continue;
    }
    const m2 = line.match(/^\s*[-*]\s+(.+)$/);
    if (m2) out.push({ name: '', description: m2[1].trim() });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Protagonist / antagonist / mentor / threat structured pickers
// ---------------------------------------------------------------------------

function parseProtagonist(body) {
  if (!body) return null;
  const rawName = pickField(body, /^Name:\s*(.+)$/im);
  // Clean up bibles that leave the name as a prose line like
  // "customizable (player picks a handle…)". Strip everything from the
  // first paren or comma onward; if the result is the literal word
  // "customizable", surface the default handle from inside the parens
  // when present, otherwise fall back to "Protagonist".
  let name = 'Protagonist';
  if (rawName) {
    const stripped = rawName.replace(/[(,].*$/, '').trim();
    if (stripped.toLowerCase() === 'customizable') {
      const defaultM = rawName.match(/default\s+"([^"]+)"/i);
      name = defaultM ? defaultM[1] : 'Protagonist';
    } else if (stripped) {
      name = stripped;
    }
  }
  return {
    name,
    age: pickField(body, /^Age:\s*(.+)$/im),
    location: pickField(body, /^Location:\s*(.+)$/im),
    family: pickField(body, /^Family situation:\s*(.+)$/im),
    voice: pickField(body, /^Voice:\s*(.+)$/im),
    customizable: pickField(body, /^What the player customizes:\s*(.+)$/im),
    description: body.trim().slice(0, 1200),
  };
}

function parseAntagonist(body, headerText) {
  if (!body) return null;
  return {
    name: extractAntagonistName(headerText, body),
    voice: pickField(body, /^Voice:\s*(.+)$/im),
    description: body.trim().slice(0, 1200),
  };
}

function extractAntagonistName(headerText, body) {
  // Prefer the section header's named-villain pattern (`ANTAGONIST: REDHOOK`
  // or `ANTAGONIST — REDHOOK`). Fall back to the first capitalized word in
  // the body when no header name is present.
  if (headerText) {
    const m = headerText.match(/(?:ANTAGONIST|VILLAIN)\s*[:\-—]\s*(.+)$/i);
    if (m) return m[1].trim();
  }
  const firstLine = (body || '').split(/\n/).find((l) => l.trim()) || '';
  const m2 = firstLine.match(/\b([A-Z][A-Za-z0-9]+)\b/);
  return m2 ? m2[1] : '';
}

function parseMentor(body) {
  if (!body) return null;
  // pickField returns the full first line after the label, but a HAKCD-shape
  // mentor `Real name:` line often runs prose into the same row
  // (`Real name: Loyd-something. Died February 1996, …`). Clamp to the
  // first sentence so downstream UIs get a clean name.
  const raw = pickField(body, /^Real name:\s*(.+)$/im);
  const realName = raw ? raw.split('.')[0].trim().replace(/,$/, '') : '';
  return {
    real_name: realName,
    voice_pre_reveal: pickField(body, /^Voice\s*\(pre-reveal\):\s*(.+)$/im),
    voice_post_reveal: pickField(body, /^Voice\s*\(post-reveal\):\s*(.+)$/im),
    description: body.trim().slice(0, 1500),
  };
}

function pickField(body, re) {
  const m = (body || '').match(re);
  return m ? m[1].trim() : '';
}

// ---------------------------------------------------------------------------
// Drift / sanity flags
// ---------------------------------------------------------------------------
//
// Knowledge guards we hold for the HAKCD source: Phrack 54 actually shipped
// in 1998 (matches the bible's "October 1998 / Phrack is on Issue 54"). If
// future bibles cite period-incorrect issues we surface them; for now this
// list stays empty unless an obvious-anachronism trigger fires.

function detectWarnings(md) {
  const warnings = [];
  // Flipper Zero predates 2020, so any pre-2020 era setting that name-drops
  // it deserves a flag. The HAKCD bible already calls this out in its OPEN
  // QUESTIONS section, but we surface it here so the preview shows it.
  if (/flipper zero/i.test(md) && /199\d|200[0-9]/i.test(md)) {
    warnings.push('Flipper Zero is anachronistic in any pre-2020 setting (HAKCD bible already flags this in OPEN QUESTIONS).');
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Top-level parseBible
// ---------------------------------------------------------------------------

function parseBible(rawMarkdown) {
  const md = String(rawMarkdown || '');
  const sections = splitTopSections(md);

  const out = {
    logline: sectionBody(sections, 'LOGLINE'),
    setting: sectionBody(sections, 'SETTING'),
    structure: sectionBody(sections, 'STRUCTURE'),
    protagonist: parseProtagonist(sectionBody(sections, 'PROTAGONIST')),
    antagonist: parseAntagonist(
      sectionBodyStartsWith(sections, 'ANTAGONIST'),
      sectionHeaderStartsWith(sections, 'ANTAGONIST')
    ),
    mentor: parseMentor(sectionBodyStartsWith(sections, 'THE MENTOR') || sectionBodyStartsWith(sections, 'MENTOR')),
    threat: sectionBodyStartsWith(sections, 'THE THREAT') || sectionBodyStartsWith(sections, 'THREAT'),
    tool_progression: sectionBody(sections, 'TOOL PROGRESSION'),
    cast: parseCast(sectionBody(sections, 'CAST LIST')),
    acts: [],
    coda: parseCoda(sectionBody(sections, 'CODA')),
    scenes: parseScenes(sectionBody(sections, 'SCENE LIST')),
    items: parseBulletList(sectionBody(sections, 'ITEM LIST')),
    skill_gates: sectionBody(sections, 'SKILL GATE MAP'),
    save_state_extensions: sectionBody(sections, 'SAVE STATE EXTENSIONS NEEDED'),
    replay: sectionBody(sections, 'REPLAY AND BRANCHING'),
    tone_map: sectionBody(sections, 'TONE MAP'),
    technical_architecture: sectionBody(sections, 'TECHNICAL ARCHITECTURE NEEDED'),
    open_questions: sectionBody(sections, 'OPEN QUESTIONS'),
    warnings: detectWarnings(md),
  };

  // Acts — collect every "## ACT N:" section in order.
  for (const s of sections) {
    if (/^ACT\s+\d+/i.test(s.key)) {
      const act = parseAct(s.header, s.body);
      if (act) out.acts.push(act);
    }
  }

  return out;
}

// ---------------------------------------------------------------------------
// splitToFiles — write each top-level section as a numbered .md file
// ---------------------------------------------------------------------------
//
// File order is deterministic so sdk_bible.compile() can concat in stable
// numerical order. Filenames mirror the canonical NN_<slug>.md convention
// already used by sdk_bible.js (which expects /^[a-z0-9][a-z0-9_-]*\.md$/).

const FILE_ORDER = [
  ['00_premise',                'Premise',                'logline'],
  ['01_setting',                'Setting',                'setting'],
  ['02_structure',              'Structure',              'structure'],
  ['03_protagonist',            'Protagonist',            'protagonist'],
  ['04_antagonist',             'Antagonist',             'antagonist'],
  ['05_mentor',                 'Mentor',                 'mentor'],
  ['06_threat',                 'Threat',                 'threat'],
  ['07_tool_progression',       'Tool Progression',       'tool_progression'],
  ['08_cast',                   'Cast',                   'cast'],
  // 09-12 reserved for acts; written from bible.acts[] below
  ['13_coda',                   'Coda',                   'coda'],
  ['14_scenes',                 'Scenes',                 'scenes'],
  ['15_items',                  'Items',                  'items'],
  ['16_skill_gates',            'Skill Gates',            'skill_gates'],
  ['17_save_state_extensions',  'Save State Extensions',  'save_state_extensions'],
  ['18_tone_map',               'Tone Map',               'tone_map'],
  ['19_technical_architecture', 'Technical Architecture', 'technical_architecture'],
];

function renderSection(name, value) {
  if (value === undefined || value === null || value === '') return null;
  // String body — wrap with H1.
  if (typeof value === 'string') {
    return `# ${name}\n\n${value.trim()}\n`;
  }
  // Object — render structured.
  if (Array.isArray(value)) {
    return renderArrayBody(name, value);
  }
  return renderObjectBody(name, value);
}

function renderObjectBody(name, obj) {
  const lines = [`# ${name}`, ''];
  for (const [k, v] of Object.entries(obj)) {
    if (!v) continue;
    if (typeof v === 'string') {
      lines.push(`## ${humanize(k)}`, '', v.trim(), '');
    }
  }
  return lines.join('\n') + '\n';
}

function renderArrayBody(name, arr) {
  const lines = [`# ${name}`, ''];
  // Cast-like entries (have name + bio + role + act).
  if (arr.length > 0 && arr[0].name !== undefined && arr[0].bio !== undefined) {
    let curAct = null;
    for (const e of arr) {
      if (e.act && e.act !== curAct) {
        curAct = e.act;
        lines.push(`## ${curAct}`, '');
      }
      const head = e.role ? `${e.name} — _${e.role}_` : e.name;
      lines.push(`- **${head}** — ${e.bio || ''}`);
    }
    return lines.join('\n') + '\n';
  }
  // Scene-like entries (have code + name + raw or primary_mechanic).
  if (arr.length > 0 && arr[0].code && arr[0].name) {
    for (const s of arr) {
      lines.push(`## ${s.code}. ${s.name}`, '');
      if (s.when_active) lines.push(`- **Active:** ${s.when_active}`);
      if (s.npcs) lines.push(`- **NPCs:** ${s.npcs}`);
      if (s.interactables) lines.push(`- **Interactables:** ${s.interactables}`);
      if (s.primary_mechanic) lines.push(`- **Primary mechanic:** ${s.primary_mechanic}`);
      if (s.exit) lines.push(`- **Exit:** ${s.exit}`);
      if (!s.primary_mechanic && s.raw) lines.push('', s.raw);
      lines.push('');
    }
    return lines.join('\n') + '\n';
  }
  // Item-like.
  if (arr.length > 0 && arr[0].description !== undefined) {
    for (const i of arr) {
      lines.push(`- ${i.name ? '**' + i.name + ':** ' : ''}${i.description}`);
    }
    return lines.join('\n') + '\n';
  }
  // Fallback.
  return lines.join('\n') + '\n' + JSON.stringify(arr, null, 2) + '\n';
}

function renderAct(act) {
  const lines = [`# ${act.name || ('Act ' + act.number)}`, ''];
  if (act.length_target) lines.push(`**Length target:** ${act.length_target}`, '');
  if (act.setup) lines.push(`**Setup:** ${act.setup}`, '');
  if (act.opening_scene) lines.push(`**Opening scene:** ${act.opening_scene}`, '');
  if (act.beats && act.beats.length) {
    lines.push('## Beats', '');
    for (const b of act.beats) {
      lines.push(`- **Beat ${b.index}:** ${b.summary}`);
    }
    lines.push('');
  }
  if (act.hinge) lines.push(`**Hinge:** ${act.hinge}`, '');
  if (act.close) lines.push(`**Close:** ${act.close}`, '');
  return lines.join('\n') + '\n';
}

function humanize(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function splitToFiles(bible, outDir) {
  await fsp.mkdir(outDir, { recursive: true });
  const written = [];

  // 00 .. 08 + 13 .. 19 — direct field mapping.
  for (const [stem, name, key] of FILE_ORDER) {
    const val = bible[key];
    const rendered = renderSection(name, val);
    if (!rendered) continue;
    const filename = `${stem}.md`;
    await fsp.writeFile(path.join(outDir, filename), rendered);
    written.push(filename);
  }

  // 09 .. 12 — one file per act in bible.acts (in order). Numbering capped at 12.
  if (Array.isArray(bible.acts)) {
    for (let i = 0; i < Math.min(bible.acts.length, 4); i++) {
      const act = bible.acts[i];
      const stem = String(9 + i).padStart(2, '0') + `_act${i + 1}`;
      const filename = `${stem}.md`;
      await fsp.writeFile(path.join(outDir, filename), renderAct(act));
      written.push(filename);
    }
  }

  // Sort by leading number so callers and the bible UI display in order.
  written.sort();
  return { written };
}

// ---------------------------------------------------------------------------
// Helper for callers that just want section counts (powers preview pane).
// ---------------------------------------------------------------------------

function countsFor(bible) {
  return {
    cast: Array.isArray(bible.cast) ? bible.cast.length : 0,
    scenes: Array.isArray(bible.scenes) ? bible.scenes.length : 0,
    acts: Array.isArray(bible.acts) ? bible.acts.length : 0,
    items: Array.isArray(bible.items) ? bible.items.length : 0,
    beats: Array.isArray(bible.acts)
      ? bible.acts.reduce((n, a) => n + (a.beats ? a.beats.length : 0), 0)
      : 0,
    warnings: Array.isArray(bible.warnings) ? bible.warnings.length : 0,
  };
}

function sectionsDetected(bible) {
  const present = [];
  const keys = [
    'logline', 'setting', 'structure', 'protagonist', 'antagonist',
    'mentor', 'threat', 'tool_progression', 'cast', 'acts', 'coda',
    'scenes', 'items', 'skill_gates', 'save_state_extensions',
    'tone_map', 'technical_architecture',
  ];
  for (const k of keys) {
    const v = bible[k];
    if (v === undefined || v === null) continue;
    if (typeof v === 'string' && v.trim() === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) continue;
    present.push(k);
  }
  return present;
}

module.exports = {
  parseBible,
  splitToFiles,
  countsFor,
  sectionsDetected,
  // exposed for tests
  _internal: {
    splitTopSections,
    parseCast,
    parseScenes,
    parseAct,
    parseProtagonist,
    parseAntagonist,
    parseMentor,
    parseBulletList,
    normalizeHeader,
  },
};
