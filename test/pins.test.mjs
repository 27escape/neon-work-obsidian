import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const { parsePins, addPinLine, removePinLine, textPinLine } = load('neon-deck', ['parsePins', 'addPinLine', 'removePinLine', 'textPinLine']);

test('pin board: parse file and text pins, skip frontmatter and headings', () => {
  const note = '---\ntags: x\n---\n# Pins\n- [[Projects/Plan]]\n![[img.png]]\n* [[A|alias]]\ncall the bank\n\n- [[B#Part]]\n';
  const pins = parsePins(note).map((p) => p.link || 'T:' + p.text);
  assert.equal(pins.join('|'), 'Projects/Plan|img.png|A|T:call the bank|B'); // vm arrays: compare as text
});

test('pin board: add skips duplicates, remove takes the first match', () => {
  let t = addPinLine('', '- [[A]]');
  t = addPinLine(t, '- [[A]]');
  t = addPinLine(t, textPinLine('two\n lines'));
  assert.equal(t, '- [[A]]\n- two lines\n');
  assert.equal(addPinLine('hand edit', '- [[B]]'), 'hand edit\n- [[B]]\n');
  assert.equal(removePinLine('- x\n  - x  \n- y', '- x'), '  - x  \n- y');
  assert.equal(removePinLine('- y', '- x'), '- y');
});
