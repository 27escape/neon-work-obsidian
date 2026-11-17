// Fork: the in-app help is cut from the README at build time; pictures become links to GitHub.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { helpSections, helpLinks, helpAnchor, HELP_TOPICS } from '../tools/help.mjs';

const base = 'https://github.com/27escape/neon-work-obsidian/blob/1.4.0';

test('help: every topic is found in the README, with its GitHub link', () => {
  const s = helpSections(fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8'), base);
  for (const [key] of HELP_TOPICS) assert.ok(s[key] && s[key].md.length > 40, key);
  assert.equal(s.planning.url, `${base}/README.md#planning`);
  assert.equal(s.mobile.url, `${base}/README.md#on-phones-and-tablets`);
  assert.match(s.overview.md, /Read-only by default/);
  assert.doesNotMatch(s.overview.md, /### Dashboard/); // the overview stops at the first part
  assert.doesNotMatch(s.dashboard.md, /### Tasks/);
  assert.match(s.planning.md, /\[🖼 Picture: [^\]]+\]\(https:\/\/github\.com\/27escape\/neon-work-obsidian\/blob\/1\.4\.0\/docs\/screenshots\/planning-gantt\.png\)/);
  for (const [key] of HELP_TOPICS) assert.doesNotMatch(s[key].md, /!\[/, `${key}: no image is loaded`);
});

test('help: relative links and anchors point at GitHub; web links are kept', () => {
  assert.equal(helpLinks('See [notes](docs/release-notes/1.4.0.md) and [settings](#settings).', base), `See [notes](${base}/docs/release-notes/1.4.0.md) and [settings](${base}/README.md#settings).`);
  assert.equal(helpLinks('[Neon Deck](https://github.com/Yobzs/neon-deck-obsidian)', base), '[Neon Deck](https://github.com/Yobzs/neon-deck-obsidian)');
  assert.equal(helpAnchor('On phones and tablets'), 'on-phones-and-tablets');
});
