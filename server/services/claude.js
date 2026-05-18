'use strict';

// Claude Code subprocess wrapper.
//
// Phase 5 iteration loop will reuse this module via a new `spawnClaudeCode`
// export that wraps the same `claude -p` subprocess pattern below. Notable
// spec drift from docs/23studios_phase5_iteration_loop.md (May 2026):
//
//   The spec calls for `claude --print --prompt-file <tempfile>` but the
//   shipped CLI does NOT have a --prompt-file flag. Instead, prompts are
//   piped via stdin, exactly as `sendMessage` already does at line ~111
//   below. Phase 5's spawnClaudeCode should follow this stdin pattern:
//
//     cat $tempfile | claude --print --model opus \
//         --max-budget-usd 5 \
//         --allowed-tools "Read,Edit,Write,Bash,Glob,Grep"
//
//   ...which in Node becomes:
//
//     spawn('claude', [
//       '-p', '--model', 'opus',
//       '--max-budget-usd', '5',
//       '--allowed-tools', 'Read,Edit,Write,Bash,Glob,Grep'
//     ], { cwd: projectSourceRoot, stdio: ['pipe','pipe','pipe'] });
//     proc.stdin.write(systemPrompt + '\n\n---\n\n' + userPrompt);
//     proc.stdin.end();
//
//   The existing sendMessage() below is per-project chat (continued context).
//   spawnClaudeCode for iteration_engine will be one-shot (no --continue),
//   which is why a new function rather than reuse is appropriate.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const CLAUDE_BIN = process.env.CLAUDE_CODE_BIN || 'claude';
const DATA_DIR = process.env.PROJECTS_DATA_DIR
  ? path.resolve(process.env.PROJECTS_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'chat_history');

const continuedProjects = new Set();
const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/;

function safeId(id) { return typeof id === 'string' && ID_RE.test(id); }

async function appendHistory(projectId, entry) {
  if (!safeId(projectId)) return;
  await fsp.mkdir(HISTORY_DIR, { recursive: true });
  const file = path.join(HISTORY_DIR, `${projectId}.jsonl`);
  const line = JSON.stringify({ ts: Date.now(), ...entry }) + '\n';
  await fsp.appendFile(file, line);
}

async function loadHistory(projectId, limit = 200) {
  if (!safeId(projectId)) return [];
  const file = path.join(HISTORY_DIR, `${projectId}.jsonl`);
  let raw;
  try { raw = await fsp.readFile(file, 'utf8'); }
  catch (_e) { return []; }
  const lines = raw.split('\n').filter(Boolean);
  const out = [];
  for (const ln of lines) {
    try { out.push(JSON.parse(ln)); } catch (_e) { /* skip bad line */ }
  }
  return limit > 0 ? out.slice(-limit) : out;
}

function sendMessage({ projectId, cwd, text, onChunk, onDone, onError }) {
  if (!safeId(projectId)) {
    onError(new Error('invalid project id'));
    return null;
  }
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    onError(new Error('invalid cwd'));
    return null;
  }
  // Claude Code happily accepts long stdin; cap at 200KB so workflow stage
  // builders that include prior-stage JSON + project context don't tip over.
  // Truncate-with-marker beats hard-reject so callers get a useful response
  // instead of a black hole at stage 3 of 9.
  if (typeof text !== 'string' || text.length === 0) {
    onError(new Error('invalid text'));
    return null;
  }
  const MAX_TEXT = 200000;
  if (text.length > MAX_TEXT) {
    text = text.slice(0, MAX_TEXT - 80) + '\n\n[... context truncated at 200 KB for subprocess input ...]';
  }

  const args = ['-p'];
  if (continuedProjects.has(projectId)) args.push('--continue');

  const env = {
    ...process.env,
    NO_COLOR: '1',
    FORCE_COLOR: '0',
    CI: '1'
  };

  let proc;
  try {
    proc = spawn(CLAUDE_BIN, args, { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    onError(e);
    return null;
  }

  let collected = '';
  let stderrBuf = '';

  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');

  proc.stdout.on('data', (chunk) => {
    collected += chunk;
    try { onChunk(chunk); } catch (_e) { /* listener error */ }
  });
  proc.stderr.on('data', (chunk) => { stderrBuf += chunk; });

  proc.on('error', (e) => {
    onError(e);
  });

  proc.on('close', async (code) => {
    try {
      await appendHistory(projectId, { role: 'user', content: text });
      await appendHistory(projectId, { role: 'assistant', content: collected, backend: 'claude', exit_code: code });
    } catch (_e) { /* history write is best-effort */ }
    if (code === 0) {
      continuedProjects.add(projectId);
      onDone({ exitCode: code });
    } else {
      onError(new Error(`claude exited ${code}: ${stderrBuf.slice(0, 500)}`));
    }
  });

  try {
    proc.stdin.write(text);
    proc.stdin.end();
  } catch (e) {
    onError(e);
  }

  return proc;
}

function resetSession(projectId) {
  continuedProjects.delete(projectId);
}

module.exports = {
  sendMessage,
  loadHistory,
  appendHistory,
  resetSession
};
