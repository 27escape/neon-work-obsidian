
/* =========================================================================
 * NEON RESEARCH — one tree: topics (folders) → subtopics (folders) → notes,
 * inside the research folder. Its own Research tab, separate from work.
 * ========================================================================= */
const VIEW_RESEARCH = 'neon-research';
const NR_DEFAULTS = {
  root: 'Learning/Core-topics', // first root's path, kept for older versions
  roots: null, // [{ name, path }]: each is its own tree, quiz and history (filled on load)
  activeRoot: 0, // index of the root shown in the tab
  countAsWork: false, // false: new notes get `untracked: true`, so Neon Time never counts them as work
  linkSuggest: true,
  open: [], // folder paths expanded in the tree
  cards: {}, // quiz card id -> { due, ivl }
};
const DAY = 86400000;
/** Short "how long ago": now, 5m, 3h, 2d, then the date. */
function shortAgo(ms) {
  const d = Date.now() - ms;
  if (d < 60000) return 'now';
  if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
  if (d < DAY) return `${Math.floor(d / 3600000)}h ago`;
  if (d < 7 * DAY) return `${Math.floor(d / DAY)}d ago`;
  return moment(ms).format(moment(ms).isSame(moment(), 'year') ? 'D MMM' : 'D MMM YYYY');
}
const CARD_RE = /^\s*(?:[-*+]\s+)?(.+?)\s+::\s+(.+?)\s*$/;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Same length as text, with code, links and frontmatter blanked out: where a plain mention may be linked. */
function plainMask(text) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return text
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, blank)
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/!?\[\[[^\]]*\]\]/g, blank)
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, blank)
    .replace(/https?:\/\/\S+/g, blank)
    .replace(/^#{1,6}\s.*$/gm, blank);
}

