'use strict';

// sim_integration_smoke.test.js — Phase 6 B7
//
// Exercises sdk_preview without spawning Xvfb/sim (we don't ship those in
// CI). Asserts the module exports the new surface (recordSession) and that
// mapKey() still resolves every input action SimPanel sends.
//
// Run: node tests/sim_integration_smoke.test.js

let failed = 0;
function assert(c, m) { if (c) console.log('  ok ' + m); else { console.error('  FAIL ' + m); failed++; } }

const sdkPreview = require('../server/services/sdk_preview');

console.log('# sdk_preview surface');
assert(typeof sdkPreview.start === 'function', 'start exported');
assert(typeof sdkPreview.stop === 'function', 'stop exported');
assert(typeof sdkPreview.get === 'function', 'get exported');
assert(typeof sdkPreview.mapKey === 'function', 'mapKey exported');
assert(typeof sdkPreview.recordSession === 'function', 'recordSession exported (B7)');
assert(typeof sdkPreview.findSimulator === 'function', 'findSimulator exported');

console.log('# input action map (SimPanel contract)');
for (const a of ['up', 'down', 'left', 'right', 'a', 'b', 'crank_cw', 'crank_ccw', 'dock']) {
  assert(typeof sdkPreview.mapKey(a) === 'string', `mapKey(${a}) -> string`);
}
assert(sdkPreview.mapKey('garbage') === null, 'unknown action -> null');

console.log('# recordSession refuses when no preview is running');
(async () => {
  let caught = null;
  try { await sdkPreview.recordSession({ projectId: 'nope-' + Date.now(), durationS: 1 }); }
  catch (e) { caught = e; }
  assert(caught && caught.message === 'preview_not_running', 'recordSession throws preview_not_running');

  if (failed) { console.error(`\n${failed} test(s) failed`); process.exit(1); }
  console.log('\nall ok');
})();
