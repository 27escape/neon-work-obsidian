Object.assign(NeonTasks.prototype, {
  /* tasks widget --------------------------------------------------------- */
  mountTasks(card) {
    const body = card.body;
    const list = body.createDiv('nt-list');
    const add = body.createDiv('nt-add');
    const input = add.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'Add a task… (Enter → Quick tasks)' } });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      if (!input.value.trim()) return shake(add);
      const v = input.value;
      input.value = '';
      this.addQuickTask(v);
    });
    button(card.actions, { icon: 'calendar-days', cls: 'nd-icon-btn', title: 'Open today’s note', onClick: async () => openFile(this.app, await ensureToday(this.app)) });
    let token = 0;
    let first = true; // the first draw shows rows without the "new" animation
    let count = 0;
    const render = async () => {
      const my = ++token;
      const items = await this.collectTasks();
      if (my !== token || !list.isConnected) return;
      if (editingIn(list)) return; // redrawn when the edit ends
      // quick tasks typed a moment ago that the index hasn't seen yet
      const quick = this.quickPath();
      const have = new Set(items.filter((t) => t.quick).map((t) => t.raw));
      const todayKey = moment().format('YYYY-MM-DD');
      this.pendingQuick = (this.pendingQuick || []).filter((p) => !have.has(p.text) && Date.now() - p.at < 10000);
      for (const p of this.pendingQuick) {
        const file = this.app.vault.getAbstractFileByPath(quick) || { path: quick, basename: 'Quick tasks' };
        items.push({ file, line: -1, raw: p.text, ...taskGroup(p.text, null, todayKey), carried: null, display: taskDisplay(p.text), quick: true, pending: true });
      }
      this.openCount = items.length;
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
          e.createDiv({ cls: 'nt-empty-hint', text: 'Tasks come from notes tagged “tasks”, today’s daily note and the box below.' });
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
          const sig = `${t.group}|${t.due}|${t.carried ? t.carried.format('YYYY-MM-DD') : ''}|${t.display}|${t.pending ? 1 : 0}`;
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
  taskRow(list, t, i) {
    const row = list.createDiv('nt-task' + (t.pending ? ' is-pending' : ''));
    row._t = t; // handlers read the latest task: a kept row may have moved to another line
    row.style.setProperty('--i', String(Math.min(i, 20)));
    const box = row.createDiv('nt-check');
    tip(box, 'Done');
    const txt = row.createDiv({ cls: 'nt-text', text: t.display || t.raw });
    if (t.due) {
      const d = moment(t.due);
      row.createSpan({ cls: `nt-due is-${t.group}`, text: t.group === 'today' ? 'today' : d.format('D MMM') });
    } else if (t.carried) row.createSpan({ cls: 'nt-due is-carried', text: `from ${t.carried.format('ddd')}` });
    const src = row.createSpan({ cls: 'nt-src', text: t.quick ? 'quick' : t.file.basename });
    tip(src, t.file.path);
    const edit = row.createDiv('nt-del nt-edit-btn');
    setIcon(edit, 'pencil');
    tip(edit, 'Edit');
    box.addEventListener('click', async () => {
      if (row.hasClass('is-done') || row._t.pending) return;
      row.addClass('is-done');
      try {
        await this.completeTask(row._t);
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
          txt.setText(taskDisplay(v));
          try {
            await this.editTask(row._t, v);
          } catch (e) {
            console.error('Neon Tasks: could not edit task', e);
            new Notice('Could not save the task');
            txt.setText(row._t.display || row._t.raw);
          }
        }
        this.emit();
      };
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(true);
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
