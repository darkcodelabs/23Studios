'use strict';

// grounding_guard.test.js — Phase 6 C4 backend tests.

const test = require('node:test');
const assert = require('node:assert');

const guard = require('../services/grounding_guard');

test('assertGrounded accepts a prompt with at least one anchor_refs entry', () => {
  const out = guard.assertGrounded({
    prompt_body: 'A 1-bit bedroom scene at 400×240, Atkinson dither.',
    anchor_refs: ['hakcd_pixel_collection/bedroom.png']
  });
  assert.strictEqual(out.no_anchor, false);
  assert.deepStrictEqual(out.anchor_refs, ['hakcd_pixel_collection/bedroom.png']);
});

test('assertGrounded throws when neither anchor_refs nor no_anchor set', () => {
  assert.throws(
    () => guard.assertGrounded({ prompt_body: 'a scene' }),
    { code: 'ungrounded', status: 409 }
  );
});

test('assertGrounded throws when anchor_refs is empty', () => {
  assert.throws(
    () => guard.assertGrounded({ prompt_body: 'a scene', anchor_refs: [] }),
    { code: 'ungrounded', status: 409 }
  );
});

test('no_anchor:true requires rationale >= 8 chars', () => {
  assert.throws(
    () => guard.assertGrounded({ prompt_body: 'a scene', no_anchor: true }),
    { code: 'ungrounded_no_rationale', status: 409 }
  );
  assert.throws(
    () => guard.assertGrounded({ prompt_body: 'a scene', no_anchor: true, rationale: 'short' }),
    { code: 'ungrounded_no_rationale' }
  );
  const ok = guard.assertGrounded({
    prompt_body: 'a scene',
    no_anchor: true,
    rationale: 'no anchor exists for this telco scene'
  });
  assert.strictEqual(ok.no_anchor, true);
  assert.ok(ok.rationale.startsWith('no anchor'));
});

test('assertGrounded dedupes + caps + sanitizes anchor_refs', () => {
  const refs = ['a.png', 'a.png', 'b.png', '', null, 123, 'b.png'];
  const out = guard.assertGrounded({ prompt_body: 'x', anchor_refs: refs });
  assert.deepStrictEqual(out.anchor_refs, ['a.png', 'b.png']);
});

test('assertGrounded rejects refs with control chars', () => {
  assert.throws(
    () => guard.assertGrounded({ prompt_body: 'x', anchor_refs: ['ok.png\nbad'] }),
    { code: 'ungrounded' } // sanitization drops bad refs → empty list → ungrounded
  );
});

test('assertGrounded enforces MAX_REFS cap', () => {
  const refs = [];
  for (let i = 0; i < 100; i++) refs.push(`r${i}.png`);
  const out = guard.assertGrounded({ prompt_body: 'x', anchor_refs: refs });
  assert.strictEqual(out.anchor_refs.length, guard.MAX_REFS);
});

test('error message surfaces scene_id + stage context when provided', () => {
  try {
    guard.assertGrounded({ prompt_body: 'x', scene_id: 'SC18', stage: 'scene_bursts' });
    assert.fail('should have thrown');
  } catch (e) {
    assert.strictEqual(e.code, 'ungrounded');
    assert.ok(e.message.includes('SC18'));
    assert.ok(e.message.includes('scene_bursts'));
  }
});

test('checkGrounded returns { ok:true } shape', () => {
  const out = guard.checkGrounded({
    prompt_body: 'x',
    anchor_refs: ['a.png']
  });
  assert.strictEqual(out.ok, true);
  assert.deepStrictEqual(out.anchor_refs, ['a.png']);
});

test('checkGrounded returns { ok:false, error_code } on failure (no throw)', () => {
  const out = guard.checkGrounded({ prompt_body: 'x' });
  assert.strictEqual(out.ok, false);
  assert.strictEqual(out.error_code, 'ungrounded');
  assert.ok(typeof out.error === 'string');
});

test('composeGroundedPromptBody appends anchor preamble', () => {
  const body = guard.composeGroundedPromptBody({
    prompt_body: 'A scene.',
    anchor_refs: ['assets/x.png', 'assets/y.png']
  });
  assert.ok(body.startsWith('A scene.'));
  assert.ok(body.includes('Anchor references'));
  assert.ok(body.includes('anchor: assets/x.png'));
  assert.ok(body.includes('anchor: assets/y.png'));
});

test('composeGroundedPromptBody emits no-anchor rationale block when override set', () => {
  const body = guard.composeGroundedPromptBody({
    prompt_body: 'A scene.',
    no_anchor: true,
    rationale: 'closest analog is the lockpicking pair; derive from GLOBAL_STYLE master'
  });
  assert.ok(body.includes('No anchor available'));
  assert.ok(body.includes('lockpicking'));
});

test('isSceneUnanchored heuristic', () => {
  assert.strictEqual(guard.isSceneUnanchored({}), true);
  assert.strictEqual(guard.isSceneUnanchored(null), true);
  assert.strictEqual(guard.isSceneUnanchored({ anchor_refs: [] }), true);
  assert.strictEqual(guard.isSceneUnanchored({ anchor_refs: ['x.png'] }), false);
  assert.strictEqual(guard.isSceneUnanchored({ no_anchor: true }), false);
});

test('assertGrounded with bad input shape throws bad_request', () => {
  assert.throws(() => guard.assertGrounded(null), { code: 'bad_request' });
  assert.throws(() => guard.assertGrounded('a string'), { code: 'bad_request' });
});
