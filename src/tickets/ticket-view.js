/* ---- ticket view (a normal note underneath) ----------------------------------- */
class TicketView extends FileView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.navigation = true;
  }
  getViewType() {
    return VIEW_TICKET;
  }
  getIcon() {
    return 'ticket';
  }
  getDisplayText() {
    return this.file ? this.file.basename : 'Ticket';
  }
  canAcceptExtension(ext) {
    return ext === 'md';
  }
  async onOpen() {
    this.contentEl.addClass('nd-root', 'tk-view');
    this.card = new TicketCard(this.plugin, this.contentEl, { popup: false, file: () => this.file, raw: (f) => this.plugin.openRaw(f, this.leaf), close: () => this.leaf.detach() });
    this.register(this.card.attachInputs(() => this.app.workspace.getActiveViewOfType(TicketView) === this && !document.querySelector('.modal-container')));
    this.addAction('file-down', 'Export as PDF', () => this.file && this.plugin.ticketFor(this.file) && this.plugin.exportTicket(this.plugin.ticketFor(this.file)));
    this.card.mountPattern();
    this.register(() => this.card.unmountPattern());
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.card.mountPattern()));
    this.registerEvent(this.app.workspace.on('neon-deck:core-unloaded', () => this.card.unmountPattern()));
    this.addAction('file-text', 'Edit as note', () => this.file && this.plugin.openRaw(this.file, this.leaf));
    const re = debounce(() => this.render(), 250, true);
    this.registerEvent(
      this.app.metadataCache.on('changed', (f) => {
        if (this.file && f.path === this.file.path) re();
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (f) => {
        if (this.file && f.path === this.file.path) re();
      }),
    );
    // a screenshot file added, deleted or renamed outside the ticket: redraw so thumbnails stay true
    const shotChange = (f, old) => {
      const dir = this.plugin.shotFolder() + '/';
      if (f.path.startsWith(dir) || (old && old.startsWith(dir))) re();
    };
    this.registerEvent(this.app.vault.on('delete', shotChange));
    this.registerEvent(this.app.vault.on('rename', shotChange));
    this.registerEvent(this.app.vault.on('create', shotChange));
  }
  async onLoadFile(file) {
    await this.render();
  }
  async onUnloadFile() {
    this.card.scroll.empty();
  }
  async onRename() {
    await this.render();
  }
  render() {
    return this.card.render();
  }
}

