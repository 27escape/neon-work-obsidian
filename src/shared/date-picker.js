/* ---- Date fields with the plugin's own calendar (fork) --------------------------------------------------------------
 * A date field and a calendar button; the calendar opens as a panel inside the form (no floating pop-up, so it works
 * the same in a modal, on a phone and on a tablet) and is drawn by the plugin, so it follows the theme everywhere,
 * Android included. Days can carry a reason (dayInfo): days off are greyed, your own time off striped, someone else's
 * time off underlined in orange, each with the reason as a tooltip on the desktop and in a line under the calendar
 * when tapped or hovered. Any day can be picked, days off included: picking one that has a reason keeps the calendar
 * open with it shown. On the desktop the field also takes a typed date; on phones and
 * tablets it is read-only and opens the calendar, rather than the system's date dialog. Weeks start on Monday.
 * datePickerMonth is pure (tested). */

const DP_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DP_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const dpYmd = (t) => t.toISOString().slice(0, 10);
const dpAdd = (ymd, n) => {
  const t = new Date(`${ymd}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return dpYmd(t);
};
/** "2026-12" → "2027-01" (n: months to move). */
function dpMonth(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return dpYmd(t).slice(0, 7);
}
/** "Mon 28 Dec 2026" (English, like the rest of Planning's labels). */
function dpLabel(ymd) {
  const t = new Date(`${ymd}T00:00:00Z`);
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getUTCDay()]} ${t.getUTCDate()} ${DP_MONTHS[t.getUTCMonth()].slice(0, 3)} ${t.getUTCFullYear()}`;
}

/**
 * One month of the calendar (pure): { ym, title, weeks: [[{ date, day, inMonth, today, selected, off, away, event,
 * mark, text }]] }, six weeks of seven days from Monday. dayInfo(date) → { off, away, event, mark, text } or null: off
 * greys a day (weekend, holiday, closure), away stripes it (your time off), event underlines it (someone else's), mark
 * outlines a date of the plan; text says why.
 */
function datePickerMonth(ym, { dayInfo = null, today = '', value = '' } = {}) {
  const first = `${ym}-01`;
  const dow = new Date(`${first}T00:00:00Z`).getUTCDay();
  const start = dpAdd(first, -((dow + 6) % 7));
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let d = 0; d < 7; d++) {
      const date = dpAdd(start, w * 7 + d);
      const info = (dayInfo && dayInfo(date)) || {};
      row.push({ date, day: +date.slice(8), inMonth: date.slice(0, 7) === ym, today: date === today, selected: date === value, off: !!info.off, away: !!info.away, event: !!info.event, mark: !!info.mark, text: info.text || '' });
    }
    weeks.push(row);
  }
  return { ym, title: `${DP_MONTHS[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`, weeks };
}

let DP_OPEN = null; // the calendar open now: { el, input }; one at a time

function dpClose(focus = false) {
  if (!DP_OPEN) return;
  const { el, input, btn } = DP_OPEN;
  DP_OPEN = null;
  el.remove();
  if (btn) btn.setAttr('aria-expanded', 'false');
  if (focus && input) input.focus();
}

