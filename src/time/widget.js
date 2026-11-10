Object.assign(NeonTime.prototype, {
  /** SVG donut: categories against the day target, overtime as an accent slice. */
  /** intro: segments draw in one after another and the total counts up (first paint only). */
  donut(parent, sum, size, intro = false) {
    const wrap = parent.createDiv('tm-donut' + (intro ? ' is-intro' : ''));
    wrap.style.setProperty('--size', `${size}px`);
    const svg = wrap.createSvg('svg', { attr: { viewBox: '0 0 120 120', width: String(size), height: String(size) } });
    const R = 50;
    const C = 2 * Math.PI * R;
    svg.createSvg('circle', { cls: 'tm-donut-track', attr: { cx: '60', cy: '60', r: String(R) } });
    // breaks always get room: once the day is full the ring stretches to fit them (issue 52)
    const base = Math.max(sum.target || sum.total, sum.total + (sum.breaks || 0)) || 1;
    const within = Math.min(sum.total, sum.target || sum.total);
    const scale = sum.total ? within / sum.total : 0;
    const slices = TIME_CATS.filter((k) => sum.by[k]).map((k) => [catColor(k), sum.by[k] * scale]);
    if (sum.untracked) slices.push(['var(--text-faint)', sum.untracked * scale]);
    if (sum.over && sum.target) slices.push(['var(--nd-accent)', sum.over, true]);
    // breaks follow the worked time on the ring; they never count as worked
    if (sum.breaks) slices.push(['var(--tm-break)', sum.breaks, false, true]);
    const gap = slices.length > 1 ? 1.2 : 0;
    let off = 0;
    let i = 0;
    for (const [color, v, isOver, isBreak] of slices) {
      const len = (v / base) * C;
      if (len > gap) {
        // createSvg takes one class per string (a space throws), so add is-over separately
        const c = svg.createSvg('circle', { cls: 'tm-donut-seg', attr: { cx: '60', cy: '60', r: String(R) } });
        if (isOver) c.classList.add('is-over');
        if (isBreak) c.classList.add('is-break');
        c.style.stroke = color;
        c.style.setProperty('--i', String(i++));
        c.setAttribute('stroke-dasharray', `${len - gap} ${C - len + gap}`);
        c.setAttribute('stroke-dashoffset', String(-off));
      }
      off += len;
    }
    const mid = wrap.createDiv('tm-donut-mid');
    const v = mid.createDiv({ cls: 'tm-donut-v' });
    if (intro) countUp(v, 0, sum.total, (x) => fmtMin(Math.round(x)), 900);
    else v.setText(fmtMin(sum.total));
    // small rings have no room for the word "over"; the accent colour says it
    const overText = `+${fmtMin(sum.over)}${size >= 140 ? ' over' : ''}`;
    const l = mid.createDiv({ cls: 'tm-donut-l', text: !sum.target ? 'weekend' : sum.over ? overText : `of ${fmtMin(sum.target)}` });
    if (sum.target && sum.over) l.addClass('is-over');
    return wrap;
  },
  legend(el, sum) {
    const w = sum.work !== 'none' && this.workOf(sum.key);
    if (w) {
      const text = { running: `Working since ${moment(w.start).format('HH:mm')}`, paused: 'On a break', ended: `Day ended ${moment(w.end).format('HH:mm')}` }[sum.work];
      el.createDiv({ cls: `tm-work is-${sum.work}`, text: `${text} · timer ${fmtMin(this.workMin(sum.key))}` });
    }
    for (const k of TIME_CATS) {
      if (!sum.by[k] && k === 'other') continue;
      const r = el.createDiv('tm-leg' + (sum.by[k] ? '' : ' is-zero'));
      r.style.setProperty('--cat', catColor(k));
      r.createSpan('tm-leg-dot');
      r.createSpan({ cls: 'tm-leg-k', text: CAT_LABEL[k] });
      r.createSpan({ cls: 'tm-leg-v', text: sum.by[k] ? fmtMin(sum.by[k]) : '—' });
    }
    for (const [n, label, color] of [[sum.untracked, 'Untracked', 'var(--text-faint)'], [sum.breaks, 'Breaks', 'var(--tm-break)']]) {
      if (!n) continue;
      const r = el.createDiv('tm-leg');
      r.style.setProperty('--cat', color);
      r.createSpan('tm-leg-dot');
      r.createSpan({ cls: 'tm-leg-k', text: label });
      r.createSpan({ cls: 'tm-leg-v', text: fmtMin(n) });
    }
    if (sum.over && sum.target) {
      const r = el.createDiv('tm-leg is-over');
      r.style.setProperty('--cat', 'var(--nd-accent)');
      r.createSpan('tm-leg-dot');
      r.createSpan({ cls: 'tm-leg-k', text: 'Overtime' });
      r.createSpan({ cls: 'tm-leg-v', text: fmtMin(sum.over) });
    }
  },
  mountWidget(card) {
    const p = this;
    button(card.actions, { icon: 'plus', cls: 'nd-icon-btn', title: 'Add time by hand', onClick: () => p.newEntry({}) });
    button(card.actions, { icon: 'maximize-2', cls: 'nd-icon-btn', title: 'Open the Time tab', onClick: () => p.openTab() });
    const body = card.body;
    body.addClass('tm-widget');
    // motion: everything rises in on first paint; after that only rows that weren't there before slide in
    let shown = false;
    let seen = new Set();
    const rowKey = (e) => e.id || `live:${e.pendingPath || e.path}:${e.start}`;
    let workBtn = null;
    const render = () => {
      if (!body.isConnected) return;
      body.empty();
      const key = moment().format('YYYY-MM-DD');
      if (workBtn) workBtn.remove();
      workBtn = p.workButton(card.actions, true);
      card.actions.prepend(workBtn);
      const sum = p.summary(key, true);
      const top = body.createDiv('tm-w-top');
      const intro = !shown;
      const d = p.donut(top, sum, 112, intro);
      d.addClass('is-clickable');
      tip(d, 'Open the Time tab');
      d.addEventListener('click', () => p.openTab());
      p.legend(top.createDiv('tm-legend'), sum);
      const sub = card.w.querySelector('.nd-card-sub');
      if (sub) sub.setText(p.widgetSub()); // follows the Workday setting
      card.badge.setText(p.session ? '●' : '');
      card.badge.toggleClass('is-live', !!p.session);
      const recent = p.entriesOf(key, true).slice(-4).reverse();
      const list = body.createDiv('tm-w-list');
      if (!recent.length) emptyState(list, p.settings.tracking ? 'Time counts while you work in a note.' : 'Automatic tracking is paused.');
      recent.forEach((e, idx) => {
        const k = rowKey(e);
        const r = list.createDiv('tm-w-row' + (e.live ? ' is-live' : '') + (intro ? ' is-intro' : seen.has(k) ? '' : ' is-new'));
        r.style.setProperty('--i', String(idx));
        r.style.setProperty('--cat', catColor(e.cat));
        r.createSpan({ cls: 'tm-w-at', text: moment(e.start).format('HH:mm') });
        r.createSpan({ cls: 'tm-w-note', text: e.note || (e.path ? e.path.split('/').pop().replace(/\.md$/, '') : CAT_LABEL[e.cat]) });
        r.createSpan({ cls: 'tm-w-min', text: fmtMin(entryMin(e)) });
        if (!e.live) r.addEventListener('click', () => new EntryModal(p, e, false).open());
        {
          button(r, {
            icon: 'trash-2',
            cls: 'nd-icon-btn tm-w-del',
            title: e.live && !e.savedId ? 'Discard live time' : 'Delete entry',
            onClick: (ev) => {
              ev.stopPropagation();
              p.deleteEntry(e);
            },
          });
        }
      });
      seen = new Set(recent.map(rowKey));
      shown = true;
      const day = p.days[key];
      if (sum.target && sum.total >= sum.target - p.settings.wrapLead) {
        const foot = body.createDiv('tm-w-foot');
        if (day && day.wrapped) foot.createSpan({ cls: 'tm-wrapped', text: '✓ Wrapped up' });
        button(foot, { icon: 'sunset', text: day && day.wrapped ? 'Update wrap up' : 'Wrap up', cls: day && day.wrapped ? '' : 'mod-cta', onClick: () => new WrapUpModal(p).open() });
      }
    };
    const soon = debounce(render, 300, true);
    const off = p.onChange((now) => (now ? render() : soon()));
    const iv = window.setInterval(render, 60 * 1000);
    render();
    return {
      destroy() {
        off();
        window.clearInterval(iv);
      },
    };
  },
});
