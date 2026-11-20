/* ---- Project plans (fork): the project's properties a Planning report keeps --------------------------------------
 * A report's front matter is its own (title, created, tags: plan-report, project: [[note]]), plus:
 * - the group (customer, or Area in a PARA vault): the project note's first group property as written, else the group
 *   worked out from its folder, under the first group property name (Settings → Projects → Group property), written
 *   like the vault's own values (customer: e2i). So a report in the shared reports folder still belongs to its customer.
 * - the properties listed in "Copy into reports" (planReportProps, default cssclasses), as they are.
 * Never copied, even when listed: tags and aliases (a report must not count as a project, or take the note's links),
 * the project's status and dates (a report is a snapshot; its summary already gives them), the report's own keys,
 * and working properties (claude, plan-scheduled). planReportProps is pure (tested). */

const PLAN_REPORT_NEVER = ['tags', 'tag', 'aliases', 'alias', 'title', 'created', 'modified', 'project', 'status', 'started', 'due', 'completed', 'cancelled', 'claude', 'plan-scheduled', 'position'];

/** A YAML scalar: plain when that is safe, else double-quoted. */
function planYamlScalar(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  return /^[A-Za-z0-9_][\w .\-\/]*$/.test(s) && !/\s$/.test(s) && !/^(true|false|yes|no|on|off|null|~)$/i.test(s) ? s : JSON.stringify(s);
}
/** One property as YAML lines (a list as "- item" lines); [] for an empty or nested value. */
function planYamlProp(key, v) {
  if (v == null || v === '') return [];
  if (Array.isArray(v)) {
    const items = v.filter((x) => x != null && x !== '' && typeof x !== 'object');
    return items.length ? [`${key}:`, ...items.map((x) => `  - ${planYamlScalar(x)}`)] : [];
  }
  return typeof v === 'object' ? [] : [`${key}: ${planYamlScalar(v)}`];
}
/** The comma list of "Copy into reports" as property names. */
const planReportCopyList = (text) => String(text == null ? '' : text).split(',').map((x) => x.trim()).filter(Boolean);
/**
 * The extra front-matter lines of a report (pure). o: { fm (the project note's properties), groupProps (names, in
 * order), groupKey (the group from the folder, or ''), copy (the "Copy into reports" text) }.
 */
function planReportProps(o) {
  const fm = o.fm || {};
  const props = (o.groupProps || []).filter(Boolean);
  const never = new Set(PLAN_REPORT_NEVER);
  const out = [];
  const done = new Set();
  const has = (k) => fm[k] != null && fm[k] !== '' && !(Array.isArray(fm[k]) && !fm[k].length);
  const asWritten = props.find(has);
  if (asWritten && !never.has(asWritten.toLowerCase())) out.push(...planYamlProp(asWritten, fm[asWritten]));
  else if (props.length && o.groupKey && !never.has(props[0].toLowerCase())) out.push(...planYamlProp(props[0], o.groupKey));
  props.forEach((k) => done.add(k.toLowerCase()));
  for (const k of planReportCopyList(o.copy)) {
    const lk = k.toLowerCase();
    if (never.has(lk) || done.has(lk)) continue;
    done.add(lk);
    const key = Object.keys(fm).find((x) => x.toLowerCase() === lk);
    if (key) out.push(...planYamlProp(key, fm[key]));
  }
  return out;
}

Object.assign(PlanView.prototype, {
  /** This plan's extra report properties, from its project note and settings. */
  reportProps() {
    const f = this.scopeFile();
    const fm = (f && (this.app.metadataCache.getFileCache(f) || {}).frontmatter) || {};
    let key = this.plan && this.plan.kind === 'folder' ? pathCustomer(this.plan.path, true) : f ? pathCustomer(f.path) : null;
    if (!key && f && NEON_CATS.customers) key = fileCategory(this.app, f);
    if (!NEON_CATS.customers || key === 'untracked') key = null;
    return planReportProps({ fm, groupProps: groupProps(), groupKey: key || '', copy: this.plugin.settings.planReportProps });
  },
});
