/* ---- plugin ------------------------------------------------------------- */
class NeonWrite extends Plugin {
  async onload() {
    this.settings = Object.assign({}, NW_DEFAULTS, (await this.loadData()) || {});
    this.registerEditorSuggest(new SlashSuggest(this));
    // tell other Neon plugins they can add slash items now (they also check on their own load)
    this.addCommand({ id: 'insert-table', name: 'Insert table…', editorCallback: (ed) => this.openTablePicker(ed) });
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu, editor) => {
        menu.addItem((i) => i.setTitle('Insert table…').setIcon('table').onClick(() => this.openTablePicker(editor)));
      }),
    );

    this.toolbar = new SelectionToolbar(this);
    this.register(() => this.toolbar.destroy());
    const later = () => window.setTimeout(() => this.toolbar.update(), 10);
    this.registerDomEvent(document, 'mouseup', later);
    this.registerDomEvent(document, 'keyup', (e) => (e.shiftKey || e.key === 'Shift' || (e.ctrlKey && e.key === 'a') ? later() : this.toolbar.hide()));
    this.registerDomEvent(document, 'scroll', () => this.toolbar.hide(), true);
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.toolbar.hide()));

    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.mountNotePattern()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.mountNotePattern()));
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.mountNotePattern()));
    this.registerEvent(this.app.workspace.on('neon-deck:core-unloaded', () => this.unmountNotePattern()));
    this.app.workspace.onLayoutReady(() => {
      this.mountNotePattern();
      // registered after startup: Obsidian fires 'create' for every file while it loads the vault
      this.registerEvent(this.app.vault.on('create', (f) => this.onCreate(f)));
    });
    if (cmState) {
      // locked callouts: refuse the user's own edits inside them (typing, delete, paste, drag, undo);
      // background writes from other plugins have no user event and pass, so editor and file never disagree
      this.registerEditorExtension(
        cmState.EditorState.transactionFilter.of((tr) => {
          if (!tr.docChanged || tr.annotation(lockAnno)) return tr;
          const ev = tr.annotation(cmState.Transaction.userEvent);
          if (!ev || !/^(input|delete|move|undo|redo)/.test(ev)) return tr;
          const ranges = lockedRanges(tr.startState.doc);
          if (!ranges.length) return tr;
          let hit = false;
          tr.changes.iterChangedRanges((a, b) => (hit = hit || ranges.some(([f, t]) => a <= t && b >= f)));
          if (!hit) return tr;
          this.shakeLocks();
          return [];
        }),
      );
      this.registerMarkdownPostProcessor((el, ctx) => {
        for (const c of el.matches('.callout') ? [el] : el.querySelectorAll('.callout')) this.addLock(c, ctx);
      });
      this.addCommand({
        id: 'toggle-callout-lock',
        name: 'Lock / unlock the callout under the cursor',
        editorCallback: (ed) => {
          const doc = ed.cm.state.doc;
          let n = ed.getCursor().line + 1;
          while (n > 1 && !CALLOUT_HEAD_RE.test(doc.line(n).text) && /^\s*>/.test(doc.line(n - 1).text)) n--;
          if (!this.lockLine(ed.cm, doc.line(n))) new Notice('The cursor is not in a callout');
        },
      });
    }
    this.registerMarkdownPostProcessor((el) => {
      for (const t of el.querySelectorAll('table')) if (t.textContent.includes('<')) mergeTable(t);
    });
    this.addCommand({
      id: 'table-title-row',
      name: 'Table: add a title row',
      editorCallback: (ed) => {
        let a = ed.getCursor().line;
        if (!ed.getLine(a).trim().startsWith('|')) return new Notice('Put the cursor in a table first');
        while (a > 0 && ed.getLine(a - 1).trim().startsWith('|')) a--;
        const cols = ed.getLine(a).trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).length;
        // after the header and the --- row: the first body row, shown above the header as one wide title
        ed.replaceRange(`| Title |${' < |'.repeat(cols - 1)}\n`, { line: a + 2, ch: 0 });
        ed.setSelection({ line: a + 2, ch: 2 }, { line: a + 2, ch: 7 });
      },
    });
    this.addCommand({
      id: 'table-merge-left',
      name: 'Table: merge cell with the one on its left (again to split)',
      editorCallback: (ed) => {
        const c = ed.getCursor();
        const next = toggleMergeCell(ed.getLine(c.line), c.ch);
        if (next == null) return new Notice('Put the cursor in a table cell that has a cell on its left');
        ed.setLine(c.line, next);
      },
    });
    this.addCommand({ id: 'insert-divider', name: 'Insert divider', editorCallback: (ed) => insertDivider(ed) });
    this.addCommand({ id: 'make-subtitle', name: 'Make sub-title (toggle)', editorCallback: (ed) => toggleSubtitle(ed) });
    this.addCommand({ id: 'insert-page-break', name: 'Insert page break (PDF)', editorCallback: (ed) => insertPageBreak(ed) });
    // --- typed under a line of text stays a divider
    this.registerDomEvent(document, 'keyup', (e) => {
      if (e.key !== 'Enter' || !this.settings.limeDividers) return;
      const v = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (v && v.getMode() === 'source' && v.editor.hasFocus()) keepDivider(v.editor);
    });
    this.addCommand({ id: 'move-images', name: 'Move existing images to Core/Images', callback: () => this.moveExistingImages() });
    this.applyLook();
    this.addSettingTab(new NeonWriteSettingTab(this.app, this));
  }
  onunload() {
    if (this.picker) this.picker.close(); // its document listeners go with it
    this.unmountNotePattern();
    document.body.removeClass('nw-lifted', 'nw-fonts', 'nw-tables', 'nw-hr', 'nw-hr-anim');
  }
  /** A small lock at the right of a callout's title; locked = lime. */
  addLock(c, ctx) {
    const title = c.querySelector(':scope > .callout-title');
    if (!title || title.querySelector('.nw-lock')) return;
    const locked = /(^|[\s|])locked(\s|$)/.test(c.getAttribute('data-callout-metadata') || '');
    c.toggleClass('is-locked', locked);
    const b = title.createDiv('nw-lock' + (locked ? ' is-locked' : ''));
    setIcon(b, locked ? 'lock' : 'lock-open');
    b.setAttr('aria-label', locked ? 'Locked · click to unlock' : 'Click to lock this block');
    // mousedown, not click: in Live Preview a click would first open the callout's source
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const view = this.app.workspace.getLeavesOfType('markdown').map((l) => l.view).find((v) => v.contentEl.contains(c));
      if (view && view.getMode() === 'source') {
        const cm = view.editor.cm;
        this.lockLine(cm, cm.state.doc.lineAt(cm.posAtDOM(c)));
        return;
      }
      const info = ctx.getSectionInfo(c);
      const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
      if (!info || !(file instanceof TFile)) return;
      this.app.vault.process(file, (d) => {
        const lines = d.split('\n');
        const t = toggleLockMeta(lines[info.lineStart] || '');
        if (t != null) lines[info.lineStart] = t;
        return lines.join('\n');
      });
    });
    b.addEventListener('click', (e) => e.stopPropagation());
  }
  /** Toggle the lock on a callout header line in an open editor (our own edit, so the lock lets it through). */
  lockLine(cm, line) {
    const t = toggleLockMeta(line.text);
    if (t == null) return false;
    cm.dispatch({ changes: { from: line.from, to: line.to, insert: t }, annotations: lockAnno.of(true) });
    return true;
  }
  /** A blocked edit: the locks in view give a short shake. */
  shakeLocks() {
    // the callout's lock when it's drawn; while its source is shown, the line being edited flashes instead
    const els = [...document.querySelectorAll('.workspace-leaf.mod-active .nw-lock.is-locked')];
    // (CodeMirror redraws its own line elements, so the class goes on the scroller around them)
    const sc = document.querySelector('.workspace-leaf.mod-active .cm-scroller');
    for (const el of els.length ? els : sc ? [sc] : []) {
      el.removeClass('is-shake');
      void el.offsetWidth;
      el.addClass('is-shake');
      window.setTimeout(() => el.removeClass('is-shake'), 450);
    }
  }
  applyLook() {
    document.body.toggleClass('nw-lifted', this.settings.liftedWindow);
    document.body.toggleClass('nw-fonts', this.settings.themeFonts);
    document.body.toggleClass('nw-tables', this.settings.styledTables);
    document.body.toggleClass('nw-hr', this.settings.limeDividers);
    document.body.toggleClass('nw-hr-anim', this.settings.limeDividers && this.settings.dividerDots);
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
  openTablePicker(editor) {
    if (this.picker) this.picker.close();
    this.picker = new TablePicker(editor, caretRect(editor));
  }

  /* images into Core/Images ------------------------------------------------ */
  imageFolder() {
    const deck = neonPlugin(this.app, 'neon-deck');
    const core = (deck && deck.settings && deck.settings.coreFolder) || 'Core';
    return normalizePath(`${core}/Images`);
  }
  isLooseImage(f) {
    const dir = this.imageFolder();
    return f instanceof TFile && /^(png|jpe?g)$/i.test(f.extension) && !f.path.startsWith(dir + '/');
  }
  onCreate(f) {
    if (!this.settings.moveImages || !this.isLooseImage(f)) return;
    // give Obsidian a moment to write the ![[link]] into the note, so the rename updates it too
    window.setTimeout(async () => {
      if (this.app.vault.getAbstractFileByPath(f.path) !== f || !this.isLooseImage(f)) return;
      try {
        await this.moveImage(f);
        new Notice(`Image moved to ${this.imageFolder()}`);
      } catch (e) {
        console.error('Neon Write: could not move image', e);
      }
    }, 1500);
  }
  /** Move one image into the Images folder (renamed with a number if the name is taken). Links follow. */
  async moveImage(f) {
    const dir = this.imageFolder();
    await ensureFolder(this.app, dir);
    let dest = normalizePath(`${dir}/${f.name}`);
    if (this.app.vault.getAbstractFileByPath(dest)) dest = uniquePath(this.app, dir, f.basename, f.extension);
    await this.app.fileManager.renameFile(f, dest);
  }
  moveExistingImages() {
    const loose = this.app.vault.getFiles().filter((f) => this.isLooseImage(f));
    if (!loose.length) return new Notice(`No .png or .jpg images outside ${this.imageFolder()}.`);
    new ConfirmModal(this.app, {
      title: 'Move images',
      text: `Move ${loose.length} image${loose.length === 1 ? '' : 's'} into ${this.imageFolder()}? Links to them are updated.`,
      cta: 'Move',
      warning: false,
      onConfirm: async () => {
        let n = 0;
        for (const f of loose) {
          try {
            await this.moveImage(f);
            n++;
          } catch (e) {
            console.error('Neon Write: could not move image', f.path, e);
          }
        }
        new Notice(`Moved ${n} image${n === 1 ? '' : 's'} to ${this.imageFolder()}`);
      },
    }).open();
  }

  /* pattern behind the active note --------------------------------------- */
  mountNotePattern() {
    const v = this.app.workspace.getActiveViewOfType(MarkdownView);
    const mode = v ? v.getMode() : '';
    // already on this note in this mode: nothing to do
    if (this.pat && v && this.pat.view === v && this.pat.mode === mode && this.pat.layer) return;
    this.unmountNotePattern();
    const api = deckApi(this.app);
    if (!this.settings.notePattern || !api || !api.mountPattern || !v) return;
    const host = v.contentEl;
    const scroller = host.querySelector(mode === 'preview' ? '.markdown-preview-view' : '.cm-scroller') || host;
    host.addClass('nw-pattern-host');
    // cards selector that matches nothing: the whole note gets the (dimmed) outside strength
    const layer = api.mountPattern(host, scroller, '.nw-no-cards');
    this.pat = { view: v, mode, host, layer };
    this.applyPatternOpacity();
  }
  unmountNotePattern() {
    const p = this.pat;
    this.pat = null;
    if (!p) return;
    try {
      if (p.layer) p.layer.destroy();
    } catch (e) {
      console.error('Neon Write pattern', e);
    }
    p.host.removeClass('nw-pattern-host', 'nd-has-pattern');
  }
  applyPatternOpacity() {
    if (this.pat) this.pat.host.style.setProperty('--nw-pattern-opacity', String(this.settings.patternOpacity / 100));
  }
}
