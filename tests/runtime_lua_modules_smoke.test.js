'use strict';

// runtime_lua_modules_smoke.test.js
//
// Text-grep validation for the four new runtime Lua concept modules and
// the updates to main.lua + sdk_prompt_assembly.js.
//
// No real Lua interpreter needed. All checks are string pattern assertions
// against the raw file content.
//
// Run: node tests/runtime_lua_modules_smoke.test.js

const fs = require('fs');
const path = require('path');

let failed = 0;
let passed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log('  ok ' + msg);
    passed++;
  } else {
    console.error('  FAIL ' + msg);
    failed++;
  }
}

const RUNTIME_LUA = path.join(__dirname, '..', 'server', 'services', 'sdk_runtime_lua');
const CONCEPTS    = path.join(RUNTIME_LUA, 'concepts');

function readLua(rel) {
  return fs.readFileSync(path.join(RUNTIME_LUA, rel), 'utf8');
}

// ---------------------------------------------------------------------------
// Helper: check that a Lua module follows the load-once pattern.
//   1. starts with `local M = {}`
//   2. ends with `_G.<name> = M\nreturn M`  (trailing newline optional)
//   3. exports every expected function via `function M.<fn>(` pattern
// ---------------------------------------------------------------------------
function checkModule(rel, globalName, expectedFns) {
  const label = rel;
  let src;
  try {
    src = readLua(rel);
  } catch (e) {
    assert(false, `${label}: file readable`);
    return;
  }
  assert(!!src, `${label}: file not empty`);

  // 1. Contains `local M = {}` as the module table declaration.
  // Files may open with a comment header block (established codebase convention)
  // before the local M declaration.
  assert(/^local M\s*=\s*\{\}/m.test(src), `${label}: declares 'local M = {}'`);

  // 2. Ends with _G.<name> = M  then  return M  (allow trailing whitespace/newlines)
  const tailPattern = new RegExp(
    '_G\\.' + globalName + '\\s*=\\s*M\\s*\\nreturn M\\s*$'
  );
  assert(tailPattern.test(src), `${label}: ends with '_G.${globalName} = M\\nreturn M'`);

  // 3. Each expected API function is present as `function M.<fn>(`
  for (const fn of expectedFns) {
    const fnPat = new RegExp('function M\\.' + fn + '\\s*\\(');
    assert(fnPat.test(src), `${label}: exports M.${fn}()`);
  }
}

// ---------------------------------------------------------------------------
// inventory.lua
// ---------------------------------------------------------------------------
console.log('# concepts/inventory.lua');
checkModule('concepts/inventory.lua', 'inventory', [
  'add',
  'remove',
  'has',
  'count',
  'list',
  'clear',
]);

