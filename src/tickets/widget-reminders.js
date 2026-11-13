Object.assign(NeonTickets.prototype, {
  /* dashboard widget ------------------------------------------------------------ */
  mountWidget(card) {
    const p = this;
    button(card.actions, { icon: 'plus', cls: 'nd-icon-btn', title: 'New project', onClick: () => p.newTicket() });
    button(card.actions, { icon: 'maximize-2', cls: 'nd-icon-btn', title: 'Open project tracker', onClick: () => p.openTracker() });
    const counter = card.body.createDiv('tk-counter is-mini');
    const list = card.body.createDiv('tk-mini-list');
    let renders = 0;
    const render = () => {
      if (!list.isConnected) return;
      list.toggleClass('is-calm', renders++ > 0); // animate on first open only
      const all = p.collectTickets();
      const act = all.filter((t) => t.status !== 'done');
      card.badge.setText(act.length ? String(act.length) : '');
      card.w.toggleClass('has-overdue', act.some((t) => t.bucket === 'overdue' || t.bucket === 'followup'));
      p.renderCounter(counter, all);
      list.empty();
      if (!act.length) {
        emptyState(list, 'No open projects ✦');
        return;
      }
      act.slice(0, 30).forEach((t, i) => {
        const r = list.createDiv(`tk-mini is-${t.bucket} prio-${t.priority}`);
        r.style.setProperty('--i', String(Math.min(i, 20)));
        r.createSpan({ cls: 'tk-mini-due', text: ticketDueText(t) });
        const txt = r.createDiv('tk-mini-text');
        if (t.id) txt.createSpan({ cls: 'tk-id', text: t.id });
        txt.createSpan({ cls: 'tk-mini-title', text: t.title });
        if (t.customer) txt.createSpan({ cls: 'tk-id', text: ` · ${t.customer}` });
        if (t.isProject && t.statusRaw) r.createSpan({ cls: `tk-tag-wait s-${t.status}`, text: t.statusRaw });
        else if (t.status === 'waiting' && t.bucket !== 'followup') r.createSpan({ cls: 'tk-tag-wait', text: 'waiting' });
        r.addEventListener('click', (e) => p.showTicket(t.file, e));
        r.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const m = new Menu();
          ticketMenu(p, t, m);
          m.showAtMouseEvent(e);
        });
      });
    };
    const off = this.onChange(render);
    render();
    return { destroy: off };
  },

  /* reminders --------------------------------------------------------------------- */
  async checkReminders(force) {
    if (!this.settings.reminders && !force) return;
    const now = moment();
    const today = now.format('YYYY-MM-DD');
    // waiting tickets without a follow-up date get one after N days
    for (const t of this.activeTickets()) {
      if (t.status === 'waiting' && !t.followUp && !t.isProject) { // fork: never add follow_up to projects
        const since = t.waitingSince || moment(t.file.stat.mtime);
        if (now.diff(since, 'days') >= this.settings.autoFollowUpDays) {
          await this.patch(t, { follow_up: today });
          await this.log(t, `No answer for ${this.settings.autoFollowUpDays} days — follow up today`);
        }
      }
    }
    this.cache = null;
    const seen = this.settings.notified;
    for (const k of Object.keys(seen)) if (seen[k] !== today) delete seen[k];
    const ahead = this.settings.remindDays;
    const due = this.activeTickets().filter((t) => t.bucket === 'followup' || (t.due && t.daysLeft <= ahead) || (t.remind && !t.remind.isAfter(now)));
    const fresh = force ? due : due.filter((t) => seen[t.file.path] !== today);
    if (!fresh.length) {
      if (force) new Notice('No projects need attention right now ✦');
      return;
    }
    for (const t of fresh) seen[t.file.path] = today;
    await this.saveSettings();
    const frag = createFragment((d) => {
      d.createDiv({ cls: 'tk-notice-title', text: `🎫 ${fresh.length} project${fresh.length === 1 ? '' : 's'} need${fresh.length === 1 ? 's' : ''} attention` });
      for (const t of fresh.slice(0, 6)) {
        const line = d.createDiv({ cls: `tk-notice-line is-${t.bucket}` });
        line.createSpan({ cls: 'tk-notice-due', text: ticketDueText(t) });
        line.createSpan({ text: ` ${t.id ? t.id + ' · ' : ''}${t.title}` });
      }
      if (fresh.length > 6) d.createDiv({ text: `+${fresh.length - 6} more` });
      d.createDiv({ cls: 'tk-notice-hint', text: 'Click to open the tracker' });
    });
    const n = new Notice(frag, 0);
    const el = n.noticeEl || n.messageEl;
    if (el) {
      el.addClass('tk-notice');
      el.addEventListener('click', () => this.openTracker());
    }
    // reminders stay inside Obsidian: a system notification froze Obsidian's main process for minutes on Linux
  },
});
