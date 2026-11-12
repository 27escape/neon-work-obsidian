/* ---- Dynamic Island: a pin board that drops down from the top bar ---------------
 * Pins live in one note (settings.pinBoardPath). Dragging a file, card or text over the
 * top bar opens it, dropping on it pins; Quick capture is its input line. Main window only. */
Object.assign(NeonDeck.prototype, {
  initIsland() {
    this.island = { el: null, open: false, byDrag: false, dwell: 0, fold: 0, tabDrag: false };
    this.registerCapture({ id: 'pin', label: 'Pin board', short: 'Pin', icon: 'pin', order: 90, run: (v) => this.pinText(v) });
    this.register(() => {
      window.clearTimeout(this.island.dwell);
      window.clearTimeout(this.island.fold);
      if (this.island.el) this.island.el.remove();
    });
    const isBoard = (f) => f && f.path === this.boardPath();
    const redraw = debounce(() => this.renderPins(), 150, true);
    for (const ev of ['modify', 'delete', 'create']) this.registerEvent(this.app.vault.on(ev, (f) => isBoard(f) && redraw()));
    this.registerEvent(this.app.vault.on('rename', (f, old) => (isBoard(f) || old === this.boardPath()) && redraw()));
    // drags: tab drags never open it; anything else that lingers over the top bar does
    this.registerDomEvent(document, 'dragstart', (e) => (this.island.tabDrag = !!(e.target.closest && e.target.closest('.workspace-tab-header'))), true);
    this.registerDomEvent(document, 'dragover', (e) => this.islandDragOver(e));
    const end = (e) => {
      this.island.tabDrag = false;
      window.clearTimeout(this.island.dwell);
      this.island.dwell = 0;
      const el = this.island.el;
      if (this.island.byDrag && !(el && e && e.target instanceof Node && el.contains(e.target))) this.foldSoon(300);
    };
    this.registerDomEvent(document, 'dragend', end, true);
    this.registerDomEvent(document, 'drop', end, true);
    this.registerDomEvent(document, 'dragleave', (e) => !e.relatedTarget && end()); // left the window
    this.registerDomEvent(document, 'keydown', (e) => {
      if (e.key === 'Escape' && this.island.open) {
        e.preventDefault();
        this.closeIsland();
      }
    });
    this.registerDomEvent(document, 'mousedown', (e) => {
      if (!this.island.open || !(e.target instanceof Element)) return;
      if (this.island.el.contains(e.target) || e.target.closest('.menu, .modal-container, .popover')) return;
      this.closeIsland();
    });
  },
  boardPath() {
    return normalizePath(this.settings.pinBoardPath || `${this.settings.coreFolder || 'Core'}/Pin board.md`);
  },
  async pinBoard(create) {
    const p = this.boardPath();
    const f = this.app.vault.getAbstractFileByPath(p);
    if (f instanceof TFile || !create) return f instanceof TFile ? f : null;
    const dir = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    if (dir) await ensureFolder(this.app, dir);
    return this.app.vault.create(p, '');
  },
  /** Top bar = everything above the workspace's first header row (title bar + tab strip). */
  topBarBottom() {
    const top = this.app.workspace.containerEl.getBoundingClientRect().top;
    const h = parseFloat(getComputedStyle(document.body).getPropertyValue('--header-height')) || 40;
    return top + h;
  },
  islandDragOver(e) {
    const s = this.island;
    if (s.tabDrag || (s.open && !s.byDrag) || activeDocument !== document) return;
    const types = Array.from((e.dataTransfer && e.dataTransfer.types) || []);
    const ok = this.dragging || types.includes('Files') || types.includes('text/plain');
    if (s.open) {
      window.clearTimeout(s.fold); // still dragging: stay open
      return;
    }
    if (!ok || e.clientY > this.topBarBottom()) {
      window.clearTimeout(s.dwell);
      s.dwell = 0;
      return;
    }
    if (!s.dwell) s.dwell = window.setTimeout(() => this.openIsland({ byDrag: true }), 250);
  },
  foldSoon(ms) {
    window.clearTimeout(this.island.fold);
    this.island.fold = window.setTimeout(() => this.closeIsland(), ms);
  },
  toggleIsland() {
    if (this.island.open) this.closeIsland();
    else this.openIsland({ focus: true });
  },
  openIsland({ focus = false, byDrag = false } = {}) {
    const s = this.island;
    window.clearTimeout(s.fold);
    window.clearTimeout(s.dwell);
    s.dwell = 0;
    if (!s.el) this.buildIsland();
    s.byDrag = byDrag;
    s.el.style.setProperty('--nd-island-top', `${Math.round(this.topBarBottom())}px`);
    this.fillTargets();
    if (!s.open) {
      s.open = true;
      s.el.addClass('is-open');
      s.el.setAttr('aria-hidden', 'false');
      this.renderPins();
    }
    if (focus) window.setTimeout(() => s.input.focus(), 0);
  },
  closeIsland() {
    const s = this.island;
    window.clearTimeout(s.fold);
    if (!s.open) return;
    s.open = s.byDrag = false;
    s.el.removeClass('is-open', 'is-target');
    s.el.setAttr('aria-hidden', 'true');
    if (s.el.contains(document.activeElement)) document.activeElement.blur();
  },

  buildIsland() {
    const s = this.island;
    const el = (s.el = document.body.createDiv({ cls: 'nd-island nd-root', attr: { 'aria-hidden': 'true', role: 'dialog', 'aria-label': 'Pin board' } }));
    const cap = el.createDiv('nd-island-cap');
    s.select = cap.createEl('select', { cls: 'dropdown nd-island-target', attr: { 'aria-label': 'Capture into' } });
    s.input = cap.createEl('input', { cls: 'nd-input nd-island-input', attr: { type: 'text', placeholder: 'Pin a note, or pick where it goes… (Enter)' } });
    s.list = el.createDiv('nd-island-pins');
    s.input.addEventListener('keydown', (e) => this.islandKey(e));
    // the island is the drop target while open
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      window.clearTimeout(s.fold);
      el.addClass('is-target');
    });
    el.addEventListener('dragleave', (e) => !el.contains(e.relatedTarget) && el.removeClass('is-target'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.removeClass('is-target');
      this.islandDrop(e);
    });
  },
  fillTargets() {
    const { select } = this.island;
    select.empty();
    for (const t of this.captureTargets()) select.createEl('option', { text: t.label, value: t.id });
    select.value = 'pin';
  },
  async islandKey(e) {
    const { select, input } = this.island;
    const n = select.options.length;
    if (e.key === 'Tab' && n) {
      e.preventDefault();
      select.selectedIndex = (select.selectedIndex + (e.shiftKey ? n - 1 : 1)) % n;
    } else if (e.altKey && /^[1-9]$/.test(e.key) && Number(e.key) <= n) {
      e.preventDefault();
      select.selectedIndex = Number(e.key) - 1;
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      const t = this.captures.get(select.value);
      const v = input.value.trim();
      if (!t || (!v && !t.allowEmpty)) return;
      this.lastCaptureTarget = t.id;
      input.value = '';
      if (t.id !== 'pin') this.closeIsland(); // the other targets may open their own dialogs
      try {
        await t.run(v);
      } catch (err) {
        console.error('Neon Deck capture', err);
        new Notice('Capture failed — see console');
      }
    }
  },

  /* pins ------------------------------------------------------------------- */
  async addPins(lines) {
    if (!lines.length) return;
    const f = await this.pinBoard(true);
    const text = await writeNote(this.app, f, (t) => lines.reduce(addPinLine, t));
    this.renderPins(text);
  },
  pinText(v) {
    return this.addPins([textPinLine(v)]);
  },
  pinFiles(files) {
    const from = this.boardPath();
    return this.addPins(files.map((f) => `- [[${this.app.metadataCache.fileToLinktext(f, from)}]]`));
  },
  async unpin(raw) {
    const f = await this.pinBoard(false);
    if (f) this.renderPins(await writeNote(this.app, f, (t) => removePinLine(t, raw)));
  },
  /** A path, [[link]] or obsidian://open URL, as a vault file, or null. */
  linkToFile(s) {
    s = s.trim();
    const url = s.match(/^obsidian:\/\/open\?(.*)$/);
    if (url) s = new URLSearchParams(url[1]).get('file') || '';
    else s = s.replace(/^!?\[\[([^\]|#]+).*\]\]$/, '$1');
    if (!s) return null;
    const mc = this.app.metadataCache;
    const f = this.app.vault.getAbstractFileByPath(normalizePath(s)) || mc.getFirstLinkpathDest(s, '');
    return f instanceof TFile ? f : null;
  },
  async islandDrop(e) {
    const dt = e.dataTransfer;
    const dragged = this.dragging;
    const text = dt ? dt.getData('text/plain') : ''; // read now: the drop's data is gone after the first await
    try {
      if (dragged instanceof TFile) await this.pinFiles([dragged]);
      else if (dt && dt.files && dt.files.length) await this.pinFiles((await this.importFiles(dt, normalizePath(`${this.settings.coreFolder || 'Core'}/Pinned`))) || []);
      else if (text.trim()) {
        const lines = text.split('\n').filter((l) => l.trim());
        const files = lines.map((l) => this.linkToFile(l));
        if (files.every(Boolean)) await this.pinFiles(files);
        else await this.pinText(text);
      }
    } catch (err) {
      console.error('Neon Deck: pin drop', err);
      new Notice('Could not pin that — see console');
    }
    if (this.island.byDrag) this.foldSoon(1200);
  },
  async renderPins(text) {
    const s = this.island;
    if (!s || !s.el || !s.open) return;
    if (text === undefined) {
      const f = await this.pinBoard(false);
      text = f ? await this.app.vault.cachedRead(f) : '';
    }
    const list = s.list;
    list.empty();
    const pins = parsePins(text);
    if (!pins.length) {
      list.createDiv({ cls: 'nd-island-empty', text: 'Drop files here, or type above and press Enter.' });
      return;
    }
    const from = this.boardPath();
    for (const p of pins) {
      const card = list.createDiv('nd-island-pin');
      if (p.link) {
        const f = this.app.metadataCache.getFirstLinkpathDest(p.link, from);
        icon(card, f ? (f.extension === 'md' ? 'file-text' : 'file') : 'file-x');
        card.createSpan({ cls: 'nd-island-name', text: f ? f.basename : p.link });
        if (f) this.bindFileMouse(card, f);
        else card.addClass('is-missing');
        card.setAttr('title', f ? f.path : `${p.link} (not found)`);
      } else {
        icon(card, 'sticky-note');
        card.createSpan({ cls: 'nd-island-name', text: p.text });
        card.addClass('is-text');
        card.setAttr('draggable', 'true');
        card.addEventListener('dragstart', (e) => e.dataTransfer && e.dataTransfer.setData('text/plain', p.text));
      }
      const x = card.createEl('button', { cls: 'nd-island-x clickable-icon', attr: { type: 'button', 'aria-label': 'Unpin' } });
      setIcon(x, 'x');
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        this.unpin(p.raw);
      });
    }
  },
});
