Object.assign(NeonProjects.prototype, {
  /* the dashboard card ---------------------------------------------------------- */
  mountWidget(card) {
    const p = this;
    button(card.actions, { icon: 'plus', cls: 'nd-icon-btn', title: 'New project', onClick: () => p.newProject() });
    const counter = card.body.createDiv('tk-counter is-mini');
    card.body.addClass('is-list'); // a column, the list filling it (styles-tracker.css)
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
        // fork: two lines: the title and its status; under them when it is due, the customer and what needs action
        const r = list.createDiv(`tk-mini tk-mini-2 is-${t.bucket}`);
        r.style.setProperty('--i', String(Math.min(i, 20)));
        const main = r.createDiv('tk-mini-main');
        const top = main.createDiv('tk-mini-top');
        tip(top.createSpan({ cls: 'tk-mini-title', text: t.title }), t.customer ? `${t.title} · ${t.customer}` : t.title);
        if (t.statusRaw) top.createSpan({ cls: `tk-tag-wait s-${t.status}`, text: t.statusRaw });
        const meta = main.createDiv('tk-mini-meta');
        meta.createSpan({ cls: 'tk-mini-due', text: projectDueText(t) });
        if (t.customer) meta.createSpan({ cls: 'tk-mini-cust', text: t.customer });
        p.renderPlanBadges(meta, t); // fork: late, overdue, due soon, blocked: small coloured pills
        r.addEventListener('click', (e) => p.openProject(t.file, e));
        hoverPreview(p.app, r, t.file);
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
