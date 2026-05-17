'use strict';

// PulpScript -> Lua transpiler test suite.
//
// For every <name>.pulp under fixtures/pulpscript/ (excluding errors/), compares
// transpile(source).lua against the sibling <name>.expected.lua after
// whitespace normalization. For every <name>.pulp under errors/, asserts that
// parseOnly(source).errors matches the <name>.expected.errors.json file as a
// subset (each expected entry must find one actual error with a substring
// match on `message`, and matching `line` if specified).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { transpile, parseOnly } = require('../services/pulp_transpiler');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'pulpscript');
const ERROR_DIR = path.join(FIXTURE_DIR, 'errors');

function normalize(text) {
  return String(text)
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line.length > 0)
    .join('\n');
}

function firstDiffLines(actual, expected, count) {
  const a = actual.split('\n');
  const e = expected.split('\n');
  const max = Math.max(a.length, e.length);
  const diffs = [];
  for (let i = 0; i < max && diffs.length < count; i++) {
    if (a[i] !== e[i]) {
      diffs.push(`line ${i + 1}:\n  actual:   ${JSON.stringify(a[i])}\n  expected: ${JSON.stringify(e[i])}`);
    }
  }
  return diffs;
}

function listPulpFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.pulp'))
    .sort();
}

// --- Codegen fixtures -------------------------------------------------------

const codegenFixtures = listPulpFiles(FIXTURE_DIR);

for (const file of codegenFixtures) {
  const base = file.replace(/\.pulp$/, '');
  const pulpPath = path.join(FIXTURE_DIR, file);
  const expectedPath = path.join(FIXTURE_DIR, `${base}.expected.lua`);

  test(`codegen: ${base}`, () => {
    const src = fs.readFileSync(pulpPath, 'utf8');
    const expected = fs.readFileSync(expectedPath, 'utf8');
    const result = transpile(src);
    const actualN = normalize(result.lua);
    const expectedN = normalize(expected);
    if (actualN !== expectedN) {
      const diffs = firstDiffLines(actualN, expectedN, 5);
      assert.fail(`Lua output mismatch for ${file}:\n${diffs.join('\n')}`);
    }
  });
}

// --- Error fixtures ---------------------------------------------------------

const errorFixtures = listPulpFiles(ERROR_DIR);

for (const file of errorFixtures) {
  const base = file.replace(/\.pulp$/, '');
  const pulpPath = path.join(ERROR_DIR, file);
  const expectedPath = path.join(ERROR_DIR, `${base}.expected.errors.json`);

  test(`errors: ${base}`, () => {
    const src = fs.readFileSync(pulpPath, 'utf8');
    const expected = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
    const { errors } = parseOnly(src);
    assert.ok(Array.isArray(errors), 'parseOnly must return errors array');
    assert.ok(errors.length > 0, `expected ${file} to produce at least one parse error, got 0`);
    for (const want of expected) {
      const match = errors.find((e) => {
        const msgOk = typeof want.message === 'string'
          ? String(e.message || '').includes(want.message)
          : true;
        const lineOk = typeof want.line === 'number' ? e.line === want.line : true;
        return msgOk && lineOk;
      });
      if (!match) {
        const dump = errors.map((e) => `  - line ${e.line} col ${e.col}: ${e.message}`).join('\n');
        assert.fail(`No error matched ${JSON.stringify(want)} in ${file}.\nActual errors:\n${dump}`);
      }
    }
  });
}
