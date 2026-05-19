'use strict';

// Smoke test for sdk_smoketest.probe (the boot-probe service itself).
// Real PlaydateSimulator is rarely on a CI box, so we exercise the graceful-
// degrade paths + the pdx-missing path. End-to-end sim run is a manual
// verify in dev (set PLAYDATE_SDK_PATH).

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const smoketest = require('../server/services/sdk_smoketest');

test('probe returns ok=false when pdx path missing', async () => {
  const r = await smoketest.probe('/nope/does/not/exist.pdx', { skipIfMissing: true });
  assert.equal(r.ok, false);
  assert.equal(r.booted, false);
  assert.ok(r.errors.some((e) => e.startsWith('pdx_not_found:')));
});

test('probe degrades with skipIfMissing when simulator absent', async () => {
  // Create a real fake pdx dir so we get past the existsSync gate but no real sim.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smoketest-'));
  const pdx = path.join(tmp, 'fake.pdx');
  fs.mkdirSync(pdx);
  fs.writeFileSync(path.join(pdx, 'pdex.bin'), '');

  const r = await smoketest.probe(pdx, {
    skipIfMissing: true,
    simBin: '/this/binary/does/not/exist'
  });
  assert.equal(r.ok, true, 'skipIfMissing must return ok=true when sim absent');
  assert.equal(r.skipped, true);
  assert.equal(r.reason, 'no_simulator');
});

test('probe strict mode (skipIfMissing=false) returns ok=false when sim absent', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'smoketest-strict-'));
  const pdx = path.join(tmp, 'fake.pdx');
  fs.mkdirSync(pdx);
  fs.writeFileSync(path.join(pdx, 'pdex.bin'), '');

  const r = await smoketest.probe(pdx, {
    skipIfMissing: false,
    simBin: '/this/binary/does/not/exist'
  });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length > 0);
  assert.ok(r.errors[0].includes('no_simulator'));
});

test('probe report has the expected shape', async () => {
  const r = await smoketest.probe('/nope/missing.pdx', { skipIfMissing: false });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.booted, 'boolean');
  assert.equal(typeof r.duration_ms, 'number');
  assert.ok(Array.isArray(r.errors));
  assert.ok(Array.isArray(r.warnings));
  assert.equal(typeof r.frame_count, 'number');
  assert.ok(r.est_fps === null || typeof r.est_fps === 'number');
});

test('findSimulator returns null or a path', () => {
  const p = smoketest.findSimulator();
  assert.ok(p === null || typeof p === 'string');
});
