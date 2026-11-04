// Load a plugin's real source files in a sandbox with a tiny Obsidian stand-in and return the named top-level values.
import fs from 'node:fs';
import vm from 'node:vm';

const order = JSON.parse(fs.readFileSync(new URL('../tools/files.json', import.meta.url), 'utf8'));
class Stub {}
const moment = () => ({ format: () => '2026-01-01' });
const obsidian = new Proxy({ moment, debounce: (f) => f, normalizePath: (p) => p }, { get: (o, k) => (k in o ? o[k] : Stub) });

export function load(plugin, names) {
  const files = order[plugin].files.filter((f) => !f.endsWith('/exports.js'));
  const code = files.map((f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')).join('\n') + `\n;({ ${names.join(', ')} })`;
  return vm.runInNewContext(code, { require: (m) => { if (m === 'obsidian') return obsidian; throw new Error('no ' + m); }, module: {}, window: {}, document: {}, console, setTimeout, clearTimeout });
}
