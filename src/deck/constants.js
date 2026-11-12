/* ------------------------------------------------------------------ */
/* Neon Deck core: constants                                           */
/* ------------------------------------------------------------------ */
const VIEW_DASH = 'neon-deck-dashboard';
const VIEW_CARDS = 'neon-deck-cards';
const VIEW_GRAPH = 'neon-deck-graph';
/** Neon views that live in the main pane (folded into one pane once, see foldNeonTabs). */
const MAIN_VIEWS = [VIEW_DASH, VIEW_CARDS, VIEW_GRAPH, 'neon-deck-tickets', 'neon-time'];

const PALETTE = ['#c6e651', '#e5506a', '#7fb3c9', '#d9c56a', '#e4e6ea', '#b9a0d6', '#5fcf96', '#e08a5a', '#8f86b8', '#8f95a0'];
const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']);

/** Folder icon colours: theme colours first (they follow the theme), then fixed ones; a picker allows any #rrggbb. */
const FOLDER_COLORS = ['var(--nd-accent)', 'var(--nd-go)', 'var(--nd-info)', 'var(--nd-warn)', '#e5506a', '#f59e0b', '#84cc16', '#14b8a6', '#3b82f6', '#a855f7', '#ec4899', '#94a3b8'];
const FOLDER_COLOR_RE = /^(#[0-9a-f]{6}|var\(--nd-[a-z0-9-]+\))$/i;
const THEMES = ['marathon', 'cyberpunk', 'calm', 'paper', 'night', 'phosphor', 'blueprint', 'strawberry', 'blackice'];
const THEME_LABEL = {
  marathon: 'Marathon', cyberpunk: 'Cyberpunk', calm: 'Calm', paper: 'Paper', night: 'Night shift', phosphor: 'Phosphor', blueprint: 'Blueprint', strawberry: 'Strawberry kitten', blackice: 'Black ICE',
};
const THEME_PATTERN = {
  marathon: 'damascus', cyberpunk: 'prism', calm: 'none', paper: 'topo', night: 'prism', phosphor: 'datastream', blueprint: 'hex', strawberry: 'none', blackice: 'blackice',
};

/** Short lines Claude wrote for the ticker; roughly one in ten items. */
const SIGNOFFS = [
  'Signal clean, deck quiet, go',
  'One thing at a time',
  'Breaks are part of the work',
  'Ship it, then polish',
  'Log it and let it go',
  'Fewer tabs, more done',
  'Your future self says thanks',
  'Pattern stable, operator steady',
  'Small steps still move tickets',
  'Write it down, clear the cache',
  'Good work today — C.',
  'Drink some water',
];

const DEFAULT_SETTINGS = {
  name: '',
  openDashboardOnStartup: true,
  theme: 'marathon',
  pattern: 'auto',
  patternStrength: 'subtle',
  patternMotion: true,
  settingsVersion: 3,
  pinnedFolders: [],
  folderColors: {}, // folder path -> icon colour chosen by hand (beats the category colour)
  coreFolder: 'Core',
  coreTidied: false,
  reviewFolder: 'Core/Reviews',
  inboxPath: 'Core/Inbox.md',
  bridgeFolder: 'Core/Bridges',
  excludeFolders: 'Core/Templates',
  cardsInSidebar: true,
  replaceFileExplorer: true,
  showCapture: false, // the Quick capture card (the capture command works either way)
  cardSort: 'created-prop',
  cardMode: 'cards',
  revisitDays: 14,
  seen: {},
  graphMaxNodes: 120,
  graphWindow: 4,
  extraStopwords: '',
};
/** 1.2 keys that moved to Neon Tickets / were removed; dropped after migration. */
const OLD_KEYS = ['glass', 'intensity', 'styleVersion', 'stampDone'];

const pal = (i) => `var(--nd-c${i + 1}, ${PALETTE[i]})`;
function countWords(text) {
  const m = stripFrontmatter(text).match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu);
  return m ? m.length : 0;
}
/** Tiny inline sparkline (7 values). */
function sparkline(parent, values) {
  const w = 54;
  const h = 18;
  const max = Math.max(1, ...values);
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(' ');
  const svg = parent.createSvg('svg', { cls: 'nd-spark', attr: { viewBox: `0 0 ${w} ${h}`, width: w, height: h } });
  // pathLength 1: the line can be drawn in with CSS (stroke-dashoffset 1 -> 0)
  svg.createSvg('polyline', { attr: { points: pts, pathLength: '1', fill: 'none', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } });
  return svg;
}

