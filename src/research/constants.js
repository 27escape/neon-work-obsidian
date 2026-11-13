
/* =========================================================================
 * NEON RESEARCH — one tree per section: topics (folders) → subtopics (folders) → notes,
 * inside each section folder. Its own Research tab (view type neon-research).
 * ========================================================================= */
const VIEW_RESEARCH = 'neon-research';
const NR_DEFAULTS = {
  // fork: no default sections; you choose the folders (Research section of the settings, or + in the tab)
  root: '', // first section's path, kept for older versions
  roots: null, // [{ name, path }]: each is its own tree (filled on load)
  activeRoot: 0, // index of the section shown in the tab
  countAsWork: true, // false: new notes get `untracked: true`, so Neon Time never counts them as work
  linkSuggest: true,
  open: [], // folder paths expanded in the tree
  researchTopics: [], // unused since the fork (status now comes from the notes); kept so older data loads
  cards: {}, // unused since the fork removed quizzes; kept so older data loads
  statusProperty: 'status', // fork: the note property that holds the research status
  doneStatuses: 'completed, done, evergreen', // fork: values that count as researched
  newStatus: 'init', // fork: status given to notes made from the Research tab
  newNoteTags: 'research', // fork: tags for notes made from the Research tab (comma-separated)
  noteTemplate: '', // fork: optional template note for new notes; {{title}}, {{date}}, {{time}} are filled in
}
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
const CARD_BLOCK = 'neon-cards'; // old flashcard blocks in notes stay hidden (quizzes were removed in the fork)
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

