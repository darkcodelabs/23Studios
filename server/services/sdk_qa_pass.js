'use strict';

// sdk_qa_pass.js — Step 8 of the 23studios canonical workflow: Multi-persona AI Game Critic.
//
// Phase 14 of docs/23studios_canonical_workflow.md.
//
// Five AI personas each answer 8 canonical questions about the game design,
// then aggregate into a qa_critic.json + qa_critic.md report.
//
// Usage:
//   const { critique } = require('./sdk_qa_pass');
//   const report = await critique(projectId, sdkRoot);
//   // sdkRoot = absolute path to project local_path (not sdk_data subdir)
//
// Claude calls: 5 parallel via claude.js sendMessage (same pattern as sdk_autopilot).
// Reads: compiled_design.json, story_bible.md, project.json, concepts/concept_*.json
// Writes: sdk_data/qa_critic.json + sdk_data/qa_critic.md

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const claude = require('./claude');

const SDK_DATA_REL = 'sdk_data';

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

const PERSONAS = [
  {
    id: 'casual',
    system: 'You are a casual mobile gamer. You play 10 min then put your phone down. Brutally honest about pacing + clarity. No jargon.'
  },
  {
    id: 'fan',
    system: "You are a Playdate superfan who owns Whitewater Wipeout, Casual Birder, Mars After Midnight. You judge by Panic's bar. Crank usage + 1-bit polish matter most."
  },
  {
    id: 'speedrunner',
    system: 'You are a speedrunner. You look for skips, sequence breaks, soft-locks, useless rooms. Tell us what to cut.'
  },
  {
    id: 'qa',
    system: 'You are a QA tester. List every gap in puzzle logic, dialog branches, item flow, and save state. Specific scene/item ids.'
  },
  {
    id: 'harsh',
    system: 'You are a harsh indie review-site critic. Write a 250-word review that would land on the front page. Score 1-10. Do not be diplomatic.'
  }
];

// ---------------------------------------------------------------------------
// Claude bridge
// ---------------------------------------------------------------------------

// Promise wrapper around claude.sendMessage — same pattern as sdk_autopilot.js.
function askClaude({ projectId, cwd }, prompt, system = '') {
  return new Promise((resolve, reject) => {
    let acc = '';
    const text = (system ? system + '\n\n' : '') + prompt;
    claude.sendMessage({
      projectId, cwd, text,
      onChunk: (c) => { acc += c; },
      onDone: () => resolve(acc),
      onError: reject
    });
  });
}

// ---------------------------------------------------------------------------
// JSON parser (same safe-parse pattern as sdk_autopilot)
// ---------------------------------------------------------------------------

function safeParseJson(text) {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = m ? m[1] : text;
  try { return JSON.parse(candidate.trim()); } catch (_e) { /* fall through */ }
  const start = candidate.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === '{') depth++;
    else if (candidate[i] === '}') {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(candidate.slice(start, i + 1)); } catch (_e) { return null; }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Input loaders
// ---------------------------------------------------------------------------

function loadJsonFile(fp, fallback) {
  try {
    if (!fs.existsSync(fp)) return fallback;
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (_e) {
    return fallback;
  }
}

function loadTextFile(fp) {
  try {
    if (!fs.existsSync(fp)) return null;
    return fs.readFileSync(fp, 'utf8');
  } catch (_e) { return null; }
}

function loadConcepts(sdkRoot) {
  const dir = path.join(sdkRoot, 'concepts');
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.startsWith('concept_') && f.endsWith('.json'));
  const concepts = [];
  for (const f of files) {
    const data = loadJsonFile(path.join(dir, f), null);
    if (data && typeof data === 'object') concepts.push(data);
  }
  return concepts;
}

