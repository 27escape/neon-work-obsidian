/* ---- modals ------------------------------------------------------------- */
class NewTicketModal extends Modal {
  constructor(plugin, opts = {}) {
    super(plugin.app);
    this.plugin = plugin;
    this.opts = opts;
  }
  onOpen() {
    const p = this.plugin;
    this.modalEl.addClass('nd-modal', 'tk-form-modal');
    this.titleEl.empty();
    const tchip = this.titleEl.createSpan('tk-form-icon');
    setIcon(tchip, 'ticket');
    this.titleEl.createSpan({ text: 'New ticket' });
    const c = this.contentEl.createDiv('tk-form');
    const field = (parent, label, note, req) => {
      const f = parent.createDiv('tk-field');
      const l = f.createDiv('tk-label');
      l.createSpan({ text: label });
      if (note) l.createSpan({ cls: req ? 'tk-req' : 'tk-opt', text: note });
      return f;
    };
    const row = () => c.createDiv('tk-row');
    // template picker (only when there are templates): fills in steps, description, priority and due
    const tpls = p.settings.templates || [];
    let tplPick = null;
    if (tpls.length) tplPick = pills(field(c, 'Template', 'optional'), [['', 'None'], ...tpls.map((x) => [x.id, x.name])], '', (v) => applyTemplate(v), 'tk-chips tk-tpl-pick');
    const r1 = row();
    const title = field(r1, 'Title', 'required', true).createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'What is it about?' } });
    title.value = this.opts.title || '';
    const id = field(r1, 'Ticket ID', 'optional').createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. INC-4821' } });
    const descF = field(c, 'Description', 'required', true);
    const desc = descF.createEl('textarea', { cls: 'nd-input', attr: { rows: '3', placeholder: 'What’s wrong, who’s affected, since when?' } });
    const ready = c.createDiv('tk-ready');
    const r2 = row();
    const prio = pills(field(r2, 'Priority'), TICKET_PRIOS.map((x) => [x, x[0].toUpperCase() + x.slice(1)]), 'normal', null, 'tk-seg tk-prio');
    const cat = pills(field(r2, 'Time category'), CATS.map((k) => [k, CAT_SHORT[k]]), this.opts.category || p.settings.defaultCategory, null, 'tk-seg tk-cat');
    for (const k of CATS) cat.btns.get(k).style.setProperty('--pill-accent', catColor(k));
    const r3 = row();
    const dueF = field(r3, 'Due');
    const due = dueF.createEl('input', { cls: 'nd-input', attr: { type: 'date' } });
    const dueTxt = dueF.createDiv('tk-date-text');
    const chips = dueF.createDiv('nd-pills tk-chips');
    const chipBtns = DUE_CHIPS.map(([n, label]) => {
      const b = chips.createEl('button', { cls: 'nd-pill-btn', text: label, attr: { type: 'button' } });
      b.addEventListener('click', () => {
        due.value = moment().add(n, 'days').format('YYYY-MM-DD');
        syncDue();
      });
      return [n, b];
    });
    const remF = field(r3, 'Remind', 'optional');
    const remPick = remF.createEl('input', { cls: 'nd-input', attr: { type: 'datetime-local' } });
    const remTxt = remF.createDiv('tk-date-text');
    const rem = pills(remF, [['none', 'None'], ['before', 'Day before'], ['pick', 'Pick']], 'before', () => syncRem(), 'tk-chips');
    const stepsF = field(c, 'First steps', 'optional · Enter adds another');
    const stepsList = stepsF.createDiv('tk-steps');
    const steps = [];
    // the step list is always what the rows show, in order (template steps and your own mixed)
    const syncSteps = () => steps.splice(0, steps.length, ...[...stepsList.children].map((r) => r.textContent));
    const addStepRow = (v, fromTpl) => {
      steps.push(v);
      const r = stepsList.createDiv('tk-step-row' + (fromTpl ? ' is-from-tpl' : ''));
      r.createSpan('tk-box');
      r.createSpan({ text: v });
      const x = r.createSpan('tk-step-x');
      setIcon(x, 'x');
      x.addEventListener('click', () => {
        r.remove();
        syncSteps();
      });
    };
    const stepIn = stepsF.createEl('input', { cls: 'nd-input tk-step-input', attr: { type: 'text', placeholder: 'Add a step…' } });
    stepIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.isComposing) {
        e.preventDefault();
        const v = stepIn.value.trim();
        if (!v) return;
        addStepRow(v);
        stepIn.value = '';
      }
    });
    let tplDesc = '';
    let base = null; // priority and due from before the first template, restored by None
    const applyTemplate = (tid) => {
      const tpl = tpls.find((x) => x.id === tid);
      // what a previous template filled in is replaced; steps and text you typed yourself stay
      for (const r of [...stepsList.querySelectorAll('.tk-step-row.is-from-tpl')]) r.remove();
      syncSteps();
      if (tplDesc && desc.value.trim() === tplDesc) desc.value = '';
      tplDesc = '';
      if (!base) base = { prio: prio.get(), due: due.value };
      if (!tpl) {
        prio.set(base.prio);
        due.value = base.due;
        base = null;
        syncDue();
        return syncValid();
      }
      // template steps go first, your own after them
      const own = [...stepsList.children];
      for (const s of tpl.steps) addStepRow(s, true);
      for (const r of own) stepsList.appendChild(r);
      syncSteps();
      if (!desc.value.trim() && tpl.description) desc.value = tplDesc = tpl.description;
      prio.set(tpl.priority || base.prio);
      due.value = tpl.dueDays != null ? moment().add(tpl.dueDays, 'days').format('YYYY-MM-DD') : base.due;
      syncDue();
      syncValid();
    };
    const r4 = row();
    const jira = field(r4, 'Jira key', 'optional').createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. OPS-311' } });
    r4.createDiv('tk-field');

    const foot = this.contentEl.createDiv('tk-form-foot');
    foot.createDiv({ cls: 'tk-keys', text: 'Ctrl+Enter to create · Esc to cancel' });
    button(foot, { text: 'Cancel', onClick: () => this.close() });
    const create = button(foot, { text: 'Create ticket', cls: 'mod-cta', onClick: () => submit() });

    const fmtDay = (v) => (v ? moment(v).format('ddd D MMM') : '—');
    const syncDue = () => {
      const days = due.value ? moment(due.value).startOf('day').diff(moment().startOf('day'), 'days') : null;
      for (const [n, b] of chipBtns) b.toggleClass('is-on', days === n);
      dueTxt.setText(due.value ? `${fmtDay(due.value)} · ${days === 0 ? 'today' : days > 0 ? `in ${days}d` : `${-days}d ago`}` : 'No due date');
      syncRem();
    };
    const remValue = () => {
      const mode = rem.get();
      if (mode === 'before') return due.value ? moment(due.value).subtract(1, 'day').format('YYYY-MM-DD') + ' 09:00' : '';
      if (mode === 'pick') return remPick.value ? remPick.value.replace('T', ' ') : '';
      return '';
    };
    const syncRem = () => {
      remPick.toggle(rem.get() === 'pick');
      const v = remValue();
      remTxt.setText(v ? moment(v, 'YYYY-MM-DD HH:mm').format('ddd D MMM · HH:mm') : rem.get() === 'before' ? 'Set a due date first' : 'No reminder');
    };
    const valid = () => title.value.trim() && desc.value.trim();
    const syncValid = () => {
      const ok = valid();
      create.toggleClass('is-disabled', !ok);
      descF.toggleClass('is-ok', !!desc.value.trim());
      ready.toggleClass('is-ok', !!ok);
      ready.setText(ok ? '✓ ready to create' : !title.value.trim() && !desc.value.trim() ? 'Title and description are needed' : !title.value.trim() ? 'Title is needed' : 'A short description is needed');
    };
    const submit = async () => {
      if (!valid()) {
        (title.value.trim() ? desc : title).focus();
        (title.value.trim() ? desc : title).addClass('is-invalid');
        return;
      }
      const pending = stepIn.value.trim();
      if (pending) steps.push(pending);
      this.close();
      await p.createTicket({
        title: title.value.trim(),
        id: id.value.trim(),
        description: desc.value.trim(),
        priority: prio.get(),
        category: cat.get(),
        due: due.value,
        remind: remValue(),
        steps,
        jira: jira.value.trim(),
      });
    };
    for (const el of [title, desc]) el.addEventListener('input', () => (el.removeClass('is-invalid'), syncValid()));
    due.addEventListener('input', syncDue);
    remPick.addEventListener('input', syncRem);
    this.contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submit();
      }
    });
    due.value = p.settings.defaultDays ? moment().add(p.settings.defaultDays, 'days').format('YYYY-MM-DD') : '';
    syncDue();
    if (tplPick && this.opts.template && tpls.some((x) => x.id === this.opts.template)) {
      tplPick.set(this.opts.template);
      applyTemplate(this.opts.template);
    }
    syncValid();
    window.setTimeout(() => (title.value ? desc : title).focus(), 20);
  }
  onClose() {
    this.contentEl.empty();
  }
}

