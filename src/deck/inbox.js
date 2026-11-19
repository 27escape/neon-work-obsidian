/* ---- Inbox (fork) -----------------------------------------------------------------
 * Inbox notes go in the inbox folder (default <base folder>/Inbox): from Quick capture or the Inbox card (named
 * YYYYMMDD_HHmmss, the text you typed in the note, below the template if there is one) or from New note's Inbox
 * button (named as typed). Every inbox note gets the inbox tag and status (default: tags: inbox, status:
 * waiting), also when it starts from a template. The card lists each note by its title, else its first line. */

/** File name for a captured thought: the time it was captured, YYYYMMDD_HHmmss (pure). */
const inboxName = (now) => now.format('YYYYMMDD_HHmmss');
/** One line of text, plain: no heading, list, checkbox or quote marks, links as their text (pure). */
function inboxPlain(line) {
  return String(line || '')
    .trim()
    .replace(/^(#+|>+|[-*+]\s+\[.\]|[-*+]|\d+[.)])\s+/, '')
    .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, '$2')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();
}
/** The first line of some text with something in it, plain (pure). */
const inboxHeadline = (text) => inboxPlain(String(text || '').split('\n').find((l) => inboxPlain(l)) || '');
/** What the Inbox card shows for a note: its title property, else the first line of its text (after the
 *  properties), else its file name (pure). */
function inboxLabel(content, title, basename) {
  if (title != null && typeof title !== 'object' && String(title).trim()) return String(title).trim();
  const body = String(content || '').replace(/^---\r?\n[\s\S]*?\r?\n---[^\n]*(\n|$)/, '');
  return inboxHeadline(body) || basename;
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
      if (inboxOpen(fm.status, done)) out.push({ file: f, title: fm.title, status: fm.status == null || typeof fm.status === 'object' ? '' : String(fm.status) });
    }
    return out.sort((a, b) => b.file.stat.ctime - a.file.stat.ctime);
  },
  registerInboxCard() {
    // fork: the Inbox tab is in the sidebar list (not in the dashboard header, which has the card)
    this.api.registerAction({ id: 'inbox', icon: 'inbox', label: 'Inbox', order: 12, view: VIEW_INBOX, hero: false, run: () => this.activate(VIEW_INBOX, 'tab') });
    if (this.settings.inboxCard === false) return this.api.unregisterWidget('inbox');
    this.api.registerWidget({ id: 'inbox', slot: 'inbox', title: 'Inbox', icon: 'inbox', sub: this.inboxFolder(), open: () => this.activate(VIEW_INBOX, 'tab'), openTitle: 'Open the Inbox tab', mount: (card, view) => this.mountInbox(card, view) });
  },
  /** The inbox list and its Add box in a card; comp (the dashboard or the Inbox tab) owns the event listeners. */
  mountInbox(card, comp) {
    const owner = comp || this;
    const body = card.body;
    body.addClass('nd-inbox-body');
    const list = body.createDiv('nd-inbox');
    const render = () => {
      if (!list.isConnected) return;
      const items = this.inboxItems();
      card.badge.setText(items.length ? String(items.length) : '');
      list.empty();
      if (!items.length) return void emptyState(list, 'Inbox is empty ✦');
      for (const { file, title, status } of items.slice(0, 60)) {
        const r = list.createDiv('nd-inbox-row');
        const name = r.createSpan({ cls: 'nd-inbox-name', text: inboxLabel('', title, file.basename) });
        if (status) r.createSpan({ cls: 'nd-inbox-status', text: status });
        r.createSpan({ cls: 'nd-inbox-when', text: shortAgoDeck(file.stat.ctime) });
        tip(r, file.path);
        // no title: the note's first line, as much as fits (the whole line on hover)
        if (title == null || typeof title === 'object' || !String(title).trim())
          this.app.vault.cachedRead(file).then((text) => {
            const label = inboxLabel(text, null, file.basename);
            name.setText(label);
            if (label !== file.basename) tip(r, `${label}\n${file.path}`);
          }, () => {});
        r.addEventListener('click', (e) => openFile(this.app, file, e));
        hoverPreview(this.app, r, file);
      }
    };
    const add = body.createDiv('nt-add');
    // a text box that grows: Enter adds the note, Shift+Enter starts a new line; the text goes in the note
    const input = add.createEl('textarea', { cls: 'nd-input', attr: { rows: '1', placeholder: 'Add to Inbox… (Enter · Shift+Enter for a new line)' } });
    const grow = () => {
      input.style.height = 'auto';
      input.style.height = `${Math.max(38, Math.min(input.scrollHeight + 3, 160))}px`; // + its border
    };
    input.addEventListener('input', grow);
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' || e.isComposing || e.shiftKey) return;
      e.preventDefault();
      const v = input.value.trim();
      if (!v) return;
      input.value = '';
      grow();
      try {
        const f = await this.createInboxNote('', v);
        new Notice(`✦ Added ${inboxHeadline(v) || f.basename} to the inbox`);
      } catch (err) {
        if (!(err && err.neonReadOnly)) {
          console.error(`${appName()} – Dashboard: inbox`, err);
          new Notice('Could not add to the inbox');
        }
        input.value = v;
        grow();
      }
    });
    button(card.actions, { icon: 'folder-open', cls: 'nd-icon-btn', title: 'Show the inbox folder', onClick: () => this.revealFolder(this.inboxFolder()) });
    const soon = debounce(render, 400, true);
    owner.registerEvent(this.app.metadataCache.on('changed', (f) => f.path.startsWith(normalizePath(this.inboxFolder()) + '/') && soon()));
    owner.registerEvent(this.app.vault.on('delete', soon));
    owner.registerEvent(this.app.vault.on('rename', soon));
    owner.registerEvent(this.app.vault.on('create', soon));
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
  /** A new inbox note (from the template if set) with the inbox tag and status; returns the file. Without a
   *  title (Quick capture, the Inbox card) the file is named by the time, and its title is the text's first line. */
  async createInboxNote(name, text = '') {
    const s = this.settings;
    const now = moment();
    text = String(text || '').trim();
    name = safeName(name);
    const title = name || inboxHeadline(text) || inboxName(now);
    name = name || inboxName(now);
    let body = null;
    if (s.inboxTemplate) {
      const tf = this.app.metadataCache.getFirstLinkpathDest(s.inboxTemplate.replace(/\.md$/, ''), '') || this.app.vault.getAbstractFileByPath(normalizePath(s.inboxTemplate));
      if (tf instanceof TFile) body = `${applyTemplate(await this.app.vault.read(tf), now, title).replace(/\s*$/, '')}\n${text ? `\n${text}\n` : ''}`;
      else new Notice(`Inbox template “${s.inboxTemplate}” not found: using standard properties`);
    }
    const f = await createUnique(this.app, this.inboxFolder(), name, body != null ? body : inboxBody(title, text, now.format('YYYY-MM-DD')));
    await this.app.fileManager.processFrontMatter(f, (fm) => inboxProps(fm, s.inboxTag, s.inboxStatus));
    return f;
  },
  async captureToInbox(text) {
    text = String(text || '').trim();
    if (!text) return;
    try {
      const f = await this.createInboxNote('', text);
      new Notice(`✦ Saved to ${f.path}`);
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error(`${appName()} – Dashboard: inbox capture`, e);
        new Notice('Could not save the inbox note');
      }
    }
  },
});