/** The ticket UI itself; used by the tab view and by the pop-up. */
class TicketCard {
  constructor(plugin, el, host) {
    this.plugin = plugin;
    this.app = plugin.app;
    this.el = el;
    this.host = host;
    el.addClass('tk-host');
    this.scroll = el.createDiv('tk-scroll');
  }
  /** The live pattern from Neon Deck behind the card (same theme, pattern and strength as the dashboard). */
  mountPattern() {
    this.unmountPattern();
    const api = deckApi(this.app);
    if (api && api.mountPattern) this.pattern = api.mountPattern(this.el, this.scroll, this.host.popup ? '.tk-tile' : '.tk-card');
  }
  unmountPattern() {
    if (this.pattern) this.pattern.destroy();
    this.pattern = null;
  }
  kickPattern() {
    if (this.pattern && this.pattern.kick) this.pattern.kick();
  }
  get file() {
    return this.host.file();
  }
  async render() {
    const file = this.file;
    if (!file || this.finishing) return;
    // editing a step in place: wait until it's saved or cancelled
    const live = this.scroll.querySelector('.tk-inline input:focus');
    if (live && live.closest('.tk-step-edit')) {
      this.pendingRender = true;
      return;
    }
    // a + box that is open stays open (same text, same focus) across the redraw
    const liveRow = live && live.closest('.tk-inline');
    const reopen = liveRow && liveRow.tkInline ? { ...liveRow.tkInline, value: live.value } : null;
    this.pendingRender = false;
    const t = this.plugin.ticketFor(file);
    const text = await this.app.vault.cachedRead(file);
    if (file !== this.file) return;
    const b = parseTicketBody(stripFrontmatter(text));
    const root = this.scroll;
    const scroll = root.scrollTop;
    root.empty();
    if (!t) {
      const e = root.createDiv('tk-empty');
      e.createDiv({ text: 'This note isn’t a ticket (no “type: ticket”).' });
      button(e, { text: 'Open as note', cls: 'mod-cta', onClick: () => this.host.raw(file) });
      return;
    }
    const card = root.createDiv(`tk-card status-${t.status} prio-${t.priority}`);
    const kick = card.createDiv('tk-kicker');
    kick.createSpan({ cls: 'tk-k', text: 'Ticket' });
    if (t.id) kick.createSpan({ cls: 'tk-id', text: t.id });
    if (t.jira) kick.createSpan({ cls: 'tk-jira', text: t.jira });
    kick.createSpan({ cls: 'tk-path', text: `· ${file.parent && file.parent.path !== '/' ? file.parent.path + '/' : ''}` });
    const corner = kick.createSpan('tk-corner tk-corner-btns');
    button(corner, {
      icon: 'file-down',
      cls: 'nd-icon-btn',
      title: 'Export as PDF (steps, screenshots, log)',
      onClick: () => {
        // close the pop-up first, or it would sit on top of the report and the PDF dialog
        if (this.host.popup) this.host.close();
        this.plugin.exportTicket(t);
      },
    });
    if (this.host.popup) {
      button(corner, { icon: 'maximize-2', cls: 'nd-icon-btn', title: 'Open as a tab', onClick: () => this.host.tab(file) });
      button(corner, { icon: 'x', cls: 'nd-icon-btn', title: 'Close (Esc)', onClick: () => this.host.close() });
    }
    card.createDiv({ cls: 'tk-title', text: t.title });

    const st = card.createDiv('nd-pills tk-status');
    for (const s of TICKET_STATUS) {
      const btn = st.createEl('button', { cls: `nd-pill-btn s-${s}` + (t.status === s ? ' is-on' : ''), text: TICKET_STATUS_LABEL[s] });
      btn.addEventListener('click', () => t.status !== s && (s === 'done' ? this.finish(t) : this.plugin.setStatus(t, s)));
    }

    const tiles = card.createDiv('tk-tiles');
    const tile = (label, value, cls, onPlus, plusTitle) => {
      const tl = tiles.createDiv(`tk-tile ${cls || ''}`);
      tl.createDiv({ cls: 'tk-tile-k', text: label });
      const v = tl.createDiv({ cls: 'tk-tile-v', text: value });
      if (onPlus) {
        const pb = button(tl, { icon: 'plus', cls: 'tk-plus', title: plusTitle, onClick: onPlus });
        pb.addClass('tk-tile-plus');
      }
      return { tl, v };
    };
    const pr = tile('Priority', t.priority[0].toUpperCase() + t.priority.slice(1), `is-prio p-${t.priority}`);
    pr.tl.addClass('is-clickable');
    pr.tl.addEventListener('click', (e) => {
      const m = new Menu();
      for (const p of [...TICKET_PRIOS].reverse()) m.addItem((i) => i.setTitle(p).setChecked(t.priority === p).onClick(() => this.plugin.setPriority(t, p)));
      m.showAtMouseEvent(e);
    });
    tile('Due', t.due ? `${t.due.format('ddd D MMM')}` : 'No date', t.bucket === 'overdue' ? 'is-late' : '', (e) => {
      const m = new Menu();
      for (const [n, label] of [[1, 'Push back 1d'], [3, 'Push back 3d'], [7, 'Push back 1w']]) m.addItem((i) => i.setTitle(label).onClick(() => this.plugin.postpone(t, n)));
      m.addItem((i) => i.setTitle('Pick a date…').onClick(() => this.plugin.promptDate(t, 'due')));
      m.showAtMouseEvent(e);
    }, 'Move the due date');
    tile('Remind', t.remind ? t.remind.format(t.remindHasTime ? 'ddd D MMM · HH:mm' : 'ddd D MMM') : 'None', '', (e) => {
      const m = new Menu();
      m.addItem((i) => i.setTitle('Tomorrow 09:00').onClick(() => this.plugin.setRemind(t, moment().add(1, 'day').format('YYYY-MM-DD') + ' 09:00')));
      if (t.due) m.addItem((i) => i.setTitle('Day before due, 09:00').onClick(() => this.plugin.setRemind(t, t.due.clone().subtract(1, 'day').format('YYYY-MM-DD') + ' 09:00')));
      m.addItem((i) => i.setTitle('Pick…').onClick(() => this.plugin.promptDate(t, 'remind')));
      if (t.remind) m.addItem((i) => i.setTitle('Clear reminder').onClick(() => this.plugin.setRemind(t, '')));
      m.showAtMouseEvent(e);
    }, 'Add a reminder');
    const total = b.time.reduce((s, x) => s + x.min, 0);
    tile('Time logged', `${total ? fmtMin(total) : '0m'} · ${CAT_LABEL[t.category] || 'Operations'}`, '', () => new TimeEntryModal(this.plugin, t, (v) => this.plugin.logTime(t, v)).open(), 'Add time by hand');
    if (t.status === 'waiting') {
      const w = card.createDiv('tk-waiting');
      icon(w, 'hourglass');
      w.createSpan({ text: `Waiting on ${t.waitingOn || '—'}` });
      if (t.followUp) w.createSpan({ cls: 'tk-wait-fu' + (t.bucket === 'followup' ? ' is-due' : ''), text: ` · follow up ${t.followUp.format('ddd D MMM')}` });
    }

    // description
    const sec = (label, extra, onPlus, plusTitle, hot) => {
      const s = card.createDiv('tk-sec');
      s.dataset.sec = label;
      const h = s.createDiv('tk-sec-head');
      h.createSpan('tk-mark');
      h.createSpan({ cls: 'tk-sec-k', text: label + (extra ? ` · ${extra}` : '') });
      if (onPlus) {
        const pb = button(h, { icon: 'plus', cls: 'tk-plus' + (hot ? ' is-hot' : ''), title: plusTitle, onClick: () => onPlus(s) });
        pb.addClass('tk-sec-plus');
      }
      return s;
    };
    const ds = sec('Description', '', (s) => this.inline(s, 'Add a line…', (v) => this.plugin.addDescription(t, v), false), 'Add a line');
    if (b.description.length) for (const l of b.description) ds.createDiv({ cls: 'tk-desc', text: l });
    else ds.createDiv({ cls: 'tk-faint', text: 'No description yet.' });

    const done = b.steps.filter((x) => x.done).length;
    const ss = sec('Next steps', b.steps.length ? `${done} of ${b.steps.length}` : '', (s) => this.inline(s, 'New step…', (v) => this.plugin.addStep(t, v), true), 'Add a step', true);
    if (done < b.steps.length) {
      const all = button(ss.querySelector('.tk-sec-head'), { icon: 'check-check', text: 'Complete all', cls: 'tk-all-done', title: 'Tick every open step', onClick: () => this.plugin.completeAllSteps(t) });
      ss.querySelector('.tk-sec-head').insertBefore(all, ss.querySelector('.tk-sec-plus'));
    }
    for (const step of b.steps) {
      const r = ss.createDiv('tk-step' + (step.done ? ' is-done' : ''));
      const box = r.createDiv('tk-box');
      r.createSpan({ cls: 'tk-step-text', text: step.text });
      if (step.done && step.at) r.createSpan({ cls: 'tk-step-at', text: step.at });
      const tick = () => {
        this.plugin.toggleStep(t, step);
        r.toggleClass('is-done', step.done); // show it now; the file write follows
        r.removeClass('is-pop');
        if (step.done) {
          void r.offsetWidth; // reflow, so a quick re-tick replays the pop
          r.addClass('is-pop');
        }
      };
      box.addEventListener('click', tick);
      const acts = r.createDiv('tk-step-acts');
      button(acts, { icon: 'pencil', cls: 'tk-step-act', title: 'Edit step', onClick: (e) => (e.stopPropagation(), this.editStepInline(r, t, step)) });
      button(acts, {
        icon: 'trash-2',
        cls: 'tk-step-act is-danger',
        title: 'Remove step',
        onClick: (e) => {
          e.stopPropagation();
          new ConfirmModal(this.app, { title: 'Remove step?', text: step.text, cta: 'Remove', onConfirm: () => this.plugin.removeStep(t, step) }).open();
        },
      });
    }
    if (!b.steps.length) ss.createDiv({ cls: 'tk-faint', text: 'No steps yet — the + adds one, Enter adds the next.' });

    // screenshots: paste (Ctrl+V), drop files on the ticket, or + to pick; saved in Core/Images/Tickets
    const shs = sec('Screenshots', b.shots.length ? String(b.shots.length) : '', () => this.pickShots(t), 'Add screenshots');
    if (b.shots.length) {
      const grid = shs.createDiv('tk-shots');
      for (const shot of b.shots) {
        const f = this.app.metadataCache.getFirstLinkpathDest(shot.link, file.path);
        const tile = grid.createDiv('tk-shot' + (f ? '' : ' is-missing'));
        if (f) {
          tile.createEl('img', { attr: { src: this.app.vault.getResourcePath(f), alt: f.basename, loading: 'lazy' } });
          tile.addEventListener('click', () => new ShotModal(this.app, f).open());
          tip(tile, f.name);
        } else tile.createDiv({ cls: 'tk-faint', text: `Missing: ${shot.link}` });
        button(tile, {
          icon: 'x',
          cls: 'nd-icon-btn tk-shot-x',
          title: 'Remove screenshot',
          onClick: (e) => {
            e.stopPropagation();
            new ConfirmModal(this.app, { title: 'Remove screenshot?', text: 'It leaves the ticket and the image goes to the system trash.', cta: 'Remove', onConfirm: () => this.plugin.removeScreenshot(t, shot) }).open();
          },
        });
      }
    } else shs.createDiv({ cls: 'tk-faint', text: 'No screenshots yet — paste one (Ctrl+V), drop image files here, or use the +.' });

    const ls = sec('Log', '', (s) => this.inline(s, 'Write a log line…', (v) => this.plugin.addLog(t, v), false, true), 'Write your own log line');
    const log = b.log.slice().sort((x, y) => (y.when ? y.when.valueOf() : 0) - (x.when ? x.when.valueOf() : 0));
    // a new top line since the last draw of this ticket slides in (not on first open)
    const key = log.length ? `${log[0].when ? log[0].when.valueOf() : ''} ${log[0].text}` : '';
    const fresh = this.logSeen && this.logSeen.path === file.path && this.logSeen.key !== key;
    this.logSeen = { path: file.path, key };
    log.forEach((e, i) => {
      const r = ls.createDiv('tk-log' + (i === 0 ? ' is-latest' + (fresh ? ' is-fresh' : '') : ''));
      r.createSpan({ cls: 'tk-log-at', text: e.when ? e.when.format(e.hasTime ? 'DD MMM HH:mm' : 'DD MMM') : '' });
      r.createSpan({ cls: 'tk-log-text', text: e.text });
    });
    if (!log.length) ls.createDiv({ cls: 'tk-faint', text: 'Nothing logged yet.' });

    if (b.time.length) {
      const ts = sec('Time', fmtMin(total), () => new TimeEntryModal(this.plugin, t, (v) => this.plugin.logTime(t, v)).open(), 'Add time');
      for (const e of b.time.slice().reverse()) {
        const r = ts.createDiv('tk-log');
        r.createSpan({ cls: 'tk-log-at', text: moment(e.date).format('DD MMM') + (e.start ? ' ' + e.start : '') });
        r.createSpan({ cls: 'tk-log-text', text: `${fmtMin(e.min)}${e.note ? ' · ' + e.note : ''}` });
      }
    }

    const foot = card.createDiv('tk-foot');
    button(foot, { text: 'Edit as note', onClick: () => this.host.raw(file) });
    const dest = this.plugin.doneDest(t, moment());
    if (t.status === 'done') button(foot, { icon: 'rotate-ccw', text: 'Reopen', cls: 'tk-reopen', onClick: () => this.plugin.setStatus(t, 'open') });
    else button(foot, { text: dest ? `Mark done → ${dest}` : 'Mark done', cls: 'mod-cta tk-done' + (done < b.steps.length ? ' is-blocked' : ''), title: done < b.steps.length ? 'Finish all steps first' : '', onClick: () => this.finish(t) });
    if (reopen) {
      const sec = root.querySelector(`.tk-sec[data-sec="${reopen.key}"]`);
      if (sec) {
        const input = this.inline(sec, reopen.placeholder, reopen.onSubmit, reopen.keep, reopen.top);
        if (input) input.value = reopen.value;
      }
    }
    root.scrollTop = scroll;
    this.kickPattern();
  }
  /** Mark done: a checkmark draws over the card while the status saves, then the ticket closes. */
  async finish(t) {
    if (this.finishing) return;
    if (await this.plugin.openSteps(t)) return this.plugin.setStatus(t, 'done'); // refuses, with a notice
    this.finishing = true; // no redraw mid-animation (the save and a done-folder move both trigger one)
    const card = this.scroll.querySelector('.tk-card');
    const mark = card.createDiv('tk-done-mark');
    setIcon(mark.createDiv('tk-done-check'), 'check');
    try {
      const [ok] = await Promise.all([this.plugin.setStatus(t, 'done'), new Promise((r) => window.setTimeout(r, 900))]);
      if (ok === false) throw new Error('a step was added meanwhile');
    } catch (e) {
      console.error('Neon Tickets: could not mark done', e);
      new Notice('Could not mark the ticket done');
      this.finishing = false;
      return this.render(); // the redraw takes the checkmark away
    }
    this.finishing = false;
    if (this.host.close) this.host.close();
    else this.render();
  }
  /** Edit a step's text in place. Saving does not write to the log. */
  editStepInline(r, t, step) {
    const row = createDiv('tk-inline tk-step-edit');
    row.createSpan('tk-box' + (step.done ? ' is-done' : ''));
    const input = row.createEl('input', { attr: { type: 'text' } });
    input.value = step.text;
    row.createSpan({ cls: 'tk-inline-hint', text: 'Enter to save · Esc to cancel' });
    r.replaceWith(row);
    let finished = false;
    const finish = async (save) => {
      if (finished) return;
      finished = true;
      const v = input.value.trim();
      if (save && v && v !== step.text) await this.plugin.editStep(t, step, v);
      row.remove();
      this.render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        finish(false);
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        finish(true);
      }
    });
    input.addEventListener('blur', () => window.setTimeout(() => document.activeElement !== input && finish(false), 150));
    input.focus();
    input.select();
  }
  /** Inline input at the end of a section. keep: Enter keeps it open for another. */
  /** + on Screenshots: pick image files. */
  pickShots(t) {
    const input = createEl('input', { attr: { type: 'file', accept: 'image/png,image/jpeg,image/gif,image/webp', multiple: '' } });
    input.addEventListener('change', () => this.plugin.addScreenshots(t, [...input.files]));
    input.click();
  }
  /** Paste and drop of images onto the ticket. isActive says whether this card is the one in front. Returns a cleanup function. */
  attachInputs(isActive) {
    const images = (list) => [...(list || [])].filter((f) => IMG_TYPES[f.type]);
    const onPaste = (e) => {
      if (!this.el.isConnected || !isActive()) return;
      const files = images(e.clipboardData && e.clipboardData.files);
      if (!files.length) return; // plain text pastes into + boxes as usual
      const t = this.file && this.plugin.ticketFor(this.file);
      if (!t) return;
      e.preventDefault();
      this.plugin.addScreenshots(t, files);
    };
    const onOver = (e) => {
      if (e.dataTransfer && [...e.dataTransfer.items].some((i) => i.kind === 'file')) {
        e.preventDefault();
        this.el.addClass('is-dropping');
      }
    };
    const onLeave = (e) => {
      if (!this.el.contains(e.relatedTarget)) this.el.removeClass('is-dropping');
    };
    const onDrop = (e) => {
      this.el.removeClass('is-dropping');
      const files = images(e.dataTransfer && e.dataTransfer.files);
      if (!files.length) return;
      const t = this.file && this.plugin.ticketFor(this.file);
      if (!t) return;
      e.preventDefault();
      this.plugin.addScreenshots(t, files);
    };
    document.addEventListener('paste', onPaste, true);
    this.el.addEventListener('dragover', onOver);
    this.el.addEventListener('dragleave', onLeave);
    this.el.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('paste', onPaste, true);
      this.el.removeEventListener('dragover', onOver);
      this.el.removeEventListener('dragleave', onLeave);
      this.el.removeEventListener('drop', onDrop);
    };
  }
  inline(sec, placeholder, onSubmit, keep, top) {
    const old = sec.querySelector('.tk-inline');
    if (old) {
      old.querySelector('input').focus();
      return;
    }
    const row = createDiv('tk-inline');
    row.tkInline = { key: sec.dataset.sec, placeholder, onSubmit, keep, top };
    if (top) sec.querySelector('.tk-sec-head').after(row);
    else sec.appendChild(row);
    row.createSpan('tk-box is-new');
    const input = row.createEl('input', { attr: { type: 'text', placeholder } });
    row.createSpan({ cls: 'tk-inline-hint', text: keep ? 'Enter to add · Esc to cancel' : 'Enter to save · Esc to cancel' });
    const close = () => {
      row.remove();
      if (this.pendingRender) this.render();
    };
    input.addEventListener('keydown', async (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        const v = input.value.trim();
        if (!v) return close();
        input.value = '';
        if (keep) {
          // show the new step straight away; the save runs in the background and the redraw replaces this draft
          if (sec.dataset.sec === 'Next steps') {
            const d = createDiv('tk-step is-pending');
            d.createDiv('tk-box');
            d.createSpan({ cls: 'tk-step-text', text: v });
            row.before(d);
          }
          onSubmit(v);
          return;
        }
        await onSubmit(v);
        close();
        // keep: the redraw that follows the save shows the new entry and keeps this box open
      }
    });
    input.addEventListener('blur', () => window.setTimeout(() => !input.value.trim() && row.isConnected && document.activeElement !== input && close(), 150));
    input.focus();
    return input;
  }
}

