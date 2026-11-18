/* ---- links to the plugin's tabs (fork) ---------------------------------------------------------------------------
 * A note can link to a tab with an Obsidian URL, as a Markdown link: [Projects](obsidian://neon-work?open=projects).
 *   open: dashboard, projects, tasks, research, time, inbox, cards, graph, or planning (with &project=<note path or
 *         name>, and &mode=gantt, board, graph or list)
 * The command "Copy a link to this tab" puts such a link for the tab in front on the clipboard, ready to paste.
 * neonLinkFor / neonLinkParams are pure (tested). */

// the tabs a link can open: name → [module id, view type]
const NEON_LINK_TABS = {
  dashboard: ['neon-deck', 'neon-deck-dashboard'],
  inbox: ['neon-deck', 'neon-inbox-view'],
  cards: ['neon-deck', 'neon-deck-cards'],
  graph: ['neon-deck', 'neon-deck-graph'],
  projects: ['neon-tickets', 'neon-deck-tickets'],
  planning: ['neon-tickets', 'neon-plan'],
  tasks: ['neon-tasks', 'neon-tasks-view'],
  research: ['neon-research', 'neon-research'],
  time: ['neon-time', 'neon-time'],
};
const NEON_LINK_MODES = ['gantt', 'board', 'graph', 'list'];

/** The link to a tab (pure): view type and, for Planning, the plan's path and mode; '' for a tab no link opens. */
function neonLinkFor(type, state = {}) {
  const name = Object.keys(NEON_LINK_TABS).find((k) => NEON_LINK_TABS[k][1] === type);
  if (!name) return '';
  let url = `obsidian://neon-work?open=${name}`;
  if (name === 'planning') {
    if (!state.path) return '';
    url += `&project=${encodeURIComponent(state.path)}`;
    if (NEON_LINK_MODES.includes(state.mode) && state.mode !== 'gantt') url += `&mode=${state.mode}`;
  }
  return url;
}
/** What a link asks for (pure): { name, tab: [module, view] | null, project, mode }. */
function neonLinkParams(params) {
  const name = String((params && (params.open || params.view)) || 'dashboard').trim().toLowerCase();
  return { name, tab: NEON_LINK_TABS[name] || null, project: String((params && params.project) || '').trim(), mode: NEON_LINK_MODES.includes(params && params.mode) ? params.mode : 'gantt' };
}

Object.assign(NeonMother.prototype, {
  /** The obsidian://neon-work handler and the "Copy a link to this tab" command. */
  registerLinks() {
    this.registerObsidianProtocolHandler('neon-work', (params) => this.openFromLink(params).catch((e) => console.error(`${appName()}: link`, e)));
    this.addCommand({
      id: 'copy-tab-link',
      name: 'Copy a link to this tab',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(ItemView);
        const url = view ? neonLinkFor(view.getViewType(), view.plan || {}) : '';
        if (!url) return false;
        if (!checking) {
          const md = `[${view.getDisplayText()}](${url})`;
          navigator.clipboard.writeText(md).then(
            () => new Notice(`Copied: ${md}`),
            () => new Notice(`Couldn't copy. The link is: ${md}`, 10000),
          );
        }
        return true;
      },
    });
  },
  /** Open the tab a link asks for. */
  async openFromLink(params) {
    const { name, tab, project, mode } = neonLinkParams(params);
    if (!tab) return void new Notice(`${appName()}: no tab called "${name}". Links can open ${Object.keys(NEON_LINK_TABS).join(', ')}.`);
    const [id, type] = tab;
    const mod = this.modules.get(id);
    if (!mod) return void new Notice(`${appName()}: ${SECTION_LABEL[id] || id} is switched off (Settings → ${appName()}).`);
    if (name !== 'planning') return void (await activateView(this.app, type, 'tab'));
    const f = project ? this.app.metadataCache.getFirstLinkpathDest(project.replace(/\.md$/i, ''), '') || this.app.vault.getAbstractFileByPath(normalizePath(project)) : null;
    const scope = f ? planScopeOf(this.app, f) || (f instanceof TFolder ? { kind: 'folder', path: f.path } : null) : null;
    if (!scope) return void new Notice(`${appName()}: no project "${project || '?'}" to plan. Use &project= with the project note's name or path.`);
    if (mod.openPlan) await mod.openPlan(scope, mode);
  },
});
