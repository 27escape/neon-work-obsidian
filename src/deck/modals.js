/* ------------------------------------------------------------------ */
/* Small modals                                                        */
/* ------------------------------------------------------------------ */

class FileListModal extends SuggestModal {
  constructor(plugin, files, placeholder) {
    super(plugin.app);
    this.plugin = plugin;
    this.files = files;
    this.setPlaceholder(placeholder);
    this.modalEl.addClass('nd-modal');
  }
  getSuggestions(q) {
    q = q.toLowerCase();
    return this.files.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 300);
  }
  renderSuggestion(f, el) {
    el.addClass('nd-suggest');
    el.createDiv({ cls: 'nd-suggest-title', text: f.basename });
    const parent = f.parent && f.parent.path !== '/' ? f.parent.path : '';
    el.createDiv({ cls: 'nd-suggest-meta', text: `${parent ? parent + ' · ' : ''}${moment(f.stat.mtime).fromNow()}` });
  }
  onChooseSuggestion(f, evt) {
    openFile(this.app, f, evt);
  }
}

/** Activity: one day in a pop-up — worked time, then tasks, tickets, time entries and notes, each clickable. */
class ActivityDayModal extends Modal {
  constructor(plugin, day, x) {
    super(plugin.app);
    this.plugin = plugin;
    this.day = day;
    this.x = x || { tasks: [], tickets: [], time: [], notes: [], worked: null };
  }
  onOpen() {
    const x = this.x;
    this.modalEl.addClass('nd-modal', 'nd-root', 'nd-act-pop');
    this.titleEl.setText(this.day.format('dddd D MMMM'));
    const c = this.contentEl;
    const facts = c.createDiv('nd-act-pop-facts');
    const fact = (v, l) => {
      const f = facts.createDiv('nd-act-pop-fact');
      f.createDiv({ cls: 'nd-act-pop-v', text: String(v) });
      f.createDiv({ cls: 'nd-act-pop-l', text: l });
    };
    if (x.worked) fact(fmtMin(x.worked), x.over ? `worked · +${fmtMin(x.over)}` : 'worked');
    fact(x.tasks.length, 'tasks');
    fact(x.tickets.length, 'tickets');
    fact(x.notes.length, 'notes');
    let i = 0;
    for (const [kind, label, list] of [['task', 'Tasks done', x.tasks], ['ticket', 'Projects', x.tickets], ['time', 'Time', x.time], ['note', 'Notes', x.notes]]) {
      if (!list.length) continue;
      const sec = c.createDiv('nd-act-pop-sec');
      sec.createDiv({ cls: 'nd-act-pop-head', text: `${label} · ${list.length}` });
      for (const r of list.slice().sort((a, b) => a.t - b.t)) {
        const el = sec.createDiv(`nd-act-item is-${kind}` + (r.open ? ' is-clickable' : ''));
        el.style.setProperty('--i', String(Math.min(i++, 20)));
        icon(el, { task: 'check', ticket: 'briefcase', time: 'clock', note: 'file-text' }[kind], 'nd-ico');
        el.createSpan({ cls: 'nd-act-item-text', text: r.text });
        if (r.extra) el.createSpan({ cls: 'nd-act-pop-extra', text: r.extra });
        el.createSpan({ cls: 'nd-act-pop-at', text: moment(r.t).format('HH:mm') });
        if (r.open)
          el.addEventListener('click', (e) => {
            this.close();
            r.open(e);
          });
      }
    }
    if (!i) c.createDiv({ cls: 'nd-act-none', text: 'Nothing on this day.' });
  }
  onClose() {
    this.contentEl.empty();
  }
}

/**
 * Quick capture box (Ctrl+Shift+Space). Type, pick a target with Tab /
 * Shift+Tab or Alt+1…9, Enter saves.
 */
