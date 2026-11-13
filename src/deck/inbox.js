/* ---- Inbox capture (fork) ---------------------------------------------------------
 * Quick capture → a new note in your inbox folder: named after the first line, made from the inbox
 * template (if set) with the captured text below it. Off until an inbox folder is set. */

/** File name for a captured thought: its first line, shortened, else a time stamp (pure). */
function inboxName(text, now) {
  const first = String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const clean = safeName(first.replace(/^#+\s*/, '').replace(/[[\]#|^]/g, '')).slice(0, 60).trim();
  return clean || `Inbox ${now.format('YYYY-MM-DD HHmm')}`;
}
/** Body of an inbox note without a template (pure). */
function inboxBody(title, text, day) {
  return ['---', `title: ${JSON.stringify(title)}`, 'tags:', '  - inbox', 'status: created', `created: ${day}`, '---', '', String(text || '').trim(), ''].join('\n');
}

Object.assign(NeonDeck.prototype, {
  registerInboxCapture() {
    if (!(this.settings.inboxFolder || '').trim()) return this.api.unregisterCapture('inbox');
    this.api.registerCapture({ id: 'inbox', label: 'Inbox note', short: 'Inbox', icon: 'inbox', order: 5, run: (v) => this.captureToInbox(v) });
  },
  async captureToInbox(text) {
    text = String(text || '').trim();
    if (!text) return;
    const s = this.settings;
    const now = moment();
    const title = inboxName(text, now);
    let body = null;
    if (s.inboxTemplate) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(s.inboxTemplate.replace(/\.md$/, ''), '') || this.app.vault.getAbstractFileByPath(normalizePath(s.inboxTemplate));
      if (tf instanceof TFile) body = `${applyTemplate(await this.app.vault.read(tf), now, title).replace(/\s*$/, '')}\n\n${text}\n`;
      else new Notice(`Inbox template “${s.inboxTemplate}” not found: using standard properties`);
    }
    try {
      const f = await createUnique(this.app, s.inboxFolder, title, body != null ? body : inboxBody(title, text, now.format('YYYY-MM-DD')));
      new Notice(`✦ Saved to ${f.path}`);
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Neon Deck: inbox capture', e);
        new Notice('Could not save the inbox note');
      }
    }
  },
});