/** Open the calendar for a field, in `host` (the panel goes at its end). */
function dpOpen(input, host, { label, dayInfo, onPick, btn }) {
  const again = DP_OPEN && DP_OPEN.input === input;
  dpClose();
  if (again) return; // the button again: close it
  const today = moment().format('YYYY-MM-DD');
  let ym = (/^\d{4}-\d{2}-\d{2}$/.test(input.value) ? input.value : today).slice(0, 7);
  const el = host.createDiv({ cls: 'nd-dp', attr: { role: 'dialog', 'aria-label': `Pick the ${label}` } });
  DP_OPEN = { el, input, btn };
  if (btn) btn.setAttr('aria-expanded', 'true');
  const head = el.createDiv('nd-dp-head');
  const prev = head.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': 'Previous month' } });
  setIcon(prev, 'chevron-left');
  const title = head.createDiv('nd-dp-title');
  const next = head.createEl('button', { cls: 'clickable-icon', attr: { type: 'button', 'aria-label': 'Next month' } });
  setIcon(next, 'chevron-right');
  const grid = el.createDiv({ cls: 'nd-dp-grid', attr: { role: 'grid' } });
  const info = el.createDiv({ cls: 'nd-dp-info', attr: { 'aria-live': 'polite' } });
  const foot = el.createDiv('nd-dp-foot');
  const say = (c) => info.setText(c ? `${dpLabel(c.date)}${c.text ? `: ${c.text}` : ''}` : '');
  const draw = () => {
    const m = datePickerMonth(ym, { dayInfo, today, value: input.value });
    title.setText(m.title);
    grid.empty();
    for (const d of DP_DAYS) grid.createDiv({ cls: 'nd-dp-dow', text: d });
    for (const c of m.weeks.flat()) {
      const cls = ['nd-dp-day', !c.inMonth && 'is-other', c.today && 'is-today', c.selected && 'is-selected', c.off && 'is-off', c.away && 'is-away', c.event && 'is-event', c.mark && 'is-mark'].filter(Boolean).join(' ');
      const b = grid.createEl('button', { cls, text: String(c.day), attr: { type: 'button', 'aria-label': `${dpLabel(c.date)}${c.text ? `, ${c.text}` : ''}`, 'aria-pressed': c.selected ? 'true' : 'false' } });
      if (c.text) b.setAttr('title', c.text);
      b.addEventListener('mouseenter', () => say(c));
      b.addEventListener('focus', () => say(c));
      b.addEventListener('click', () => {
        input.value = c.date;
        onPick(c.date);
        // a day off stays open, its reason shown (on a phone there is no hover to see it first)
        if (c.off || c.away || c.event) {
          ym = c.date.slice(0, 7);
          draw();
          info.setText(`Picked ${dpLabel(c.date)}: ${c.text || 'not a working day'}`);
        } else dpClose(true);
      });
    }
  };
  prev.addEventListener('click', () => ((ym = dpMonth(ym, -1)), draw()));
  next.addEventListener('click', () => ((ym = dpMonth(ym, 1)), draw()));
  const todayBtn = foot.createEl('button', { text: 'Today', attr: { type: 'button' } });
  todayBtn.addEventListener('click', () => ((ym = today.slice(0, 7)), draw()));
  const clear = foot.createEl('button', { text: 'Clear', attr: { type: 'button' } });
  clear.addEventListener('click', () => {
    input.value = '';
    onPick(null);
    dpClose(true);
  });
  const done = foot.createEl('button', { cls: 'mod-cta', text: 'Close', attr: { type: 'button' } });
  done.addEventListener('click', () => dpClose(true));
  el.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); // not the modal's Escape
    dpClose(true);
  });
  draw();
  const sel = grid.querySelector('.is-selected') || grid.querySelector('.is-today');
  if (sel && !NEON_MOBILE.on) sel.focus();
}

/**
 * A date field with a calendar button (see the header). Returns the input (its value: YYYY-MM-DD or ''). panelIn:
 * where the calendar opens (default: under the field); dayInfo: as datePickerMonth's.
 */
function dateField(parent, { value = '', label = 'date', onChange = null, dayInfo = null, panelIn = null } = {}) {
  const box = parent.createDiv('nd-date-field');
  const mobile = NEON_MOBILE.on;
  // phones and tablets: a read-only field that opens our calendar, not the system's date dialog
  const input = box.createEl('input', { attr: mobile ? { type: 'text', readonly: 'true', placeholder: 'YYYY-MM-DD' } : { type: 'date' } });
  input.value = value || '';
  const pick = (v) => onChange && onChange(v || null);
  if (!mobile) input.addEventListener('change', () => pick(input.value));
  const btn = box.createEl('button', { cls: 'clickable-icon nd-date-pick', attr: { type: 'button', 'aria-label': `Pick the ${label} from a calendar`, 'aria-expanded': 'false' } });
  setIcon(btn, 'calendar');
  const open = () => dpOpen(input, panelIn || parent, { label, dayInfo, onPick: pick, btn });
  btn.addEventListener('click', open);
  if (mobile) input.addEventListener('click', open);
  return input;
}