class QuickCaptureModal extends Modal {
  constructor(plugin, initial = '') {
    super(plugin.app);
    this.plugin = plugin;
    this.initial = initial;
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'nd-qc-modal');
    this.titleEl.setText('Quick capture');
    const targets = this.plugin.captureTargets();
    if (!targets.length) {
      this.contentEl.createDiv({ cls: 'nd-muted', text: 'Turn on Tasks, Projects or Time in the settings to capture into them.' });
      return;
    }
    let idx = Math.max(0, targets.findIndex((t) => t.id === this.plugin.lastCaptureTarget));
    const input = this.contentEl.createEl('textarea', { cls: 'nd-input nd-qc-input', attr: { rows: '2', placeholder: 'Type, pick where it goes, Enter…' } });
    input.value = this.initial;
    const row = this.contentEl.createDiv('nd-qc-targets');
    const btns = targets.map((t, i) => {
      const b = row.createEl('button', { cls: 'nd-pill-btn', attr: { type: 'button' } });
      icon(b, t.icon || 'dot');
      b.createSpan({ text: t.label });
      b.createSpan({ cls: 'nd-kbd', text: String(i + 1) });
      b.addEventListener('click', () => {
        idx = i;
        sync();
        go();
      });
      return b;
    });
    const hint = this.contentEl.createDiv({ cls: 'nd-qc-hint', text: 'Tab picks the target · Alt+1…' + targets.length + ' jumps · Enter saves · Shift+Enter new line' });
    const sync = () => btns.forEach((b, i) => b.toggleClass('is-on', i === idx));
    const go = async () => {
      const v = input.value.trim();
      const t = targets[idx];
      if (!t) return;
      if (!v && !t.allowEmpty) {
        input.focus();
        return;
      }
      this.plugin.lastCaptureTarget = t.id;
      this.close();
      try {
        await t.run(v);
      } catch (e) {
        console.error('Neon Deck capture', e);
        new Notice('Capture failed — see console');
      }
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        idx = (idx + (e.shiftKey ? targets.length - 1 : 1)) % targets.length;
        sync();
      } else if (e.altKey && /^[1-9]$/.test(e.key) && Number(e.key) <= targets.length) {
        e.preventDefault();
        idx = Number(e.key) - 1;
        sync();
      } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        go();
      }
    });
    sync();
    hint.toggle(targets.length > 1);
    window.setTimeout(() => input.focus(), 10);
  }
  onClose() {
    this.contentEl.empty();
  }
}


/** Folder colour…: swatches, any colour from the picker, or back to the category colour. */
class FolderColorModal extends Modal {
  constructor(plugin, folder) {
    super(plugin.app);
    this.plugin = plugin;
    this.folder = folder;
    this.modalEl.addClass('nd-modal', 'nd-color-modal');
  }
  onOpen() {
    const { contentEl } = this;
    const cur = this.plugin.settings.folderColors[this.folder.path] || null;
    this.titleEl.setText(`Folder colour · ${this.folder.name}`);
    const set = async (c) => {
      await this.plugin.setFolderColor(this.folder.path, c);
      this.close();
    };
    const grid = contentEl.createDiv('nd-swatches');
    for (const c of FOLDER_COLORS) {
      const b = grid.createEl('button', { cls: 'nd-swatch' + (c === cur ? ' is-on' : ''), attr: { type: 'button', 'aria-label': c } });
      b.style.setProperty('--sw', c);
      b.addEventListener('click', () => set(c));
    }
    const row = contentEl.createDiv('nd-modal-row');
    const pick = row.createEl('input', { cls: 'nd-color-pick', attr: { type: 'color', 'aria-label': 'Any colour' } });
    pick.value = cur && cur.startsWith('#') ? cur : '#a855f7';
    pick.addEventListener('change', () => set(pick.value));
    row.createSpan({ cls: 'nd-color-hint', text: 'Any colour' });
    button(row, { icon: 'rotate-ccw', text: 'Automatic (category)', onClick: () => set(null) });
  }
  onClose() {
    this.contentEl.empty();
  }
}
