Object.assign(NeonTickets.prototype, {
  /** Open the template's note and hand it to Obsidian's PDF export (the note is the template, issue 51). */
  async exportTemplate(tpl) {
    const note = this.templateFile(tpl) || (await this.writeTemplateNote(tpl));
    const open = this.app.workspace.getLeavesOfType('markdown').find((l) => l.view.file === note);
    const leaf = open || this.app.workspace.getLeaf('tab');
    await leaf.openFile(note, { active: true, state: { mode: 'preview' } });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    window.setTimeout(() => {
      if (!this.app.commands.executeCommandById('workspace:export-pdf')) new Notice('Template note open — use “Export to PDF” from the note menu to save it.');
    }, 400);
    return note;
  },
});
