Object.assign(NeonProjects.prototype, {
  /* the dashboard card ---------------------------------------------------------- */
  mountWidget(card) {
    const p = this;
    button(card.actions, { icon: 'plus', cls: 'nd-icon-btn', title: 'New project', onClick: () => p.newProject() });
    button(card.actions, { icon: 'maximize-2', cls: 'nd-icon-btn', title: 'Open the Projects tab', onClick: () => p.openTracker() });
    const counter = card.body.createDiv('tk-counter is-mini');
    const list = card.body.createDiv('tk-mini-list');
    let renders = 0;
    const render = () => {
      if (!list.isConnected) return;
      list.toggleClass('is-calm', renders++ > 0);
      const all = p.collectProjects();
      const act = all.filter((t) => t.status !== 'done');
      card.badge.setText(act.length ? String(act.length) : '');
      card.w.toggleClass('has-overdue', act.some((t) => t.bucket === 'overdue'));
      p.renderCounter(counter, all);
      list.empty();
      if (!act.length) return void emptyState(list, 'No open projects ✦');
      act.slice(0, 30).forEach((t, i) => {
        const r = list.createDiv(`tk-mini is-${t.bucket}`);
        r.style.setProperty('--i', String(Math.min(i, 20)));
        r.createSpan({ cls: 'tk-mini-due', text: projectDueText(t) });
        const txt = r.createDiv('tk-mini-text');
        txt.createSpan({ cls: 'tk-mini-title', text: t.title });
        if (t.customer) txt.createSpan({ cls: 'tk-id', text: ` · ${t.customer}` });
        if (t.statusRaw) r.createSpan({ cls: `tk-tag-wait s-${t.status}`, text: t.statusRaw });
        r.addEventListener('click', (e) => p.openProject(t.file, e));
        r.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          const m = new Menu();
          projectMenu(p, t, m);
          m.showAtMouseEvent(e);
        });
      });
    };
    const off = this.onChange(render);
    render();
    return { destroy: off };
  },

  /* reminders: inside Obsidian only, once a day per project; nothing is written to notes ---------- */
  async checkReminders(force) {
    if (!this.settings.reminders && !force) return;
    const now = moment();
    const today = now.format('YYYY-MM-DD');
    this.cache = null;
    const seen = this.settings.notified;
    for (const k of Object.keys(seen)) if (seen[k] !== today) delete seen[k];
    const ahead = this.settings.remindDays;
    const due = this.activeProjects().filter((t) => (t.due && t.daysLeft <= ahead) || (t.remind && !t.remind.isAfter(now)));
    const fresh = force ? due : due.filter((t) => seen[t.file.path] !== today);
    if (!fresh.length) {
      if (force) new Notice('No projects need attention right now ✦');
      return;
    }
    for (const t of fresh) seen[t.file.path] = today;
    await this.saveSettings();
    const frag = createFragment((d) => {
      d.createDiv({ cls: 'tk-notice-title', text: `${fresh.length} project${fresh.length === 1 ? '' : 's'} need${fresh.length === 1 ? 's' : ''} attention` });
      for (const t of fresh.slice(0, 6)) {
        const line = d.createDiv({ cls: `tk-notice-line is-${t.bucket}` });
        line.createSpan({ cls: 'tk-notice-due', text: projectDueText(t) });
        line.createSpan({ text: ` ${t.title}` });
      }
      if (fresh.length > 6) d.createDiv({ text: `+${fresh.length - 6} more` });
      d.createDiv({ cls: 'tk-notice-hint', text: 'Click to open the Projects tab' });
    });
    const n = new Notice(frag, 0);
    const el = n.noticeEl || n.messageEl;
    if (el) {
      el.addClass('tk-notice');
      el.addEventListener('click', () => this.openTracker());
    }
  },
});
