// Build: join src/ files (order in tools/files.json) into main.js files. No dependencies.
// node tools/build.mjs [--out <dir>] [--verify] [--only <target>]
//   1.x targets (neon-deck, neon-tasks, …): one plugin each, written to <out>/<plugin>/main.js
//   bundle target (neon-deck-2): one plugin; each module wrapped in its own scope, plus the kernel
//   --verify  compare 1.x output with the main.js already there (marker lines ignored)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process'; // build tool only, never in the plugin

const args = process.argv.slice(2);
const opt = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : null);
const out = opt('--out') || '.';
const only = opt('--only');
const verify = args.includes('--verify');
const order = JSON.parse(fs.readFileSync('tools/files.json', 'utf8'));
const MARK = /^\/\* @src .* \*\/$/; // one marker line per source file, so a line in main.js leads back to its file
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\n$/, '');
const part = (f) => `/* @src ${f} */\n${read(f)}`;
const check = (f) => execFileSync(process.execPath, ['--check', f]);
let bad = 0;

for (const [target, o] of Object.entries(order)) {
  if (only && target !== only) continue;
  if (o.bundle) {
    bundle(target, o);
    continue;
  }
  const js = [read(o.header), ...o.files.map(part)].join('\n') + '\n';
  const file = path.join(out, target, 'main.js');
  if (verify) {
    const strip = (s) => s.split('\n').filter((l) => !MARK.test(l)).join('\n').replace(/\n+$/, '');
    const same = strip(js) === strip(fs.readFileSync(file, 'utf8'));
    if (!same) bad++;
    console.log(`${same ? 'same' : 'DIFF'}  ${target}`);
    continue;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, js);
  check(file);
  console.log(`built ${file} (${js.split('\n').length} lines)`);
}

function bundle(target, o) {
  const dir = o.out;
  const manifest = JSON.parse(fs.readFileSync(o.manifest, 'utf8'));
  const shared = order[o.modules[0].plugin].files[0];
  const js = [read(o.header), part(shared).replace(/const ND_VERSION = '[^']*';/, `const ND_VERSION = '${manifest.version}';`)];
  // each module in its own function scope: its top-level names can't clash with another module's
  for (const m of o.modules) {
    const files = order[m.plugin].files.filter((f) => f !== shared && !f.endsWith('/exports.js'));
    js.push(`/* ==== module ${m.id} ==== */`, `const ${m.cls}Module = (() => {`, ...files.map(part), `return ${m.cls};`, '})();');
  }
  js.push(`const NEON_MODULES = [\n${o.modules.map((m) => `  { id: '${m.id}', name: '${m.name}', desc: '${m.desc}', cls: ${m.cls}Module },`).join('\n')}\n];`);
  js.push(...o.kernel.map(part), 'module.exports = NeonMother;');
  // fonts inside styles.css: the community installer only downloads main.js, manifest.json and styles.css
  const fonts = [['Unbounded', 'Unbounded.ttf'], ['Space Grotesk', 'SpaceGrotesk.ttf'], ['JetBrains Mono', 'JetBrainsMono.ttf']]
    .map(([family, file]) => `@font-face{font-family:"${family}";src:url(data:font/ttf;base64,${fs.readFileSync(`neon-deck/fonts/${file}`).toString('base64')}) format("truetype");font-weight:100 900;font-style:normal;font-display:swap;}`)
    .join('\n');
  const css = `/* fonts (SIL Open Font License, see README) */\n${fonts}\n` + o.modules.map((m) => `/* @src ${m.plugin}/styles.css */\n${read(`${m.plugin}/styles.css`)}`).join('\n');
  fs.rmSync(path.join(out, dir), { recursive: true, force: true });
  fs.mkdirSync(path.join(out, dir), { recursive: true });
  fs.writeFileSync(path.join(out, dir, 'main.js'), js.join('\n') + '\n');
  fs.writeFileSync(path.join(out, dir, 'styles.css'), css + '\n');
  fs.writeFileSync(path.join(out, dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  check(path.join(out, dir, 'main.js'));
  console.log(`built ${path.join(out, dir)} (${manifest.version}, ${js.join('\n').split('\n').length} lines)`);
}
process.exit(bad ? 1 : 0);
