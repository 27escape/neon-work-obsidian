// One-off refactor helper: move methods of a class into their own file as
// `Object.assign(Class.prototype, { ... })`, without touching method bodies.
// node tools/mixin.mjs <src file> <Class> <new file> <method,method,...>
// The new file is placed right after the class file in tools/files.json.
import fs from 'node:fs';

const [file, cls, out, list] = process.argv.slice(2);
const names = new Set(list.split(','));
const L = fs.readFileSync(file, 'utf8').split('\n');
const classLine = L.findIndex((l) => new RegExp(`^(module\\.exports = )?class ${cls}\\b`).test(l));
if (classLine < 0) throw new Error(`class ${cls} not in ${file}`);
// method starts (with their doc comments) inside the class body
const starts = [];
let end = -1;
for (let i = classLine + 1; i < L.length; i++) {
  if (L[i] === '}' || L[i] === '};') {
    end = i;
    break;
  }
  const m = L[i].match(/^  (static |get |set )?(?:async )?([A-Za-z_$][\w$]*)\(.*\) \{$/);
  if (!m) continue;
  let s = i;
  while (s > classLine + 1 && /^  (\/\*| \*|\/\/)/.test(L[s - 1])) s--;
  starts.push({ name: m[2], kind: m[1], s });
}
if (end < 0) throw new Error('class end not found');
const moved = [];
const keep = new Set();
starts.forEach((st, k) => {
  const e = (starts[k + 1] ? starts[k + 1].s : end) - 1;
  if (!names.has(st.name)) return;
  if (st.kind) throw new Error(`${st.name}: getters/setters/static can't move`);
  const body = L.slice(st.s, e + 1);
  if (body.some((l) => /\bsuper\./.test(l))) throw new Error(`${st.name} uses super`);
  // last non-empty line closes the method: add the comma an object literal needs
  let last = body.length - 1;
  while (!body[last].trim()) last--;
  if (body[last] !== '  }') throw new Error(`${st.name}: unexpected end "${body[last]}"`);
  body[last] = '  },';
  moved.push(...body);
  for (let i = st.s; i <= e; i++) keep.add(i);
  names.delete(st.name);
});
if (names.size) throw new Error(`not found: ${[...names].join(', ')}`);
const rest = L.filter((_, i) => !keep.has(i));
fs.writeFileSync(file, rest.join('\n'));
fs.writeFileSync(out, `Object.assign(${cls}.prototype, {\n${moved.join('\n')}\n});\n`);
const order = JSON.parse(fs.readFileSync('tools/files.json', 'utf8'));
for (const o of Object.values(order)) {
  const at = o.files.indexOf(file);
  if (at >= 0 && !o.files.includes(out)) o.files.splice(at + 1, 0, out);
}
fs.writeFileSync('tools/files.json', JSON.stringify(order, null, 2) + '\n');
console.log(`${out}: ${moved.length} lines; ${file}: ${rest.length} lines`);
