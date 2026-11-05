Object.assign(NeonTime.prototype, {
  /* ---- work timer (item 14): start, pause, resume, end the day ---- */
  workOf(key) {
    const d = this.days[key];
    return d && d.work && d.work.start ? d.work : null;
  },
  workState(key) {
    const w = this.workOf(key);
    if (!w) return 'none';
    if (w.end) return 'ended';
    const b = w.breaks[w.breaks.length - 1];
    return b && b[1] == null ? 'paused' : 'running';
  },
  /** Minutes worked: start to end (or now), minus breaks; null without a started day. */
  workMin(key, now = Date.now()) {
    const w = this.workOf(key);
    if (!w) return null;
    const end = w.end || now;
    const off = w.breaks.reduce((n, [a, b]) => n + Math.max(0, Math.min(b == null ? end : b, end) - a), 0);
    return Math.max(0, Math.round((end - w.start - off) / 60000));
  },
  /** Factor that makes the day's tracked entries add up to the worked time (1 without a workday). */
  workScale(key, live) {
    const worked = this.workMin(key);
    if (worked == null) return 1;
    const tracked = this.entriesOf(key, live).reduce((n, e) => n + e.ms / 60000, 0);
    return tracked > 0 ? worked / tracked : 1;
  },
  /** The Start / Pause / Resume button. */
  workToggle() {
    const key = moment().format('YYYY-MM-DD');
    const now = Date.now();
    const d = this.day(key);
    const st = this.workState(key);
    if (st === 'none') d.work = { start: now, breaks: [], end: null, last: now };
    else if (st === 'running') d.work.breaks.push([now, null]);
    else if (st === 'paused') d.work.breaks[d.work.breaks.length - 1][1] = now;
    else (d.work.breaks.push([d.work.end, now]), (d.work.end = null)); // ended: the gap becomes a break
    d.work.last = now;
    this.saveSoon();
    this.emit();
  },
  /** Start / Pause / Resume button for today. */
  workButton(parent, iconOnly) {
    const st = this.workState(moment().format('YYYY-MM-DD'));
    const [ic, text] = { none: ['play', 'Start day'], running: ['pause', 'Pause'], paused: ['play', 'Resume'], ended: ['play', 'Resume day'] }[st];
    return button(parent, { icon: ic, text: iconOnly ? undefined : text, cls: iconOnly ? 'nd-icon-btn tm-work-btn' : 'tm-work-btn' + (st === 'none' ? ' mod-cta' : ''), title: text, onClick: () => this.workToggle() });
  },
  /** End the workday at `at` (Wrap up, or the idle rule with the last activity). */
  workEnd(key, at = Date.now()) {
    const w = this.workOf(key);
    if (!w || w.end) return;
    const b = w.breaks[w.breaks.length - 1];
    if (b && b[1] == null) b[1] = Math.max(b[0], at);
    w.end = Math.max(w.start, at);
    this.saveSoon();
    this.emit();
  },
  /** Any input in Obsidian: the workday is still going. */
  workSeen() {
    const now = Date.now();
    // yesterday too: a day started before midnight keeps running
    for (const key of [moment().format('YYYY-MM-DD'), moment().subtract(1, 'day').format('YYYY-MM-DD')]) {
      const w = this.workOf(key);
      // after a long idle (sleep) the tick ends the day at the real last activity first
      if (!w || w.end || now - w.last < 30000 || now - w.last > this.settings.workIdleH * 3600000) continue;
      w.last = now;
      this.saveSoon();
    }
  },
  /** Idle rule: a running day with no input for workIdleH hours ends at the last activity. */
  workIdleCheck() {
    const limit = this.settings.workIdleH * 3600000;
    for (const key of [moment().format('YYYY-MM-DD'), moment().subtract(1, 'day').format('YYYY-MM-DD')]) {
      const w = this.workOf(key);
      if (w && !w.end && this.workState(key) === 'running' && Date.now() - w.last > limit) {
        this.workEnd(key, w.last);
        new Notice(`⏱ Workday ended at ${moment(w.last).format('HH:mm')} (no activity for ${this.settings.workIdleH} h)`);
      }
    }
  },
});
