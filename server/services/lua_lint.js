'use strict';

// lua_lint.js — Phase 6 B10
//
// Regex-light Lua linter that enforces 23 Studios SKILL.md rules without
// shelling out to a full Lua parser. Returns an array of findings:
//   { line, col, severity, rule, message, autofix? }
//
// SKILL.md rule coverage:
//   #2  400x240 viewport (no other display constants)
//   #6  playdate.display.setRefreshRate(30)
//   #8  imagetable filename pattern: name-table-W-H.png
//   #9  no runtime rotate/scale on sprites (drawScaled/drawRotated)
//   #11 crank + B handoff convention (warn if crank read without B map)
//   #12 A confirms, B cancels (warn if reversed)
//   #14 sprite system used (sprite.add / sprite.update present)
//   bootstrap: _G.<name> = M (when module table M present)
//   mandatory calls: playdate.update, sprite.update, timer.updateTimers
//
// CLI: node server/services/lua_lint.js path/to/file.lua

const fs = require('fs');
const path = require('path');

const SEV_ERROR = 'error';
const SEV_WARN = 'warn';

function newFinding(line, col, severity, rule, message, autofix) {
  const f = { line, col, severity, rule, message };
  if (autofix) f.autofix = autofix;
  return f;
}

// Walk file once for line/col mapping. Each finding uses 1-based line/col.
function lines(txt) { return txt.split(/\r?\n/); }

function ruleViewport(text, ls, out) {
  // Rule #2: only 400x240 should appear as a screen-size pair.
  // Treat any explicit 320x240 / 480x320 / 800x480 etc. as a violation.
  const bad = /\b(320|480|800|512|256)\s*[,xX]\s*(240|320|480|192)\b/;
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(bad);
    if (m) {
      const w = Number(m[1]), h = Number(m[2]);
      if (!(w === 400 && h === 240)) {
        out.push(newFinding(i + 1, m.index + 1, SEV_ERROR, 'skill#2',
          `non-Playdate viewport ${w}x${h} — only 400x240 is supported`));
      }
    }
  }
}

function ruleRefreshRate(text, ls, out) {
  // Rule #6: must call playdate.display.setRefreshRate(30).
  const hasCall = /playdate\.display\.setRefreshRate\s*\(\s*30\s*\)/.test(text);
  const hasOther = /playdate\.display\.setRefreshRate\s*\(\s*(?!30\b)\d+\s*\)/;
  if (!hasCall) {
    out.push(newFinding(1, 1, SEV_ERROR, 'skill#6',
      'missing playdate.display.setRefreshRate(30) — add to game init',
      'playdate.display.setRefreshRate(30)'));
  }
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(hasOther);
    if (m) {
      out.push(newFinding(i + 1, m.index + 1, SEV_ERROR, 'skill#6',
        'setRefreshRate must be exactly 30 on Playdate hardware'));
    }
  }
}

function ruleImagetableNaming(text, ls, out) {
  // Rule #8: imagetable files named name-table-W-H.png.
  // Detect playdate.graphics.imagetable.new("…") calls + flag bad paths.
  const re = /playdate\.graphics\.imagetable\.new\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (let i = 0; i < ls.length; i++) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(ls[i])) !== null) {
      const arg = m[1];
      // Match either explicit "name-table-W-H" or "name-table-WxH"
      const ok = /-table-\d+-\d+(?:\.png)?$/.test(arg) ||
                 /-table-\d+x\d+(?:\.png)?$/.test(arg);
      if (!ok) {
        out.push(newFinding(i + 1, m.index + 1, SEV_ERROR, 'skill#8',
          `imagetable filename "${arg}" must match name-table-W-H.png`));
      }
    }
  }
}

function ruleNoRuntimeTransform(text, ls, out) {
  // Rule #9: no rotate/scale on sprites at runtime.
  // Flag drawRotated, drawScaled, setRotation (with non-zero literal),
  // setScale (with literal != 1).
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    let m;
    if ((m = l.match(/\b(drawRotated|drawScaled)\b/))) {
      out.push(newFinding(i + 1, m.index + 1, SEV_WARN, 'skill#9',
        `${m[1]} costs frame budget — pre-render rotated/scaled imagetables`));
    }
    if ((m = l.match(/setRotation\s*\(\s*([0-9.+\-]+)/))) {
      if (Number(m[1]) !== 0) {
        out.push(newFinding(i + 1, m.index + 1, SEV_WARN, 'skill#9',
          'setRotation at runtime — bake rotated frames into an imagetable'));
      }
    }
    if ((m = l.match(/setScale\s*\(\s*([0-9.+\-]+)/))) {
      if (Number(m[1]) !== 1) {
        out.push(newFinding(i + 1, m.index + 1, SEV_WARN, 'skill#9',
          'setScale at runtime — pre-render scaled frames'));
      }
    }
  }
}

function ruleCrankWithB(text, ls, out) {
  // Rule #11: any crank read needs a B-button fallback handler.
  const usesCrank = /playdate\.(getCrankPosition|getCrankChange|isCrankDocked)/.test(text);
  if (!usesCrank) return;
  const hasB = /(playdate\.buttonIsPressed|playdate\.buttonJustPressed|BButtonDown|playdate\.kButtonB)/.test(text);
  if (!hasB) {
    out.push(newFinding(1, 1, SEV_WARN, 'skill#11',
      'crank used without a B-button fallback — pair crank input with B handoff'));
  }
}

function ruleAcceptCancel(text, ls, out) {
  // Rule #12: A confirms, B cancels. Trip if comments say the opposite.
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (/\bB\b.*confirm|\bA\b.*cancel/i.test(l) &&
        !/A confirms|B cancels/i.test(l)) {
      out.push(newFinding(i + 1, 1, SEV_WARN, 'skill#12',
        'A confirms, B cancels — check button semantics'));
    }
  }
}

