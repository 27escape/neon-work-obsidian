// Load a module's real source files in a sandbox with a tiny Obsidian stand-in and return the named top-level values.
import fs from 'node:fs';
import vm from 'node:vm';

const o = JSON.parse(fs.readFileSync(new URL('../tools/files.json', import.meta.url), 'utf8'));
class Stub {}
const moment = () => ({ format: () => '2026-01-01', subtract: () => ({ format: () => '2025-12-31' }) });
const obsidian = new Proxy({ moment, debounce: (f) => f, normalizePath: (p) => p }, { get: (t, k) => (k in t ? t[k] : Stub) });

/** id: module id, e.g. 'neon-write'. Loads the shared helpers plus that module's files. */
export function load(id, names) {
  const m = o.modules.find((x) => x.id === id);
  const code = [...o.shared, ...m.files].map((f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n') + `\n;({ ${names.join(', ')} })`;
  const require = (r) => {
    if (r === 'obsidian') return obsidian;
    throw new Error('no ' + r);
  };
  return vm.runInNewContext(code, { require, module: {}, window: {}, document: {}, console, setTimeout, clearTimeout });
}
