// The in-app help (fork): README sections, cut by heading at build time and shipped inside main.js, so the help
// works offline and matches the installed version. Pictures become links to them on GitHub (the plugin never loads
// anything from the network itself); other relative links point at the same files on GitHub.
// Used by tools/build.mjs; tested in test/help.test.mjs.

/** The repository; the help links to its files at the installed version's tag. */
export const HELP_REPO = 'https://github.com/27escape/neon-work-obsidian';

/** [key, README heading] in the order the help shows them. */
export const HELP_TOPICS = [
  ['overview', 'What it does'],
  ['dashboard', 'Dashboard'],
  ['tasks', 'Tasks'],
  ['projects', 'Projects'],
  ['planning', 'Planning'],
  ['research', 'Research'],
  ['time', 'Time'],
  ['write', 'Write'],
  ['layouts', 'Other vault layouts'],
  ['mobile', 'On phones and tablets'],
  ['settings', 'Settings'],
  ['install', 'Install'],
];

/** GitHub's anchor for a heading: lower case, punctuation dropped, spaces to dashes. */
export const helpAnchor = (heading) => heading.trim().toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-');

/** Links that work from inside Obsidian: pictures and relative paths become links to the files on GitHub. */
export function helpLinks(text, base) {
  return (
    text
      // pictures: a link to the picture on GitHub (nothing is loaded from the network)
      .replace(/!\[([^\]]*)\]\((?!https?:)([^)\s]+)\)/g, (m, alt, path) => `[🖼 Picture: ${alt || path} ↗](${base}/${path})`)
      // README anchors, then other relative links (docs, FORK.md): the same place on GitHub
      .replace(/(?<!!)\[([^\]]+)\]\((#[^)\s]+)\)/g, (m, label, hash) => `[${label}](${base}/README.md${hash})`)
      .replace(/(?<!!)\[([^\]]+)\]\((?!https?:|mailto:|#)([^)\s]+)\)/g, (m, label, path) => `[${label}](${base}/${path})`)
  );
}

/**
 * { key: { title, md, url } } from the README text. base: the repo at this version, e.g.
 * https://github.com/27escape/neon-work-obsidian/blob/1.4.0 (a release tag, so the links show what is installed).
 */
export function helpSections(readme, base) {
  const lines = readme.replace(/\r/g, '').split('\n');
  const level = (l) => ((l.match(/^(#+) /) || [])[1] || '').length;
  const out = {};
  for (const [key, title] of HELP_TOPICS) {
    const at = lines.findIndex((l) => level(l) >= 2 && level(l) <= 3 && l.replace(/^#+ /, '').trim() === title);
    if (at < 0) continue;
    // a section ends at the next heading of its level or higher; "What it does" keeps only its own intro
    const stop = key === 'overview' ? 3 : level(lines[at]);
    let end = at + 1;
    while (end < lines.length && !(level(lines[end]) && level(lines[end]) <= stop)) end++;
    let md = lines.slice(at + 1, end).join('\n').trim();
    let url = `${base}/README.md#${helpAnchor(title)}`;
    let name = title;
    if (key === 'overview') {
      // the README's opening too (what the plugin is, read-only, 100% local), minus its title and notes
      const top = lines.findIndex((l) => level(l) === 1);
      const first = lines.findIndex((l, i) => i > top && level(l) === 2);
      md = `${lines.slice(top + 1, first).filter((l) => !/^>/.test(l)).join('\n').trim()}\n\n${md}`;
      url = `${base}/README.md`;
      name = 'Overview';
    }
    out[key] = { title: name, md: helpLinks(md, base), url };
  }
  return out;
}