const newTemplateId = () => `tpl-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Add or edit a ticket template: a name and a list of steps, plus optional description, priority and due date. */
class TemplateModal extends Modal {
  constructor(plugin, tpl) {
    super(plugin.app);
    this.plugin = plugin;
    this.isNew = !tpl;
    this.tpl = tpl ? { ...tpl, steps: [...tpl.steps] } : { id: newTemplateId(), name: '', steps: [], description: '', priority: 'normal', dueDays: null };
  }
  onOpen() {
    const t = this.tpl;
    this.modalEl.addClass('nd-modal', 'tk-form-modal', 'tk-tpl-modal');
    this.titleEl.empty();
    setIcon(this.titleEl.createSpan('tk-form-icon'), 'layout-template');
    this.titleEl.createSpan({ text: this.isNew ? 'New template' : 'Edit template' });
    const c = this.contentEl.createDiv('tk-form');
    const field = (label, note) => {
      const f = c.createDiv('tk-field');
      const l = f.createDiv('tk-label');
      l.createSpan({ text: label });
      if (note) l.createSpan({ cls: 'tk-opt', text: note });
      return f;
    };
    const name = field('Name', 'required').createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. New laptop setup' } });
    name.value = t.name;

    // steps: edit in place, move up / down, remove; Enter in the last box adds the next
    const stepsF = field('Steps', 'Enter adds another');
    const list = stepsF.createDiv('tk-tpl-edit-steps');
    const draw = () => {
      list.empty();
      t.steps.forEach((s, i) => {
        const r = list.createDiv('tk-tpl-step');
        r.createSpan('tk-box');
        const inp = r.createEl('input', { cls: 'nd-input', attr: { type: 'text' } });
        inp.value = s;
        inp.addEventListener('input', () => (t.steps[i] = inp.value));
        const move = (d) => {
          const j = i + d;
          if (j < 0 || j >= t.steps.length) return;
          [t.steps[i], t.steps[j]] = [t.steps[j], t.steps[i]];
          draw();
        };
        button(r, { icon: 'arrow-up', cls: 'nd-icon-btn', title: 'Move up', onClick: () => move(-1) });
        button(r, { icon: 'arrow-down', cls: 'nd-icon-btn', title: 'Move down', onClick: () => move(1) });
        button(r, { icon: 'x', cls: 'nd-icon-btn', title: 'Remove step', onClick: () => (t.steps.splice(i, 1), draw()) });
      });
    };
    draw();
    const add = stepsF.createEl('input', { cls: 'nd-input tk-step-input', attr: { type: 'text', placeholder: 'Add a step…' } });
    add.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.isComposing) {
        e.preventDefault();
        const v = add.value.trim();
        if (!v) return;
        t.steps.push(v);
        add.value = '';
        draw();
      }
    });

    const desc = field('Description', 'optional · filled in when empty').createEl('textarea', { cls: 'nd-input', attr: { rows: '2', placeholder: 'Text the ticket starts with' } });
    desc.value = t.description || '';
    const row = c.createDiv('tk-row');
    const pf = row.createDiv('tk-field');
    pf.createDiv({ cls: 'tk-label', text: 'Priority' });
    const prio = pills(pf, TICKET_PRIOS.map((x) => [x, x[0].toUpperCase() + x.slice(1)]), t.priority || 'normal', null, 'tk-seg tk-prio');
    const df = row.createDiv('tk-field');
    const dl = df.createDiv('tk-label');
    dl.createSpan({ text: 'Due in (days)' });
    dl.createSpan({ cls: 'tk-opt', text: 'optional' });
    const dueDays = df.createEl('input', { cls: 'nd-input', attr: { type: 'number', min: '0', max: '365', placeholder: 'form default' } });
    dueDays.value = t.dueDays == null ? '' : String(t.dueDays);

    const foot = this.contentEl.createDiv('tk-form-foot');
    foot.createDiv({ cls: 'tk-keys', text: 'Ctrl+Enter to save · Esc to cancel' });
    button(foot, { text: 'Cancel', onClick: () => this.close() });
    const save = async () => {
      const n = name.value.trim();
      if (!n) return name.addClass('is-invalid'), name.focus();
      const pending = add.value.trim();
      if (pending) t.steps.push(pending);
      const dd = dueDays.value.trim() === '' ? null : clamp(Math.round(Number(dueDays.value)), 0, 365);
      this.close();
      await this.plugin.saveTemplate({ ...t, name: n, steps: t.steps.map((s) => s.trim()).filter(Boolean), description: desc.value.trim(), priority: prio.get() || 'normal', dueDays: Number.isFinite(dd) ? dd : null });
      new Notice(`Template “${n}” saved`);
    };
    button(foot, { text: this.isNew ? 'Create template' : 'Save', cls: 'mod-cta', onClick: save });
    name.addEventListener('input', () => name.removeClass('is-invalid'));
    this.contentEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        save();
      }
    });
    window.setTimeout(() => (t.name ? add : name).focus(), 20);
  }
  onClose() {
    this.contentEl.empty();
  }
}

/** Clear done tickets: all of them, or only those finished before this month. They go to the system trash. */
class ClearDoneModal extends Modal {
  constructor(plugin, done) {
    super(plugin.app);
    this.plugin = plugin;
    this.done = done;
  }
  onOpen() {
    const p = this.plugin;
    this.modalEl.addClass('nd-modal', 'tk-clear-modal');
    this.titleEl.setText('Clear done tickets');
    const c = this.contentEl;
    const monthStart = moment().startOf('month');
    const finished = (t) => (t.completed ? t.completed : moment(t.file.stat.mtime));
    const sets = {
      before: this.done.filter((t) => finished(t).isBefore(monthStart)),
      all: this.done,
    };
    const what = c.createDiv('tk-field');
    what.createDiv({ cls: 'tk-label', text: 'Which tickets' });
    const choice = pills(
      what,
      [
        ['before', `Finished before ${monthStart.format('MMMM')} (${sets.before.length})`],
        ['all', `All done (${sets.all.length})`],
      ],
      sets.before.length ? 'before' : 'all',
      () => sync(),
      'tk-chips',
    );
    const extra = c.createEl('label', { cls: 'tk-clear-extra' });
    const withFiles = extra.createEl('input', { attr: { type: 'checkbox' } });
    withFiles.checked = true;
    extra.appendText(' Also their screenshots and exported reports');
    const info = c.createEl('p', { cls: 'tk-faint' });
    const row = c.createDiv('nd-modal-row');
    button(row, { text: 'Cancel', onClick: () => this.close() });
    const go = button(row, {
      text: 'Move to trash',
      cls: 'mod-warning',
      onClick: async () => {
        const list = sets[choice.get()] || [];
        if (!list.length) return;
        this.close();
        await p.clearDone(list, withFiles.checked);
      },
    });
    const sync = () => {
      const n = (sets[choice.get()] || []).length;
      go.toggleClass('is-disabled', !n);
      info.setText(n ? `${n} ticket${n === 1 ? '' : 's'} go${n === 1 ? 'es' : ''} to the system trash (you can restore them from there). The “done in …” counter counts them no more; time logged in Neon Time stays.` : 'Nothing to clear for this choice.');
    };
    sync();
  }
  onClose() {
    this.contentEl.empty();
  }
}

/** A screenshot at full size. */
class ShotModal extends Modal {
  constructor(app, file) {
    super(app);
    this.file = file;
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'tk-shot-modal');
    this.titleEl.setText(this.file.name);
    this.contentEl.createEl('img', { attr: { src: this.app.vault.getResourcePath(this.file), alt: this.file.basename } });
  }
  onClose() {
    this.contentEl.empty();
  }
}

class WaitingModal extends Modal {
  constructor(plugin, t, onDone) {
    super(plugin.app);
    this.plugin = plugin;
    this.t = t;
    this.onDone = onDone;
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'tk-wait-modal');
    this.titleEl.setText(`Waiting · ${this.t.id || this.t.title}`);
    const c = this.contentEl;
    c.createDiv({ cls: 'tk-label', text: 'Waiting on who or what?' });
    const who = c.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. vendor support, Anna from finance' } });
    who.value = this.t.waitingOn || '';
    c.createDiv({ cls: 'tk-label', text: 'Follow up' });
    const pick = c.createEl('input', { cls: 'nd-input', attr: { type: 'date' } });
    const when = pills(c, [['1', 'Tomorrow'], ['3', '3d'], ['7', '1w'], ['pick', 'Pick']], '3', () => pick.toggle(when.get() === 'pick'), 'tk-chips');
    pick.toggle(false);
    pick.value = moment().add(3, 'days').format('YYYY-MM-DD');
    const row = c.createDiv('nd-modal-row');
    button(row, { text: 'Cancel', onClick: () => this.close() });
    const save = () => {
      const w = when.get();
      const date = w === 'pick' ? pick.value : moment().add(Number(w), 'days').format('YYYY-MM-DD');
      this.close();
      this.onDone({ who: who.value.trim(), followUp: date });
    };
    button(row, { text: 'Set waiting', cls: 'mod-cta', onClick: save });
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        save();
      }
    });
    window.setTimeout(() => who.focus(), 20);
  }
  onClose() {
    this.contentEl.empty();
  }
}

class TimeEntryModal extends Modal {
  constructor(plugin, t, onDone) {
    super(plugin.app);
    Object.assign(this, { plugin, t, onDone });
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'tk-time-modal');
    this.titleEl.setText(`Log time · ${this.t.id || this.t.title}`);
    const c = this.contentEl;
    c.createDiv({ cls: 'tk-label', text: 'Minutes' });
    const min = c.createEl('input', { cls: 'nd-input', attr: { type: 'number', min: '1', max: '960', value: '30' } });
    const quick = c.createDiv('nd-pills tk-chips');
    for (const n of [15, 30, 45, 60, 90]) {
      const b = quick.createEl('button', { cls: 'nd-pill-btn', text: fmtMin(n), attr: { type: 'button' } });
      b.addEventListener('click', () => {
        min.value = String(n);
        quick.querySelectorAll('.is-on').forEach((x) => x.removeClass('is-on'));
        b.addClass('is-on');
      });
    }
    c.createDiv({ cls: 'tk-label', text: 'What did you do?' });
    const note = c.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'e.g. call with vendor' } });
    const row = c.createDiv('nd-modal-row');
    button(row, { text: 'Cancel', onClick: () => this.close() });
    const save = () => {
      const n = Math.round(Number(min.value));
      if (!(n > 0 && n <= 960)) return min.addClass('is-invalid');
      this.close();
      this.onDone({ min: n, note: note.value.trim() });
    };
    button(row, { text: 'Log time', cls: 'mod-cta', onClick: save });
    c.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        save();
      }
    });
    window.setTimeout(() => min.select(), 20);
  }
  onClose() {
    this.contentEl.empty();
  }
}

function ticketMenu(plugin, t, m) {
  m.addItem((i) => i.setTitle('Open').setIcon('ticket').onClick(() => plugin.showTicket(t.file)));
  m.addItem((i) => i.setTitle('Open in new tab').setIcon('file-plus-2').onClick(() => plugin.openTicket(t.file, true)));
  m.addItem((i) => i.setTitle('Edit as note').setIcon('file-text').onClick(() => plugin.openRaw(t.file)));
  m.addSeparator();
  if (t.status === 'done') m.addItem((i) => i.setTitle('Reopen').setIcon('rotate-ccw').onClick(() => plugin.setStatus(t, 'open')));
  else m.addItem((i) => i.setTitle('Mark done').setIcon('check').onClick(() => plugin.setStatus(t, 'done')));
  for (const s of TICKET_STATUS) {
    if (s === 'done') continue;
    m.addItem((i) => i.setTitle(`Status: ${TICKET_STATUS_LABEL[s]}`).setChecked(t.status === s).onClick(() => plugin.setStatus(t, s)));
  }
  m.addSeparator();
  for (const p of [...TICKET_PRIOS].reverse()) m.addItem((i) => i.setTitle(`Priority: ${p}`).setChecked(t.priority === p).onClick(() => plugin.setPriority(t, p)));
  m.addSeparator();
  for (const [n, label] of [[1, '+1 day'], [3, '+3 days'], [7, '+1 week'], [14, '+2 weeks']]) m.addItem((i) => i.setTitle(`Postpone ${label}`).setIcon('calendar-clock').onClick(() => plugin.postpone(t, n)));
  m.addItem((i) => i.setTitle('Set due date…').setIcon('calendar').onClick(() => plugin.promptDate(t, 'due')));
  m.addItem((i) => i.setTitle('Remind me on…').setIcon('bell').onClick(() => plugin.promptDate(t, 'remind')));
}

