Object.assign(CardsView.prototype, {
  renderCrumbs(folder) {
    const c = this.crumbs;
    c.empty();
    const mk = (label, path) => {
      const b = c.createEl('button', { cls: 'nd-crumb', text: label });
      b.addEventListener('click', () => this.navigate(path, -1));
      this.makeDropTarget(b, () => path);
      return b;
    };
    const home = mk(this.app.vault.getName(), '/');
    if (folder.path === '/') home.addClass('is-current');
    else {
      // inside a folder the vault name is just a home icon, so the path fits
      home.empty();
      home.addClass('is-home');
      setIcon(home, 'home');
      home.setAttr('aria-label', this.app.vault.getName());
    }
    let acc = '';
    const parts = folder.path === '/' ? [] : folder.path.split('/');
    parts.forEach((p, i) => {
      c.createSpan({ cls: 'nd-crumb-sep', text: '/' });
      acc = acc ? `${acc}/${p}` : p;
      const b = mk(p, acc);
      if (i === parts.length - 1) b.addClass('is-current');
    });
    c.scrollLeft = c.scrollWidth;
    c.toggleClass('is-over', c.scrollWidth > c.clientWidth + 1);
  },

  baseCard(parent, cls, i, path) {
    const card = parent.createDiv(`nd-ci ${cls}`);
    card.style.setProperty('--i', String(Math.min(i, 24)));
    card.dataset.path = path;
    return card;
  },
  catTag(parent, cat) {
    if (!cat || cat === 'untracked') return null;
    const t = parent.createSpan({ cls: 'nd-cat-tag', text: CAT_LABEL[cat] });
    t.style.setProperty('--tag-accent', catColor(cat));
    return t;
  },
  folderIcon(parent, cat, path) {
    const ic = icon(parent, 'folder', 'nd-folder-icon');
    const own = path != null && this.plugin.settings.folderColors[path];
    ic.style.setProperty('--folder-accent', own || (cat ? catColor(cat) : 'var(--nd-muted)'));
    return ic;
  },
  folderCard(parent, folder, info, i) {
    const card = this.baseCard(parent, 'nd-ci-folder', i, folder.path);
    this.folderIcon(card, info.cat, folder.path);
    const main = card.createDiv('nd-ci-main');
    const top = main.createDiv('nd-ci-top');
    top.createDiv({ cls: 'nd-ci-title', text: folder.name });
    this.catTag(top, info.cat);
    const n = info.notes.length;
    const weekAgo = Date.now() - 7 * 864e5;
    const files = info.other ? `${info.other} file${info.other === 1 ? '' : 's'}` : '';
    let meta = n || !files ? `${n} note${n === 1 ? '' : 's'}${files ? ` · ${files}` : ''}` : files;
    if (info.cat === 'school' && n) {
      const fresh = info.notes.filter((f) => !this.needsRevisit(f)).length;
      meta += ` · ${fresh} / ${n} revisited`;
      const bar = main.createDiv('nd-ci-progress');
      bar.createDiv('nd-ci-progress-fill').style.width = `${Math.round((fresh / n) * 100)}%`;
    } else {
      const wk = info.notes.filter((f) => f.stat.mtime >= weekAgo).length;
      if (wk) meta += ` · ${wk} edited this week`;
    }
    main.insertBefore(createDiv({ cls: 'nd-ci-meta', text: meta }), main.querySelector('.nd-ci-progress'));
    card.addEventListener('click', () => this.navigate(folder.path, 1));
    card.addEventListener('mousedown', (e) => {
      if (e.button === 1) e.preventDefault();
    });
    card.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        this.plugin.openCardsAt(folder.path, true);
      }
    });
    card.addEventListener('contextmenu', (e) => this.folderMenu(folder, e));
    this.dragFolder(card, folder);
    this.makeDropTarget(card, () => folder.path);
  },
  folderMenu(folder, e) {
    e.preventDefault();
    this.plugin.fileMenu(folder, e, (m) => {
      const pinned = this.plugin.settings.pinnedFolders.includes(folder.path);
      m.addItem((it) => it.setTitle(pinned ? 'Unpin folder' : 'Pin folder').setIcon(pinned ? 'pin-off' : 'pin').onClick(() => this.plugin.togglePin(folder.path)));
      m.addItem((it) => it.setTitle('Folder colour…').setIcon('palette').onClick(() => new FolderColorModal(this.plugin, folder).open()));
      m.addItem((it) => it.setTitle('Open in new cards tab').setIcon('layout-grid').onClick(() => this.plugin.openCardsAt(folder.path, true)));
      m.addItem((it) => it.setTitle('New note here').setIcon('file-plus').onClick(() => this.plugin.newNote(folder.path)));
      m.addItem((it) => it.setTitle('New folder here').setIcon('folder-plus').onClick(() => this.plugin.newFolder(folder.path)));
      m.addItem((it) => it.setTitle('Graph of this folder').setIcon('waypoints').onClick(() => this.plugin.openGraph('notes', `folder:${folder.path}`)));
    });
  },
  dragFolder(el, folder) {
    el.setAttr('draggable', 'true');
    el.addEventListener('dragstart', (e) => {
      this.plugin.dragging = folder;
      try {
        const dm = this.app.dragManager;
        dm.onDragStart(e, dm.dragFolder(e, folder));
      } catch (_) {
        if (e.dataTransfer) e.dataTransfer.setData('text/plain', folder.path);
      }
    });
    el.addEventListener('dragend', () => (this.plugin.dragging = null));
  },
  fileCard(parent, file, i, showPath) {
    const ext = file.extension.toLowerCase();
    const isMd = ext === 'md';
    const isImg = IMG_EXT.has(ext);
    const cache = isMd ? this.app.metadataCache.getFileCache(file) : null;
    const cat = isMd ? noteCategory(cache) : null;
    const card = this.baseCard(parent, 'nd-ci-note' + (isImg ? ' is-image' : '') + (isMd ? '' : ' is-other'), i, file.path);
    if (cat && cat !== 'untracked') card.style.setProperty('--ci-accent', catColor(cat));
    if (this.plugin.lastFile && this.plugin.lastFile.path === file.path) card.addClass('is-active');
    const age = this.revisitAge(file);
    const revisit = age >= this.plugin.settings.revisitDays;
    card.toggleClass('needs-revisit', revisit);
    const cover = isImg ? this.app.vault.getResourcePath(file) : isMd ? this.coverFor(file, cache) : null;
    if (cover) {
      card.addClass('has-cover');
      card.createDiv('nd-ci-cover').createEl('img', { attr: { src: cover, loading: 'lazy', alt: '' } });
    }
    const top = card.createDiv('nd-ci-top');
    if (!this.catTag(top, cat)) {
      if (!isMd) top.createSpan({ cls: 'nd-cat-tag is-ext', text: ext });
      else top.createSpan({ cls: 'nd-cat-tag is-none', text: cat === 'untracked' ? 'Untracked' : 'Note' });
    }
    const when = top.createSpan('nd-ci-when');
    if (revisit) {
      when.addClass('is-revisit');
      when.setText(`Revisit · ${age}d`);
    } else {
      const seen = this.plugin.settings.seen[file.path] || 0;
      when.setText(seen > file.stat.mtime ? `opened ${moment(seen).fromNow()}` : `edited ${moment(file.stat.mtime).fromNow()}`);
    }
    card.createDiv({ cls: 'nd-ci-title', text: file.basename });
    if (showPath && file.parent && file.parent.path !== '/') card.createDiv({ cls: 'nd-ci-path', text: file.parent.path });
    if (isMd) {
      this.fillExcerpt(file, card.createDiv('nd-ci-excerpt'));
      const tags = [...new Set(getAllTags(cache || {}) || [])].filter((t) => !/^#(tasks|ticket|projects|school|admin|operations|ops)$/i.test(t));
      const n = this.linkCount(file);
      // no tags and no links: skip the footer, so the card stays close to a folder card's height
      if (tags.length || n) {
        const foot = card.createDiv('nd-ci-foot');
        const tg = foot.createDiv('nd-ci-tags');
        tags.slice(0, 3).forEach((t) => tg.createSpan({ cls: 'nd-tag', text: t }));
        if (n) foot.createSpan({ cls: 'nd-ci-links', text: `${n} link${n === 1 ? '' : 's'}` });
      }
      this.bindPreview(card, file);
    } else {
      const size = file.stat.size > 1048576 ? `${(file.stat.size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(file.stat.size / 1024))} KB`;
      card.createDiv({ cls: 'nd-ci-meta', text: size });
    }
    this.plugin.bindFileMouse(card, file, this);
  },
  coverFor(file, cache) {
    if (!cache) return null;
    const resolve = (link) => {
      if (typeof link !== 'string') return null;
      const clean = link.replace(/^!?\[\[|\]\]$/g, '').split('|')[0].split('#')[0].trim();
      if (!clean || /^https?:/i.test(clean)) return null;
      const dest = this.app.metadataCache.getFirstLinkpathDest(clean, file.path);
      return dest && IMG_EXT.has(dest.extension.toLowerCase()) ? this.app.vault.getResourcePath(dest) : null;
    };
    const fm = cache.frontmatter || {};
    for (const k of ['cover', 'banner', 'image']) {
      const r = resolve(fm[k]);
      if (r) return r;
    }
    for (const e of cache.embeds || []) {
      const r = resolve(e.link);
      if (r) return r;
    }
    return null;
  },
  async excerpt(file, max = 180) {
    const key = `${file.path}:${file.stat.mtime}:${max}`;
    let t = this.excerpts.get(key);
    if (t === undefined) {
      t = excerptOf(await this.app.vault.cachedRead(file), max);
      if (this.excerpts.size > 2000) this.excerpts.clear();
      this.excerpts.set(key, t);
    }
    return t;
  },
  async fillExcerpt(file, el) {
    const t = await this.excerpt(file);
    el.setText(t || 'Empty note — click to start writing');
    el.toggleClass('is-empty', !t);
  },
  updateCard(file) {
    if (!this.bodyEl || !(file instanceof TFile)) return;
    const card = this.bodyEl.querySelector(`[data-path="${CSS.escape(file.path)}"]`);
    if (!card) return;
    const ex = card.querySelector('.nd-ci-excerpt');
    if (ex) this.fillExcerpt(file, ex);
  },
  markActive() {
    if (!this.bodyEl) return;
    const p = this.plugin.lastFile && this.plugin.lastFile.path;
    this.bodyEl.querySelectorAll('[data-path]').forEach((c) => c.toggleClass('is-active', c.dataset.path === p));
  },

  /* hover preview ------------------------------------------------------ */
  bindPreview(card, file) {
    card.addEventListener('mouseenter', () => {
      window.clearTimeout(this.previewTimer);
      this.previewTimer = window.setTimeout(() => this.showPreview(file, card), 550);
    });
    card.addEventListener('mouseleave', () => {
      window.clearTimeout(this.previewTimer);
      this.hidePreview();
    });
  },
  async showPreview(file, card) {
    if (!card.isConnected) return;
    this.hidePreview(true);
    const pv = this.contentEl.createDiv('nd-preview');
    this.previewEl = pv;
    pv.addEventListener('mouseenter', () => window.clearTimeout(this.hideTimer));
    pv.addEventListener('mouseleave', () => this.hidePreview());
    pv.createDiv({ cls: 'nd-preview-k', text: `Preview · ${file.basename}` });
    const text = pv.createDiv('nd-preview-text');
    const ex = await this.excerpt(file, 320);
    if (this.previewEl !== pv) return;
    text.setText(ex || 'Empty note.');
    const from = ((this.incoming && this.incoming.get(file.path)) || []).map((p) => p.split('/').pop().replace(/\.md$/, ''));
    if (from.length) pv.createDiv({ cls: 'nd-preview-links', text: `Linked from: ${from.slice(0, 5).join(', ')}${from.length > 5 ? ` +${from.length - 5}` : ''}` });
    const row = pv.createDiv('nd-preview-row');
    button(row, { text: 'Open', cls: 'mod-cta', onClick: (e) => (this.hidePreview(true), openFile(this.app, file, e)) });
    if (fileCategory(this.app, file) === 'school') button(row, { text: 'Mark revisited', onClick: () => (this.plugin.markSeen(file.path), this.hidePreview(true)) });
    const hr = this.contentEl.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const w = 340;
    let left = cr.right - hr.left + 10;
    if (left + w > hr.width - 8) left = Math.max(8, cr.left - hr.left - w - 10);
    pv.style.left = `${left}px`;
    pv.style.top = `${clamp(cr.top - hr.top, 8, Math.max(8, hr.height - pv.offsetHeight - 8))}px`;
  },
  hidePreview(now) {
    window.clearTimeout(this.hideTimer);
    const kill = () => {
      if (this.previewEl) this.previewEl.remove();
      this.previewEl = null;
    };
    if (now) kill();
    else this.hideTimer = window.setTimeout(kill, 220);
  },

});
