/* ---- link suggestions -------------------------------------------------------- */
class LinkSuggestModal extends Modal {
  constructor(plugin, file, hits) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.hits = hits;
  }
  onOpen() {
    this.modalEl.addClass('nd-modal', 'nr-modal');
    this.titleEl.setText(`Possible links · ${this.file.basename}`);
    const c = this.contentEl;
    const list = c.createDiv('nr-links');
    for (const h of this.hits) {
      const r = list.createDiv('nr-link-row');
      const t = r.createDiv('nr-link-main');
      t.createDiv({ cls: 'nr-link-target', text: h.target.basename });
      const ctx = t.createDiv('nr-link-ctx');
      ctx.appendText('…' + h.before);
      ctx.createEl('mark', { text: h.match });
      ctx.appendText(h.after + '…');
      button(r, {
        icon: 'link',
        text: 'Link',
        onClick: async () => {
          await this.plugin.linkMention(this.file, h.target);
          r.addClass('is-done');
          r.querySelector('button').remove();
        },
      });
    }
    const foot = c.createDiv('nd-modal-row');
    button(foot, { text: 'Close', onClick: () => this.close() });
    button(foot, {
      text: `Link all (${this.hits.length})`,
      cls: 'mod-cta',
      onClick: async () => {
        for (const h of this.hits) await this.plugin.linkMention(this.file, h.target);
        this.close();
        new Notice(`Linked ${this.hits.length} mention${this.hits.length === 1 ? '' : 's'}`);
      },
    });
  }
  onClose() {
    this.contentEl.empty();
  }
}

