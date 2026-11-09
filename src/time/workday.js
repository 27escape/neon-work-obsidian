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
  /** Add a completed break without changing the independently logged work entries. */
  addBreak({ start, ms }) {
    const w = this.workOf(dayKey(start));
    if (!w) {
      new Notice('Start the workday before logging a break.');
      return false;
    }
    const end = w.end || Date.now();
    const stop = start + ms;
    const overlap = w.breaks.some(([a, b]) => start < (b == null ? end : b) && a < stop);
    if (!Number.isFinite(start) || !Number.isInteger(ms) || ms <= 0 || start < w.start || stop > end || overlap) {
      new Notice(overlap ? 'That break overlaps an existing break.' : 'Choose a break within the started workday.');
      return false;
    }
    w.breaks.push([start, stop]);
    w.breaks.sort((a, b) => a[0] - b[0]);
    this.changed(dayKey(start), true);
    new Notice(`Break logged · ${fmtMin(ms / 60000)}`);
    return true;
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
    this.changed(key, true);
  },
  /** Today's workday buttons: Start day, which becomes End day once started, plus Pause / Resume while it runs. */
  workButton(parent, iconOnly) {
    const key = moment().format('YYYY-MM-DD');
    const st = this.workState(key);
    const wrap = parent.createDiv('tm-work-btns');
    const btn = (ic, text, cta, onClick) => button(wrap, { icon: ic, text: iconOnly ? undefined : text, cls: iconOnly ? 'nd-icon-btn tm-work-btn' : 'tm-work-btn' + (cta ? ' mod-cta' : ''), title: text, onClick });
    if (st === 'running' || st === 'paused') {
      btn('square', 'End day', true, () => {
        this.workEnd(key);
        new Notice(`Workday ended · ${fmtMin(this.workMin(key))} worked`);
      });
      btn(st === 'running' ? 'pause' : 'play', st === 'running' ? 'Pause' : 'Resume', false, () => this.workToggle());
    } else btn('play', st === 'none' ? 'Start day' : 'Resume day', st === 'none', () => this.workToggle());
    return wrap;
  },
  /** End the workday at `at` (Wrap up, or the idle rule with the last activity). */
  workEnd(key, at = Date.now()) {
    const w = this.workOf(key);
    if (!w || w.end) return;
    const b = w.breaks[w.breaks.length - 1];
    if (b && b[1] == null) b[1] = Math.max(b[0], at);
    w.end = Math.max(w.start, at);
    this.changed(key, true);
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
