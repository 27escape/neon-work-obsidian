/* ------------------------------------------------------------------ */
/* Concept graph (InfraNodus-style)                                    */
/* ------------------------------------------------------------------ */

class GraphView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.navigation = true;
    this.plugin = plugin;
    // notes only: the concept graph was taken out of the UI in 1.6 (its code is still below, unused)
    this.mode = 'notes';
    this.scope = 'vault';
    this.showLabels = true;
    this.cam = { x: 0, y: 0, k: 1 };
    this.hover = -1;
    this.selected = -1;
    this.focusTopic = -1;
    this.previewTopic = -1;
    this.gapFocus = null;
    this.nodes = [];
    this.links = [];
    this.buildToken = 0;
    this.dpr = 1;
    this.cw = 0;
    this.ch = 0;
  }
  getViewType() {
    return VIEW_GRAPH;
  }
  getDisplayText() {
    return 'Graph';
  }
  getIcon() {
    return 'waypoints';
  }
  getState() {
    return { mode: this.mode, scope: this.scope };
  }
  async setState(state, result) {
    if (state) {
      // older layouts may still ask for 'concepts'; always show notes
      this.mode = 'notes';
      if (state.scope) this.scope = state.scope;
    }
    await super.setState(state, result);
    if (this.ready) {
      this.syncToolbar();
      this.rebuild();
    }
  }

  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass('nd-root', 'nd-graph');
    const bar = root.createDiv('nd-graph-bar');
    this.segBtns = {}; // no Concepts / Notes switch any more
    this.scopeSel = bar.createEl('select', { cls: 'dropdown nd-select' });
    this.scopeSel.addEventListener('focus', () => this.fillScopes());
    this.scopeSel.addEventListener('change', () => {
      this.scope = this.scopeSel.value;
      this.rebuild();
      this.app.workspace.requestSaveLayout();
    });
    this.statEl = bar.createDiv('nd-graph-stat');
    const tools = bar.createDiv('nd-tools');
    button(tools, { icon: 'maximize', cls: 'nd-icon-btn', title: 'Fit to view (or double-click the background)', onClick: () => this.fit(true) });
    button(tools, {
      icon: 'shuffle',
      cls: 'nd-icon-btn',
      title: 'Shake the layout',
      onClick: () => {
        if (!this.sim) return;
        this.seedLayout((Math.random() * 1e9) | 0);
        this.sim.alpha = 1;
        for (let i = 0; i < 60; i++) this.sim.tick();
        this.fit(true);
        this.kick();
      },
    });
    this.labelBtn = button(tools, {
      icon: 'type',
      cls: 'nd-icon-btn is-active',
      title: 'Toggle labels',
      onClick: () => {
        this.showLabels = !this.showLabels;
        this.labelBtn.toggleClass('is-active', this.showLabels);
        this.requestDraw();
      },
    });
    button(tools, { icon: 'refresh-cw', cls: 'nd-icon-btn', title: 'Rebuild from notes', onClick: () => this.rebuild() });
    this.panelBtn = button(tools, {
      icon: 'panel-right',
      cls: 'nd-icon-btn is-active',
      title: 'Toggle insights panel',
      onClick: () => {
        root.toggleClass('nd-panel-hidden', !root.hasClass('nd-panel-hidden'));
        this.panelBtn.toggleClass('is-active', !root.hasClass('nd-panel-hidden'));
      },
    });
    const body = root.createDiv('nd-graph-body');
    this.stage = body.createDiv('nd-graph-stage');
    this.canvas = this.stage.createEl('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.emptyEl = this.stage.createDiv('nd-graph-empty');
    this.stage.createDiv({ cls: 'nd-graph-hint', text: 'drag · scroll zoom · double-click open · right-click more' });
    this.panel = body.createDiv('nd-graph-panel');
    this.bindCanvas();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.stage);
    this.register(() => ro.disconnect());
    this.register(() => {
      // closed for good: no timer or ripple may start drawing again
      this.closed = true;
      cancelAnimationFrame(this.raf);
    });
    const soon = debounce(() => this.rebuild(), 1500, true);
    this.registerEvent(
      this.app.workspace.on('file-open', (f) => {
        if (f && this.scope === 'note' && (!this.builtFor || this.builtFor !== f.path)) soon();
      }),
    );
    this.registerEvent(
      this.app.vault.on('modify', (f) => {
        if (this.scope === 'note' && this.builtFor === f.path) soon();
      }),
    );
    this.registerEvent(this.app.workspace.on('css-change', () => this.themeChanged()));
    this.register(this.plugin.onLook(() => this.themeChanged()));
    this.ready = true;
    this.fillScopes();
    this.syncToolbar();
    this.resize();
    await this.rebuild();
  }

  syncToolbar() {
    for (const [m, b] of Object.entries(this.segBtns)) b.toggleClass('is-active', m === this.mode);
    this.fillScopes();
  }
  fillScopes() {
    const sel = this.scopeSel;
    sel.empty();
    sel.createEl('option', { value: 'vault', text: '◎ Whole vault' });
    sel.createEl('option', { value: 'note', text: '✎ Active note' + (this.mode === 'notes' ? ' (2 hops)' : '') });
    const folders = this.app.vault
      .getAllLoadedFiles()
      .filter((f) => f instanceof TFolder && f.path !== '/')
      .sort((a, b) => a.path.localeCompare(b.path));
    for (const f of folders) sel.createEl('option', { value: `folder:${f.path}`, text: `▸ ${f.path}` });
    if (![...sel.options].some((o) => o.value === this.scope)) this.scope = 'vault';
    sel.value = this.scope;
  }

  scopeFiles() {
    const excl = (f) => this.plugin.isExcluded(f);
    let files = this.app.vault.getMarkdownFiles().filter((f) => !excl(f));
    this.builtFor = null;
    if (this.scope === 'note') {
      const f = this.plugin.lastFile;
      if (!f || f.extension !== 'md') return [];
      this.builtFor = f.path;
      if (this.mode === 'concepts') return [f];
      const rl = this.app.metadataCache.resolvedLinks;
      const back = new Map();
      for (const src in rl) for (const dst in rl[src]) {
        if (!back.has(dst)) back.set(dst, []);
        back.get(dst).push(src);
      }
      const seen = new Set([f.path]);
      let frontier = [f.path];
      for (let hop = 0; hop < 2; hop++) {
        const next = [];
        for (const p of frontier) for (const q of [...Object.keys(rl[p] || {}), ...(back.get(p) || [])]) {
          if (!seen.has(q)) {
            seen.add(q);
            next.push(q);
          }
        }
        frontier = next;
      }
      return files.filter((x) => seen.has(x.path));
    }
    if (this.scope.startsWith('folder:')) {
      const p = this.scope.slice(7);
      files = files.filter((f) => f.path.startsWith(p + '/'));
    }
    return files.sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  async rebuild() {
    const token = ++this.buildToken;
    const s = this.plugin.settings;
    const files = this.scopeFiles();
    this.statEl.setText('analysing…');
    let net;
    if (this.mode === 'concepts') {
      const docs = [];
      const some = files.slice(0, 1500);
      const texts = await Promise.all(some.map((f) => this.app.vault.cachedRead(f).catch(() => '')));
      some.forEach((f, i) => docs.push({ path: f.path, text: texts[i] }));
      if (token !== this.buildToken) return;
      net = buildConceptNetwork(docs, { window: s.graphWindow, maxNodes: s.graphMaxNodes, stopwords: this.plugin.stopwords() });
    } else {
      net = buildNoteNetwork(this.app, files, s.graphMaxNodes * 2);
    }
    if (token !== this.buildToken) return;
    this.selected = this.hover = this.focusTopic = this.previewTopic = -1;
    this.gapFocus = null;
    if (net.labels.length < 2) {
      this.net = null;
      this.an = null; // a stale analysis made theme changes crash on an empty graph
      this.nodes = [];
      this.links = [];
      this.sim = null;
      this.statEl.setText('');
      this.emptyEl.empty();
      this.emptyEl.addClass('is-visible');
      this.emptyEl.createDiv({ cls: 'nd-graph-empty-art', text: '◌ ◌ ◌' });
      this.emptyEl.createDiv({
        text:
          this.mode === 'concepts'
            ? this.scope === 'note'
              ? 'Open a note with some text, then come back ✦'
              : 'Not enough text yet — write a few notes and rebuild ✦'
            : 'No linked notes in this scope yet — connect notes with [[links]] ✦',
      });
      this.panel.empty();
      this.requestDraw();
      return;
    }
    this.emptyEl.removeClass('is-visible');
    const an = analyzeNetwork(net.labels.length, net.edges);
    this.net = net;
    this.an = an;
    this.nodes = net.labels.map((label, i) => ({
      i,
      label,
      kind: net.kinds[i],
      r: 4 + 20 * an.score[i],
      c: an.comm[i],
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      fixed: false,
    }));
    this.links = net.edges.map(([a, b, w]) => ({ s: this.nodes[a], t: this.nodes[b], w }));
    this.maxW = this.links.reduce((m, l) => Math.max(m, l.w), 1);
    this.neighbors = an.adj.map((a) => new Set(a));
    this.bcRank = this.nodes.map((n) => n.i).sort((a, b) => an.bc[b] - an.bc[a]);
    this.sim = new ForceSim(this.nodes, this.links);
    this.seedLayout(7);
    for (let i = 0; i < 180; i++) this.sim.tick();
    this.statEl.setText(`${this.nodes.length} ${this.mode === 'concepts' ? 'concepts' : 'notes'} · ${this.links.length} links · ${an.topics.length} topics`);
    this.fit(false);
    this.renderPanel();
    this.kick();
  }

  seedLayout(seed) {
    const rand = mulberry32(seed);
    const an = this.an;
    const nT = an.topics.length;
    const R = 40 * Math.sqrt(this.nodes.length);
    an.topics.forEach((t, k) => {
      const ang = (k / Math.max(1, nT)) * Math.PI * 2 + rand();
      const cx = k === 0 ? 0 : Math.cos(ang) * R;
      const cy = k === 0 ? 0 : Math.sin(ang) * R;
      const spread = 20 * Math.sqrt(t.members.length);
      for (const i of t.members) {
        const n = this.nodes[i];
        n.x = cx + (rand() - 0.5) * spread;
        n.y = cy + (rand() - 0.5) * spread;
        n.vx = n.vy = 0;
        n.fixed = false;
      }
    });
  }

  themeChanged() {
    this._col = null;
    if (this.an && this.net) this.renderPanel();
    this.requestDraw();
  }

  resize() {
    if (!this.stage) return;
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    if (!w || !h) return;
    const first = !this.cw;
    this.dpr = window.devicePixelRatio || 1;
    this.cw = w;
    this.ch = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    if (first && this.nodes.length) this.fit(false);
    this.requestDraw();
  }

  bounds(ids) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const i of ids || this.nodes.map((n) => n.i)) {
      const n = this.nodes[i];
      x0 = Math.min(x0, n.x - n.r - 20);
      x1 = Math.max(x1, n.x + n.r + 20);
      y0 = Math.min(y0, n.y - n.r - 10);
      y1 = Math.max(y1, n.y + n.r + 26);
    }
    return { x0, y0, x1, y1 };
  }
  fit(animate, ids) {
    if (!this.nodes.length || !this.cw) return;
    const b = this.bounds(ids);
    const k = clamp(Math.min(this.cw / (b.x1 - b.x0), this.ch / (b.y1 - b.y0)) * 0.92, 0.08, ids ? 2.2 : 1.6);
    const to = { k, x: this.cw / 2 - ((b.x0 + b.x1) / 2) * k, y: this.ch / 2 - ((b.y0 + b.y1) / 2) * k };
    this.moveCam(to, animate);
  }
  focusNode(n) {
    const k = Math.max(this.cam.k, 1.1);
    this.moveCam({ k, x: this.cw / 2 - n.x * k, y: this.ch / 2 - n.y * k }, true);
  }
  moveCam(to, animate) {
    if (!animate) {
      this.cam = to;
      this.camAnim = null;
      this.requestDraw();
      return;
    }
    this.camAnim = { from: { ...this.cam }, to, t0: performance.now(), dur: 420 };
    this.kick();
  }

  focusSet() {
    const nb = (i) => new Set([i, ...this.neighbors[i]]);
    if (this.hover >= 0) return nb(this.hover);
    if (this.selected >= 0) return nb(this.selected);
    const t = this.previewTopic >= 0 ? this.previewTopic : this.focusTopic;
    if (t >= 0) return new Set(this.an.topics[t].members);
    if (this.gapFocus) return new Set([...this.an.topics[this.gapFocus.a].members, ...this.an.topics[this.gapFocus.b].members]);
    return null;
  }

}

