import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { planGraphState } = load('neon-tickets', ['planGraphState']);

test('graph layout: the old Fit / Full size choice is dropped from saved tabs', () => {
  assert.deepEqual({ ...planGraphState({ dir: 'LR', phases: true, fit: true }) }, { dir: 'LR', phases: true });
  assert.deepEqual({ ...planGraphState({ fit: false }) }, { dir: 'TB', phases: false });
});

test('graph layout: odd saved values fall back to Down without phases', () => {
  assert.deepEqual({ ...planGraphState({ dir: 'sideways', phases: 'yes' }) }, { dir: 'TB', phases: false });
  assert.deepEqual({ ...planGraphState(null) }, { dir: 'TB', phases: false });
});
