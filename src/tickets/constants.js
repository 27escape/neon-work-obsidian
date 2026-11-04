
/* ------------------------------------------------------------------ */
/* Neon Tickets                                                        */
/* ------------------------------------------------------------------ */

const VIEW_TICKETS = 'neon-deck-tickets';
const VIEW_TICKET = 'neon-ticket';
const TICKET_STATUS = ['open', 'in-progress', 'waiting', 'done'];
const TICKET_STATUS_LABEL = { open: 'Open', 'in-progress': 'In progress', waiting: 'Waiting', done: 'Done' };
const TICKET_PRIOS = ['low', 'normal', 'high', 'urgent'];
const TICKET_PRIO_RANK = { urgent: 0, high: 1, normal: 2, low: 3 };
const TICKET_BUCKETS = [
  ['followup', 'Follow up'],
  ['overdue', 'Overdue'],
  ['today', 'Due today'],
  ['week', 'Next 7 days'],
  ['later', 'Later'],
  ['nodate', 'No due date'],
  ['done', 'Done'],
];
const TICKETS_DEFAULTS = {
  ticketFolder: 'Core/Tickets',
  doneFolder: 'Done',
  autoFile: true,
  openInTicketView: true,
  popup: true,
  defaultDays: 7,
  defaultCategory: 'operations',
  reminders: true,
  remindDays: 1,
  autoFollowUpDays: 3,
  notified: {},
  migrated: false,
  // ticket templates: { id, name, steps[], description, priority, dueDays } — kept here, never as notes
  templates: [],
  tabSort: 'due', // Tickets tab sort / group (TICKET_SORTS)
  statusLog: [], // { t, id, title, status, path }: tickets set to a status below (Recently done on the dashboard)
  activityStatuses: ['done', 'waiting'],
};
const DUE_CHIPS = [[1, '1d'], [3, '3d'], [7, '1w'], [14, '2w'], [30, '1m']];
const SEC = {
  description: { re: /^#{1,6}\s+(description|summary)\s*$/i, head: '## Description' },
  steps: { re: /^#{1,6}\s+(next steps|steps|first steps)\s*$/i, head: '## Next steps' },
  log: { re: /^#{1,6}\s+log\s*$/i, head: '## Log' },
  time: { re: /^#{1,6}\s+time( logged)?\s*$/i, head: '## Time' },
  shots: { re: /^#{1,6}\s+(screenshots|images|attachments)\s*$/i, head: '## Screenshots' },
};
const SEC_ORDER = ['description', 'steps', 'shots', 'log', 'time'];
const IMG_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' };
const STAMP = () => moment().format('YYYY-MM-DD HH:mm');

function normTicketStatus(v) {
  const s = String(v || 'open').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (/^(done|closed|resolved|completed?|cancell?ed|erledigt)$/.test(s)) return 'done';
  if (/^(in-?progress|doing|active|wip|started)$/.test(s)) return 'in-progress';
  if (/^(waiting|blocked|on-?hold|pending|wartet)$/.test(s)) return 'waiting';
  return 'open';
}
function normTicketPrio(v) {
  const s = String(v || 'normal').trim().toLowerCase();
  if (/^(urgent|critical|p0|p1|asap)$/.test(s)) return 'urgent';
  if (/^(high|p2)$/.test(s)) return 'high';
  if (/^(low|p4|p5)$/.test(s)) return 'low';
  return 'normal';
}
const daysFromToday = (m) => m.clone().startOf('day').diff(moment().startOf('day'), 'days');
function ticketDueText(t) {
  if (t.status === 'done') return t.completed ? `done ${t.completed.format('D MMM')}` : 'done';
  if (t.bucket === 'followup') return 'follow up';
  if (!t.due) return 'no date';
  const d = t.daysLeft;
  if (d < -1) return `${-d}d late`;
  if (d === -1) return '1d late';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 14) return `in ${d}d`;
  return `in ${Math.round(d / 7)}w`;
}
function ticketSort(a, b) {
  if ((a.bucket === 'followup') !== (b.bucket === 'followup')) return a.bucket === 'followup' ? -1 : 1;
  const ad = a.due ? a.due.valueOf() : null;
  const bd = b.due ? b.due.valueOf() : null;
  if (ad !== bd) {
    if (ad === null) return 1;
    if (bd === null) return -1;
    return ad - bd;
  }
  return TICKET_PRIO_RANK[a.priority] - TICKET_PRIO_RANK[b.priority] || a.title.localeCompare(b.title);
}

/** Sort / group options of the Tickets tab (item 38); 'due' is the original due-date buckets. */
const TICKET_SORTS = [
  ['due', 'Due date'],
  ['status', 'Status'],
  ['priority', 'Priority'],
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['changed', 'Recently changed'],
  ['title', 'Title A–Z'],
  ['id', 'Ticket ID'],
  ['jira', 'Jira key'],
];
const byText = (k) => (a, b) => (a[k] || '').localeCompare(b[k] || '', undefined, { numeric: true, sensitivity: 'base' }) || a.title.localeCompare(b.title);
/** Tickets in sections for a sort mode: [[key, label, tickets]], from data already in memory. */
function ticketGroups(items, mode) {
  const label = (s) => s[0].toUpperCase() + s.slice(1);
  if (mode === 'status') return TICKET_STATUS.map((st) => [`status-${st}`, TICKET_STATUS_LABEL[st], items.filter((t) => t.status === st).sort(ticketSort)]);
  if (mode === 'priority') return [...TICKET_PRIOS].reverse().map((pr) => [`prio-${pr}`, label(pr), items.filter((t) => t.priority === pr).sort(ticketSort)]);
  const flat = {
    newest: ['Newest first', (a, b) => b.created.valueOf() - a.created.valueOf()],
    oldest: ['Oldest first', (a, b) => a.created.valueOf() - b.created.valueOf()],
    changed: ['Recently changed', (a, b) => b.file.stat.mtime - a.file.stat.mtime],
    title: ['Title A–Z', byText('title')],
    id: ['Ticket ID', byText('id')],
    jira: ['Jira key', (a, b) => (!a.jira - !b.jira) || byText('jira')(a, b)],
  }[mode];
  if (flat) return [['flat', flat[0], items.slice().sort(flat[1])]];
  return TICKET_BUCKETS.map(([bucket, l]) => {
    const g = items.filter((t) => t.bucket === bucket);
    if (bucket === 'done') g.sort((a, b) => (b.completed ? b.completed.valueOf() : b.file.stat.mtime) - (a.completed ? a.completed.valueOf() : a.file.stat.mtime));
    return [bucket, l, g];
  });
}

