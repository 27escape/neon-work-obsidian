class NeonTickets extends Plugin {
  async onload() {
    this.moving = new Set();
    const raw = await this.loadData();
    this.settings = Object.assign({}, TICKETS_DEFAULTS, raw || {});
    this.settings.defaultCategory = normCat(this.settings.defaultCategory);
    if (!raw) await this.migrateFromDeck();
    if (!this.settings.notified || typeof this.settings.notified !== 'object') this.settings.notified = {};
    // templates: keep only well-formed ones (a name and a list of text steps)
    this.settings.templates = (Array.isArray(this.settings.templates) ? this.settings.templates : [])
      .filter((x) => x && typeof x === 'object' && String(x.name || '').trim())
      .map((x) => ({
        id: String(x.id || newTemplateId()),
        name: String(x.name).trim(),
        steps: Array.isArray(x.steps) ? x.steps.map((v) => String(v).trim()).filter(Boolean) : [],
        description: String(x.description || ''),
        priority: TICKET_PRIOS.includes(x.priority) ? x.priority : 'normal',
        dueDays: Number.isFinite(x.dueDays) ? x.dueDays : null,
      }));
    // own copies, never the arrays in TICKETS_DEFAULTS
    this.settings.statusLog = Array.isArray(this.settings.statusLog) ? this.settings.statusLog.slice(-200) : [];
    if (!TICKET_SORTS.some(([k]) => k === this.settings.tabSort)) this.settings.tabSort = 'due';
    this.settings.activityStatuses = Array.isArray(this.settings.activityStatuses) ? this.settings.activityStatuses.slice() : ['done', 'waiting'];
    await this.saveSettings();
    this.rawPaths = new Set();
    this.listeners = new Set();
    this.cache = null;

    this.registerView(VIEW_TICKETS, (leaf) => new TicketsView(leaf, this));
    this.registerView(VIEW_TICKET, (leaf) => new TicketView(leaf, this));
    this.registerHoverLinkSource(VIEW_TICKETS, { display: 'Neon tickets', defaultMod: true });
    this.addRibbonIcon('ticket', 'Ticket tracker', () => this.openTracker());
    this.patchLeaf();

    this.addCommand({ id: 'open-tickets', name: 'Open ticket tracker', callback: () => this.openTracker() });
    this.addCommand({ id: 'new-ticket', name: 'New ticket', callback: () => this.newTicket() });
    this.addCommand({ id: 'ticket-reminders', name: 'Show tickets that need attention', callback: () => this.checkReminders(true) });
    this.addCommand({ id: 'file-done', name: 'File all done tickets into Done/YYYY-MM', callback: () => this.fileAllDone(true) });
    const cur = (id, name, fn) =>
      this.addCommand({
        id,
        name,
        checkCallback: (checking) => {
          const f = this.app.workspace.getActiveFile();
          const t = f && this.ticketFor(f);
          if (!t) return false;
          if (!checking) fn(t);
          return true;
        },
      });
    cur('ticket-done', 'Ticket: mark current ticket done', (t) => this.setStatus(t, 'done'));
    cur('ticket-postpone-1', 'Ticket: postpone current ticket by 1 day', (t) => this.postpone(t, 1));
    cur('ticket-postpone-7', 'Ticket: postpone current ticket by 1 week', (t) => this.postpone(t, 7));
    cur('ticket-due', 'Ticket: set due date of current ticket', (t) => this.promptDate(t, 'due'));
    cur('ticket-view', 'Ticket: toggle ticket view / note', (t) => {
      const leaf = this.app.workspace.getLeaf(false);
      if (leaf.view.getViewType() === VIEW_TICKET) this.openRaw(t.file, leaf);
      else this.openTicket(t.file, false, leaf);
    });
    this.addSettingTab(new NeonTicketsSettingTab(this.app, this));
    this.buildStatus();

    // Only ticket notes invalidate the list: typing in other notes costs nothing.
    const dirty = () => {
      this.cache = null;
      this.emitSoon();
    };
    const known = (path) => !!(this.cache && this.cache.paths.has(path));
    this.registerEvent(
      this.app.metadataCache.on('changed', (f, _d, cache) => {
        if (!isTicketCache(cache) && !known(f.path)) return;
        dirty();
        if (isTicketCache(cache)) this.fileSoon(f);
      }),
    );
    this.registerEvent(this.app.vault.on('delete', (f) => known(f.path) && dirty()));
    this.registerEvent(this.app.vault.on('rename', (f, old) => (known(old) || f instanceof TFolder || isTicketCache(this.app.metadataCache.getFileCache(f))) && dirty()));
    // the first full index after startup
    const ref = this.app.metadataCache.on('resolved', () => {
      this.app.metadataCache.offref(ref);
      dirty();
    });
    this.registerEvent(ref);
    this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => this.decorateMarkdown(leaf)));
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.hookCore()));
    this.templates = [];
    const tplChanged = debounce(() => this.loadTemplates(), 300, true);
    const inTpl = (path) => !!path && path.startsWith(this.templateDir() + '/');
    for (const ev of ['create', 'modify', 'delete']) this.registerEvent(this.app.vault.on(ev, (f) => inTpl(f.path) && tplChanged()));
    this.registerEvent(this.app.vault.on('rename', (f, old) => (inTpl(f.path) || inTpl(old)) && tplChanged()));
    this.app.workspace.onLayoutReady(() => {
      this.hookCore();
      this.initTemplates().catch((e) => console.error('Neon Tickets: templates', e));
      window.setTimeout(async () => {
        if (!this.settings.migrated) {
          this.settings.migrated = true;
          await this.saveSettings();
        }
        // file any done tickets that were left in the ticket folder
        if (this.settings.autoFile) await this.fileAllDone(false);
        this.checkReminders();
      }, 4000);
      this.registerInterval(window.setInterval(() => this.checkReminders(), 15 * 60 * 1000));
    });
  }
  onunload() {
    if (this.fileTimers) for (const id of this.fileTimers.values()) window.clearTimeout(id);
    const api = deckApi(this.app);
    if (api) {
      api.unregisterWidget('tickets');
      api.unregisterCapture('ticket');
      api.unregisterFacts('tickets');
      api.unregisterActivity && api.unregisterActivity('tickets');
      api.unregisterAction('tickets');
      api.unprovide('ticketClick');
      api.unregisterWeekLine('tickets');
    }
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  /** First run: take the ticket settings from Neon Deck 1.2's data. */
  async migrateFromDeck() {
    try {
      const path = normalizePath(`${this.app.vault.configDir}/plugins/neon-deck/data.json`);
      if (!(await this.app.vault.adapter.exists(path))) return;
      const old = JSON.parse(await this.app.vault.adapter.read(path));
      const map = { ticketFolder: 'ticketFolder', ticketDefaultDays: 'defaultDays', ticketReminders: 'reminders', ticketRemindDays: 'remindDays', ticketNotified: 'notified' };
      for (const [a, b] of Object.entries(map)) if (old[a] !== undefined) this.settings[b] = old[a];
    } catch (e) {
      console.warn('Neon Tickets: could not read Neon Deck 1.2 settings', e);
    }
  }
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emitSoon() {
    if (!this._emit)
      this._emit = debounce(() => {
        for (const fn of this.listeners) fn();
        const api = deckApi(this.app);
        if (api) api.factsChanged();
      }, 300, true);
    this._emit();
  }
  hookCore() {
    const api = deckApi(this.app);
    if (!api) return;
    api.registerWidget({ id: 'tickets', slot: 'tickets', title: 'Tickets', icon: 'ticket', mount: (card) => this.mountWidget(card) });
    api.registerCapture({ id: 'ticket', label: 'Ticket', short: 'Ticket', icon: 'ticket', order: 20, allowEmpty: true, run: (v) => this.newTicket({ title: v }) });
    api.registerAction({ id: 'tickets', icon: 'ticket', label: 'Tickets', order: 20, view: VIEW_TICKETS, run: () => this.openTracker() });
    api.provide('ticketClick', (f) => {
      if (!this.settings.popup || !this.ticketFor(f)) return false;
      new TicketPopup(this, f).open();
      return true;
    });
    if (api.registerActivity)
      api.registerActivity('tickets', () =>
        this.settings.statusLog.map((x) => ({
          t: x.t,
          kind: 'ticket',
          text: x.title,
          src: x.id || '',
          status: x.status,
          open: () => {
            const f = this.app.vault.getAbstractFileByPath(x.path);
            if (f instanceof TFile) this.showTicket(f);
          },
        })),
      );
    api.registerFacts('tickets', () => {
      const act = this.activeTickets();
      const week = act.filter((t) => t.due && t.daysLeft >= 0 && t.daysLeft <= 7).length;
      const over = act.filter((t) => t.bucket === 'overdue').length;
      const out = [{ v: week, l: week === 1 ? 'ticket due this week' : 'tickets due this week' }];
      if (over) out.push({ v: over, l: 'overdue' });
      const n = this.doneIn(moment());
      if (n) out.push({ v: n, l: `done in ${moment().format('MMMM')}` });
      return out;
    });
    api.registerWeekLine('tickets', (start, end) => {
      const n = this.collectTickets().filter((t) => t.completed && !t.completed.isBefore(start) && t.completed.isBefore(end)).length;
      return n ? [`${n} ticket${n === 1 ? '' : 's'} closed`] : [];
    });
  }

  /* routing: tickets open in the ticket view ----------------------------- */
  patchLeaf() {
    const proto = obsidian.WorkspaceLeaf.prototype;
    const orig = proto.setViewState;
    const self = this;
    proto.setViewState = function (state, eState) {
      try {
        if (self.settings.openInTicketView && state && state.type === 'markdown' && state.state && typeof state.state.file === 'string' && !self.rawPaths.has(state.state.file)) {
          const f = self.app.vault.getAbstractFileByPath(state.state.file);
          if (f instanceof TFile && isTicketCache(self.app.metadataCache.getFileCache(f))) state = Object.assign({}, state, { type: VIEW_TICKET });
        }
      } catch (e) {
        console.error('Neon Tickets routing', e);
      }
      return orig.call(this, state, eState);
    };
    this.register(() => {
      if (proto.setViewState !== orig) proto.setViewState = orig;
    });
  }
  /** A click on a ticket: pop-up by default, Ctrl/Cmd+click opens a tab. */
  showTicket(file, e) {
    this.followedUp(file);
    if (e && (e.ctrlKey || e.metaKey)) return this.openTicket(file, true);
    if (e && e.shiftKey) return this.openTicket(file, 'split');
    if (!this.settings.popup) return this.openTicket(file);
    new TicketPopup(this, file).open();
  }
  /** Opening a ticket whose follow-up is due is the follow-up: the next one moves autoFollowUpDays ahead (issue 58). */
  async followedUp(file) {
    const t = this.activeTickets().find((x) => x.file === file);
    if (!t || t.bucket !== 'followup') return;
    const next = moment().add(this.settings.autoFollowUpDays, 'days');
    await this.patch(t, { follow_up: next.format('YYYY-MM-DD') });
    await this.log(t, `Followed up · next follow up ${next.format('ddd D MMM')}`);
  }
  async openTicket(file, newTab, leaf) {
    this.rawPaths.delete(file.path);
    leaf = leaf || (newTab ? this.app.workspace.getLeaf(newTab === 'split' ? 'split' : 'tab') : reusableLeaf(this.app));
    await leaf.setViewState({ type: this.settings.openInTicketView ? VIEW_TICKET : 'markdown', state: { file: file.path }, active: true });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }
  async openRaw(file, leaf) {
    this.rawPaths.add(file.path);
    leaf = leaf || reusableLeaf(this.app);
    await leaf.setViewState({ type: 'markdown', state: { file: file.path, mode: 'source' }, active: true });
  }
  decorateMarkdown(leaf) {
    const view = leaf && leaf.view;
    if (!view || view.getViewType() !== 'markdown' || !view.file || view.ntAction) return;
    if (!this.ticketFor(view.file)) return;
    view.ntAction = view.addAction('ticket', 'Ticket view', () => view.file && this.openTicket(view.file, false, view.leaf));
  }
  openTracker() {
    return activateView(this.app, VIEW_TICKETS, 'tab');
  }

  buildStatus() {
    const el = this.addStatusBarItem();
    el.addClass('nd-status', 'tk-statusbar', 'mod-clickable');
    setIcon(el.createSpan('nd-status-icon'), 'ticket');
    const txt = el.createSpan('nd-status-text');
    tip(el, 'Tickets — click to open the tracker');
    el.addEventListener('click', () => this.openTracker());
    const update = () => {
      const act = this.activeTickets();
      const over = act.filter((t) => t.bucket === 'overdue').length;
      const fu = act.filter((t) => t.bucket === 'followup').length;
      const today = act.filter((t) => t.bucket === 'today').length;
      el.toggle(act.length > 0);
      const parts = [];
      if (over) parts.push(`${over} overdue`);
      if (fu) parts.push(`${fu} follow up`);
      if (today) parts.push(`${today} today`);
      txt.setText(parts.length ? parts.join(' · ') : `${act.length} open`);
      el.toggleClass('is-alert', over > 0);
      el.toggleClass('is-warn', !over && today + fu > 0);
    };
    this.register(this.onChange(update));
    this.registerInterval(window.setInterval(update, 5 * 60 * 1000));
    this.app.workspace.onLayoutReady(update);
  }
}