// Additional contracts.
const invSrc = readLua('concepts/inventory.lua');
assert(
  /save_state\.get\s*\(/.test(invSrc),
  'inventory: reads through save_state.get()'
);
assert(
  /save_state\.set\s*\(/.test(invSrc),
  'inventory: writes through save_state.set()'
);

// ---------------------------------------------------------------------------
// collision.lua
// ---------------------------------------------------------------------------
console.log('# concepts/collision.lua');
checkModule('concepts/collision.lua', 'collision', [
  'rectsOverlap',
  'spriteHit',
  'queryAt',
  'queryRect',
  'lineOfSight',
]);

const colSrc = readLua('concepts/collision.lua');
assert(
  /gfx\.sprite\.getAllSprites\s*\(/.test(colSrc),
  'collision: uses gfx.sprite.getAllSprites()'
);
assert(
  /getBounds\s*\(/.test(colSrc),
  'collision: uses sprite:getBounds()'
);

// ---------------------------------------------------------------------------
// interaction.lua
// ---------------------------------------------------------------------------
console.log('# concepts/interaction.lua');
checkModule('concepts/interaction.lua', 'interaction', [
  'register',
  'dispatch',
  'verbsFor',
]);

const interSrc = readLua('concepts/interaction.lua');

// Canonical verbs must be declared.
const canonVerbs = ['use', 'inspect', 'take', 'talk', 'give'];
for (const v of canonVerbs) {
  assert(
    interSrc.includes("'" + v + "'") || interSrc.includes('"' + v + '"'),
    `interaction: canonical verb '${v}' present`
  );
}

// Handler must be called via pcall for safety.
assert(/pcall\s*\(handler/.test(interSrc), 'interaction: dispatch wraps handler in pcall');

// ---------------------------------------------------------------------------
// debug_overlay.lua
// ---------------------------------------------------------------------------
console.log('# concepts/debug_overlay.lua');
checkModule('concepts/debug_overlay.lua', 'debug_overlay', [
  'toggle',
  'draw',
  'addLine',
  'fps',
]);

const dbgSrc = readLua('concepts/debug_overlay.lua');
assert(
  /playdate\.getStats\s*\(/.test(dbgSrc),
  'debug_overlay: calls playdate.getStats()'
);
assert(
  /playdate\.addMenuItem\s*\(/.test(dbgSrc),
  'debug_overlay: registers system menu item'
);
assert(
  /gfx\.sprite\.update\s*\(\)/.test(dbgSrc)
    || /after gfx\.sprite\.update/.test(dbgSrc)
    || /AFTER.*gfx\.sprite\.update/.test(dbgSrc)
    || /after gfx.sprite.update/.test(dbgSrc),
  'debug_overlay: mentions gfx.sprite.update() ordering in comment'
);
// FPS measurement present.
assert(
  /getCurrentTimeMilliseconds/.test(dbgSrc),
  'debug_overlay: FPS measured via getCurrentTimeMilliseconds'
);

// ---------------------------------------------------------------------------
// main.lua — new imports + debug_overlay.draw()
// ---------------------------------------------------------------------------
console.log('# sdk_runtime_lua/main.lua');
const mainSrc = readLua('main.lua');

const newImports = [
  'concepts/inventory',
  'concepts/collision',
  'concepts/interaction',
  'concepts/debug_overlay',
];
for (const mod of newImports) {
  assert(
    mainSrc.includes('import "' + mod + '"'),
    `main.lua: imports ${mod}`
  );
}

// Import order: save_state before inventory; debug_overlay after interaction.
const invIdx   = mainSrc.indexOf('concepts/inventory');
const colIdx   = mainSrc.indexOf('concepts/collision');
const interIdx = mainSrc.indexOf('concepts/interaction');
const dbgIdx   = mainSrc.indexOf('concepts/debug_overlay');
const ssIdx    = mainSrc.indexOf('runtime/save_state');

assert(ssIdx < invIdx,    'main.lua: save_state imported before inventory');
assert(invIdx < colIdx,   'main.lua: inventory imported before collision');
assert(colIdx < interIdx, 'main.lua: collision imported before interaction');
assert(interIdx < dbgIdx, 'main.lua: interaction imported before debug_overlay');

// debug_overlay.draw() called after gfx.sprite.update().
const spriteUpdateIdx    = mainSrc.indexOf('gfx.sprite.update()');
const debugDrawIdx       = mainSrc.indexOf('debug_overlay.draw()');
assert(spriteUpdateIdx !== -1, 'main.lua: gfx.sprite.update() present');
assert(debugDrawIdx !== -1,    'main.lua: debug_overlay.draw() present');
assert(
  spriteUpdateIdx < debugDrawIdx,
  'main.lua: debug_overlay.draw() called AFTER gfx.sprite.update()'
);

// ---------------------------------------------------------------------------
// sdk_prompt_assembly.js — globals note
// ---------------------------------------------------------------------------
console.log('# sdk_prompt_assembly.js globals note');
const assemblyPath = path.join(
  __dirname, '..', 'server', 'services', 'sdk_prompt_assembly.js'
);
const assemblySrc = fs.readFileSync(assemblyPath, 'utf8');

const requiredGlobals = [
  'scene_manager',
  'save_state',
  'sprite_base',
  'input',
  'animation',
  'audio_manager',
  'inventory',
  'collision',
  'interaction',
  'debug_overlay',
];
for (const g of requiredGlobals) {
  assert(
    assemblySrc.includes(g),
    `sdk_prompt_assembly: mentions global '${g}'`
  );
}

// Must explicitly warn against local import of concepts.
assert(
  /NEVER.*local.*import/.test(assemblySrc) || /NEVER write.*local.*import/.test(assemblySrc),
  'sdk_prompt_assembly: warns against `local foo = import` pattern'
);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('');
console.log(`# results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
