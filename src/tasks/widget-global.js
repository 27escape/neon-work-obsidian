Object.assign(NeonTasks.prototype, {
  /* global tasks ---------------------------------------------------------- */
  async addGlobal(text) {
    text = String(text || '').trim();
    if (!text) return;
    this.settings.globalTasks.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, created: Date.now() });
    await this.globalChanged();
    new Notice('✦ Global task added');
  },
  async globalChanged() {
    this.emit();
    await this.saveSettings();
    if (!this._backupSoon) this._backupSoon = debounce(() => this.writeBackup(), 15000, true);
    this._backupSoon();
  },
  mountGlobal(card) {
    const body = card.body;
    const list = body.createDiv('nt-list nt-global');
    const add = body.createDiv('nt-add');
    const input = add.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'Add a global task… (Enter)' } });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      if (!input.value.trim()) return shake(add);
      const v = input.value;
      input.value = '';
      this.addGlobal(v);
    });
    let dragId = null;
    let first = true;
    let count = 0;
    const render = () => {
      if (!list.isConnected || editingIn(list)) return;
      const items = this.settings.globalTasks;
      countUp(card.badge, count, items.length, (v) => (Math.round(v) ? String(Math.round(v)) : ''), 300);
      count = items.length;
      const old = new Map([...list.children].filter((el) => el.dataset.key && !el.hasClass('is-leaving')).map((el) => [el.dataset.key, el]));
      const want = [];
      if (!items.length) {
        let e = old.get('empty');
        if (!e) {
          e = emptyState(list, 'Nothing here — add the big things you shouldn’t forget');
          e.addClass('nt-fade-in');
          e.dataset.key = 'empty';
        }
        want.push(e);
      }
      items.forEach((t, i) => {
        const prevRow = old.get(t.id);
        if (prevRow && prevRow.dataset.sig === t.text) return want.push(prevRow);
        const row = list.createDiv('nt-task nt-gtask' + (!first && !prevRow ? ' is-new' : ''));
        row.dataset.key = t.id;
        row.dataset.sig = t.text;
        if (prevRow) prevRow.replaceWith(row); // edited: swap in place
        want.push(row);
        row.style.setProperty('--i', String(Math.min(i, 20)));
        row.setAttr('draggable', 'true');
        icon(row, 'grip-vertical', 'nt-grip');
        const box = row.createDiv('nt-check');
        tip(box, 'Done');
        const txt = row.createDiv({ cls: 'nt-text', text: t.text });
        tip(txt, 'Double-click to edit · drag to reorder');
        const del = row.createDiv('nt-del');
        setIcon(del, 'x');
        tip(del, 'Delete');
        box.addEventListener('click', () => {
          if (row.hasClass('is-done')) return;
          row.addClass('is-done');
          window.setTimeout(async () => {
            const idx = this.settings.globalTasks.findIndex((x) => x.id === t.id);
            if (idx >= 0) this.settings.globalTasks.splice(idx, 1);
            this.logDone(t.text, 'global');
            await this.globalChanged();
          }, 900);
        });
        del.addEventListener('click', async () => {
          const idx = this.settings.globalTasks.findIndex((x) => x.id === t.id);
          if (idx < 0) return;
          const [removed] = this.settings.globalTasks.splice(idx, 1);
          await this.globalChanged();
          const n = new Notice(createFragment((f) => {
            f.appendText('Global task deleted · ');
            f.createEl('a', { text: 'Undo', href: '#' }).addEventListener('click', async (e) => {
              e.preventDefault();
              this.settings.globalTasks.splice(Math.min(idx, this.settings.globalTasks.length), 0, removed);
              await this.globalChanged();
              n.hide();
            });
          }), 6000);
        });
        txt.addEventListener('dblclick', () => {
          const inp = createEl('input', { cls: 'nd-input nt-edit', attr: { type: 'text' } });
          inp.value = t.text;
          txt.replaceWith(inp);
          inp.focus();
          inp.select();
          const done = async (save) => {
            if (!inp.isConnected) return;
            const v = inp.value.trim();
            if (save && v && v !== t.text) {
              t.text = v;
              inp.blur();
              await this.globalChanged();
            } else {
              inp.replaceWith(txt);
              render();
            }
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
        row.addEventListener('dragstart', (e) => {
          dragId = t.id;
          row.addClass('is-dragging');
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', t.text);
          }
        });
        row.addEventListener('dragend', () => {
          dragId = null;
          row.removeClass('is-dragging');
          list.querySelectorAll('.is-drop-above, .is-drop-below').forEach((el) => el.removeClass('is-drop-above', 'is-drop-below'));
        });
        row.addEventListener('dragover', (e) => {
          if (!dragId || dragId === t.id) return;
          e.preventDefault();
          const r = row.getBoundingClientRect();
          const below = e.clientY > r.top + r.height / 2;
          row.toggleClass('is-drop-below', below);
          row.toggleClass('is-drop-above', !below);
        });
        row.addEventListener('dragleave', () => row.removeClass('is-drop-above', 'is-drop-below'));
        row.addEventListener('drop', async (e) => {
          if (!dragId || dragId === t.id) return;
          e.preventDefault();
          const arr = this.settings.globalTasks;
          const from = arr.findIndex((x) => x.id === dragId);
          if (from < 0) return;
          const [moved] = arr.splice(from, 1);
          const r = row.getBoundingClientRect();
          let to = arr.findIndex((x) => x.id === t.id);
          if (e.clientY > r.top + r.height / 2) to++;
          arr.splice(to, 0, moved);
          dragId = null;
          await this.globalChanged();
        });
      });
      patchList(list, want);
      first = false;
    };
    const off = this.onChange(render);
    render();
    return { destroy: off };
  },

  /* backup ---------------------------------------------------------------- */
  backupFile() {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.backupPath));
    return f instanceof TFile ? f : null;
  },
  async writeBackup(notify) {
    try {
      const path = normalizePath(this.settings.backupPath);
      const items = this.settings.globalTasks;
      const body = [
        '---',
        'neon: global-tasks-backup',
        `updated: ${moment().format('YYYY-MM-DD HH:mm')}`,
        `count: ${items.length}`,
        '---',
        '# Global tasks backup',
        '',
        '> [!info] Read-only copy',
        '> Written by Neon Tasks. Edits here are ignored. If the plugin data is ever lost, Neon Tasks offers to restore from this note.',
        '',
        ...items.map((t) => `- [ ] ${t.text.replace(/\n/g, ' ')}`),
        '',
      ].join('\n');
      const f = this.backupFile();
      if (f) {
        await this.app.vault.process(f, (cur) => (stripFrontmatter(cur).trim() !== stripFrontmatter(body).trim() ? body : cur));
      } else {
        await ensureFolder(this.app, path.split('/').slice(0, -1).join('/'));
        await this.app.vault.create(path, body);
      }
      this.settings.lastBackup = moment().format('YYYY-MM-DD');
      await this.saveSettings();
      if (notify) new Notice('✦ Global tasks backed up');
    } catch (e) {
      console.error('Neon Tasks backup', e);
    }
  },
  dailyBackup() {
    if (this.settings.lastBackup !== moment().format('YYYY-MM-DD')) this.writeBackup();
  },
  async maybeRestore() {
    if (!this.freshData || this.settings.globalTasks.length) return;
    const f = this.backupFile();
    if (!f) return;
    const items = (await this.app.vault.read(f))
      .split('\n')
      .map((l) => l.match(/^- \[ \] (.+)$/))
      .filter(Boolean)
      .map((m) => m[1].trim());
    if (!items.length) return;
    new ConfirmModal(this.app, {
      title: 'Restore Global tasks?',
      text: `Neon Tasks has no saved data, but its backup note has ${items.length} global task${items.length === 1 ? '' : 's'}. Restore them?`,
      cta: 'Restore',
      warning: false,
      onConfirm: async () => {
        this.settings.globalTasks = items.map((text, i) => ({ id: `r${Date.now().toString(36)}${i}`, text, created: Date.now() }));
        await this.globalChanged();
        new Notice(`✦ Restored ${items.length} global tasks`);
      },
    }).open();
  },

});
