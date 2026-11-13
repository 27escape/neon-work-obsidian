
/* =========================================================================
 * NEON TIME — active time per category, manual entries, overtime and one
 * log note per day for your AI agent. Never talks to Jira or the network.
 * ========================================================================= */
const VIEW_TIME = 'neon-time';
const TIME_CATS = [...CATS, 'other'];
const TIME_DEFAULTS = {
  tracking: true,
  logFolder: 'Neon/Time Log', // fork: no Core folder
  writeNotes: true,
  dayHours: 8,
  idleMin: 30,
  workIdleH: 2, // a started workday ends by itself after this many hours without input
  wrapLead: 30,
  installedAt: 0,
  days: {}, // 'YYYY-MM-DD' -> { entries: [], done: [], tomorrow, wrapped }
};
const SOURCES = ['auto', 'manual', 'ticket'];
let entrySeq = 0;
const newId = () => `${Date.now().toString(36)}${(entrySeq++).toString(36)}`;
const entryMin = (e) => Math.round(e.ms / 60000);
const cell = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

