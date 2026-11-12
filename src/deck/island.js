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
      if (this.island.anim) this.island.anim.cancel();
      if (this.island.el) this.island.el.remove();
      if (this.island.svg) this.island.svg.remove();
      if (this.island.anchor) this.island.anchor.removeClass('is-island-open');
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
      if (this.island.el.contains(e.target) || e.target.closest('.menu, .modal-container, .popover, .nd-ticker')) return;
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
    const onTicker = e.target instanceof Element && e.target.closest('.nd-ticker');
    if (!ok || (e.clientY > this.topBarBottom() && !onTicker)) {
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
  /** The dashboard's ticker line when one is on screen: the island's resting form there. */
  tickerAnchor() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_DASH)) {
      const t = leaf.view.tickerEl;
      if (!t || !t.isConnected || t.ownerDocument !== document) continue;
      const r = t.getBoundingClientRect();
      if (!r.width || r.bottom < 0 || r.top > window.innerHeight) continue;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (hit && hit.closest('.nd-ticker') === t) return t;
    }
    return null;
  },
  /** Where the island grows from: the ticker pill, or a small drop under the top bar. */
  islandOrigin() {
    const s = this.island;
    if (s.anchor && s.anchor.isConnected) {
      const r = s.anchor.getBoundingClientRect();
      return { top: r.top, x: r.left + r.width / 2, w: r.width, h: r.height };
    }
    return { top: this.topBarBottom() + 8, x: window.innerWidth / 2, w: 150, h: 30 };
  },
  openIsland({ focus = false, byDrag = false } = {}) {
    const s = this.island;
    window.clearTimeout(s.fold);
    window.clearTimeout(s.dwell);
    s.dwell = 0;
    if (!s.el) this.buildIsland();
    s.byDrag = byDrag;
    this.fillTargets();
    if (!s.open || s.closing) {
      if (s.anim) s.anim.cancel();
      s.closing = false;
      if (!s.open) (s.anchor = this.tickerAnchor()), (s.seen = null);
      const o = this.islandOrigin();
      const w = Math.min(640, window.innerWidth - 32);
      s.el.style.setProperty('--nd-island-top', `${Math.round(o.top)}px`);
      s.el.style.setProperty('--nd-island-x', `${Math.round(Math.min(Math.max(o.x, w / 2 + 16), window.innerWidth - w / 2 - 16))}px`);
      s.el.toggleClass('from-ticker', !!s.anchor);
      s.open = true;
      s.el.addClass('is-open');
      s.el.setAttr('aria-hidden', 'false');
      if (s.anchor) s.anchor.addClass('is-island-open');
      this.renderPins();
      this.morph(true, o);
    }
    if (focus) window.setTimeout(() => s.input.focus(), 0);
  },
  closeIsland() {
    const s = this.island;
    window.clearTimeout(s.fold);
    if (!s.open || s.closing) return;
    s.closing = true;
    s.el.removeClass('is-target');
    if (s.el.contains(document.activeElement)) document.activeElement.blur();
    const done = () => {
      s.open = s.byDrag = s.closing = false;
      s.el.removeClass('is-open');
      s.el.setAttr('aria-hidden', 'true');
      if (s.anchor) s.anchor.removeClass('is-island-open');
      s.anchor = null;
    };
    const a = this.morph(false, this.islandOrigin());
    if (a) a.onfinish = () => (done(), a.cancel());
    else done();
  },
  /** Ferrofluid grow / shrink: squash and stretch between the origin pill and the full island. */
  morph(opening, from) {
    const s = this.island;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
    const r = s.el.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const at = (x, y) => ({ transform: `translate(-50%, 0) scale(${x}, ${y})` });
    const pill = at(Math.min(1, from.w / r.width), Math.min(1, from.h / r.height));
    const frames = opening
      ? [pill, { ...at(1.035, 0.94), offset: 0.55 }, { ...at(0.99, 1.025), offset: 0.78 }, at(1, 1)]
      : [at(1, 1), { ...at(1.025, 0.95), offset: 0.3 }, pill];
    if (s.anim) s.anim.cancel();
    s.anim = s.el.animate(frames, opening ? { duration: 560, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' } : { duration: 340, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' });
    s.body.animate(opening ? [{ opacity: 0 }, { opacity: 0, offset: 0.35 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0, offset: 0.45 }, { opacity: 0 }], { duration: opening ? 460 : 340 });
    return s.anim;
  },
  /** A swallow: the blob squashes as a pin goes in. */
  gulp() {
    const { el, open } = this.island;
    if (!el || !open || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const at = (x, y) => ({ transform: `translate(-50%, 0) scale(${x}, ${y})` });
    el.animate([at(1, 1), { ...at(1.03, 0.93), offset: 0.35 }, { ...at(0.99, 1.03), offset: 0.7 }, at(1, 1)], { duration: 420, easing: 'ease-out' });
  },

  buildIsland() {
    const s = this.island;
    const el = (s.el = document.body.createDiv({ cls: 'nd-island nd-root', attr: { 'aria-hidden': 'true', role: 'dialog', 'aria-label': 'Pin board' } }));
    // ferrofluid: shapes in one layer melt together through an SVG goo filter; text sits above, crisp
    if (!document.getElementById('nd-goo-filter')) {
      s.svg = document.body.createSvg('svg', { cls: 'nd-goo-defs', attr: { 'aria-hidden': 'true', width: '0', height: '0' } });
      const f = s.svg.createSvg('defs').createSvg('filter', { attr: { id: 'nd-goo-filter', x: '-20%', y: '-40%', width: '140%', height: '180%' } });
      f.createSvg('feGaussianBlur', { attr: { in: 'SourceGraphic', stdDeviation: '6', result: 'blur' } });
      f.createSvg('feColorMatrix', { attr: { in: 'blur', mode: 'matrix', values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11'  } });
    }
    const goo = (s.goo = el.createDiv('nd-island-goo'));
    goo.createDiv('nd-goo-neck');
    goo.createDiv('nd-goo-core');
    for (let i = 0; i < 7; i++) goo.createDiv('nd-goo-drop').style.setProperty('--d', String(i));
    el.createDiv('nd-island-skin'); // the crisp, glossy surface over the melted shape
    const body = (s.body = el.createDiv('nd-island-body'));
    const cap = body.createDiv('nd-island-cap');
    s.select = cap.createEl('select', { cls: 'dropdown nd-island-target', attr: { 'aria-label': 'Capture into' } });
    s.input = cap.createEl('input', { cls: 'nd-input nd-island-input', attr: { type: 'text', placeholder: 'Pin a note, or pick where it goes… (Enter)' } });
    s.list = body.createDiv('nd-island-pins');
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
    this.gulp();
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
    const fresh = s.seen ? pins.filter((p) => !s.seen.has(p.raw)) : pins; // after opening, every pin bubbles in
    s.seen = new Set(pins.map((p) => p.raw));
    for (const p of pins) {
      const card = list.createDiv('nd-island-pin');
      const k = fresh.indexOf(p);
      if (k >= 0) {
        card.addClass('is-new');
        card.style.setProperty('--i', String(Math.min(k, 12)));
      }
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
        card.addClass('is-leaving');
        window.setTimeout(() => this.unpin(p.raw), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220);
      });
    }
  },
});
