/* ---- Project plans (fork): changing a task from the Planning view --------------------------------------------------
 * Pure line edits (tested) and the one place that writes them: the checkbox (board), the duration and the milestone
 * tag. Each edit finds the task's line again (by its text, else its 🆔 id), changes only that line through writeNote,
 * then updates the task in memory and redraws, so a quick second edit starts from the note as it is. Nothing is
 * written while read-only is on. The task menu (right-click on a card, row or box; click on a Gantt bar) offers them. */

const PLAN_LINE_RE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)(.)(\]\s+)(.*)$/u;
const PLAN_DURATIONS = [1, 2, 3, 5, 10]; // offered in the task menu (working days; 5 = a week)

/**
 * Edit one task's line (pure): fn(rest, box) → { rest, box } with rest the text after the checkbox. Returns
 * { text, line, raw, box }, or null when the task can't be found. The task is looked for on its line (same text or
 * same 🆔 id), else on the one line with the same text, else the same id.
 */
function planEditLine(text, t, fn) {
  const lines = text.split('\n');
  const parse = (l) => (l || '').replace(/\r$/, '').match(PLAN_LINE_RE);
  const idRe = t.id ? new RegExp(`🆔\\s*${t.id}(?![\\w-])`, 'u') : null; // ids are letters, digits, - and _
  const sameText = (l) => {
    const m = parse(l);
    return !!m && m[4] === t.raw;
  };
  const sameId = (l) => {
    const m = parse(l);
    return !!m && !!idRe && idRe.test(m[4]);
  };
  const only = (ok) => {
    const hits = lines.map((l, i) => (ok(l) ? i : -1)).filter((i) => i >= 0);
    return hits.length === 1 ? hits[0] : -1;
  };
  let n = sameText(lines[t.line]) || sameId(lines[t.line]) ? t.line : only(sameText);
  if (n < 0) n = only(sameId);
  if (n < 0) return null;
  const cr = lines[n].endsWith('\r') ? '\r' : '';
  const m = parse(lines[n]);
  const next = fn(m[4], m[2]);
  if (next.rest === m[4] && next.box === m[2]) return { text, line: n, raw: m[4], box: m[2] };
  lines[n] = m[1] + next.box + m[3] + next.rest + cr;
  return { text: lines.join('\n'), line: n, raw: next.rest, box: next.box };
}

/** The checkbox set to `box`: done adds "✅ today" if missing, reopening removes it; already there: unchanged. */
function planSetBox(text, t, box, today) {
  return planEditLine(text, t, (rest, now) => {
    if (now === box) return { rest, box };
    if (box === 'x' || box === 'X') return { rest: /✅\s*\d{4}-\d{2}-\d{2}/u.test(rest) ? rest : `${rest} ✅ ${today}`, box };
    return { rest: rest.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/gu, ''), box };
  });
}

/** Where a new field goes: before the first emoji field or tag, else at the end. */
function planFieldAt(rest) {
  const m = rest.match(/\s(?:🆔|⛔|📅|⏳|🛫|✅|➕|❌|🔁|⏫|🔼|🔽|🔺|⏬|#[\w/-])/u);
  return m ? m.index : rest.length;
}

/** The duration set to `days` working days ([duration:: Nd]); null removes it. Its place in the line is kept. */
function planSetDuration(text, t, days) {
  return planEditLine(text, t, (rest, box) => {
    const field = days == null ? '' : `[duration:: ${days}d]`;
    const re = /\s*\[duration::[^\]]*\]/iu;
    if (re.test(rest)) return { rest: rest.replace(re, field ? ` ${field}` : '').replace(/^\s+/, ''), box };
    if (!field) return { rest, box };
    const at = planFieldAt(rest);
    return { rest: `${rest.slice(0, at)} ${field}${rest.slice(at)}`, box };
  });
}

/** The #milestone tag on or off; a milestone has no length, so its duration field goes. */
function planSetMilestone(text, t, on) {
  return planEditLine(text, t, (rest, box) => {
    const re = /(^|\s)#milestone(?=\s|$)/iu;
    if (!on) return { rest: rest.replace(re, '').replace(/\s{2,}/g, ' ').trim(), box };
    if (re.test(rest)) return { rest, box };
    const plain = rest.replace(/\s*\[duration::[^\]]*\]/iu, '');
    const at = planFieldAt(plain);
    return { rest: `${plain.slice(0, at)} #milestone${plain.slice(at)}`, box };
  });
}

