/* ---- manual entry / edit -------------------------------------------------- */
/** "930", "0930", "9:5", "9.30", "14" -> "09:30", "09:30", "09:05", "09:30", "14:00"; null when it isn't a time. */
function parseClock(s) {
  const t = String(s || '').trim();
  const m = /^(\d{1,2})(?:[:.h ](\d{1,2}))?$/.exec(t) || /^(\d{1,2})(\d{2})$/.exec(t);
  if (!m || +m[1] > 23 || +(m[2] || 0) > 59) return null;
  return `${m[1].padStart(2, '0')}:${(m[2] || '0').padStart(2, '0')}`;
}
/** Date plus From / Until clock text -> { start, ms }, or { bad: 'from' | 'until' }; Until at or before From means the
 *  next day (23:30 -> 00:30 is 1 h), max 16 h. */
function entryRange(date, from, until) {
  const f = parseClock(from);
  if (!f) return { bad: 'from' };
  const u = parseClock(until);
  if (!u) return { bad: 'until' };
  const s = moment(`${date} ${f}`, 'YYYY-MM-DD HH:mm', true);
  const e = moment(`${date} ${u}`, 'YYYY-MM-DD HH:mm', true);
  if (!s.isValid()) return { bad: 'from' };
  if (!e.isAfter(s)) e.add(1, 'day'); // crosses midnight (moment keeps the clock time across DST)
  const n = e.diff(s, 'minutes');
  return n > 0 && n <= 960 ? { start: s.valueOf(), ms: n * 60000 } : { bad: 'until' };
}
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
    // From / Until: you say when you finished, not how many minutes it took
    let s0;
    let s1;
    if (e.ms) (s0 = moment(e.start)), (s1 = moment(e.start + e.ms));
    else if (e.start) (s0 = moment(e.start)), (s1 = moment(e.start).add(this.isBreak ? 15 : 30, 'minutes'));
    else {
      // today: ends now, or for a break where work stopped (an open pause or End day)
      const w = this.isBreak && p.workOf(moment().format('YYYY-MM-DD'));
      const open = w && w.breaks.find((x) => x[1] == null);
      s1 = moment(w ? Math.min(Date.now(), w.end || Infinity, open ? open[0] : Infinity) : Date.now());
      s0 = s1.clone().subtract(this.isBreak ? 15 : 30, 'minutes');
    }
    const date = field('Date', row).createEl('input', { cls: 'nd-input', attr: { type: 'date' } });
    date.value = s0.format('YYYY-MM-DD');
    const clockField = (label, m) => {
      const el = field(label, row).createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. 930 or 9:30', 'aria-label': label } });
      el.value = m.format('HH:mm');
      el.addEventListener('blur', () => {
        const v = parseClock(el.value);
        if (v) el.value = v;
      });
      return el;
    };
    const from = clockField('From', s0);
    const until = clockField('Until', s1);
    const dur = c.createDiv('tm-dur');
    const showDur = () => {
      const r = entryRange(date.value, from.value, until.value);
      for (const el of [from, until]) el.removeClass('is-invalid');
      dur.setText(r.bad ? (parseClock(from.value) && parseClock(until.value) ? 'Over 16 h — check From and Until' : '') : `= ${fmtMin(r.ms / 60000)}`);
      dur.toggleClass('is-bad', !!r.bad);
    };
    for (const el of [date, from, until]) el.addEventListener('input', showDur);
    const shown = () => [date.value, from.value, until.value].join('|');
    const initial = shown(); // an edit that leaves the times alone keeps the exact start and length
    showDur();
    // quick lengths count back from Until
    const quick = c.createDiv('nd-pills tm-chips');
    for (const n of [15, 30, 45, 60, 90, 120]) {
      const b = quick.createEl('button', { cls: 'nd-pill-btn', text: fmtMin(n), attr: { type: 'button', title: `From = Until − ${fmtMin(n)}` } });
      b.addEventListener('click', () => {
        const u = parseClock(until.value);
        if (!u) return until.addClass('is-invalid');
        from.value = moment(`${date.value} ${u}`, 'YYYY-MM-DD HH:mm').subtract(n, 'minutes').format('HH:mm');
        showDur();
      });
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
      if (!moment(date.value, 'YYYY-MM-DD', true).isValid()) return date.addClass('is-invalid');
      const r = entryRange(date.value, from.value, until.value);
      if (r.bad) return (r.bad === 'from' ? from : until).addClass('is-invalid');
      const v = e.ms && shown() === initial ? { start: e.start, ms: e.ms } : { start: r.start, ms: r.ms };
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
    window.setTimeout(() => (this.isNew && !e.note && note ? note : until).focus(), 20);
  }
  onClose() {
    this.contentEl.empty();
  }
}

