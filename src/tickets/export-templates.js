Object.assign(NeonTickets.prototype, {
  /* ---- export ---- */
  /** Build a report note for the ticket (<ticket folder>/Exports) and open Obsidian's PDF export for it. */
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
    const dir = normalizePath(`${this.settings.ticketFolder || 'Neon/Tickets'}/Exports`);
    await ensureFolder(this.app, dir);
    const path = normalizePath(`${dir}/${safeName(`${t.id ? t.id + ' ' : ''}${t.title}`) || 'Ticket'} report.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    const report = existing instanceof TFile ? (await writeNote(this.app, existing, () => md), existing) : await this.app.vault.create(path, md);
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

  /* ---- ticket templates: one note each in <ticket folder>/Templates; the note is the template (issues 49, 51) ---- */
  templateDir() {
    return normalizePath(`${this.ticketRoot()}/Templates`);
  },
  templateFile(tpl) {
    const f = tpl && tpl.path && this.app.vault.getAbstractFileByPath(tpl.path);
    return f instanceof TFile ? f : null;
  },
  /** Read every template note in the folder into this.templates (sorted by name). */
  async loadTemplates() {
    const dir = this.templateDir() + '/';
    const out = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(dir)) continue;
      const tpl = parseTemplateNote(f.basename, await this.app.vault.cachedRead(f));
      if (tpl) out.push({ ...tpl, id: tpl.id || f.path, path: f.path });
    }
    this.templates = out.sort((x, y) => x.name.localeCompare(y.name));
    this.emitSoon();
    return this.templates;
  },
  /** Startup: make the folder (fresh vault), move templates from plugin data into notes once, then read them. */
  async initTemplates() {
    // fork: the Templates folder is made only when there are old templates to move into it (or you save one)
    if (!this.settings.templatesMigrated && this.settings.templates.length) {
      await ensureFolder(this.app, this.templateDir());
      const have = new Set((await this.loadTemplates()).map((t) => t.id));
      for (const t of this.settings.templates) if (!have.has(t.id)) await this.writeTemplateNote(t);
      // settings.templates stays as it was, as a backup
      this.settings.templatesMigrated = true;
      await this.saveSettings();
    }
    await this.loadTemplates();
  },
  /** Write a template's note: its own note, or a new one (an old export snapshot with that name is replaced). */
  async writeTemplateNote(tpl) {
    const dir = this.templateDir();
    const md = templateMarkdown(tpl);
    let f = this.templateFile(tpl);
    // an existing note is renamed where it is (its folder may differ from a changed ticket folder)
    const want = normalizePath(`${f ? f.parent.path : dir}/${safeName(tpl.name) || 'Ticket template'}.md`);
    if (f && f.path !== want) {
      if (this.app.vault.getAbstractFileByPath(want)) new Notice(`A template named “${tpl.name}” already exists; the old name was kept.`);
      else await this.app.fileManager.renameFile(f, want);
    }
    if (!f) {
      const old = this.app.vault.getAbstractFileByPath(want);
      if (old instanceof TFile && /^type:\s*ticket-template-export\s*$/m.test(await this.app.vault.read(old))) f = old;
    }
    if (f) await writeNote(this.app, f, () => md);
    else f = await createUnique(this.app, dir, safeName(tpl.name) || 'Ticket template', md);
    return f;
  },
  async saveTemplate(tpl) {
    const f = await this.writeTemplateNote(tpl);
    // use what was just saved: an open note is written to its editor first, so the file on disk lags behind;
    // the folder watcher reloads from disk once Obsidian has saved it
    const list = (this.templates || []).filter((x) => x.id !== tpl.id);
    list.push({ ...tpl, steps: [...tpl.steps], name: f.basename, path: f.path });
    this.templates = list.sort((x, y) => x.name.localeCompare(y.name));
    this.emitSoon();
  },
  async deleteTemplate(id) {
    const f = this.templateFile((this.templates || []).find((x) => x.id === id));
    if (f) await this.app.fileManager.trashFile(f);
    await this.loadTemplates();
  },
  async duplicateTemplate(id) {
    const tpl = (this.templates || []).find((x) => x.id === id);
    if (tpl) await this.saveTemplate({ ...tpl, steps: [...tpl.steps], id: newTemplateId(), name: `${tpl.name} copy`, path: '' });
  },
  /** A ticket's steps, description and priority as a new template, opened for editing first (issue 50). */
  async templateFromTicket(t) {
    const text = await this.app.vault.read(t.file);
    const lines = stripFrontmatter(text).split('\n');
    const d = findSection(lines, 'description');
    const dueDays = t.due && t.created ? Math.max(0, t.due.clone().startOf('day').diff(t.created.clone().startOf('day'), 'days')) : null;
    new TemplateModal(this, {
      id: newTemplateId(),
      name: t.title.replace(/^.*? · /, ''),
      steps: parseTicketBody(lines.join('\n')).steps.map((s) => s.text),
      description: d ? lines.slice(d[0] + 1, d[1]).join('\n').trim() : '',
      priority: t.priority || 'normal',
      dueDays,
    }, true).open();
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
