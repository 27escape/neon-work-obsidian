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

/** The setting's comma list, lower case (pure). */
const inboxList = (text) =>
  String(text || '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
/** Is an inbox note still open: no status, or one not in the done list (pure)? */
function inboxOpen(status, doneList) {
  const v = Array.isArray(status) ? status[0] : status;
  const s = v == null || typeof v === 'object' ? '' : String(v).trim().toLowerCase();
  return !s || !doneList.includes(s);
}

Object.assign(NeonDeck.prototype, {
  /** fork: open inbox notes (status not in the done list), newest first: [{ file, status }]. */
  inboxItems() {
    const root = normalizePath(this.inboxFolder());
    const done = inboxList(this.settings.inboxDone);
    const out = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(root + '/') || isIgnoredNote(this.app, f)) continue;
      const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {};
      if (inboxOpen(fm.status, done)) out.push({ file: f, status: fm.status == null || typeof fm.status === 'object' ? '' : String(fm.status) });
    }
    return out.sort((a, b) => b.file.stat.ctime - a.file.stat.ctime);
  },
  registerInboxCard() {
    if (this.settings.inboxCard === false) return this.api.unregisterWidget('inbox');
    this.api.registerWidget({ id: 'inbox', slot: 'inbox', title: 'Inbox', icon: 'inbox', sub: this.inboxFolder(), mount: (card) => this.mountInbox(card) });
  },
  mountInbox(card) {
    const body = card.body;
    body.addClass('nd-inbox-body');
    const list = body.createDiv('nd-inbox');
    const render = () => {
      if (!list.isConnected) return;
      const items = this.inboxItems();
      card.badge.setText(items.length ? String(items.length) : '');
      list.empty();
      if (!items.length) return void emptyState(list, 'Inbox is empty ✦');
      for (const { file, status } of items.slice(0, 60)) {
        const r = list.createDiv('nd-inbox-row');
        r.createSpan({ cls: 'nd-inbox-name', text: file.basename });
        if (status) r.createSpan({ cls: 'nd-inbox-status', text: status });
        r.createSpan({ cls: 'nd-inbox-when', text: shortAgoDeck(file.stat.ctime) });
        tip(r, file.path);
        r.addEventListener('click', (e) => openFile(this.app, file, e));
      }
    };
    const add = body.createDiv('nt-add');
    const input = add.createEl('input', { cls: 'nd-input', attr: { type: 'text', placeholder: 'Add to Inbox… (Enter)' } });
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      const v = input.value.trim();
      if (!v) return;
      input.value = '';
      try {
        const f = await this.createInboxNote(inboxName(v, moment()), '');
        new Notice(`✦ Added ${f.basename} to the inbox`);
      } catch (err) {
        if (!(err && err.neonReadOnly)) {
          console.error('Neon Deck: inbox', err);
          new Notice('Could not add to the inbox');
        }
        input.value = v;
      }
    });
    button(card.actions, { icon: 'folder-open', cls: 'nd-icon-btn', title: 'Show the inbox folder', onClick: () => this.revealFolder(this.inboxFolder()) });
    const soon = debounce(render, 400, true);
    this.registerEvent(this.app.metadataCache.on('changed', (f) => f.path.startsWith(normalizePath(this.inboxFolder()) + '/') && soon()));
    this.registerEvent(this.app.vault.on('delete', soon));
    this.registerEvent(this.app.vault.on('rename', soon));
    this.registerEvent(this.app.vault.on('create', soon));
    render();
    return { destroy() {} };
  },
  /** Show a folder in the file explorer (if it is on). */
  revealFolder(path) {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(path));
    const fx = this.app.internalPlugins && this.app.internalPlugins.getPluginById && this.app.internalPlugins.getPluginById('file-explorer');
    if (folder instanceof TFolder && fx && fx.enabled && fx.instance && fx.instance.revealInFolder) fx.instance.revealInFolder(folder);
    else new Notice(`${path} doesn’t exist yet: it is made with the first inbox note`);
  },
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