function ruleSpriteSystem(text, ls, out) {
  // Rule #14: code must use the sprite system (gfx.sprite.update + adds).
  const hasUpdate = /playdate\.graphics\.sprite\.update\s*\(/.test(text)
                 || /\bgfx\.sprite\.update\s*\(/.test(text);
  const hasAdd = /:add\s*\(\s*\)|sprite\.new\s*\(|\bgfx\.sprite\.new\s*\(/.test(text);
  if (!hasUpdate && hasAdd) {
    out.push(newFinding(1, 1, SEV_ERROR, 'skill#14',
      'sprites created but playdate.graphics.sprite.update() never called'));
  }
}

function ruleMandatoryCalls(text, ls, out) {
  // Each scene-loop file should call playdate.update, sprite.update, timer.updateTimers.
  const needsLoop = /function\s+playdate\.update\s*\(/.test(text);
  if (!needsLoop) {
    out.push(newFinding(1, 1, SEV_ERROR, 'mandatory',
      'missing function playdate.update() — needed for every Playdate scene'));
    return;
  }
  const hasTimers = /playdate\.timer\.updateTimers\s*\(/.test(text);
  if (!hasTimers) {
    out.push(newFinding(1, 1, SEV_WARN, 'mandatory',
      'playdate.timer.updateTimers() not called — animations + timers will stall'));
  }
}

function ruleBootstrap(text, ls, out) {
  // Bootstrap: if file defines `local M = {}` it must expose `_G.<name> = M`.
  const m = text.match(/local\s+([A-Z_][A-Za-z0-9_]*)\s*=\s*\{\s*\}/);
  if (!m) return;
  const name = m[1];
  // Accept either `_G.<name> = M` or `_G[<name>] = M`.
  const re = new RegExp(`_G\\.${name}\\s*=\\s*${name}|_G\\[['"]${name}['"]\\]\\s*=\\s*${name}`);
  if (!re.test(text)) {
    out.push(newFinding(1, 1, SEV_WARN, 'bootstrap',
      `module ${name} defined locally but not exposed via _G.${name} = ${name}`,
      `_G.${name} = ${name}`));
  }
}

const RULES = [
  ruleViewport,
  ruleRefreshRate,
  ruleImagetableNaming,
  ruleNoRuntimeTransform,
  ruleCrankWithB,
  ruleAcceptCancel,
  ruleSpriteSystem,
  ruleMandatoryCalls,
  ruleBootstrap
];

function lint(lua, _skillPath) {
  const text = typeof lua === 'string' ? lua : String(lua || '');
  const ls = lines(text);
  const findings = [];
  for (const r of RULES) {
    try { r(text, ls, findings); } catch (_e) { /* don't crash entire lint on one rule */ }
  }
  // Stable sort: line, col, rule.
  findings.sort((a, b) => a.line - b.line || a.col - b.col ||
                          a.rule.localeCompare(b.rule));
  return findings;
}

function summarize(findings) {
  return {
    errors: findings.filter((f) => f.severity === SEV_ERROR).length,
    warnings: findings.filter((f) => f.severity === SEV_WARN).length,
    total: findings.length
  };
}

module.exports = { lint, summarize, SEV_ERROR, SEV_WARN };

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('usage: node server/services/lua_lint.js <file.lua> [file2.lua ...]');
    process.exit(2);
  }
  let totalErrors = 0;
  for (const f of args) {
    if (!fs.existsSync(f)) {
      console.error(`${f}: not found`);
      totalErrors++; continue;
    }
    const txt = fs.readFileSync(f, 'utf8');
    const findings = lint(txt, null);
    const s = summarize(findings);
    console.log(`# ${path.relative(process.cwd(), f)}  errors=${s.errors}  warnings=${s.warnings}`);
    for (const fd of findings) {
      console.log(`  ${fd.line}:${fd.col}  [${fd.severity}]  ${fd.rule}  ${fd.message}`);
      if (fd.autofix) console.log(`    autofix: ${fd.autofix}`);
    }
    totalErrors += s.errors;
  }
  process.exit(totalErrors > 0 ? 1 : 0);
}
