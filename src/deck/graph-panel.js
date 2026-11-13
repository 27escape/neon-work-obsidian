Object.assign(GraphView.prototype, {
  select(i) {
    this.selected = i;
    this.renderSelection();
    this.requestDraw();
  },
  nodeFile(n) {
    if (this.mode === 'notes') return this.net.files[n.i];
    if (n.kind === 'link') return this.app.metadataCache.getFirstLinkpathDest(this.net.keys[n.i].slice(1, -1), '');
    return null;
  },
  activateNode(n, e) {
    const f = this.nodeFile(n);
    if (f) this.plugin.openFile(f, e);
    else this.plugin.openSearch(n.kind === 'tag' ? `tag:${n.label}` : n.label);
  },
  nodeMenu(n, e) {
    const f = this.nodeFile(n);
    if (this.mode === 'notes' && f) {
      this.plugin.fileMenu(f, e);
      return;
    }
    const m = new Menu();
    m.addItem((it) => it.setTitle(`Search notes for “${n.label}”`).setIcon('search').onClick(() => this.plugin.openSearch(n.kind === 'tag' ? `tag:${n.label}` : n.label)));
    if (f) m.addItem((it) => it.setTitle('Open note').setIcon('file-text').onClick(() => this.plugin.openFile(f)));
    else if (n.kind === 'word')
      m.addItem((it) =>
        it.setTitle(`Create note “${n.label}”`).setIcon('file-plus').onClick(async () => {
          const nf = await createUnique(this.app, '', n.label, `# ${n.label}\n\n`);
          this.plugin.openFile(nf);
        }),
      );
    m.addItem((it) => it.setTitle('Focus its topic').setIcon('shapes').onClick(() => this.toggleTopic(n.c)));
    m.addSeparator();
    m.addItem((it) =>
      it.setTitle(`Hide “${n.label}” (stop-word)`).setIcon('eye-off').onClick(async () => {
        const s = this.plugin.settings;
        s.extraStopwords = [s.extraStopwords, this.net.keys[n.i]].filter(Boolean).join(', ');
        await this.plugin.saveSettings();
        this.rebuild();
      }),
    );
    m.showAtMouseEvent(e);
  },
  toggleTopic(k) {
    this.focusTopic = this.focusTopic === k ? -1 : k;
    this.gapFocus = null;
    this.panel.querySelectorAll('.nd-topic').forEach((r, idx) => r.toggleClass('is-active', idx === this.focusTopic));
    if (this.focusTopic >= 0) this.fit(true, this.an.topics[k].members);
    else this.fit(true);
    this.requestDraw();
  },

  section(title, ic) {
    const s = this.panel.createDiv('nd-panel-sec');
    const h = s.createDiv('nd-panel-head');
    icon(h, ic);
    h.createSpan({ text: title });
    return s;
  },
  topicWords(k, n = 3) {
    return this.an.topics[k].members.slice(0, n).map((i) => this.net.labels[i]);
  },

  renderPanel() {
    const p = this.panel;
    p.empty();
    const an = this.an;
    const pal = this.colors().pal;
    const unit = this.mode === 'concepts' ? 'concepts' : 'notes';

    const st = this.section('Structure', 'gauge');
    const badge = st.createDiv(`nd-diversity is-${an.diversity.toLowerCase()}`);
    badge.createDiv({ cls: 'nd-div-label', text: an.diversity });
    badge.createDiv({ cls: 'nd-div-q', text: `modularity ${an.Q.toFixed(2)} · top topic ${Math.round(an.topics[0].share * 100)}%` });
    const scale = st.createDiv('nd-div-scale');
    for (const lvl of ['Biased', 'Focused', 'Diversified', 'Dispersed']) scale.createDiv({ cls: 'nd-div-step' + (lvl === an.diversity ? ' is-on' : ''), text: lvl });
    st.createDiv({ cls: 'nd-muted', text: DIVERSITY_HINT[an.diversity] });

    const tp = this.section('Main topics', 'shapes');
    an.topics.slice(0, 8).forEach((t, k) => {
      const row = tp.createDiv('nd-topic');
      row.style.setProperty('--topic', pal[k % pal.length]);
      row.createDiv({ cls: 'nd-topic-sw', text: String(k + 1) });
      const txt = row.createDiv('nd-topic-txt');
      txt.createDiv({ cls: 'nd-topic-words', text: this.topicWords(k, 4).join(' · ') });
      const meter = txt.createDiv('nd-topic-meter');
      meter.createDiv('nd-topic-fill').style.setProperty('--w', `${Math.round(t.share * 100)}%`);
      txt.createDiv({ cls: 'nd-topic-share', text: `${Math.round(t.share * 100)}% · ${t.members.length} ${unit}` });
      row.addEventListener('mouseenter', () => {
        this.previewTopic = k;
        this.requestDraw();
      });
      row.addEventListener('mouseleave', () => {
        this.previewTopic = -1;
        this.requestDraw();
      });
      row.addEventListener('click', () => this.toggleTopic(k));
    });

    const inf = this.section('Most influential', 'zap');
    const chips = inf.createDiv('nd-chip-row');
    this.bcRank.slice(0, 14).forEach((i) => {
      const n = this.nodes[i];
      const chip = chips.createEl('button', { cls: 'nd-chip', text: n.label });
      chip.style.setProperty('--card-accent', pal[n.c % pal.length]);
      chip.addEventListener('click', () => {
        this.select(i);
        this.focusNode(n);
      });
      chip.addEventListener('mouseenter', () => {
        this.hover = i;
        this.requestDraw();
      });
      chip.addEventListener('mouseleave', () => {
        this.hover = -1;
        this.requestDraw();
      });
    });

    const gp = this.section('Structural gaps', 'unlink');
    if (!an.gaps.length) gp.createDiv({ cls: 'nd-muted', text: 'Not enough distinct topics to detect gaps yet.' });
    an.gaps.forEach((g) => {
      const card = gp.createDiv('nd-gap');
      const line = card.createDiv('nd-gap-line');
      const wa = this.topicWords(g.a, 2);
      const wb = this.topicWords(g.b, 2);
      const sa = line.createSpan({ cls: 'nd-gap-side', text: wa.join(' · ') });
      sa.style.setProperty('--topic', pal[g.a % pal.length]);
      line.createSpan({ cls: 'nd-gap-x', text: '⟷' });
      const sb = line.createSpan({ cls: 'nd-gap-side', text: wb.join(' · ') });
      sb.style.setProperty('--topic', pal[g.b % pal.length]);
      card.createDiv({
        cls: 'nd-gap-q',
        text: this.mode === 'concepts' ? `How does “${wa[0]}” relate to “${wb[0]}”?` : `What connects [[${wa[0]}]] with [[${wb[0]}]]?`,
      });
      card.createDiv({ cls: 'nd-gap-meta', text: g.weight ? `only ${g.weight} weak link${g.weight === 1 ? '' : 's'} between them` : 'no links between them yet' });
      const row = card.createDiv('nd-gap-actions');
      const hl = button(row, {
        icon: 'scan-eye',
        text: 'Highlight',
        onClick: () => {
          const same = this.gapFocus === g;
          this.gapFocus = same ? null : g;
          this.focusTopic = -1;
          gp.querySelectorAll('.nd-gap').forEach((c) => c.removeClass('is-active'));
          if (!same) card.addClass('is-active');
          if (!same) this.fit(true, [...an.topics[g.a].members, ...an.topics[g.b].members]);
          this.requestDraw();
        },
      });
      hl.addClass('nd-small');
      button(row, { icon: 'git-merge', text: 'Bridge note', cls: 'mod-cta nd-small', onClick: () => this.createBridge(g) });
    });

    this.selEl = this.section('Selection', 'mouse-pointer-click');
    this.renderSelection();
  },

  renderSelection() {
    const s = this.selEl;
    if (!s) return;
    s.querySelectorAll('.nd-sel').forEach((x) => x.remove());
    const box = s.createDiv('nd-sel');
    if (this.selected < 0 || !this.nodes[this.selected]) {
      box.createDiv({ cls: 'nd-muted', text: 'Click a node to inspect it. Double-click opens it.' });
      return;
    }
    const n = this.nodes[this.selected];
    const pal = this.colors().pal;
    const title = box.createDiv({ cls: 'nd-sel-title', text: n.label });
    title.style.setProperty('--topic', pal[n.c % pal.length]);
    const stats = box.createDiv('nd-chip-row');
    const rank = this.bcRank.indexOf(n.i) + 1;
    stats.createSpan({ cls: 'nd-pill', text: `#${rank} influence` });
    stats.createSpan({ cls: 'nd-pill', text: `${this.neighbors[n.i].size} connections` });
    stats.createSpan({ cls: 'nd-pill', text: `topic ${n.c + 1}` });
    if (this.mode === 'concepts') stats.createSpan({ cls: 'nd-pill', text: `×${this.net.freq[n.i]}` });
    const actions = box.createDiv('nd-gap-actions');
    const f = this.nodeFile(n);
    if (f) button(actions, { icon: 'file-text', text: 'Open', cls: 'mod-cta nd-small', onClick: (e) => this.plugin.openFile(f, e) });
    if (this.mode === 'concepts') button(actions, { icon: 'search', text: 'Search', cls: 'nd-small', onClick: () => this.plugin.openSearch(n.kind === 'tag' ? `tag:${n.label}` : n.label) });
    const list = box.createDiv('nd-mini-list');
    const files =
      this.mode === 'concepts'
        ? this.net.where[n.i].map((p) => this.app.vault.getAbstractFileByPath(p)).filter((x) => x instanceof TFile)
        : [...this.neighbors[n.i]].map((j) => this.net.files[j]);
    box.createDiv({ cls: 'nd-muted', text: this.mode === 'concepts' ? `Appears in ${files.length} note${files.length === 1 ? '' : 's'}:` : 'Linked notes:' });
    box.appendChild(list);
    files.slice(0, 12).forEach((file, i) => {
      const row = list.createDiv('nd-mini');
      row.style.setProperty('--i', String(i));
      row.style.setProperty('--card-accent', pal[n.c % pal.length]);
      row.createDiv({ cls: 'nd-mini-title', text: file.basename });
      this.plugin.bindFileMouse(row, file, this);
    });
  },

  async createBridge(g) {
    const wa = this.topicWords(g.a, 4);
    const wb = this.topicWords(g.b, 4);
    const notesOf = (k) => {
      const t = this.an.topics[k];
      const out = new Set();
      if (this.mode === 'notes') t.members.slice(0, 4).forEach((i) => out.add(this.net.files[i].basename));
      else
        for (const i of t.members.slice(0, 4))
          for (const p of this.net.where[i].slice(0, 2)) {
            const f = this.app.vault.getAbstractFileByPath(p);
            if (f instanceof TFile) out.add(f.basename);
          }
      return [...out].slice(0, 5);
    };
    const strip = (w) => w.replace(/^\[\[|\]\]$/g, '');
    const title = `Bridge – ${strip(wa[0])} × ${strip(wb[0])}`;
    const body = [
      '---',
      'tags: [bridge, idea]',
      `created: ${moment().format('YYYY-MM-DD HH:mm')}`,
      '---',
      `# 🌉 ${strip(wa[0])} × ${strip(wb[0])}`,
      '',
      '> [!question] Structural gap found by Neon Deck',
      `> How does **${wa.join(', ')}** relate to **${wb.join(', ')}**?`,
      '',
      `## Side A — ${wa.join(' · ')}`,
      ...notesOf(g.a).map((b) => `- [[${b}]]`),
      '',
      `## Side B — ${wb.join(' · ')}`,
      ...notesOf(g.b).map((b) => `- [[${b}]]`),
      '',
      '## Connecting ideas',
      '- ',
      '',
    ].join('\n');
    const f = await createUnique(this.app, this.plugin.bridgeFolder(), title, body);
    new Notice('🌉 Bridge note created');
    this.plugin.openFile(f, { ctrlKey: true });
  },
});
