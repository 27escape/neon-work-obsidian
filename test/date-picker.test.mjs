import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { showDatePicker } = load('neon-tickets', ['showDatePicker']);

test('date picker: the browser’s calendar where it has one, else the focus (phones open their own)', () => {
  const calls = [];
  const field = (extra) => Object.assign({ focus: () => calls.push('focus'), click: () => calls.push('click') }, extra);
  assert.equal(showDatePicker(field({ showPicker: () => calls.push('picker') })), true);
  assert.deepEqual(calls.splice(0), ['picker']);
  // showPicker refused (not allowed in this webview): the focus instead
  assert.equal(showDatePicker(field({ showPicker: () => { throw new Error('NotAllowedError'); } })), false);
  assert.deepEqual(calls.splice(0), ['focus', 'click']);
  // no showPicker at all (an older webview)
  assert.equal(showDatePicker(field({})), false);
  assert.deepEqual(calls.splice(0), ['focus', 'click']);
  // a disabled field, or none: nothing happens
  assert.equal(showDatePicker(field({ disabled: true, showPicker: () => calls.push('picker') })), false);
  assert.equal(showDatePicker(null), false);
  assert.deepEqual(calls, []);
});
