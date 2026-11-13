/* ------------------------------------------------------------------ */
/* Neon Projects (fork; upstream's Neon Tickets module, rewritten)     */
/* ------------------------------------------------------------------ */
// The module keeps upstream's id (neon-tickets) and view type, so its data folder and saved layouts carry on.

const VIEW_TICKETS = 'neon-deck-tickets';
/** The four status groups: how a project is counted and coloured. */
const PROJECT_KINDS = ['open', 'in-progress', 'waiting', 'done'];
const PROJECT_KIND_LABEL = { open: 'Not started', 'in-progress': 'Active', waiting: 'On hold', done: 'Closed' };
const PROJECT_BUCKETS = [
  ['overdue', 'Overdue'],
  ['today', 'Due today'],
  ['week', 'Next 7 days'],
  ['later', 'Later'],
  ['nodate', 'No due date'],
  ['done', 'Closed'],
];
const PROJECTS_DEFAULTS = {
  // which notes are projects, and their status values (comma lists, in the order offered)
  projectTag: 'project',
  statusNotStarted: 'init, created',
  statusActive: 'inprogress, ongoing',
  statusOnHold: 'paused, blocked',
  statusClosed: 'completed, cancelled',
  statusCancelled: 'cancelled', // closing with this value writes a `cancelled` date instead of `completed`
  // where new projects go: <customers folder>/<customer>/<projects folder name>/, else the project folder
  customersFolder: '1.Customers',
  projectsFolderName: 'Projects',
  projectFolder: '', // projects without a customer; '' = <base folder>/Projects
  projectTemplate: '',
  // the tracker and reminders
  tabSort: 'customer',
  reminders: true,
  remindDays: 1,
  notified: {},
  statusLog: [], // { t, title, status, path }: projects set to a status below (Recently done on the dashboard)
  activityStatuses: ['done', 'waiting'],
};
const PROJECT_SORTS = [
  ['customer', 'Customer'],
  ['status', 'Status'],
  ['due', 'Due date'],
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['changed', 'Recently changed'],
  ['title', 'Title A–Z'],
];

/** Status group of a value: from the settings (NEON_PROJECTS), else a few common words, else not started. */
function projectKind(v) {
  const k = NEON_PROJECTS.kinds[String(v == null ? '' : v).trim().toLowerCase()];
  if (k) return k;
  const s = String(v || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (/^(done|closed|resolved|completed?|cancell?ed)$/.test(s)) return 'done';
  if (/^(in-?progress|doing|active|wip|started|ongoing)$/.test(s)) return 'in-progress';
  if (/^(waiting|blocked|on-?hold|paused|pending)$/.test(s)) return 'waiting';
  return 'open';
}
const daysFromToday = (m) => m.clone().startOf('day').diff(moment().startOf('day'), 'days');
/** Short due text for a project row. */
function projectDueText(t) {
  if (t.status === 'done') return t.completed ? `${t.statusRaw || 'closed'} ${t.completed.format('D MMM')}` : t.statusRaw || 'closed';
  if (!t.due) return 'no date';
  const d = t.daysLeft;
  if (d < -1) return `${-d}d late`;
  if (d === -1) return '1d late';
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 14) return `in ${d}d`;
  return `in ${Math.round(d / 7)}w`;
}
/** Default order: open first, then by due date (none last), then title. */
function projectSort(a, b) {
  return (a.status === 'done') - (b.status === 'done') || (a.due ? a.due.valueOf() : Infinity) - (b.due ? b.due.valueOf() : Infinity) || a.title.localeCompare(b.title);
}
const byTitle = (a, b) => a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' });
/** Projects in sections for a sort mode: [[key, label, projects]]. */
function projectGroups(items, mode) {
  if (mode === 'customer') {
    const names = [...new Set(items.map((t) => t.customer || ''))].sort((a, b) => (!a - !b) || a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return names.map((c) => [`customer-${c || 'none'}`, c || 'No customer', items.filter((t) => (t.customer || '') === c).sort(projectSort)]);
  }
  if (mode === 'status') {
    return PROJECT_KINDS.map((k) => [`status-${k}`, PROJECT_KIND_LABEL[k], items.filter((t) => t.status === k).sort(projectSort)]);
  }
  const flat = {
    newest: ['Newest first', (a, b) => b.created.valueOf() - a.created.valueOf()],
    oldest: ['Oldest first', (a, b) => a.created.valueOf() - b.created.valueOf()],
    changed: ['Recently changed', (a, b) => b.file.stat.mtime - a.file.stat.mtime],
    title: ['Title A–Z', byTitle],
  }[mode];
  if (flat) return [['flat', flat[0], items.slice().sort(flat[1])]];
  return PROJECT_BUCKETS.map(([bucket, l]) => {
    const g = items.filter((t) => t.bucket === bucket);
    g.sort(bucket === 'done' ? (a, b) => (b.completed ? b.completed.valueOf() : 0) - (a.completed ? a.completed.valueOf() : 0) : projectSort);
    return [bucket, l, g];
  });
}
