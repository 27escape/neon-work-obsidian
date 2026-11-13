Object.assign(NeonTickets.prototype, {
  /* collecting ------------------------------------------------------------- */
  collectTickets() {
    if (this.cache && this.cache.day === dayKey(Date.now())) return this.cache.list;
    const out = [];
    const today = moment().startOf('day');
    const deck = neonPlugin(this.app, 'neon-deck');
    for (const f of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(f);
      if (!isTicketCache(cache)) continue;
      if (deck && deck.isExcluded && deck.isExcluded(f)) continue;
      out.push(this.toTicket(f, cache, today));
    }
    out.sort(ticketSort);
    this.cache = { day: dayKey(Date.now()), list: out, paths: new Set(out.map((t) => t.file.path)) };
    return out;
  },
  toTicket(f, cache, today) {
    const fm = (cache && cache.frontmatter) || {};
    const isProject = isProjectCache(cache); // fork
    const started = parseDay(fm.started);
    const created = parseDay(fm.created) || started || moment(f.stat.ctime);
    const due = parseDay(fm.due);
    const remindRaw = fm.remind != null ? String(fm.remind) : '';
    const t = {
      file: f,
      title: isProject ? projectTitle(f.basename) : String(fm.title || f.basename),
      // fork: project fields
      isProject,
      statusRaw: fm.status != null && typeof fm.status !== 'object' && String(fm.status).trim() ? String(fm.status).trim() : '',
      customer: projectCustomer(f.path, fm, this.settings.customersFolder),
      stage: fm.stage != null && typeof fm.stage !== 'object' ? String(fm.stage).trim() : '',
      note: fm.note != null && typeof fm.note !== 'object' ? String(fm.note).trim() : '',
      startedOn: started,
      cancelled: parseDay(fm.cancelled),
      id: fm.ticket != null && fm.ticket !== '' ? String(fm.ticket) : fm.id != null ? String(fm.id) : '',
      status: normTicketStatus(fm.status),
      priority: normTicketPrio(fm.priority),
      category: noteCategory(cache, f.path) || (NEON_CATS.customers ? 'other' : 'operations'),
      created,
      due,
      remind: parseDay(remindRaw),
      remindHasTime: /\d{1,2}:\d{2}/.test(remindRaw),
      completed: parseDay(fm.completed) || parseDay(fm.cancelled),
      waitingOn: fm.waiting_on ? String(fm.waiting_on) : '',
      followUp: parseDay(fm.follow_up),
      waitingSince: parseDay(fm.waiting_since),
      jira: fm.jira ? String(fm.jira) : '',
      daysLeft: due ? daysFromToday(due) : null,
      age: Math.max(0, today.diff(created.clone().startOf('day'), 'days')),
      progress: 0,
      // anything done yet: a status past Open, or a ticked step (issue 59)
      started: normTicketStatus(fm.status) !== 'open' || ((cache && cache.listItems) || []).some((li) => li.task && li.task !== ' '),
    };
    if (t.id && t.title.startsWith(t.id)) t.title = t.title.slice(t.id.length).replace(/^[\s·:\-–—]+/, '') || t.title;
    if (due) {
      const span = due.clone().endOf('day').diff(created, 'minutes');
      t.progress = span > 0 ? clamp(moment().diff(created, 'minutes') / span, 0, 1) : 1;
    }
    const followDue = t.status === 'waiting' && t.followUp && !t.followUp.isAfter(today, 'day');
    t.bucket = t.status === 'done' ? 'done' : followDue ? 'followup' : !due ? 'nodate' : t.daysLeft < 0 ? 'overdue' : t.daysLeft === 0 ? 'today' : t.daysLeft <= 7 ? 'week' : 'later';
    return t;
  },
  activeTickets() {
    return this.collectTickets().filter((t) => t.status !== 'done');
  },
  ticketFor(file) {
    if (!file) return null;
    const cache = this.app.metadataCache.getFileCache(file);
    return isTicketCache(cache) ? this.toTicket(file, cache, moment().startOf('day')) : null;
  },
  doneIn(m) {
    return this.collectTickets().filter((t) => t.status === 'done' && t.completed && t.completed.isSame(m, 'month')).length;
  },
  renderCounter(el, all) {
    el.empty();
    const now = moment();
    const last = now.clone().subtract(1, 'month');
    const done = (m) => all.filter((t) => t.status === 'done' && t.completed && t.completed.isSame(m, 'month')).length;
    el.createSpan({ cls: 'tk-counter-n', text: String(done(now)) });
    el.createSpan({ cls: 'tk-counter-l', text: `done in ${now.format('MMMM')} · ${done(last)} in ${last.format('MMMM')}` });
  },

});
