Object.assign(NeonTickets.prototype, {
  /** Write an export-only template snapshot and hand it to Obsidian's PDF export. */
  async exportTemplate(tpl) {
    const details = [
      ['Priority', tpl.priority || 'normal'],
      ['Due', tpl.dueDays == null ? 'New ticket default' : tpl.dueDays === 0 ? 'Today' : `${tpl.dueDays} days after creation`],
    ];
    const md = [
      '---',
      'type: ticket-template-export',
      'untracked: true',
      `template: ${JSON.stringify(tpl.id)}`,
      `exported: ${moment().format('YYYY-MM-DD HH:mm')}`,
      'cssclasses: [tk-report]',
      '---',
      `# ${tpl.name}`,
      '',
      '> [!info] Export-only snapshot',
      '> Edit the template in Neon Tickets. Changes to this note do not update the template.',
      '',
      '| Setting | Value |',
      '| --- | --- |',
      ...details.map(([k, v]) => `| **${k}** | ${String(v).replace(/\|/g, '\\|')} |`),
      '',
      '## Description',
      ...(tpl.description ? tpl.description.split('\n') : ['_No description._']),
      '',
      `## Steps (${tpl.steps.length})`,
      ...(tpl.steps.length ? tpl.steps.map((s) => `- [ ] ${s}`) : ['_No steps._']),
      '',
      `_Exported ${moment().format('D MMM YYYY, HH:mm')} from Neon Tickets._`,
      '',
    ].join('\n');
    const dir = normalizePath(`${this.settings.ticketFolder || 'Core/Tickets'}/Templates`);
    await ensureFolder(this.app, dir);
    const path = normalizePath(`${dir}/${safeName(tpl.name) || 'Ticket template'}.md`);
    const existing = this.app.vault.getAbstractFileByPath(path);
    const note = existing instanceof TFile ? (await writeNote(this.app, existing, () => md), existing) : await this.app.vault.create(path, md);
    const open = this.app.workspace.getLeavesOfType('markdown').find((l) => l.view.file === note);
    const leaf = open || this.app.workspace.getLeaf('tab');
    await leaf.openFile(note, { active: true, state: { mode: 'preview' } });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    window.setTimeout(() => {
      if (!this.app.commands.executeCommandById('workspace:export-pdf')) new Notice('Template note ready — use “Export to PDF” from the note menu to save it.');
    }, 400);
    return note;
  },
});
