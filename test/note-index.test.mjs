// Fork: the shared note index answers the modules' questions and stays current from events.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load } from './load.mjs';

const I = load('neon-tasks', ['NoteIndex', 'NEON_PROJECTS']);
const plain = (x) => JSON.parse(JSON.stringify(x));

test('index: projects, open tasks, properties; updates, deletes and renames', () => {
  const md = (path) => ({ path, extension: 'md' });
  const files = [md('a.md'), md('P/b.md'), md('c.md')];
  const caches = {
    'a.md': { frontmatter: { tags: ['project'], status: 'init' } },
    'P/b.md': { frontmatter: { claude: 'process' }, listItems: [{ task: '/' }] },
    'c.md': { listItems: [{ task: 'x' }] },
  };
  let scans = 0;
  const app = { vault: { getMarkdownFiles: () => (scans++, files) }, metadataCache: { getFileCache: (f) => caches[f.path] } };
  I.NEON_PROJECTS.tag = 'project';
  const ix = new I.NoteIndex(app);
  const paths = (list) => plain(list.map((e) => e.file.path));
  assert.deepEqual(paths(ix.projects()), ['a.md']);
  assert.deepEqual(paths(ix.withOpenTasks()), ['P/b.md']);
  assert.deepEqual(paths(ix.withProperty('claude')), ['P/b.md']);
  assert.equal(scans, 1, 'one scan, then answers from the index');
  caches['c.md'] = { listItems: [{ task: ' ' }], frontmatter: { tags: 'project' } };
  ix.changed(files[2]);
  assert.deepEqual(paths(ix.withOpenTasks()), ['P/b.md', 'c.md']);
  assert.deepEqual(paths(ix.projects()), ['a.md', 'c.md']);
  ix.deleted({ path: 'P' });
  assert.deepEqual(paths(ix.withProperty('claude')), []);
  const moved = md('Z/a.md');
  caches['Z/a.md'] = caches['a.md'];
  ix.renamed(moved, 'a.md');
  assert.deepEqual(paths(ix.projects()), ['c.md', 'Z/a.md']);
  assert.equal(scans, 1);
});
