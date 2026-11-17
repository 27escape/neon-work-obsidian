/* ---- Project plans (fork): the task editor's text work (pure, tested) ------------------------------------------------
 * The editor (plan-editor.js) only collects a form; these functions turn it into line edits. Fields it doesn't
 * manage (priority, recurrence, ➕ created, other tags and [key:: value] fields) stay where they are; the ones it
 * manages are changed in place, removed when cleared, or added before the trailing tags. Ids: the project's
 * `plan-prefix` property, else the initials of its title, then the next free number (pla-50). */

const PLAN_DATE_SIGNS = [
  ['start', '🛫'],
  ['scheduled', '⏳'],
  ['due', '📅'],
];

/** "Pilot - Local AI" → "pla". */
function planInitials(title) {
  const words = String(title || '').split(/[^A-Za-z0-9]+/).filter(Boolean);
  return words.map((w) => w[0]).join('').toLowerCase().slice(0, 5) || 'task';
}
/** The id prefix: the plan-prefix property (letters, digits, - and _), else the title's initials. */
function planPrefix(fm, title) {
  const v = String((fm && (fm['plan-prefix'] != null ? fm['plan-prefix'] : fm.planPrefix)) || '').trim();
  const p = /\{\{/.test(v) ? '' : v.replace(/[^\w-]/g, ''); // a template's {{prefix}} not filled in yet: the initials
  return p || planInitials(title);
}
/** The next free id: prefix-(highest number used + 1). ids: every id in use. */
function planNextId(ids, prefix) {
  const used = new Set(ids);
  const re = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  let n = 0;
  for (const id of used) {
    const m = re.exec(id || '');
    if (m) n = Math.max(n, +m[1]);
  }
  n++;
  while (used.has(`${prefix}-${n}`)) n++;
  return `${prefix}-${n}`;
}

/** A line's text in parts: leading tags, the description, other [key:: value] fields in it, the rest (fields). */
function planSplit(rest) {
  const lead = (rest.match(/^(?:#[\w/-]+\s+)+/u) || [''])[0];
  const body = rest.slice(lead.length);
  const at = planFieldAt(body);
  const head = body.slice(0, at);
  const inline = (head.match(PLAN_FIELD_RE) || []).filter((f) => !/^\[(duration|owner)::/i.test(f)); // the editor sets those two
  return { lead, desc: head.replace(PLAN_FIELD_RE, '').replace(/\s+/g, ' ').trim(), inline, tail: body.slice(at) };
}

/** The [owner:: …] field set to these owners (as written: [[@Sam Taylor]] or a plain name); none removes it. */
function planOwnerRest(rest, owners) {
  if (owners === undefined) return rest;
  const field = owners && owners.length ? `[owner:: ${owners.join(', ')}]` : '';
  const re = new RegExp(`\\s*${PLAN_OWNER_RE.source}`, 'iu');
  if (re.test(rest)) return rest.replace(re, field ? ` ${field}` : '').replace(/^\s+/, '');
  if (!field) return rest;
  const dur = rest.match(/\[duration::[^\]]*\]/iu); // next to the duration, else before the fields
  const at = dur ? dur.index + dur[0].length : planFieldAt(rest);
  return `${rest.slice(0, at)} ${field}${rest.slice(at)}`;
}

/** An emoji field set to value (in place), removed (null), or added before the trailing tags. */
function planSetSign(rest, sign, value) {
  const re = new RegExp(`\\s*${sign}\\uFE0F?\\s*[\\w-]+(?:\\s*,\\s*[\\w-]+)*`, 'u');
  if (re.test(rest)) return value ? rest.replace(re, ` ${sign} ${value}`) : rest.replace(re, '');
  if (!value) return rest;
  const tags = rest.match(/(?:\s+#[\w/-]+)+\s*$/u);
  const at = tags ? tags.index : rest.length;
  return `${rest.slice(0, at)} ${sign} ${value}${rest.slice(at)}`;
}
/** The Tasks plugin's priority emoji set to a level (2, normal: none): in place of the old one, else before the tags. */
function planSetPriority(rest, level) {
  const sign = planPrioritySign(level);
  const m = rest.match(/\s*[🔺⏫🔼🔽⏬]\uFE0F?/u);
  if (m) {
    const before = rest.slice(0, m.index);
    const after = rest.slice(m.index + m[0].length).replace(/\s*[🔺⏫🔼🔽⏬]\uFE0F?/gu, '');
    return sign ? `${before} ${sign}${after}` : `${before}${after}`;
  }
  if (!sign) return rest;
  const tags = rest.match(/(?:\s+#[\w/-]+)+\s*$/u);
  const at = tags ? tags.index : rest.length;
  return `${rest.slice(0, at)} ${sign}${rest.slice(at)}`;
}
/** A tag on (added at the end) or off. */
function planSetTag(rest, tag, on) {
  const re = new RegExp(`(^|\\s)#${tag}(?=\\s|$)`, 'iu');
  if (!on) return rest.replace(re, '$1');
  return re.test(rest) ? rest : `${rest} #${tag}`;
}
/** ⛔ with ids added and removed (order kept). */
function planDepsRest(rest, add = [], remove = []) {
  const m = rest.match(/⛔️?\s*([\w-]+(?:\s*,\s*[\w-]+)*)/u);
  const now = m ? m[1].split(',').map((x) => x.trim()) : [];
  const next = [...now.filter((d) => !remove.includes(d)), ...add.filter((d) => !now.includes(d))];
  return planSetSign(rest, '⛔', next.length ? next.join(',') : null);
}

const planTidy = (r) => r.replace(/[ \t]{2,}/g, ' ').trim();

/**
 * A task's text after the editor (pure): { rest, box }. f: { desc, box, days (null: no estimate), milestone, flagged,
 * start, scheduled, due, id, deps: [ids], tag (new tasks: the task tag) }. Done adds ✅ today, cancelled ❌ today.
 */
function planApplyForm(rest, box, f, today) {
  const p = planSplit(rest);
  let r = `${p.lead}${[String(f.desc || '').replace(/\s+/g, ' ').trim(), ...p.inline].join(' ')}${p.tail}`;
  r = planDurRest(r, f.milestone ? null : f.days);
  r = planOwnerRest(r, f.owners);
  for (const [k, sign] of PLAN_DATE_SIGNS) r = planSetSign(r, sign, f[k] || null);
  r = planSetSign(r, '🆔', f.id || null);
  r = planSetSign(r, '⛔', f.deps && f.deps.length ? f.deps.join(',') : null);
  r = planSetTag(r, 'milestone', !!f.milestone);
  r = planSetTag(r, 'blocked', !!f.flagged);
  if (f.marks) for (const k of ['risk', 'issue', 'decision']) r = planSetTag(r, k, f.marks.includes(k));
  if (f.priority != null) r = planSetPriority(r, f.priority);
  if (f.tag) r = planSetTag(r, f.tag.replace(/^#/, ''), true);
  const nb = f.box != null ? f.box : box;
  if (nb === 'x' || nb === 'X') {
    r = planSetSign(r, '❌', null);
    if (!/✅\s*\d{4}-\d{2}-\d{2}/u.test(r)) r = `${r} ✅ ${today}`;
  } else if (nb === '-') {
    r = planSetSign(r, '✅', null);
    if (!/❌\s*\d{4}-\d{2}-\d{2}/u.test(r)) r = `${r} ❌ ${today}`;
  } else r = planSetSign(planSetSign(r, '✅', null), '❌', null);
  return { rest: planTidy(r), box: nb };
}

/** The note's headings: [{ line, level, text }] (front matter and code blocks skipped). */
function planHeadings(lines) {
  const out = [];
  let fence = false;
  let front = (lines[0] || '').replace(/\r$/, '') === '---';
  lines.forEach((raw, i) => {
    const l = raw.replace(/\r$/, '');
    if (front) {
      if (i > 0 && l === '---') front = false;
      return;
    }
    if (/^(```|~~~)/.test(l)) fence = !fence;
    if (fence) return;
    const m = l.match(/^(#{1,6})\s+(.*?)\s*$/);
    if (m) out.push({ line: i, level: m[1].length, text: m[2] });
  });
  return out;
}
/** Where a task goes under a phase: after the section's last list line, else after the heading; no phase: the end. */
function planInsertAt(lines, phase) {
  const hs = planHeadings(lines);
  const h = phase ? hs.find((x) => x.text === phase) : null;
  const item = (l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(l || '');
  if (!h) {
    let n = lines.length;
    while (n > 0 && !lines[n - 1].trim()) n--;
    return { at: n, gap: n > 0 && !item(lines[n - 1]) };
  }
  // the phase's own lines: up to the next heading of any level (a sub-heading is a phase of its own; going to the
  // end of the whole section put a task for "1. Scope" after the last task of "8. Close-down")
  const next = hs.find((x) => x.line > h.line);
  const end = next ? next.line : lines.length;
  let last = -1;
  for (let i = h.line + 1; i < end; i++) if (item(lines[i])) last = i;
  return last >= 0 ? { at: last + 1, gap: false } : { at: h.line + 1, gap: true };
}
/** Lines with a task line put at a phase's insert point (blank lines kept around it). */
function planPutLine(lines, line, phase, cr) {
  const { at, gap } = planInsertAt(lines, phase);
  const add = gap ? ['' + cr, line + cr] : [line + cr];
  if (gap && lines[at] !== undefined && lines[at].trim()) add.push('' + cr);
  lines.splice(at, 0, ...add);
  return at + (gap ? 1 : 0);
}

/**
 * The note's text after the editor's save (pure). others: [{ task, fn(rest, box) → { rest, box } }] (dependencies of
 * other tasks, ids given to them); main: { task (null: a new task), form, phase, after (a new task goes straight after
 * this task's line) }. Returns { text, line, raw, box,
 * missing: [tasks not found] }.
 */
function planEditFile(text, { others = [], main = null }, today) {
  let cur = text;
  const missing = [];
  for (const o of others) {
    const r = planEditLine(cur, o.task, o.fn);
    if (r) cur = r.text;
    else missing.push(o.task);
  }
  if (!main) return { text: cur, missing, line: -1 };
  const cr = text.includes('\r\n') ? '\r' : '';
  if (main.task) {
    const r = planEditLine(cur, main.task, (rest, box) => planApplyForm(rest, box, main.form, today));
    if (!r) return { text: cur, missing: [...missing, main.task], line: -1 };
    let line = r.line;
    cur = r.text;
    if (main.phase != null && main.phase !== (main.task.phase || '')) {
      const lines = cur.split('\n');
      const [l] = lines.splice(line, 1);
      line = planPutLine(lines, l.replace(/\r$/, ''), main.phase, cr);
      cur = lines.join('\n');
    }
    return { text: cur, line, raw: r.raw, box: r.box, missing };
  }
  const { rest, box } = planApplyForm('', ' ', main.form, today);
  const lines = cur.split('\n');
  const after = main.after ? planFindLine(lines, main.after) : -1;
  const anchor = main.anchor && after < 0 ? planAnchorLine(lines, main.anchor) : -1;
  let line;
  if (after >= 0 || anchor >= 0) {
    // after a task (below its sub-items, at its indent), or at the cursor (below the list item it is on)
    const from = after >= 0 ? after : anchor;
    line = planBelow(lines, from);
    const indent = planItem(lines[from]) ? lines[from].match(/^\s*/)[0] : '';
    lines.splice(line, 0, `${indent}- [${box}] ${rest}${cr}`);
  } else line = planPutLine(lines, `- [${box}] ${rest}`, main.phase || '', cr);
  return { text: lines.join('\n'), line, raw: rest, box, missing };
}
const planItem = (l) => /^\s*(?:[-*+]|\d+[.)])\s/.test(l || '');
/** Where a new line goes below line i: after a list item and its sub-items; at a blank line itself; else the next. */
function planBelow(lines, i) {
  const cur = (lines[i] || '').replace(/\r$/, '');
  if (!cur.trim()) return i;
  if (!planItem(cur)) return i + 1;
  const width = (l) => l.replace(/\r$/, '').match(/^\s*/)[0].replace(/\t/g, '    ').length;
  let j = i + 1;
  while (j < lines.length && lines[j].trim() && width(lines[j]) > width(cur)) j++;
  return j;
}
/** The line the cursor was on ({ line, text } when the editor opened), found again if the note has changed since. */
function planAnchorLine(lines, a) {
  const same = (i) => i >= 0 && i < lines.length && lines[i].replace(/\r$/, '') === a.text;
  if (same(a.line)) return a.line;
  for (let d = 1; d < lines.length; d++) {
    if (same(a.line - d)) return a.line - d;
    if (same(a.line + d)) return a.line + d;
  }
  return Math.min(Math.max(a.line, 0), lines.length);
}

/** Tasks that depend on `t`, directly or further on (so `t` can't depend on them: a loop). */
function planDownstream(tasks, t) {
  const kids = new Map();
  for (const x of tasks) for (const d of x.deps) (kids.get(d) || kids.set(d, []).get(d)).push(x);
  const out = new Set();
  const walk = (id) => {
    for (const k of kids.get(id) || []) {
      if (out.has(k)) continue;
      out.add(k);
      if (k.id) walk(k.id);
    }
  };
  if (t && t.id) walk(t.id);
  return out;
}
/** Tasks `t` depends on, directly or further back (so they can't depend on `t`). */
function planUpstream(byId, t) {
  const out = new Set();
  const walk = (x) => {
    for (const d of x.deps) {
      const y = byId.get(d);
      if (!y || out.has(y)) continue;
      out.add(y);
      walk(y);
    }
  };
  if (t) walk(t);
  return out;
}

/** The plan's dates for each task: Map task → { start, due }, as the Gantt draws them (needs the project's start). */
function planPlannedDates(tasks, base, today) {
  const out = new Map();
  if (!base) return out;
  const from = planWorkdays(base, 0);
  const sched = planSchedule(tasks, { notBefore: today ? planWorkdaysBetween(from, today) : 0 });
  for (const r of sched.rows) out.set(r.task, { start: planWorkdays(from, r.es), due: planWorkdays(from, Math.max(r.es, r.ef - 1)) });
  return out;
}

/** A template's {{prefix}} filled in with the plan's prefix, throughout the note (pure). */
function planFillPrefix(text, prefix) {
  return text.replace(/\{\{\s*prefix\s*\}\}/g, prefix);
}
const PLAN_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** "Saturday" / "Sunday" for a weekend date, else '' (pure). */
function planWeekend(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return '';
  const d = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return d === 0 || d === 6 ? PLAN_DAY_NAMES[d] : '';
}
/** Open tasks with a 🛫 ⏳ 📅 date on a weekend: [{ task, sign, date, day }]. */
function planWeekendDates(tasks) {
  const out = [];
  for (const t of tasks)
    if (!t.external && !planClosed(t))
      for (const [k, sign] of PLAN_DATE_SIGNS) {
        const day = planWeekend(t[k]);
        if (day) out.push({ task: t, sign, date: t[k], day });
      }
  return out;
}
