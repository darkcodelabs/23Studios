'use strict';

// dialogue_generator.js — per-(scene, NPC) dialogue generation.
//
// Inputs: scene entry from sdk.scenes, cast entry from sdk.characters,
// bible's tone map for the act, plus 3 random ~200-word excerpts from
// dialogue_corpus.sample() as voice anchor.
//
// Output: JSON { npc_id, scene_id, lines: [{id, text, trigger}, ...] }
// Cached per (scene, npc, sha256(scene+cast+tone)) to skip regen when
// bible inputs haven't changed.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const openrouter = require('./openrouter');
const corpus = require('./dialogue_corpus');

const DEFAULT_MODEL = process.env.STUDIO_DIALOGUE_MODEL
  || process.env.STUDIO_LLM_MODEL
  || 'openai/gpt-5';

function cacheKey({ projectId, sceneId, npcId, sceneEntry, castEntry, actToneEntry }) {
  const h = crypto.createHash('sha256');
  h.update(JSON.stringify({
    p: projectId, s: sceneId, n: npcId,
    se: sceneEntry || {}, ce: castEntry || {}, te: actToneEntry || {}
  }));
  return `${sceneId}__${npcId}__${h.digest('hex').slice(0, 10)}`;
}

function cachePath(localPath, key) {
  return path.join(localPath, 'sdk_data', 'dialogue_cache', key + '.json');
}

function outputPath(localPath, sceneId, npcId) {
  return path.join(localPath, 'sdk_data', 'dialogue', `${sceneId}__${npcId}.json`);
}

function buildSystemPrompt({ sceneEntry, castEntry, actToneEntry, corpusExcerpts }) {
  const excerptsBlock = (corpusExcerpts || []).map((e, i) =>
    `EXCERPT ${i + 1} (${e.source}/${e.file}):\n${e.text}`
  ).join('\n\n');

  return `You are writing dialogue for a 1998 BBS / phreaker game called HAKCD.

The character speaking is:
${JSON.stringify(castEntry || {}, null, 2)}

The scene is:
${JSON.stringify(sceneEntry || {}, null, 2)}

The tone of this act is:
${JSON.stringify(actToneEntry || {}, null, 2)}

For voice calibration, here are real excerpts of how this community talks.
Match this rhythm, vocabulary density, and ambient slang:

${excerptsBlock}

Constraints:
- 4 to 10 lines max per scene per NPC
- No exposition dumps. No "as you know"
- Period accurate: 1998 vocabulary, no "Slack", no "Discord", no "iPhone",
  no modern AI / cloud / SaaS terms
- Each line stands alone — must work as a single Playdate dialogue card,
  ~80 characters max per line
- Use the vocabulary density of the excerpts above
- Reference specific 1998 technical things (BBS commands, tone frequencies,
  Phrack issues, the actual phreaker glossary) when natural
- Lines should advance scene state OR reveal character, not both
- "trigger" is one of: on_enter | on_interact | on_exit | on_idle |
  on_use_<item> | on_dialog_choice_<id>

Output STRICT JSON only — no prose, no markdown fences, no commentary.
Begin response with { and end with }.

Schema:
{
  "npc_id": "<id>",
  "scene_id": "<id>",
  "lines": [
    { "id": 1, "text": "...", "trigger": "on_enter" },
    ...
  ]
}`;
}

function safeParseJson(text) {
  if (!text || typeof text !== 'string') return null;
  // Try direct parse first
  try { return JSON.parse(text); } catch (_e) {}
  // Strip markdown fences if present
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try { return JSON.parse(m[0]); } catch (_e) {}
  }
  return null;
}

async function generateDialogue({
  projectId, localPath, sceneEntry, castEntry, actToneEntry,
  model = DEFAULT_MODEL, ev = null, force = false
}) {
  if (!sceneEntry || !castEntry) throw new Error('generateDialogue: scene + cast entries required');
  const sceneId = sceneEntry.id;
  const npcId = castEntry.id;
  if (!sceneId || !npcId) throw new Error('generateDialogue: scene.id + cast.id required');

  const key = cacheKey({ projectId, sceneId, npcId, sceneEntry, castEntry, actToneEntry });
  const cachePathFull = cachePath(localPath, key);
  const outPathFull = outputPath(localPath, sceneId, npcId);

  // Cache hit
  if (!force && fs.existsSync(cachePathFull)) {
    try {
      const cached = JSON.parse(await fsp.readFile(cachePathFull, 'utf8'));
      if (ev) ev('log', { text: `dialogue cache hit: ${sceneId}__${npcId}` });
      // Mirror cached payload to canonical output path even on cache hit
      await fsp.mkdir(path.dirname(outPathFull), { recursive: true });
      await fsp.writeFile(outPathFull, JSON.stringify(cached, null, 2));
      return cached;
    } catch (_e) { /* corrupt cache — regen */ }
  }

  // Sample voice anchor — deterministic per (scene, npc) for stable regen
  const corpusExcerpts = corpus.sample(3, `${sceneId}_${npcId}`);

  const systemPrompt = buildSystemPrompt({
    sceneEntry, castEntry, actToneEntry, corpusExcerpts
  });

  const userPrompt =
`Write dialogue for ${castEntry.name || npcId} in scene "${sceneEntry.name || sceneId}".
Output JSON only.`;

  // First attempt
  let parsed = null;
  let lastText = '';
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const sys = attempt === 0 ? systemPrompt
      : systemPrompt + '\n\nYour previous reply was NOT parseable JSON. Output ONLY a JSON object. Begin with { and end with }. No prose, no fences, no commentary.';
    let text = '';
    try {
      text = await openrouter.streamChat({
        model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: userPrompt }
        ],
        onDelta: () => {},
        projectId,
        stage: 'dialogue',
        sceneId
      });
    } catch (e) {
      if (ev) ev('log', { text: `dialogue api fail ${sceneId}__${npcId}: ${e.message}` });
      throw e;
    }
    lastText = text;
    parsed = safeParseJson(text);
  }

  if (!parsed) {
    if (ev) ev('log', { text: `dialogue parse fail ${sceneId}__${npcId} — stub written` });
    // Stub fallback so pipeline doesn't crash; flag the asset for regen
    parsed = {
      npc_id: npcId, scene_id: sceneId,
      lines: [{ id: 1, text: '(pending regen — parse failed)', trigger: 'on_enter' }],
      _fallback: true, _raw: lastText.slice(0, 400)
    };
  } else {
    // Normalize: ensure npc_id + scene_id + lines[] shape
    parsed.npc_id = npcId;
    parsed.scene_id = sceneId;
    if (!Array.isArray(parsed.lines)) parsed.lines = [];
    parsed.lines = parsed.lines.slice(0, 10).map((l, i) => ({
      id: l.id || i + 1,
      text: String(l.text || '').slice(0, 200),
      trigger: String(l.trigger || 'on_interact').slice(0, 64)
    }));
  }

  // Persist canonical output + cache
  await fsp.mkdir(path.dirname(outPathFull), { recursive: true });
  await fsp.mkdir(path.dirname(cachePathFull), { recursive: true });
  await fsp.writeFile(outPathFull, JSON.stringify(parsed, null, 2));
  await fsp.writeFile(cachePathFull, JSON.stringify(parsed, null, 2));

  if (ev) ev('asset', { kind: 'dialogue', id: `${sceneId}__${npcId}`, line_count: parsed.lines.length });
  return parsed;
}

module.exports = { generateDialogue, _internals: { buildSystemPrompt, cacheKey } };
