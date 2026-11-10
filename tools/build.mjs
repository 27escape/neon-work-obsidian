// Build Neon Deck: join src/ files (order in tools/files.json) into dist/neon-deck/{main.js,styles.css,manifest.json}.
// No dependencies. node tools/build.mjs
// Each module is wrapped in its own function scope (its top-level names can't clash with another
// module's); a "/* @src <path> */" line before every file leads from a main.js line back to its file.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process'; // build tool only, never in the plugin

const o = JSON.parse(fs.readFileSync('tools/files.json', 'utf8'));
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\n$/, '');
const part = (f) => `/* @src ${f} */\n${read(f)}`;
const manifest = JSON.parse(fs.readFileSync(o.manifest, 'utf8'));

const js = [read(o.header), ...o.shared.map((f) => part(f).replace(/const ND_VERSION = '[^']*';/, `const ND_VERSION = '${manifest.version}';`))];
for (const m of o.modules) js.push(`/* ==== module ${m.id} ==== */`, `const ${m.cls}Module = (() => {`, ...m.files.map(part), `return ${m.cls};`, '})();');
js.push(`const NEON_MODULES = [\n${o.modules.map((m) => `  { id: '${m.id}', name: '${m.name}', old: '${m.old || m.name}', desc: '${m.desc}', cls: ${m.cls}Module },`).join('\n')}\n];`);
js.push(...o.kernel.map(part), 'module.exports = NeonMother;');

// fonts inside styles.css: the community installer only downloads main.js, manifest.json and styles.css
// WOFF2 made once from the .ttf sources (fonttools): the two UI fonts subset to Latin plus a few symbols, the mono font whole
//   pyftsubset X.ttf --unicodes="U+0020-017F,U+2010-203A,U+20AC,U+2190-2193,U+2205,U+2212,U+25CF" --layout-features='*' --flavor=woff2
const fonts = [['Unbounded', 'Unbounded.woff2'], ['Space Grotesk', 'SpaceGrotesk.woff2'], ['JetBrains Mono', 'JetBrainsMono.woff2']]
  .map(([family, file]) => `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${fs.readFileSync(`src/deck/fonts/${file}`).toString('base64')}) format("woff2");font-weight:100 900;font-style:normal;font-display:swap;}`)
  .join('\n');
const fontLicense = read('src/deck/fonts/OFL.txt');
const css = [`/*\n${fontLicense}\n*/\n${fonts}`, ...o.modules.map((m) => `/* @src ${m.id}/styles.css */\n${m.css.map((f) => `/* @css ${f} */\n${read(f)}`).join('\n')}`)].join('\n');

const dir = 'dist/neon-deck';
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(`${dir}/main.js`, js.join('\n') + '\n');
fs.writeFileSync(`${dir}/styles.css`, css + '\n');
fs.writeFileSync(`${dir}/manifest.json`, JSON.stringify(manifest, null, 2) + '\n');
fs.copyFileSync(o.manifest, 'manifest.json'); // the community list reads manifest.json at the repo root
execFileSync(process.execPath, ['--check', `${dir}/main.js`]);
console.log(`built ${dir} (${manifest.version}, ${js.join('\n').split('\n').length} lines)`);
