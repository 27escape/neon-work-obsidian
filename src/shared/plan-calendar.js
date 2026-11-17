/* ---- Project plans (fork): working days, public holidays and people's time off (pure) -------------------------------
 * Planning counts working days. Which days those are comes from the Projects settings (NEON_PLAN.calendar): the
 * working week (Monday to Friday by default), a region's public holidays, worked out here without any network
 * (England and Wales, Scotland, Northern Ireland: fixed dates, Easter, first and last Mondays, and a substitute
 * weekday for one that falls on a weekend), and company closure days (dates and ranges; they also cover one-off bank
 * holidays no rule can know). People's time off comes from a shared Team holidays note (a setting) and from a
 * project note's own "Holidays" section, as a list:
 *   - [[@Kevin Mulholland]]
 *       - 2026-12-24 to 2027-01-02
 *       - every Tuesday
 * A person is matched to task owners by the same name (the people note, or the plain name), or by first name. A task
 * then takes longer when its owners are off: a day counts only when all of them work (planLeaveSpan). planCollect
 * gathers the time off with the tasks (tasks.leave). Weeks mode, which has no dates, keeps plain Monday to Friday. */

const PLAN_REGIONS = [
  ['', 'None'],
  ['england-wales', 'England and Wales'],
  ['scotland', 'Scotland'],
  ['northern-ireland', 'Northern Ireland'],
];
const PLAN_DOW_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const planDow = (ymd) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const planYmd = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
const planNextDay = (ymd, n = 1) => {
  const t = new Date(`${ymd}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

/** Easter Sunday in the Gregorian calendar (the anonymous algorithm). */
function planEaster(y) {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = h + l - 7 * m + 114;
  return planYmd(y, Math.floor(n / 31), (n % 31) + 1);
}
/** The nth Monday of a month; n = -1: the last one. */
function planMonday(y, m, n) {
  if (n > 0) {
    const first = planYmd(y, m, 1);
    return planNextDay(first, ((8 - planDow(first)) % 7) + 7 * (n - 1));
  }
  const last = planYmd(y, m + 1, 0);
  return planNextDay(last, -((planDow(last) + 6) % 7));
}

/** A region's public holidays in a year: Map date → name (pure). Weekend ones move to the next free weekday. */
function planPublicHolidays(region, y) {
  const out = new Map();
  if (!PLAN_REGIONS.some(([k]) => k && k === region)) return out;
  const scot = region === 'scotland';
  const ni = region === 'northern-ireland';
  const easter = planEaster(y);
  out.set(planNextDay(easter, -2), 'Good Friday');
  if (!scot) out.set(planNextDay(easter, 1), 'Easter Monday');
  out.set(planMonday(y, 5, 1), 'Early May bank holiday');
  out.set(planMonday(y, 5, -1), 'Spring bank holiday');
  out.set(scot ? planMonday(y, 8, 1) : planMonday(y, 8, -1), 'Summer bank holiday');
  const fixed = [[planYmd(y, 1, 1), 'New Year’s Day']];
  if (scot) fixed.push([planYmd(y, 1, 2), '2nd January']);
  if (ni) fixed.push([planYmd(y, 3, 17), 'St Patrick’s Day'], [planYmd(y, 7, 12), 'Battle of the Boyne']);
  if (scot) fixed.push([planYmd(y, 11, 30), 'St Andrew’s Day']);
  fixed.push([planYmd(y, 12, 25), 'Christmas Day'], [planYmd(y, 12, 26), 'Boxing Day']);
  const weekend = (d) => planDow(d) % 6 === 0;
  for (const [d, name] of fixed) if (!weekend(d)) out.set(d, name);
  for (const [d, name] of fixed) {
    if (!weekend(d)) continue;
    let s = d;
    while (weekend(s) || out.has(s)) s = planNextDay(s);
    out.set(s, `${name} (substitute day)`);
  }
  return out;
}

/** 0–6 (Sunday–Saturday) for a day name: "tue", "Tues", "Tuesday", "Tuesdays"; -1 if it isn't one. */
function planDayIndex(word) {
  const w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  if (w.length < 3) return -1;
  return PLAN_DOW_FULL.findIndex((f) => f.toLowerCase().startsWith(w) || w.startsWith(f.toLowerCase()));
}
/** The working week from "Mon, Tue, Wed, Thu, Fri" or "Mon-Fri": a Set of 0–6; empty or unreadable: Monday to Friday. */
function planWeekdays(text) {
  const out = new Set();
  for (const part of String(text || '').split(/[,;/]+|\band\b/i)) {
    const r = part.match(/([a-z]+)\s*(?:-|–|to)\s*([a-z]+)/i);
    if (r && planDayIndex(r[1]) >= 0 && planDayIndex(r[2]) >= 0) {
      for (let d = planDayIndex(r[1]), n = 0; n < 7; d = (d + 1) % 7, n++) {
        out.add(d);
        if (d === planDayIndex(r[2])) break;
      }
    } else for (const w of part.split(/\s+/)) if (planDayIndex(w) >= 0) out.add(planDayIndex(w));
  }
  return out.size ? out : new Set([1, 2, 3, 4, 5]);
}
/**
 * Days in a piece of text (pure): { dates: Set, weekdays: Set }. Dates are YYYY-MM-DD; a range is two dates joined by
 * "to", "until", a dash or ".." (both ends included); "every Tuesday" (or "every Mon and Fri") adds weekdays.
 */
function planParseDays(text) {
  const dates = new Set();
  const weekdays = new Set();
  const s = String(text || '').replace(/(\d{4}-\d{2}-\d{2})\s*(?:to|until|till|–|—|-|\.\.|>)\s*(\d{4}-\d{2}-\d{2})/giu, (all, a, b) => {
    for (let d = a, n = 0; d <= b && n < 400; d = planNextDay(d), n++) dates.add(d);
    return ' ';
  });
  for (const m of s.matchAll(/\d{4}-\d{2}-\d{2}/g)) dates.add(m[0]);
  for (const m of s.matchAll(/\b(?:every|nwd)\b([^\n]*)/gi)) for (const w of m[1].split(/[\s,;/&]+/)) if (planDayIndex(w) >= 0) weekdays.add(planDayIndex(w));
  return { dates, weekdays };
}

/**
 * The working calendar (pure): { work: Set of weekdays, off(ymd) → why it isn't a working day ('' when it is: a day
 * name, a holiday's name or "a closure day"), isWorkday(ymd) }. region: a PLAN_REGIONS key; weekdays and closures:
 * the settings' text.
 */
function planCalendar({ region = '', weekdays = '', closures = '' } = {}) {
  const work = planWeekdays(weekdays);
  const closed = planParseDays(closures).dates;
  const years = new Map();
  const off = (ymd) => {
    const dow = planDow(ymd);
    if (!work.has(dow)) return PLAN_DOW_FULL[dow];
    const y = +ymd.slice(0, 4);
    if (!years.has(y)) years.set(y, planPublicHolidays(region, y));
    return years.get(y).get(ymd) || (closed.has(ymd) ? 'a closure day' : '');
  };
  return { region, work, off, isWorkday: (ymd) => !off(ymd) };
}
const PLAN_PLAIN_CAL = planCalendar();
/** The calendar from the settings, else plain Monday to Friday. */
const planCal = () => (typeof NEON_PLAN !== 'undefined' && NEON_PLAN.calendar) || PLAN_PLAIN_CAL;

/** Public holidays and closure days from one date to another (inclusive) that fall in the working week: [{ date, name }]. */
function planDaysOff(from, to, cal = planCal()) {
  const out = [];
  for (let d = from, n = 0; d <= to && n < 2000; d = planNextDay(d), n++) if (cal.work.has(planDow(d)) && cal.off(d)) out.push({ date: d, name: cal.off(d) });
  return out;
}

/* ---- people's time off ---- */

/** A person at the start of a list line: { key, name, rest } (rest: dates on the same line), or null. */
function planLeavePerson(body) {
  const link = body.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*:?\s*(.*)$/);
  if (link) {
    const base = link[1].split('#')[0].split('/').pop().trim();
    return { key: base.replace(/^@/, '').toLowerCase(), name: (link[2] || base).replace(/^@/, '').trim(), rest: link[3] };
  }
  const cut = body.search(/\d{4}-\d{2}-\d{2}|\bevery\b|\bnwd\b/i);
  const name = (cut >= 0 ? body.slice(0, cut) : body).replace(/[:\s]+$/, '').replace(/^@/, '').trim();
  if (!name || cut === 0) return null;
  return { key: name.toLowerCase(), name, rest: cut >= 0 ? body.slice(cut) : '' };
}
/** People's time off from a list (pure): Map key → { name, dates: Set, weekdays: Set }. See the header. */
function planLeaveParse(text) {
  const out = new Map();
  let who = null;
  let fence = false;
  const add = (e, s) => {
    const d = planParseDays(s);
    for (const x of d.dates) e.dates.add(x);
    for (const x of d.weekdays) e.weekdays.add(x);
  };
  for (const line of String(text || '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const m = line.match(/^(\s*)[-*+]\s+(?:\[.\]\s+)?(.*)$/);
    if (!m) {
      if (/^#/.test(line)) who = null; // a heading ends a person's list
      continue;
    }
    if (!m[1].length) {
      const p = planLeavePerson(m[2].trim());
      who = null;
      if (!p) continue;
      if (!out.has(p.key)) out.set(p.key, { name: p.name, dates: new Set(), weekdays: new Set() });
      who = out.get(p.key);
      if (p.rest) add(who, p.rest);
    } else if (who) add(who, m[2]);
  }
  return out;
}
/** The text of a note's "Holidays" (or "Time off", "Leave") section, to the next heading at its level or above; '' if none. */
function planHolidaySection(text) {
  const lines = String(text || '').split('\n');
  let fence = false;
  let level = 0;
  const out = [];
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) fence = !fence;
    const h = !fence && l.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (level) {
      if (h && h[1].length <= level) break;
      out.push(l);
    } else if (h && /^(holidays|time off|leave|annual leave)$/i.test(h[2])) level = h[1].length;
  }
  return out.join('\n');
}
/** Several time-off maps as one (pure). */
function planLeaveMerge(...maps) {
  const out = new Map();
  for (const m of maps)
    for (const [k, e] of m || []) {
      if (!out.has(k)) out.set(k, { name: e.name, dates: new Set(), weekdays: new Set() });
      const o = out.get(k);
      for (const x of e.dates) o.dates.add(x);
      for (const x of e.weekdays) o.weekdays.add(x);
    }
  return out;
}
/** An owner's time off: the same name, else the same first name ("@kevin" for [[@Kevin Mulholland]]); or null. */
function planLeaveFor(leave, owner) {
  if (!leave || !leave.size || !owner) return null;
  if (leave.has(owner.key)) return leave.get(owner.key);
  const first = owner.key.split(/\s+/)[0];
  for (const [k, e] of leave) if ((!k.includes(' ') && k === first) || (!owner.key.includes(' ') && k.split(/\s+/)[0] === owner.key)) return e;
  return null;
}
const planLeaveOff = (e, ymd) => !!e && (e.dates.has(ymd) || e.weekdays.has(planDow(ymd)));

/**
 * For planSchedule's span: (task, es, days) → working days the task spans once its owners' time off is left out (a
 * day counts when all of them work). null when nobody has time off. from: the plan's first working day.
 */
function planLeaveSpan(leave, from, cal = planCal()) {
  if (!leave || !leave.size || !from) return null;
  return (t, es, days) => {
    if (!days || planClosed(t)) return days;
    const who = (t.owners || []).map((o) => planLeaveFor(leave, o)).filter(Boolean);
    if (!who.length) return days;
    let d = planWorkdays(from, es, cal);
    let worked = 0;
    let span = 0;
    while (worked < days && span < 2000) {
      if (!who.some((e) => planLeaveOff(e, d))) worked++;
      span++;
      d = planWorkdays(d, 1, cal);
    }
    return span;
  };
}
/** "24 Dec to 1 Jan; every Tuesday": a person's time off on working days from one date to another (pure). */
function planLeaveText(e, from, to, cal = planCal()) {
  if (!e) return '';
  const parts = [];
  let start = null;
  let prev = null;
  const flush = () => start && parts.push(start === prev ? planShortDate(start) : `${planShortDate(start)} to ${planShortDate(prev)}`);
  for (let d = planWorkdays(from, 0, cal), n = 0; d <= to && n < 2000; d = planWorkdays(d, 1, cal), n++) {
    if (!e.dates.has(d)) continue;
    if (start && planWorkdays(prev, 1, cal) === d) prev = d;
    else {
      flush();
      start = prev = d;
    }
  }
  flush();
  const every = [...e.weekdays].filter((w) => cal.work.has(w)).sort();
  if (every.length) parts.push(`every ${every.map((w) => PLAN_DOW_FULL[w]).join(' and ')}`);
  return parts.join('; ');
}
