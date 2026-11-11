
/* =========================================================================
 * NEON RESEARCH — one tree: topics (folders) → subtopics (folders) → notes,
 * inside the research folder. Its own Study tab (view type stays neon-research), separate from work.
 * ========================================================================= */
const VIEW_RESEARCH = 'neon-research';
const NR_DEFAULTS = {
  root: 'Learning/Core-topics', // first root's path, kept for older versions
  roots: null, // [{ name, path }]: each is its own tree, quiz and history (filled on load)
  activeRoot: 0, // index of the root shown in the tab
  countAsWork: false, // false: new notes get `untracked: true`, so Neon Time never counts them as work
  linkSuggest: true,
  open: [], // folder paths expanded in the tree
  researchTopics: [], // [{ text, done }]: topics queued in the Research subtab
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
const CARD_RE = /^\s*(?:[-*+]\s+)?(.+?)\s+(:::?)\s+(.+?)\s*$/; // "q :: a" flashcard, "q ::: a" exercise (typed answer)
const CARD_BLOCK = 'neon-cards'; // fenced block that keeps a note's cards in the file but off the page (issue 56)
const CARD_FENCE_RE = /^\s*(```|~~~)\s*neon-cards\s*$/;

/** Text with card lines added to the note's hidden card block (made at the end when missing); `top` puts them first. */
function addToCardBlock(text, lines, top) {
  lines = [].concat(lines);
  const all = text.split('\n');
  const s = all.findIndex((l) => CARD_FENCE_RE.test(l));
  if (s < 0) return `${text.replace(/\s*$/, '')}\n\n\`\`\`${CARD_BLOCK}\n${lines.join('\n')}\n\`\`\`\n`;
  const fence = all[s].trim().slice(0, 3);
  let e = all.findIndex((l, i) => i > s && l.trim().startsWith(fence));
  if (e < 0) e = all.length;
  all.splice(top ? s + 1 : e, 0, ...lines);
  return all.join('\n');
}
/** Replace (or with null remove) a card's line; finds it again if lines moved, leaves the text alone if it's gone. */
function setCardLine(text, card, line) {
  const all = text.split('\n');
  let i = all[card.ln] === card.raw ? card.ln : all.indexOf(card.raw);
  if (i < 0) return text;
  if (line == null) all.splice(i, 1);
  else all[i] = (card.raw.match(/^\s*(?:[-*+]\s+)?/) || [''])[0] + line;
  return all.join('\n');
}
/** Move cards written on the page into the hidden block, in file order at its top, so ids and history stay. */
function moveCardsToBlock(text, cards) {
  const inline = cards.filter((c) => !c.hidden).sort((a, b) => a.ln - b.ln);
  if (!inline.length) return text;
  let t = text;
  for (const c of inline.slice().reverse()) t = setCardLine(t, c, null);
  return addToCardBlock(t, inline.map((c) => `${c.q} ${c.type ? ':::' : '::'} ${c.a}`), true);
}
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

