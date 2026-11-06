Object.assign(NeonTickets.prototype, {
  /* writing ------------------------------------------------------------------ */
  async patch(t, patch) {
    await this.app.fileManager.processFrontMatter(t.file, (fm) => {
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === '') delete fm[k];
        else fm[k] = v;
      }
    });
  },
  async log(t, text) {
    await writeNote(this.app, t.file, (d) => addToSection(d, 'log', `- ${STAMP()} — ${text}`));
    this.app.workspace.trigger('neon:ticket-changed', { file: t.file, id: t.id, title: t.title, change: text });
  },
  /** How many steps of a ticket are still open (read from the note). */
  async openSteps(t) {
    return parseTicketBody(stripFrontmatter(await this.app.vault.cachedRead(t.file))).steps.filter((s) => !s.done).length;
  },
  /** Change a ticket's status. Done is refused (false) while steps are open. */
  async setStatus(t, status) {
    if (status === t.status) return;
    if (status === 'done') {
      const n = await this.openSteps(t);
      if (n) {
        new Notice(`${n} step${n > 1 ? 's' : ''} still open — finish ${n > 1 ? 'them' : 'it'} first`);
        return false;
      }
    }
    if (status === 'waiting') {
      return new WaitingModal(this, t, async ({ who, followUp }) => {
        const wait = { status: 'waiting', waiting_on: who || null, follow_up: followUp || null, waiting_since: moment().format('YYYY-MM-DD') };
        if (t.status === 'done') wait.completed = null;
        await this.patch(t, wait);
        this.logStatus(t, 'waiting');
        await this.log(t, `Waiting${who ? ' on ' + who : ''}${followUp ? ` · follow up ${moment(followUp).format('ddd D MMM')}` : ''}`);
      }).open();
    }
    const patch = { status, waiting_on: null, follow_up: null, waiting_since: null };
    if (status === 'done') patch.completed = moment().format('YYYY-MM-DD');
    else if (t.status === 'done') patch.completed = null;
    await this.patch(t, patch);
    this.logStatus(t, status);
    await this.log(t, status === 'done' ? 'Done' : t.status === 'done' ? 'Reopened' : `Status: ${TICKET_STATUS_LABEL[t.status]} → ${TICKET_STATUS_LABEL[status]}`);
    if (status === 'done') {
      new Notice(`✓ ${t.id ? t.id + ' · ' : ''}${t.title} — done`);
      if (this.settings.autoFile) await this.moveDone(t.file, moment());
    } else if (t.status === 'done' && this.settings.autoFile) await this.moveBack(t.file);
    return true;
  },
  /** Tick every open step in one queued write, with one log line. */
  completeAllSteps(t) {
    if (!this.writeQ) this.writeQ = new Map();
    const key = t.file.path;
    const next = (this.writeQ.get(key) || Promise.resolve())
      .then(() =>
        writeNote(this.app, t.file, (d) => {
          const open = parseTicketBody(stripFrontmatter(d)).steps.filter((s) => !s.done);
          if (!open.length) return d;
          const lines = d.split('\n');
          const offset = d.slice(0, d.length - stripFrontmatter(d).length).split('\n').length - 1;
          for (const s of open) lines[s.line + offset] = lines[s.line + offset].replace('[ ]', '[x]').replace(/\s*$/, '') + ` ✅ ${STAMP()}`;
          return addToSection(lines.join('\n'), 'log', `- ${STAMP()} — All steps done (${open.length})`);
        }),
      )
      .catch((e) => {
        console.error('Neon Tickets: could not complete the steps', e);
        new Notice('Could not save the steps');
      });
    this.writeQ.set(key, next);
    return next;
  },
  /** Remember a status change for the dashboard's Recently done log (only the statuses chosen in settings). */
  logStatus(t, status) {
    if (!this.settings.activityStatuses.includes(status)) return;
    const log = this.settings.statusLog;
    log.push({ t: Date.now(), id: t.id || '', title: t.title, status, path: t.file.path });
    if (log.length > 200) log.splice(0, log.length - 200);
    this.saveSettings();
    const api = deckApi(this.app);
    if (api && api.activityChanged) api.activityChanged();
  },
  async setPriority(t, p) {
    if (p === t.priority) return;
    await this.patch(t, { priority: p });
    await this.log(t, `Priority: ${t.priority} → ${p}`);
  },
  async postpone(t, days) {
    const today = moment().startOf('day');
    const base = t.due && !t.due.isBefore(today) ? t.due.clone() : today;
    await this.setDue(t, base.add(days, 'days').format('YYYY-MM-DD'));
  },
  async setDue(t, v) {
    await this.patch(t, { due: v || null });
    await this.log(t, v ? `Due moved${t.due ? ` from ${t.due.format('D MMM')}` : ''} to ${moment(v).format('ddd D MMM')}` : 'Due date cleared');
    if (v) new Notice(`${t.id || t.title} → due ${moment(v).format('ddd D MMM')}`);
  },
  async setRemind(t, v) {
    await this.patch(t, { remind: v || null });
    await this.log(t, v ? `Reminder set for ${moment(v, ['YYYY-MM-DD HH:mm', 'YYYY-MM-DD']).format('ddd D MMM HH:mm')}` : 'Reminder cleared');
    delete this.settings.notified[t.file.path];
    await this.saveSettings();
  },
  promptDate(t, key) {
    const cur = t[key];
    new DatePromptModal(this.app, {
      title: key === 'due' ? `Due date · ${t.id || t.title}` : `Remind me · ${t.id || t.title}`,
      time: key === 'remind',
      value: cur ? cur.format(key === 'remind' ? 'YYYY-MM-DDTHH:mm' : 'YYYY-MM-DD') : '',
      onSubmit: (v) => (key === 'due' ? this.setDue(t, v) : this.setRemind(t, v)),
    }).open();
  },
  /** Add a step. No log line (only checking a step is logged). Writes per ticket are queued so fast Enters never clash. */
  addStep(t, text) {
    if (!this.writeQ) this.writeQ = new Map();
    const key = t.file.path;
    const next = (this.writeQ.get(key) || Promise.resolve())
      .then(() => writeNote(this.app, t.file, (d) => addToSection(d, 'steps', `- [ ] ${text}`)))
      .catch((e) => console.error('Neon Tickets: could not add step', e));
    this.writeQ.set(key, next);
    return next;
  },
  /**
   * Tick or untick a step: one queued write flips the box and (for a finished step) adds the log line.
   * step.done flips at once, so the row can update before the write and a quick second click toggles back.
   */
  toggleStep(t, step) {
    const wasDone = step.done;
    step.done = !wasDone;
    if (!this.writeQ) this.writeQ = new Map();
    const key = t.file.path;
    let ok = false;
    const next = (this.writeQ.get(key) || Promise.resolve())
      .then(() =>
        writeNote(this.app, t.file, (d) => {
          const lines = d.split('\n');
          const fmLen = d.length - stripFrontmatter(d).length;
          const offset = d.slice(0, fmLen).split('\n').length - 1;
          const i = step.line + offset;
          const l = lines[i];
          if (l === undefined || !l.includes(step.text)) return d;
          ok = true;
          if (wasDone) lines[i] = l.replace(/\[[^ ]\]/, '[ ]').replace(/\s*✅\s*\d{4}-\d{2}-\d{2}(\s+\d{1,2}:\d{2})?\s*$/u, '');
          else lines[i] = l.replace('[ ]', '[x]').replace(/\s*$/, '') + ` ✅ ${STAMP()}`;
          const out = lines.join('\n');
          // only finished steps go in the log; reopening one stays quiet
          return wasDone ? out : addToSection(out, 'log', `- ${STAMP()} — Step done: ${step.text}`);
        }),
      )
      .then(() => {
        if (!ok) {
          step.done = wasDone;
          new Notice('That step changed in the meantime — refreshed');
        } else if (!wasDone) this.app.workspace.trigger('neon:ticket-changed', { file: t.file, id: t.id, title: t.title, change: `Step done: ${step.text}` });
      })
      .catch((e) => {
        step.done = wasDone;
        console.error('Neon Tickets: could not change step', e);
        new Notice('Could not save the step');
      });
    this.writeQ.set(key, next);
    return next;
  },
  /** Change a step's line, or delete it and its completion log when fn returns null. */
  async changeStepLine(t, step, fn) {
    let ok = false;
    await writeNote(this.app, t.file, (d) => {
      const lines = d.split('\n');
      const fmLen = d.length - stripFrontmatter(d).length;
      const offset = d.slice(0, fmLen).split('\n').length - 1;
      const i = step.line + offset;
      const l = lines[i];
      if (l === undefined || !l.includes(step.text)) return d;
      ok = true;
      const nl = fn(l);
      if (nl === null) {
        lines.splice(i, 1);
        const log = lines.findIndex((x) => {
          const m = x.match(/^\s*[-*+]\s+\d{4}-\d{2}-\d{2} \d{1,2}:\d{2} — Step done: (.*)$/);
          return m && m[1] === step.text;
        });
        if (log !== -1) lines.splice(log, 1);
      } else lines[i] = nl;
      return lines.join('\n');
    });
    if (!ok) new Notice('That step changed in the meantime — refreshed');
    return ok;
  },
  async editStep(t, step, text) {
    return this.changeStepLine(t, step, (l) => {
      const m = l.match(/^(\s*[-*+]\s+\[.\]\s*)(.*?)(\s*✅\s*\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?\s*)?$/u);
      return m ? m[1] + text + (m[3] || '') : l;
    });
  },
  async removeStep(t, step) {
    return this.changeStepLine(t, step, () => null);
  },
  async addLog(t, text) {
    await this.log(t, text);
  },
  async addDescription(t, text) {
    await writeNote(this.app, t.file, (d) => addToSection(d, 'description', text));
    await this.log(t, 'Description updated');
  },
  async logTime(t, { min, note }) {
    const start = moment().subtract(min, 'minutes');
    await writeNote(this.app, t.file, (d) => addToSection(d, 'time', `- ${start.format('YYYY-MM-DD HH:mm')} · ${min}m${note ? ' · ' + note : ''}`));
    await this.log(t, `Time logged: ${fmtMin(min)}${note ? ' — ' + note : ''}`);
    this.app.workspace.trigger('neon:time-entry', {
      start: start.valueOf(),
      min,
      cat: t.category,
      note: note ? `${t.id ? t.id + ' ' : ''}${note}` : `${t.id ? t.id + ' · ' : ''}${t.title}`,
      path: t.file.path,
      jira: t.jira,
      source: 'ticket',
    });
  },

});
