Object.assign(NeonTasks.prototype, {
  /* tasks widget --------------------------------------------------------- */
  mountTasks(card) {
    const body = card.body;
    // fork: tasks from across your notes; the Todo note has its own card (with the add box)
    const list = body.createDiv('nt-list');
    button(card.actions, { icon: 'calendar-days', cls: 'nd-icon-btn', title: 'Open this period’s daily / weekly note', onClick: async () => openFile(this.app, await ensureToday(this.app)) });
    let token = 0;
    let first = true; // the first draw shows rows without the "new" animation
    let count = 0;
    const render = async () => {
      const my = ++token;
      const all = await this.collectTasks();
      if (my !== token || !list.isConnected) return;
      if (editingIn(list)) return; // redrawn when the edit ends
      this.openCount = all.length;
      const items = all.filter((t) => !t.quick); // Todo tasks are in the Todo card
      countUp(card.badge, count, items.length, (v) => (Math.round(v) ? String(Math.round(v)) : ''), 300);
      count = items.length;
      const old = new Map([...list.children].filter((el) => el.dataset.key && !el.hasClass('is-leaving')).map((el) => [el.dataset.key, el]));
      const want = [];
      if (!items.length) {
        let e = old.get('empty');
        if (!e) {
          e = emptyState(list, 'All clear ✦ no open tasks');
          e.addClass('nt-fade-in');
          e.dataset.key = 'empty';
          e.createDiv({ cls: 'nt-empty-hint', text: `Tasks are checkbox lines with ${this.settings.taskTag || 'the task tag'} in any note (Todo has its own card), plus notes tagged “tasks” and recent daily notes.` });
        }
        want.push(e);
      }
      let i = 0;
      const dup = new Map();
      for (const [g, label] of [['overdue', 'Overdue'], ['today', 'Today'], ['later', 'Later']]) {
        const group = items.filter((t) => t.group === g);
        if (!group.length) continue;
        const head = old.get(`g:${g}`) || list.createDiv({ cls: `nt-group is-${g}` });
        head.dataset.key = `g:${g}`;
        head.setText(`${label} · ${group.length}`);
        want.push(head);
        for (const t of group.slice(0, 40)) {
          const base = `${t.file.path}|${t.raw}`;
          const n = dup.get(base) || 0;
          dup.set(base, n + 1);
          const key = `${base}#${n}`;
          const sig = `${t.group}|${t.due}|${t.carried ? t.carried.format('YYYY-MM-DD') : ''}|${t.display}|${t.doing ? 1 : 0}`;
          let row = old.get(key);
          if (row && row.dataset.sig === sig) row._t = t;
          else {
            const fresh = this.taskRow(list, t, i);
            fresh.dataset.key = key;
            fresh.dataset.sig = sig;
            if (row) row.replaceWith(fresh); // same task, changed text: swap in place
            else if (!first) fresh.addClass('is-new');
            row = fresh;
          }
          i++;
          want.push(row);
        }
      }
      patchList(list, want);
      first = false;
    };
    const off = this.onChange(render);
    render();
    return { destroy: off };
  },
  taskRow(list, t, i, inTodo) {
    const row = list.createDiv('nt-task' + (t.pending ? ' is-pending' : '') + (t.doing ? ' is-doing' : ''));
    row._t = t; // handlers read the latest task: a kept row may have moved to another line
    row.style.setProperty('--i', String(Math.min(i, 20)));
    const box = row.createDiv('nt-check');
    tip(box, 'Done');
    // fork: the text gets the full width; the date and note sit on a smaller line underneath
    const body = row.createDiv('nt-body');
    const txt = body.createDiv({ cls: 'nt-text', text: t.display || t.raw });
    const meta = body.createDiv('nt-meta');
    if (t.due) {
      const d = moment(t.due);
      meta.createSpan({ cls: `nt-due is-${t.group}`, text: t.group === 'today' ? 'today' : d.format('D MMM') });
    } else if (t.carried) meta.createSpan({ cls: 'nt-due is-carried', text: `from ${t.carried.format('ddd')}` });
    if (t.doing) tip(box, 'In progress · click when done');
    const src = meta.createSpan({ cls: 'nt-src', text: inTodo ? '' : t.quick ? 'Todo' : t.file.basename });
    if (!meta.textContent) meta.remove();
    tip(src, t.file.path);
    const edit = row.createDiv('nt-del nt-edit-btn');
    setIcon(edit, 'pencil');
    tip(edit, 'Edit');
    box.addEventListener('click', async () => {
      if (row.hasClass('is-done') || row._t.pending) return;
      row.addClass('is-done');
      try {
        if ((await this.completeTask(row._t)) === false) (row.removeClass('is-done'), this.emit());
      } catch (e) {
        console.error('Neon Tasks: could not tick task', e);
        new Notice('Could not tick the task');
        row.removeClass('is-done');
      }
    });
    const open = (e) => !row._t.pending && openFile(this.app, row._t.file, e, row._t.line);
    txt.addEventListener('click', open);
    src.addEventListener('click', open);
    edit.addEventListener('click', () => {
      if (row._t.pending || row.querySelector('.nt-edit')) return;
      const inp = createEl('input', { cls: 'nd-input nt-edit', attr: { type: 'text' } });
      inp.value = row._t.raw; // the whole line text, so the 📅 date and tags can be changed too
      txt.replaceWith(inp);
      inp.focus();
      const done = async (save) => {
        if (!inp.isConnected) return;
        const v = inp.value.trim();
        inp.replaceWith(txt);
        if (save && v && v !== row._t.raw) {
          txt.setText(taskDisplay(v, this.settings.taskTag));
          try {
            if (!(await this.editTask(row._t, v))) txt.setText(row._t.display || row._t.raw);
          } catch (e) {
            console.error('Neon Tasks: could not edit task', e);
            new Notice('Could not save the task');
            txt.setText(row._t.display || row._t.raw);
          }
        }
        this.emit();
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.isComposing) done(true);
        else if (e.key === 'Escape') {
          e.stopPropagation();
          done(false);
        }
      });
      inp.addEventListener('blur', () => done(true));
    });
    return row;
  },

});
