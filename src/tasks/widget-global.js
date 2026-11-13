Object.assign(NeonTasks.prototype, {
  /* the Todo card (fork) --------------------------------------------------
   * Replaces the Global tasks list kept in plugin data: it shows the open tasks of the Todo note in file
   * order. Adding writes a task at the head of that note; ticking and editing change its line there. */
  async addGlobal(text) {
    await this.addQuickTask(text);
  },
  /** Global tasks saved by upstream Neon Tasks (plugin data): offer once to move them into the Todo note. */
  offerGlobalMove() {
    const items = this.settings.globalTasks || [];
    if (!items.length || this.settings.globalMoveAsked) return;
    new ConfirmModal(this.app, {
      title: 'Move Global tasks into Todo?',
      text: `${items.length} Global task${items.length === 1 ? '' : 's'} from the original Neon Tasks are stored in plugin data. Add them to the head of ${this.quickPath()}?`,
      cta: 'Move',
      warning: false,
      onConfirm: async () => {
        try {
          for (const t of items.slice().reverse()) await this.writeQuickTask(t.text);
          this.settings.globalTasks = [];
        } catch (e) {
          if (!(e && e.neonReadOnly)) console.error('Neon Tasks: could not move Global tasks', e);
          return;
        }
        this.settings.globalMoveAsked = true;
        await this.saveSettings();
        new Notice(`✦ Moved ${items.length} task${items.length === 1 ? '' : 's'} into Todo`);
      },
    }).open();
    this.settings.globalMoveAsked = true;
    this.saveSettings();
  },
  mountGlobal(card) {
    const body = card.body;
    const list = body.createDiv('nt-list nt-global');
    const add = body.createDiv('nt-add');
    const input = add.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'Add to Todo… (Enter)' } });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      if (!input.value.trim()) return shake(add);
      const v = input.value;
      input.value = '';
      this.addQuickTask(v);
    });
    button(card.actions, {
      icon: 'file-text',
      cls: 'nd-icon-btn',
      title: 'Open the Todo note',
      onClick: (e) => {
        const f = this.todoFile();
        if (f) openFile(this.app, f, e);
        else new Notice(`No Todo note at ${this.quickPath()} yet. Set it in Settings → Neon Tasks.`);
      },
    });
    let token = 0;
    let first = true;
    let count = 0;
    const render = async () => {
      const my = ++token;
      const items = await this.collectTodo();
      if (my !== token || !list.isConnected || editingIn(list)) return;
      // tasks typed a moment ago that the index hasn't seen yet
      const have = new Set(items.map((t) => t.raw));
      const todayKey = moment().format('YYYY-MM-DD');
      this.pendingQuick = (this.pendingQuick || []).filter((p) => ![...have].some((r) => r.includes(p.text)) && Date.now() - p.at < 10000);
      const pending = this.pendingQuick.map((p) => ({ file: { path: this.quickPath(), basename: 'Todo' }, line: -1, raw: p.text, ...taskGroup(p.text, null, todayKey), carried: null, display: p.text, quick: true, pending: true }));
      const all = [...pending, ...items];
      countUp(card.badge, count, all.length, (v) => (Math.round(v) ? String(Math.round(v)) : ''), 300);
      count = all.length;
      const old = new Map([...list.children].filter((el) => el.dataset.key && !el.hasClass('is-leaving')).map((el) => [el.dataset.key, el]));
      const want = [];
      if (!all.length) {
        let e = old.get('empty');
        if (!e) {
          e = emptyState(list, this.todoFile() ? 'Nothing open in Todo ✦' : `No Todo note yet: the first task you add creates ${this.quickPath()}`);
          e.addClass('nt-fade-in');
          e.dataset.key = 'empty';
        }
        want.push(e);
      }
      const dup = new Map();
      all.slice(0, 60).forEach((t, i) => {
        const base = `${t.line}|${t.raw}`;
        const n = dup.get(base) || 0;
        dup.set(base, n + 1);
        const key = `${base}#${n}`;
        const sig = `${t.group}|${t.due}|${t.display}|${t.doing ? 1 : 0}|${t.pending ? 1 : 0}`;
        let row = old.get(key);
        if (row && row.dataset.sig === sig) row._t = t;
        else {
          const fresh = this.taskRow(list, t, i, true);
          fresh.dataset.key = key;
          fresh.dataset.sig = sig;
          if (row) row.replaceWith(fresh);
          else if (!first) fresh.addClass('is-new');
          row = fresh;
        }
        want.push(row);
      });
      patchList(list, want);
      first = false;
    };
    const off = this.onChange(render);
    render();
    return { destroy: off };
  },
});