// Build a text summary of the game design suitable for LLM input.
function buildDesignContext(compiledDesign, projectData, storyBible, concepts) {
  const parts = [];

  if (storyBible) {
    parts.push('## Story Bible\n' + storyBible.slice(0, 4000));
  }

  if (projectData && projectData.scenes && projectData.scenes.length) {
    parts.push('## Scenes\n' + projectData.scenes.map((s) =>
      `- ${s.id || '?'}: ${s.name || ''} — ${s.description || ''}`
    ).slice(0, 30).join('\n'));
  }

  if (projectData && projectData.characters && projectData.characters.length) {
    parts.push('## Characters\n' + projectData.characters.map((c) =>
      `- ${c.id || '?'}: ${c.name || ''} (${c.role || 'npc'})`
    ).join('\n'));
  }

  if (compiledDesign) {
    const rooms = Object.keys(compiledDesign.rooms_graph || {});
    if (rooms.length) {
      parts.push(`## Room graph (${rooms.length} rooms)\n` + rooms.join(', '));
    }
    const puzzles = compiledDesign.puzzle_dag || [];
    if (puzzles.length) {
      parts.push('## Puzzle DAG\n' + puzzles.map((p) =>
        `- ${p.id}: requires [${(p.requires || []).join(', ')}] → produces [${(p.produces || []).join(', ')}]`
      ).join('\n'));
    }
    const items = (compiledDesign.inventory_rules && compiledDesign.inventory_rules.items) || [];
    if (items.length) {
      parts.push('## Inventory\n' + items.map((i) => `- ${i.id} (found in: ${i.scene || '?'})`).join('\n'));
    }
  }

  if (concepts.length) {
    parts.push('## Concept notes\n' + concepts.map((c) =>
      `- ${c.id || '?'}: ${c.title_suggestion || ''} — ${c.mechanic_hook || ''}`
    ).join('\n'));
  }

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Persona critique prompt
// ---------------------------------------------------------------------------

const EIGHT_QUESTIONS = `Answer each question briefly but specifically, referencing actual scene/item/character ids where possible.

1. What is boring?
2. What is confusing?
3. What feels too slow?
4. What should use the crank more?
5. What looks visually weak?
6. What feels memorable?
7. What should be cut?
8. What should be expanded?`;

function buildPersonaPrompt(persona, designContext) {
  return `You are critiquing a Playdate (hand-crank handheld) game design. Here is the full game design context:

${designContext}

${EIGHT_QUESTIONS}

Return ONLY a JSON object with this exact shape (no prose outside the JSON):
{
  "persona": "${persona.id}",
  "score_1_to_10": <integer 1-10>,
  "verdict": "<ship|rework|reshelve>",
  "answers": {
    "q1": "<what is boring>",
    "q2": "<what is confusing>",
    "q3": "<what feels too slow>",
    "q4": "<what should use the crank more>",
    "q5": "<what looks visually weak>",
    "q6": "<what feels memorable>",
    "q7": "<what should be cut>",
    "q8": "<what should be expanded>"
  },
  "top_issues": ["<issue 1>", "<issue 2>", "<issue 3>"],
  "top_strengths": ["<strength 1>", "<strength 2>"]
}`;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function deriveRecommendation(avgScore) {
  if (avgScore >= 7) return 'ship';
  if (avgScore >= 5) return 'rework';
  return 'reshelve';
}

// Find strings that appear across multiple personas' top_issues/top_strengths.
// Uses a simple keyword overlap heuristic rather than exact match.
function findCommon(arrays, minCount = 2) {
  const counts = {};
  for (const arr of arrays) {
    for (const item of (arr || [])) {
      if (!item || typeof item !== 'string') continue;
      const key = item.toLowerCase().trim();
      counts[key] = (counts[key] || 0) + 1;
    }
  }
  return Object.entries(counts)
    .filter(([, n]) => n >= minCount)
    .sort(([, a], [, b]) => b - a)
    .map(([k]) => k);
}

function aggregateResults(personas) {
  const scores = personas.map((p) => p.score_1_to_10 || 5);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

  const verdicts = personas.map((p) => p.verdict || 'rework');
  const ship_count = verdicts.filter((v) => v === 'ship').length;
  const rework_count = verdicts.filter((v) => v === 'rework').length;
  const reshelve_count = verdicts.filter((v) => v === 'reshelve').length;

  const allIssues = personas.map((p) => p.top_issues || []);
  const allStrengths = personas.map((p) => p.top_strengths || []);

  return {
    avg_score: Math.round(avgScore * 10) / 10,
    ship_count,
    rework_count,
    reshelve_count,
    common_issues: findCommon(allIssues, 2).slice(0, 5),
    common_strengths: findCommon(allStrengths, 2).slice(0, 5)
  };
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

const QUESTION_LABELS = [
  '', // q0 placeholder
  'What is boring?',
  'What is confusing?',
  'What feels too slow?',
  'What should use the crank more?',
  'What looks visually weak?',
  'What feels memorable?',
  'What should be cut?',
  'What should be expanded?'
];

function renderMarkdown(report) {
  const { personas, aggregate, critiqued_at, recommendation } = report;

  const lines = [
    '# QA Critic Report',
    '',
    `**Critiqued at:** ${critiqued_at}`,
    `**Recommendation:** ${recommendation.toUpperCase()}`,
    `**Average score:** ${aggregate.avg_score}/10`,
    `**Verdicts:** ${aggregate.ship_count} ship / ${aggregate.rework_count} rework / ${aggregate.reshelve_count} reshelve`,
    ''
  ];

  if (aggregate.common_issues.length) {
    lines.push('## Common Issues');
    for (const issue of aggregate.common_issues) {
      lines.push(`- ${issue}`);
    }
    lines.push('');
  }

  if (aggregate.common_strengths.length) {
    lines.push('## Common Strengths');
    for (const strength of aggregate.common_strengths) {
      lines.push(`- ${strength}`);
    }
    lines.push('');
  }

  for (const p of personas) {
    const verdictEmoji = p.verdict === 'ship' ? '[SHIP]' : p.verdict === 'rework' ? '[REWORK]' : '[RESHELVE]';
    lines.push(`## Persona: ${p.persona}`);
    lines.push('');
    lines.push(`**Score:** ${p.score_1_to_10}/10 | **Verdict:** ${verdictEmoji}`);
    lines.push('');

    if (p.top_issues && p.top_issues.length) {
      lines.push('**Top issues:**');
      for (const issue of p.top_issues) lines.push(`- ${issue}`);
      lines.push('');
    }

    if (p.top_strengths && p.top_strengths.length) {
      lines.push('**Top strengths:**');
      for (const s of p.top_strengths) lines.push(`- ${s}`);
      lines.push('');
    }

    if (p.answers) {
      lines.push('**Q&A:**');
      lines.push('');
      for (let q = 1; q <= 8; q++) {
        const key = `q${q}`;
        if (p.answers[key]) {
          lines.push(`**Q${q}: ${QUESTION_LABELS[q]}**`);
          lines.push(p.answers[key]);
          lines.push('');
        }
      }
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public: critique(projectId, sdkRoot)
// ---------------------------------------------------------------------------

/**
 * critique(projectId, sdkRoot)
 *
 * Fires 5 parallel Claude calls (one per persona), aggregates results, and
 * writes qa_critic.json + qa_critic.md into <sdkRoot>/sdk_data/.
 *
 * sdkRoot is the project's local_path (the directory that contains sdk_data/).
 *
 * Returns the full report object.
 */
async function critique(projectId, sdkRoot) {
  const sdkDataDir = path.join(sdkRoot, SDK_DATA_REL);

  // Load source material ---------------------------------------------------
  const compiledDesign = loadJsonFile(path.join(sdkDataDir, 'compiled_design.json'), null);
  const storyBible = loadTextFile(path.join(sdkDataDir, 'story_bible.md'));
  const projectData = loadJsonFile(path.join(sdkDataDir, 'project.json'), { scenes: [], characters: [] });
  const concepts = loadConcepts(sdkDataDir);

  const designContext = buildDesignContext(compiledDesign, projectData, storyBible, concepts);

  // The cwd passed to sendMessage must be a real directory.
  // Use sdkRoot (the project's local_path) as the cwd for the Claude subprocess.
  const claudeCtx = { projectId, cwd: sdkRoot };

  // Fire 5 parallel Claude calls --------------------------------------------
  const personaResults = await Promise.all(
    PERSONAS.map(async (persona) => {
      const prompt = buildPersonaPrompt(persona, designContext);
      let raw;
      try {
        raw = await askClaude(claudeCtx, prompt, persona.system);
      } catch (e) {
        // Return a placeholder on individual failure so the others still aggregate.
        return {
          persona: persona.id,
          score_1_to_10: 5,
          verdict: 'rework',
          answers: {},
          top_issues: [`[claude error: ${e.message}]`],
          top_strengths: []
        };
      }

      const parsed = safeParseJson(raw);
      if (!parsed || typeof parsed !== 'object') {
        return {
          persona: persona.id,
          score_1_to_10: 5,
          verdict: 'rework',
          answers: {},
          top_issues: ['[failed to parse persona response]'],
          top_strengths: []
        };
      }

      // Clamp score to [1, 10].
      const score = Math.min(10, Math.max(1, Number(parsed.score_1_to_10) || 5));
      const verdict = ['ship', 'rework', 'reshelve'].includes(parsed.verdict)
        ? parsed.verdict
        : 'rework';

      return {
        persona: persona.id,
        score_1_to_10: score,
        verdict,
        answers: parsed.answers || {},
        top_issues: Array.isArray(parsed.top_issues) ? parsed.top_issues : [],
        top_strengths: Array.isArray(parsed.top_strengths) ? parsed.top_strengths : []
      };
    })
  );

  // Aggregate ---------------------------------------------------------------
  const aggregate = aggregateResults(personaResults);
  const recommendation = deriveRecommendation(aggregate.avg_score);

  const report = {
    critiqued_at: new Date().toISOString(),
    personas: personaResults,
    aggregate,
    recommendation
  };

  // Write outputs -----------------------------------------------------------
  await fsp.mkdir(sdkDataDir, { recursive: true });

  const jsonPath = path.join(sdkDataDir, 'qa_critic.json');
  await fsp.writeFile(jsonPath, JSON.stringify(report, null, 2));

  const mdPath = path.join(sdkDataDir, 'qa_critic.md');
  await fsp.writeFile(mdPath, renderMarkdown(report));

  return report;
}

// Read the persisted report (returns null if not yet run).
async function readLatest(sdkRoot) {
  const fp = path.join(sdkRoot, SDK_DATA_REL, 'qa_critic.json');
  try {
    const raw = await fsp.readFile(fp, 'utf8');
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

module.exports = { critique, readLatest };
