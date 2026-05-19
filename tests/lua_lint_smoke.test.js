'use strict';

// lua_lint_smoke.test.js — Phase 6 B10
//
// Asserts each SKILL.md rule trips on a violating snippet and stays clean
// on a compliant one. Also covers the bootstrap + mandatory-call checks.
//
// Run: node tests/lua_lint_smoke.test.js

const lint = require('../server/services/lua_lint');

let failed = 0;
function assert(c, m) { if (c) console.log('  ok ' + m); else { console.error('  FAIL ' + m); failed++; } }

function hasRule(findings, rule) { return findings.some((f) => f.rule === rule); }

console.log('# rule #2 viewport');
const v1 = lint.lint('local w, h = 320, 240');
assert(hasRule(v1, 'skill#2'), '320x240 trips skill#2');
const v2 = lint.lint('local w, h = 400, 240');
assert(!hasRule(v2, 'skill#2'), '400x240 passes skill#2');

console.log('# rule #6 setRefreshRate');
const r1 = lint.lint('-- nothing');
assert(hasRule(r1, 'skill#6'), 'missing setRefreshRate trips skill#6');
const r2 = lint.lint('playdate.display.setRefreshRate(30)\nfunction playdate.update() end');
assert(!hasRule(r2, 'skill#6'), 'setRefreshRate(30) passes');
const r3 = lint.lint('playdate.display.setRefreshRate(50)\nfunction playdate.update() end');
assert(hasRule(r3, 'skill#6'), 'setRefreshRate(50) trips');

console.log('# rule #8 imagetable naming');
const i1 = lint.lint('local t = playdate.graphics.imagetable.new("foo")');
assert(hasRule(i1, 'skill#8'), 'bad name trips skill#8');
const i2 = lint.lint('local t = playdate.graphics.imagetable.new("foo-table-32-32")');
assert(!hasRule(i2, 'skill#8'), 'name-table-W-H passes skill#8');

console.log('# rule #9 no runtime transform');
const t1 = lint.lint('sprite:setRotation(45)');
assert(hasRule(t1, 'skill#9'), 'setRotation(45) trips skill#9');
const t2 = lint.lint('sprite:setRotation(0)');
assert(!hasRule(t2, 'skill#9'), 'setRotation(0) passes');
const t3 = lint.lint('img:drawScaled(0,0,2)');
assert(hasRule(t3, 'skill#9'), 'drawScaled trips');

console.log('# rule #11 crank requires B');
const c1 = lint.lint('local p = playdate.getCrankPosition()');
assert(hasRule(c1, 'skill#11'), 'crank without B trips skill#11');
const c2 = lint.lint('local p = playdate.getCrankPosition()\nif playdate.buttonIsPressed(playdate.kButtonB) then end');
assert(!hasRule(c2, 'skill#11'), 'crank with B passes');

console.log('# rule #14 sprite system');
const s1 = lint.lint('local s = playdate.graphics.sprite.new(img)\ns:add()');
assert(hasRule(s1, 'skill#14'), 'sprites without update() trip skill#14');

console.log('# mandatory calls');
const m1 = lint.lint('playdate.display.setRefreshRate(30)');
assert(hasRule(m1, 'mandatory'), 'no playdate.update trips mandatory');

console.log('# bootstrap');
const b1 = lint.lint('local M = {}\nfunction playdate.update() end\nplaydate.display.setRefreshRate(30)\nplaydate.timer.updateTimers()');
assert(hasRule(b1, 'bootstrap'), 'local M without _G.M trips bootstrap');
const b2 = lint.lint('local M = {}\n_G.M = M\nfunction playdate.update() end\nplaydate.display.setRefreshRate(30)\nplaydate.timer.updateTimers()');
assert(!hasRule(b2, 'bootstrap'), '_G.M = M passes bootstrap');

console.log('# clean baseline');
const clean = `
local M = {}
playdate.display.setRefreshRate(30)
local t = playdate.graphics.imagetable.new("hero-table-32-32")
function playdate.update()
  playdate.graphics.sprite.update()
  playdate.timer.updateTimers()
end
_G.M = M
`;
const cf = lint.lint(clean);
const s = lint.summarize(cf);
assert(s.errors === 0, `clean snippet has 0 errors (got ${s.errors})`);

if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
console.log('\nall ok');
