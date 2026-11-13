// Fork: the Claude card groups notes by their claude property.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const C = load('neon-deck', ['claudeGroups', 'claudeList']);

test('waiting and review groups, newest first; other values ignored', () => {
  const e = (name, value, mtime) => ({ file: { basename: name, stat: { mtime } }, value });
  const g = C.claudeGroups([e('a', 'process', 1), e('b', 'Updated', 5), e('c', 'refine', 3), e('d', 'ignore', 9), e('f', 'completed', 9)], C.claudeList('process, refine'), C.claudeList('updated'));
  assert.deepEqual(JSON.parse(JSON.stringify(g.waiting.map((x) => x.file.basename))), ['c', 'a']);
  assert.deepEqual(JSON.parse(JSON.stringify(g.review.map((x) => x.file.basename))), ['b']);
});
