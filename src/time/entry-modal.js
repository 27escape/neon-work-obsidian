/* ---- manual entry / edit -------------------------------------------------- */
class EntryModal extends Modal {
  /** entry: existing entry to edit (with .day), or a partial one for a new entry */
  constructor(plugin, entry, isNew, isBreak = false) {
    super(plugin.app);
    Object.assign(this, { plugin, entry, isNew, isBreak });
  }
  onOpen() {
    const p = this.plugin;
    const e = this.entry;
    this.modalEl.addClass('nd-modal', 'tm-modal');
    this.titleEl.setText(this.isBreak ? 'Log a break' : this.isNew ? 'Add time' : 'Edit time entry');
    const c = this.contentEl;
    const field = (label, parent = c) => {
      const f = parent.createDiv('tm-field');
      f.createDiv({ cls: 'tm-label', text: label });
      return f;
    };
    const row = c.createDiv('tm-row');
    const start = moment(e.start || Date.now());
    const date = field('Date', row).createEl('input', { cls: 'nd-input', attr: { type: 'date' } });
    date.value = start.format('YYYY-MM-DD');
    const time = field('Start', row).createEl('input', { cls: 'nd-input', attr: { type: 'time' } });
    time.value = e.start ? start.format('HH:mm') : '';
    time.placeholder = 'optional';
    const minF = field('Minutes', row);
    const min = minF.createEl('input', { cls: 'nd-input', attr: { type: 'number', min: '1', max: '960' } });
    min.value = e.ms ? String(entryMin(e)) : '30';
    const quick = c.createDiv('nd-pills tm-chips');
    for (const n of [15, 30, 45, 60, 90, 120]) {
      const b = quick.createEl('button', { cls: 'nd-pill-btn', text: fmtMin(n), attr: { type: 'button' } });
      b.addEventListener('click', () => (min.value = String(n)));
    }
    let cat;
    let note;
    let jira;
    if (!this.isBreak) {
      cat = pills(field('Category'), TIME_CATS.map((k) => [k, CAT_LABEL[k]]), normCat(e.cat) || 'operations', null, 'tm-cats');
      for (const k of TIME_CATS) cat.btns.get(k).style.setProperty('--pill-accent', catColor(k));
      note = field('What did you do?').createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. CRM ticket 8812' } });
      note.value = e.note || '';
      jira = field('Jira key (optional)').createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. OPS-311' } });
      jira.value = e.jira || '';
    }

    const foot = c.createDiv('nd-modal-row');
    if (!this.isNew)
      button(foot, {
        icon: 'trash-2',
        text: 'Delete',
        cls: 'tm-del',
        onClick: () => {
          this.close();
          p.deleteEntry(e);
        },
      });
    button(foot, { text: 'Cancel', onClick: () => this.close() });
    const save = () => {
      const n = Math.round(Number(min.value));
      if (!(n > 0 && n <= 960)) return min.addClass('is-invalid');
      const d = moment(date.value, 'YYYY-MM-DD', true);
      if (!d.isValid()) return date.addClass('is-invalid');
      if (this.isBreak && !time.value) return time.addClass('is-invalid');
      // no start time: place it so it ends now (today) or at 09:00 (other days)
      let s;
      if (time.value) s = moment(`${date.value} ${time.value}`, 'YYYY-MM-DD HH:mm', true);
      else if (d.isSame(moment(), 'day')) s = moment().subtract(n, 'minutes');
      else s = d.clone().hour(9);
      if (!s.isValid()) return time.addClass('is-invalid');
      if (!s.isSame(d, 'day')) s = d.clone().startOf('day');
      const v = { start: s.valueOf(), ms: n * 60000 };
      if (this.isBreak) {
        if (p.addBreak(v)) this.close();
        return;
      }
      this.close();
      Object.assign(v, { cat: cat.get() || 'other', note: note.value.trim(), jira: jira.value.trim() });
      if (this.isNew) p.addEntry({ ...v, path: e.path || '', source: e.source || 'manual' });
      else p.updateEntry(e, v);
    };
    button(foot, { text: this.isNew ? 'Add' : 'Save', cls: 'mod-cta', onClick: save });
    c.addEventListener('keydown', (ev) => {
      // Enter saves from the fields only; on a focused button (Delete, Cancel, a chip) it presses that button
      if (ev.key === 'Enter' && !ev.isComposing && ev.target instanceof HTMLInputElement) {
        ev.preventDefault();
        save();
      }
    });
    window.setTimeout(() => (this.isNew && !e.note && note ? note : min).focus(), 20);
  }
  onClose() {
    this.contentEl.empty();
  }
}