/** "2 days", "1 week", "Milestone", "1 day (no estimate)". */
function planDaysText(t) {
  if (t.milestone) return 'Milestone';
  const d = planDays(t);
  const s = d % 5 === 0 && d >= 5 ? `${d / 5} week${d === 5 ? '' : 's'}` : `${d} day${d === 1 ? '' : 's'}`;
  return t.days == null ? `${s} (no estimate)` : s;
}

Object.assign(PlanView.prototype, {
  /** Run an edit on a task's line; one at a time, each from the note as it is then. */
  editTask(t, edit) {
    const job = (this.editing || Promise.resolve()).then(() => this.writeEdit(t, edit));
    this.editing = job.catch(() => {});
    return job;
  },
  async writeEdit(t, edit) {
    let res = null;
    try {
      await writeNote(this.app, t.file, (text) => {
        res = edit(text);
        return res ? res.text : text;
      });
    } catch (e) {
      if (!(e && e.neonReadOnly)) {
        console.error('Planning: could not change the task', e);
        new Notice('Could not change the task. Details in the console.');
      }
      return this.refresh();
    }
    if (!res) {
      new Notice('Could not find that task in its note any more: refreshed');
      return this.refresh();
    }
    // the task as it is now, so the view is right at once and a next edit starts from here
    const now = planTask(`- [${res.box}] ${res.raw}`, { file: t.file, line: res.line, phase: t.phase });
    if (now) Object.assign(t, now);
    this.render();
  },
  moveTask(t, box) {
    return this.editTask(t, (text) => planSetBox(text, t, box, moment().format('YYYY-MM-DD')));
  },
  setDuration(t, days) {
    return this.editTask(t, (text) => planSetDuration(text, t, days));
  },
  setMilestone(t, on) {
    return this.editTask(t, (text) => planSetMilestone(text, t, on));
  },
  /** Ask for a duration: a number of days, or "2w" for weeks; empty removes the estimate. */
  askDuration(t) {
    new PromptModal(this.app, {
      title: `Duration of “${planClip(planText(t.raw), 50)}”`,
      value: t.days == null ? '' : String(t.days),
      placeholder: 'Working days, e.g. 3, or 2w for two weeks; empty: no estimate',
      cta: 'Set',
      onSubmit: (v) => {
        const m = String(v || '').trim().match(/^(\d+(?:\.\d+)?)\s*(d|days?|w|weeks?)?$/i);
        if (!String(v || '').trim()) return this.setDuration(t, null);
        if (!m) return new Notice('A number of days (3) or weeks (2w), please');
        this.setDuration(t, Math.max(0, Math.round(parseFloat(m[1]) * (/^w/i.test(m[2] || '') ? 5 : 1))));
      },
    }).open();
  },
  /** The task menu: open, move, duration, milestone. */
  taskMenu(e, t) {
    if (e.preventDefault) e.preventDefault();
    const m = new Menu();
    m.addItem((i) => i.setTitle('Open the task').setIcon('file-text').onClick(() => openFile(this.app, t.file, null, t.line)));
    if (t.external) return m.showAtMouseEvent(e);
    m.addSeparator();
    for (const [, label, box] of PLAN_COLUMNS)
      if (box !== null) m.addItem((i) => i.setTitle(`Move to ${label}`).setChecked(t.box === box || (box === 'x' && t.status === 'done')).onClick(() => this.moveTask(t, box)));
    m.addSeparator();
    for (const d of PLAN_DURATIONS)
      m.addItem((i) => i.setTitle(`Duration: ${planDaysText({ days: d })}`).setChecked(!t.milestone && t.days === d).onClick(() => this.setDuration(t, d)));
    m.addItem((i) => i.setTitle('Duration…').setIcon('timer').onClick(() => this.askDuration(t)));
    m.addItem((i) => i.setTitle('Milestone').setIcon('diamond').setChecked(!!t.milestone).onClick(() => this.setMilestone(t, !t.milestone)));
    m.showAtMouseEvent(e);
  },
});
