Object.assign(NeonTickets.prototype, {
  /* filing done tickets ----------------------------------------------------- */
  ticketRoot() {
    return normalizePath(this.settings.ticketFolder || 'Core/Tickets');
  },
  doneRoot() {
    return normalizePath(`${this.ticketRoot()}/${this.settings.doneFolder || 'Done'}`);
  },
  /** Where a done ticket goes, or null when it lives outside the ticket folder. */
  doneDest(t, when) {
    if (!this.settings.autoFile) return null;
    const p = t.file.path;
    const root = this.ticketRoot();
    if (!p.startsWith(root + '/')) return null;
    return `${this.doneRoot()}/${(t.completed || when).format('YYYY-MM')}`;
  },
  async moveTo(file, folder) {
    let dest = normalizePath(`${folder}/${file.name}`);
    if (dest === file.path) return;
    if (this.moving.has(file)) return;
    this.moving.add(file);
    try {
      await ensureFolder(this.app, folder);
      // a note with the same name is already there: add a number instead of leaving the ticket behind
      if (this.app.vault.getAbstractFileByPath(dest)) dest = uniquePath(this.app, folder, file.basename, file.extension);
      await this.app.fileManager.renameFile(file, dest);
    } catch (e) {
      console.error('Neon Tickets: move failed', e);
      new Notice(`Couldn’t move “${file.basename}” to ${folder}`);
    } finally {
      this.moving.delete(file);
    }
  },
  /** Tickets marked done (or reopened) by editing the note get filed too. */
  fileSoon(f) {
    if (!this.settings.autoFile || !(f instanceof TFile)) return;
    this.fileTimers = this.fileTimers || new Map();
    window.clearTimeout(this.fileTimers.get(f));
    this.fileTimers.set(
      f,
      window.setTimeout(async () => {
        this.fileTimers.delete(f);
        const t = this.ticketFor(f);
        if (!t) return;
        if (t.status === 'done') await this.moveDone(f, moment());
        else await this.moveBack(f);
      }, 1500),
    );
  },
  async moveDone(file, when) {
    const t = this.ticketFor(file) || { file, completed: null };
    const dest = this.doneDest(t, when);
    if (dest && !file.path.startsWith(dest + '/')) await this.moveTo(file, dest);
  },
  async moveBack(file) {
    if (file.path.startsWith(this.doneRoot() + '/')) await this.moveTo(file, this.ticketRoot());
  },
  async fileAllDone(notify) {
    let n = 0;
    for (const t of this.collectTickets().filter((x) => x.status === 'done')) {
      const dest = this.doneDest(t, moment(t.file.stat.mtime));
      if (dest && !t.file.path.startsWith(dest + '/')) {
        await this.moveTo(t.file, dest);
        n++;
      }
    }
    if (notify || n) new Notice(n ? `✦ Filed ${n} done ticket${n === 1 ? '' : 's'} into ${this.doneRoot()}/` : 'All done tickets are already filed');
  },

  /* creating ------------------------------------------------------------------ */
  newTicket(opts) {
    new NewTicketModal(this, opts || {}).open();
  },

  /* ---- screenshots ---- */
  shotFolder() {
    const deck = neonPlugin(this.app, 'neon-deck');
    const core = (deck && deck.settings && deck.settings.coreFolder) || 'Core';
    return normalizePath(`${core}/Images/Tickets`);
  },
  /** Save image files into Core/Images/Tickets and link them under ## Screenshots. */
  async addScreenshots(t, files) {
    if (!files.length) return;
    const dir = this.shotFolder();
    await ensureFolder(this.app, dir);
    const links = [];
    for (const [i, f] of files.entries()) {
      const ext = IMG_TYPES[f.type];
      if (!ext) continue;
      const base = safeName(`${t.id || t.title} ${moment().format('YYYY-MM-DD HH-mm-ss')}${files.length > 1 ? ` ${i + 1}` : ''}`);
      const created = await this.app.vault.createBinary(uniquePath(this.app, dir, base, ext), await f.arrayBuffer());
      links.push(`![[${created.path}]]`);
    }
    if (!links.length) return;
    await this.app.vault.process(t.file, (d) => links.reduce((acc, l) => addToSection(acc, 'shots', l), d));
    await this.log(t, links.length === 1 ? 'Screenshot added' : `${links.length} screenshots added`);
    new Notice(`${links.length === 1 ? 'Screenshot' : `${links.length} screenshots`} saved to ${dir}`);
  },
  /** Take a screenshot off the ticket; the image itself goes to the system trash. */
  async removeScreenshot(t, shot) {
    const f = this.app.metadataCache.getFirstLinkpathDest(shot.link, t.file.path);
    await this.app.vault.process(t.file, (d) => {
      const lines = d.split('\n');
      const sec = findSection(lines, 'shots');
      if (!sec) return d;
      const i = lines.findIndex((l, n) => n > sec[0] && n < sec[1] && l.includes(shot.link));
      if (i !== -1) lines.splice(i, 1);
      return lines.join('\n');
    });
    if (f) await this.app.vault.trash(f, true);
  },

  /** Move done tickets (and optionally their screenshots and reports) to the system trash; tidy empty Done folders. */
  async clearDone(list, withFiles) {
    const reportsDir = normalizePath(`${this.ticketRoot()}/Exports`) + '/';
    const files = new Set();
    for (const t of list) {
      if (withFiles) {
        const b = parseTicketBody(stripFrontmatter(await this.app.vault.cachedRead(t.file)));
        for (const shot of b.shots) {
          const f = this.app.metadataCache.getFirstLinkpathDest(shot.link, t.file.path);
          if (f) files.add(f);
        }
        for (const f of this.app.vault.getMarkdownFiles()) {
          if (!f.path.startsWith(reportsDir)) continue;
          const fm = (this.app.metadataCache.getFileCache(f) || {}).frontmatter || {};
          if (fm.ticket === t.file.path) files.add(f);
        }
      }
      files.add(t.file);
    }
    let n = 0;
    for (const f of files) {
      try {
        await this.app.vault.trash(f, true);
        n++;
      } catch (e) {
        console.error('Neon Tickets: could not trash', f.path, e);
      }
    }
    // empty month folders under Done/ go too
    const done = this.app.vault.getAbstractFileByPath(this.doneRoot());
    if (done && done.children) for (const d of [...done.children]) if (d.children && !d.children.length) await this.app.vault.trash(d, true);
    this.cache = null;
    this.emitSoon();
    new Notice(`Cleared ${list.length} done ticket${list.length === 1 ? '' : 's'}${n > list.length ? ` and ${n - list.length} file${n - list.length === 1 ? '' : 's'}` : ''} (system trash)`);
  },

});