/** The same ticket card as an in-app pop-up, on top of whatever is open. */
class TicketPopup extends Modal {
  constructor(plugin, file) {
    super(plugin.app);
    this.plugin = plugin;
    this.file = file;
    this.refs = [];
  }
  onOpen() {
    this.containerEl.addClass('tk-popup-wrap');
    this.modalEl.addClass('nd-root', 'tk-popup');
    if (this.titleEl) this.titleEl.remove();
    this.contentEl.addClass('tk-view', 'is-popup');
    this.card = new TicketCard(this.plugin, this.contentEl, {
      popup: true,
      file: () => this.file,
      raw: (f) => {
        this.close();
        this.plugin.openRaw(f);
      },
      tab: (f) => {
        this.close();
        this.plugin.openTicket(f);
      },
      close: () => this.close(),
    });
    const re = debounce(() => this.card.render(), 250, true);
    const mc = this.app.metadataCache;
    const v = this.app.vault;
    this.refs.push([mc, mc.on('changed', (f) => f === this.file && re())]);
    this.refs.push([v, v.on('rename', (f) => f === this.file && re())]);
    this.refs.push([v, v.on('delete', (f) => f === this.file && this.close())]);
    const shotChange = (f, old) => {
      const dir = this.plugin.shotFolder() + '/';
      if (f.path.startsWith(dir) || (old && old.startsWith(dir))) re();
    };
    for (const ev of ['delete', 'rename', 'create']) this.refs.push([v, v.on(ev, shotChange)]);
    this.card.render();
    this.card.mountPattern();
    // the pop-up is in front while it's open: it takes pasted and dropped images
    this.detachInputs = this.card.attachInputs(() => true);
    this.refs.push([this.app.workspace, this.app.workspace.on('neon-deck:core-ready', () => this.card.mountPattern())]);
    this.refs.push([this.app.workspace, this.app.workspace.on('neon-deck:core-unloaded', () => this.card.unmountPattern())]);
  }
  close() {
    // Esc while typing in a + box only closes that box
    const a = document.activeElement;
    const row = a && a.closest && a.closest('.tk-popup .tk-inline');
    if (row) {
      row.remove();
      return;
    }
    super.close();
  }
  onClose() {
    for (const [src, ref] of this.refs) src.offref(ref);
    this.refs = [];
    if (this.detachInputs) this.detachInputs();
    this.card.unmountPattern();
    this.contentEl.empty();
  }
}

