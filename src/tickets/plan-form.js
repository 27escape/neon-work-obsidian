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
  const p = String((fm && (fm['plan-prefix'] != null ? fm['plan-prefix'] : fm.planPrefix)) || '').trim().replace(/[^\w-]/g, '');
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
  const inline = (head.match(/\[[\w-]+::[^\]]*\]/gu) || []).filter((f) => !/^\[duration::/i.test(f));
  return { lead, desc: head.replace(/\s*\[[\w-]+::[^\]]*\]/gu, '').trim(), inline, tail: body.slice(at) };
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
  for (const [k, sign] of PLAN_DATE_SIGNS) r = planSetSign(r, sign, f[k] || null);
  r = planSetSign(r, '🆔', f.id || null);
  r = planSetSign(r, '⛔', f.deps && f.deps.length ? f.deps.join(',') : null);
  r = planSetTag(r, 'milestone', !!f.milestone);
  r = planSetTag(r, 'blocked', !!f.flagged);
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
  const next = hs.find((x) => x.line > h.line && x.level <= h.level);
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
 * other tasks, ids given to them); main: { task (null: a new task), form, phase }. Returns { text, line, raw, box,
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
  const line = planPutLine(lines, `- [${box}] ${rest}`, main.phase || '', cr);
  return { text: lines.join('\n'), line, raw: rest, box, missing };
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
