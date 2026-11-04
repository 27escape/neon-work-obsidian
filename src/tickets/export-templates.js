Object.assign(NeonTickets.prototype, {
  /* ---- export ---- */
  /** Build a report note for the ticket (Core/Tickets/Exports) and open Obsidian's PDF export for it. */
  async exportTicket(t) {
    const text = await this.app.vault.read(t.file);
    const b = parseTicketBody(stripFrontmatter(text));
    const day = (m) => (m ? moment(m).format('D MMM YYYY') : '—');
    const done = b.steps.filter((x) => x.done).length;
    const total = b.time.reduce((sum, x) => sum + x.min, 0);
    const facts = [
      ['Ticket', t.id || '—'],
      ['Jira', t.jira || '—'],
      ['Status', TICKET_STATUS_LABEL[t.status] || t.status],
      ['Priority', t.priority],
      ['Opened', day(t.created)],
      ['Due', day(t.due)],
      ['Completed', day(t.completed)],
      ['Time logged', total ? fmtMin(total) : '—'],
    ];
    const md = [
      '---',
      'type: ticket-report',
      'untracked: true', // reading a report is not work on the ticket
      `ticket: ${JSON.stringify(t.file.path)}`,
      `exported: ${moment().format('YYYY-MM-DD HH:mm')}`,
      'cssclasses: [tk-report]',
      '---',
      `# ${t.title}`,
      '',
      '| Detail | Value |',
      '| --- | --- |',
      ...facts.map(([k, v]) => `| **${k}** | ${String(v).replace(/\|/g, '\\|')} |`),
      '',
      '## Description',
      ...(b.description.length ? b.description : ['_No description._']),
      '',
      `## Steps (${done} of ${b.steps.length} done)`,
      ...(b.steps.length ? b.steps.map((x) => `- [${x.done ? 'x' : ' '}] ${x.text}${x.done && x.at ? ` — done ${x.at}` : ''}`) : ['_No steps._']),
      '',
      '## Screenshots',
      ...(b.shots.length ? b.shots.flatMap((x) => [`![[${x.link}]]`, '']) : ['_No screenshots._', '']),
      '## Time logged',
      ...(b.time.length ? b.time.map((x) => `- ${x.date}${x.start ? ' ' + x.start : ''} · ${fmtMin(x.min)}${x.note ? ` · ${x.note}` : ''}`) : ['_No time logged._']),
      '',
      '## Log',
      ...(b.log.length ? b.log.slice().sort((x, y) => (y.when ? y.when.valueOf() : 0) - (x.when ? x.when.valueOf() : 0)).map((x) => `- ${x.when ? x.when.format(x.hasTime ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD') + ' — ' : ''}${x.text}`) : ['_Nothing logged._']),
      '',
      `_Exported ${moment().format('D MMM YYYY, HH:mm')} from Neon Tickets._`,
      '',
    ].join('\n');
    const dir = normalizePath(`${this.settings.ticketFolder || 'Core/Tickets'}/Exports`);
    await ensureFolder(this.app, dir);
    const path = normalizePath(`${dir}/${safeName(`${t.id ? t.id + ' ' : ''}${t.title}`) || 'Ticket'} report.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    const report = existing instanceof TFile ? (await this.app.vault.process(existing, () => md), existing) : await this.app.vault.create(path, md);
    // open the report in reading mode (reusing its tab if it's already open) and hand it to Obsidian's PDF export
    const open = this.app.workspace.getLeavesOfType('markdown').find((l) => l.view.file === report);
    const leaf = open || this.app.workspace.getLeaf('tab');
    await leaf.openFile(report, { active: true, state: { mode: 'preview' } });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    window.setTimeout(() => {
      if (!this.app.commands.executeCommandById('workspace:export-pdf')) new Notice('Report ready — use “Export to PDF” from the note menu to save it.');
    }, 400);
    return report;
  },

  /* ---- ticket templates (local: stored in this plugin's data) ---- */
  async saveTemplate(tpl) {
    const list = this.settings.templates;
    const i = list.findIndex((x) => x.id === tpl.id);
    if (i === -1) list.push(tpl);
    else list[i] = tpl;
    await this.saveSettings();
    this.emitSoon();
  },
  async deleteTemplate(id) {
    this.settings.templates = this.settings.templates.filter((x) => x.id !== id);
    await this.saveSettings();
    this.emitSoon();
  },
  async duplicateTemplate(id) {
    const tpl = this.settings.templates.find((x) => x.id === id);
    if (!tpl) return;
    const copy = { ...tpl, steps: [...tpl.steps], id: newTemplateId(), name: `${tpl.name} copy` };
    const list = this.settings.templates;
    list.splice(list.indexOf(tpl) + 1, 0, copy);
    await this.saveSettings();
    this.emitSoon();
  },
  async createTicket({ title, id, description, priority, category, due, remind, steps, jira }) {
    const q = (v) => JSON.stringify(String(v || ''));
    const yaml = [
      '---',
      'type: ticket',
      ...(id ? [`ticket: ${q(id)}`] : []),
      'status: open',
      `priority: ${priority || 'normal'}`,
      'tags:',
      '  - ticket',
      `${CATS.includes(category) ? category : 'operations'}: true`,
      `created: ${moment().format('YYYY-MM-DD')}`,
      ...(due ? [`due: ${due}`] : []),
      ...(remind ? [`remind: ${remind}`] : []),
      ...(jira ? [`jira: ${q(jira)}`] : []),
      '---',
      '',
    ].join('\n');
    const body = [
      `# ${id ? id + ' · ' : ''}${title}`,
      '',
      '## Description',
      description,
      '',
      '## Next steps',
      ...(steps && steps.length ? steps.map((s) => `- [ ] ${s}`) : []),
      '',
      '## Log',
      `- ${STAMP()} — Ticket opened`,
      '',
    ].join('\n');
    const f = await createUnique(this.app, this.ticketRoot(), `${id ? id + ' ' : ''}${title}`, yaml + body);
    this.app.workspace.trigger('neon:ticket-changed', { file: f, id, title, change: 'Ticket opened' });
    await this.showTicket(f);
    new Notice(`🎫 Ticket created${due ? ` · due ${moment(due).format('ddd D MMM')}` : ''}`);
  },

});
