/* ---- Project plans (fork): the report's People table and Project details -------------------------------------------
 * People: everyone named as a task owner ([owner:: …]) with their open and done tasks, days of open work and phases.
 * Project details: the project note itself, as a snapshot, from the top to the end of the section holding the plan's
 * last task, so research and notes kept below the plan are left out. Its headings move down one level, under the
 * report's "Project details"; the front matter, refine callouts and %% comments %% go; links to the note's own headings
 * point at the note; checkbox lines keep their text, owners and 📅 / ✅ dates but lose the plan's working fields (🆔, ⛔,
 * [duration:: …], 🛫 …) and the task tags, and their boxes become ☐ / ☑ so the copy never counts as tasks twice in
 * Tasks or Dataview queries. Both pure (tested). */

/** [{ name, open, done, days, phases }] for each task owner, in the order they first appear. */
function planReportPeople(tasks) {
  const by = new Map();
  for (const t of tasks) {
    if (t.external) continue;
    for (const o of t.owners || []) {
      if (!by.has(o.key)) by.set(o.key, { name: o.name, open: 0, done: 0, days: 0, phases: [] });
      const p = by.get(o.key);
      if (planClosed(t)) p.done++;
      else (p.open++, (p.days += planDays(t)));
      const ph = t.phase || 'Tasks';
      if (!p.phases.includes(ph)) p.phases.push(ph);
    }
  }
  return [...by.values()];
}

// checkbox → a symbol that no task query reads as a task
const PLAN_REPORT_BOX = { ' ': '☐', x: '☑', X: '☑', '-': '☒', '/': '◐', '?': '❓', '!': '❗' };

/** One checkbox line for readers (see the header); other lines unchanged. */
function planReportLine(line, taskTags) {
  const m = line.match(/^(\s*(?:[-*+]|\d+[.)])\s+)(?:\[(.)\]|\((.)\))\s+(.*)$/u);
  if (!m) return line;
  const box = m[2] !== undefined ? m[2] : m[3];
  const owners = planOwners(m[4]).map((o) => o.name);
  let text = m[4]
    .replace(/🆔\s*[\w-]+/gu, '')
    .replace(/⛔️?\s*[\w-]+(?:\s*,\s*[\w-]+)*/gu, '')
    .replace(PLAN_FIELD_RE, '')
    .replace(/(?:⏳|🛫|➕|❌)\s*\d{4}-\d{2}-\d{2}/gu, '')
    .replace(/(📅|✅)\s*(\d{4}-\d{2}-\d{2})/gu, (all, sign, d) => `${sign} ${planShortDate(d)}`);
  for (const tag of String(taskTags || '').split(',').map((x) => x.trim().replace(/^#?/, '#')).filter((x) => x.length > 1))
    text = text.replace(new RegExp(`(^|\\s)${tag.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}(?=$|\\s)`, 'giu'), '$1');
  text = text.replace(/\s+/g, ' ').trim();
  return `${m[1]}${PLAN_REPORT_BOX[box] || '☐'} ${text}${owners.length ? ` (${owners.join(', ')})` : ''}`;
}

/**
 * The note's text for the report (see the header). text: the note as saved; note: its name (for links to its own
 * headings); lastLine: the line of the plan's last task in it (null: the whole note); taskTags: "#task, #todo".
 */
function planReportDetails(text, { note, lastLine = null, taskTags = '' } = {}) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  let from = 0;
  if (lines[0] === '---') {
    const e = lines.indexOf('---', 1);
    if (e > 0) from = e + 1;
  }
  // where each line is a heading (outside code blocks), and its level
  const level = [];
  let fence = null;
  for (const l of lines) {
    const f = l.match(/^\s*(```+|~~~+)/);
    if (f) fence = fence ? (f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence) : f[1];
    const h = !fence && !f && l.match(/^(#{1,6})\s/);
    level.push(h ? h[1].length : 0);
  }
  let to = lines.length;
  if (lastLine != null && lastLine >= from && lastLine < lines.length) {
    let top = 7;
    for (let k = lastLine; k >= from; k--)
      if (level[k]) {
        top = level[k];
        break;
      }
    for (let k = lastLine + 1; k < lines.length; k++)
      if (level[k] && level[k] <= top) {
        to = k;
        break;
      }
  }
  const out = [];
  let callout = false;
  let comment = false;
  fence = null;
  for (let k = from; k < to; k++) {
    let l = lines[k];
    const f = l.match(/^\s*(```+|~~~+)/);
    if (f) fence = fence ? (f[1][0] === fence[0] && f[1].length >= fence.length ? null : fence) : f[1];
    if (fence || f) {
      out.push(l);
      continue;
    }
    // %% comments %%, also across lines
    if (comment) {
      const e = l.indexOf('%%');
      if (e < 0) continue;
      comment = false;
      l = l.slice(e + 2);
    }
    l = l.replace(/%%[\s\S]*?%%/g, '');
    const s = l.indexOf('%%');
    if (s >= 0) ((comment = true), (l = l.slice(0, s)));
    // the refine callout (instructions for Claude), with its lines
    if (/^>\s*\[!refine\]/i.test(l)) {
      callout = true;
      continue;
    }
    if (callout && /^>/.test(l)) continue;
    callout = false;
    if (level[k]) l = l.replace(/^(#{1,6})/, (h) => (h.length < 6 ? `${h}#` : h));
    l = l.replace(/(!?)\[\[#([^\]]*)\]\]/g, (all, bang, rest) => `${bang}[[${note}#${rest}]]`);
    out.push(planReportLine(l, taskTags));
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
