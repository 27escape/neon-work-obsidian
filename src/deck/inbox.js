/* ---- Inbox (fork) -----------------------------------------------------------------
 * Inbox notes go in the inbox folder (default <base folder>/Inbox): from Quick capture (named after the
 * first line, the text below the template) or from New note's Inbox button. Every inbox note gets the inbox
 * tag and status (default: tags: inbox, status: waiting), also when it starts from a template. */

/** File name for a captured thought: its first line, shortened, else a time stamp (pure). */
function inboxName(text, now) {
  const first = String(text || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  const clean = safeName(first.replace(/^#+\s*/, '').replace(/[[\]#|^]/g, '')).slice(0, 60).trim();
  return clean || `Inbox ${now.format('YYYY-MM-DD HHmm')}`;
}
/** Body of an inbox note without a template (pure). */
function inboxBody(title, text, day) {
  return ['---', `title: ${JSON.stringify(title)}`, `created: ${day}`, '---', '', String(text || '').trim(), ''].join('\n');
}
/** Put the inbox tag and status on a note's properties (pure; fm as Obsidian's processFrontMatter gives it). */
function inboxProps(fm, tag, status) {
  tag = String(tag || '').trim().replace(/^#/, '');
  if (tag) {
    const tags = Array.isArray(fm.tags) ? fm.tags : fm.tags ? String(fm.tags).split(/[,\s]+/).filter(Boolean) : [];
    if (!tags.some((t) => String(t).replace(/^#/, '').toLowerCase() === tag.toLowerCase())) tags.push(tag);
    fm.tags = tags;
  }
  if (String(status || '').trim()) fm.status = String(status).trim();
  return fm;
}

Object.assign(NeonDeck.prototype, {
  /** The inbox folder: the setting, else <base folder>/Inbox. */
  inboxFolder() {
    return locPath(this.settings.inboxFolder, 'Inbox');
  },
  registerInboxCapture() {
    this.api.registerCapture({ id: 'inbox', label: 'Inbox note', short: 'Inbox', icon: 'inbox', order: 5, run: (v) => this.captureToInbox(v) });
    this.api.provide('inboxNote', (title, text) => this.createInboxNote(title, text)); // New note's Inbox button
  },
  /** A new inbox note (from the template if set) with the inbox tag and status; returns the file. */
  async createInboxNote(title, text = '') {
    const s = this.settings;
    const now = moment();
    title = safeName(title) || inboxName(text, now);
    let body = null;
    if (s.inboxTemplate) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(s.inboxTemplate.replace(/\.md$/, ''), '') || this.app.vault.getAbstractFileByPath(normalizePath(s.inboxTemplate));
      if (tf instanceof TFile) body = `${applyTemplate(await this.app.vault.read(tf), now, title).replace(/\s*$/, '')}\n${text ? `\n${text}\n` : ''}`;
      else new Notice(`Inbox template “${s.inboxTemplate}” not found: using standard properties`);
    }
    const f = await createUnique(this.app, this.inboxFolder(), title, body != null ? body : inboxBody(title, text, now.format('YYYY-MM-DD')));
    await this.app.fileManager.processFrontMatter(f, (fm) => inboxProps(fm, s.inboxTag, s.inboxStatus));
    return f;
  },
  async captureToInbox(text) {
    text = String(text || '').trim();
    if (!text) return;
    try {
      const f = await this.createInboxNote(inboxName(text, moment()), text);
      new Notice(`✦ Saved to ${f.path}`);
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Neon Deck: inbox capture', e);
        new Notice('Could not save the inbox note');
      }
    }
  },
});
