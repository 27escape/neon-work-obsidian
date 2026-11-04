
/** Wrap a comparison so names starting with "!" come first ("!!" before "!"). */
function bangFirst(cmp) {
  const bangs = (f) => (f.name.match(/^!+/) || [''])[0].length;
  return (a, b) => bangs(b) - bangs(a) || cmp(a, b);
}
/** Everything that happened per day in a month: tasks, tickets, time entries, notes. Map 'YYYY-MM-DD' -> lists. */
function actDays(p, d, month) {
  const from = month.clone().startOf('month').startOf('isoWeek').valueOf();
  const to = month.clone().endOf('month').endOf('isoWeek').valueOf();
  const days = new Map();
  const day = (t) => {
    const k = dayKey(t);
    if (!days.has(k)) days.set(k, { tasks: [], tickets: [], time: [], notes: [], worked: null, over: 0 });
    return days.get(k);
  };
  const inRange = (t) => t >= from && t <= to;
  for (const [id, fn] of p.activity) {
    let items = [];
    try {
      items = fn() || [];
    } catch (e) {
      console.error(`Neon Deck activity ${id}`, e);
    }
    for (const x of items) if (x && inRange(x.t)) day(x.t)[x.kind === 'ticket' ? 'tickets' : 'tasks'].push({ ...x, kind: x.kind === 'ticket' ? 'ticket' : 'task', extra: x.status || x.src });
  }
  for (const f of d.md) {
    if (inRange(f.stat.ctime)) day(f.stat.ctime).notes.push({ t: f.stat.ctime, kind: 'note', text: f.basename, extra: 'created', open: (e) => openFile(p.app, f, e) });
    else if (inRange(f.stat.mtime)) day(f.stat.mtime).notes.push({ t: f.stat.mtime, kind: 'note', text: f.basename, extra: 'edited', open: (e) => openFile(p.app, f, e) });
  }
  const timeDay = p.services.get('timeDay');
  if (timeDay)
    for (let m = moment(from); m.valueOf() <= to && !m.isAfter(moment(), 'day'); m.add(1, 'day')) {
      const k = m.format('YYYY-MM-DD');
      const td = timeDay(k);
      if (!td || !td.worked) continue;
      const x = day(m.valueOf());
      x.worked = td.worked;
      x.over = td.over;
      for (const e of td.entries) x.time.push({ t: e.start, kind: 'time', text: e.text, extra: fmtMin(e.min) });
    }
  return days;
}
const actCount = (x) => x.tasks.length + x.tickets.length + x.time.length + x.notes.length;
/**
 * Month stats of the Activity card. Each entry: label, icon, accent, how it's counted, and get(days, month, plugin)
 * returning { v, sub } (or null to hide it). Adding a stat = adding one entry here.
 */
const ACTIVITY_STATS = [
  {
    id: 'workday', label: 'avg workday', accent: 'var(--nd-info)', how: 'Average worked time on days with time (Neon Time); overtime days are past the day target.',
    get(days, month) {
      const xs = [...days.entries()].filter(([k, x]) => x.worked && moment(k).isSame(month, 'month'));
      if (!xs.length) return null;
      const over = xs.filter(([, x]) => x.over > 0).length;
      return { v: fmtMin(Math.round(xs.reduce((n, [, x]) => n + x.worked, 0) / xs.length)), sub: `${over} overtime day${over === 1 ? '' : 's'}` };
    },
  },
  {
    id: 'busiest', label: 'busiest weekday', accent: 'var(--nd-accent)', how: 'Weekday with the most tasks, tickets, time entries and notes this month.',
    get(days, month) {
      const by = [0, 0, 0, 0, 0, 0, 0];
      for (const [k, x] of days) if (moment(k).isSame(month, 'month')) by[moment(k).isoWeekday() - 1] += actCount(x);
      const best = Math.max(...by);
      return best ? { v: moment().isoWeekday(by.indexOf(best) + 1).format('dddd'), sub: `${best} things` } : null;
    },
  },
  {
    id: 'streak', label: 'longest streak', accent: 'var(--nd-go)', how: 'Most days in a row with any activity this month.',
    get(days, month) {
      let best = 0;
      let run = 0;
      for (let m = month.clone().startOf('month'); m.isSame(month, 'month'); m.add(1, 'day')) {
        const x = days.get(m.format('YYYY-MM-DD'));
        run = x && actCount(x) ? run + 1 : 0;
        best = Math.max(best, run);
      }
      return best ? { v: `${best} day${best === 1 ? '' : 's'}` } : null;
    },
  },
  {
    id: 'ontime', label: 'tasks on time', accent: 'var(--nd-go)', how: 'Ticked tasks with a 📅 date: done on or before it vs after it.',
    get(days, month) {
      const xs = [...days.entries()].filter(([k]) => moment(k).isSame(month, 'month')).flatMap(([, x]) => x.tasks.filter((t) => t.due));
      if (!xs.length) return null;
      const late = xs.filter((t) => dayKey(t.t) > t.due).length;
      return { v: `${Math.round((100 * (xs.length - late)) / xs.length)}%`, sub: `${late} late` };
    },
  },
  {
    id: 'tickets', label: 'tickets closed / opened', accent: 'var(--nd-warn)', how: 'Ticket notes with `completed` / `created` in this month; average days from created to completed.',
    get(days, month, p) {
      let opened = 0;
      let closed = 0;
      let span = 0;
      for (const f of p.app.vault.getMarkdownFiles()) {
        const fm = (p.app.metadataCache.getFileCache(f) || {}).frontmatter;
        if (!fm || fm.type !== 'ticket') continue;
        const c = fm.created ? moment(String(fm.created)) : null;
        const done = fm.completed ? moment(String(fm.completed)) : null;
        if (c && c.isValid() && c.isSame(month, 'month')) opened++;
        if (done && done.isValid() && done.isSame(month, 'month')) {
          closed++;
          if (c && c.isValid()) span += Math.max(0, done.diff(c, 'days'));
        }
      }
      return opened || closed ? { v: `${closed} / ${opened}`, sub: closed ? `avg ${Math.round((span / closed) * 10) / 10} d to close` : '' } : null;
    },
  },
];
/** A note's `created` property as a time (several spellings, any date moment reads), else the file's creation time. */
function createdOf(app, f) {
  const fm = (f.extension === 'md' && (app.metadataCache.getFileCache(f) || {}).frontmatter) || {};
  const v = fm.created ?? fm.Created ?? fm['date created'] ?? fm.date_created;
  const m = v != null && v !== '' ? moment(String(v), [moment.ISO_8601, 'YYYY-MM-DD HH:mm', 'YYYY-MM-DD', 'DD.MM.YYYY'], true) : null;
  return m && m.isValid() ? m.valueOf() : f.stat.ctime;
}

