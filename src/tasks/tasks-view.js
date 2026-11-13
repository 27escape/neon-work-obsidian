/* ---- Tasks tab (fork) -------------------------------------------------------------
 * The two task cards of the dashboard, full size in the main pane: Tasks (#task lines across your
 * notes, by date) and Todo (your Todo note). Opened from the Neon sidebar list or the command. */
const VIEW_TASKS = 'neon-tasks-view';

class TasksView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.navigation = true; // part of the main pane's Back / Forward history
    this.plugin = plugin;
    this.handles = [];
  }
  getViewType() {
    return VIEW_TASKS;
  }
  getDisplayText() {
    return 'Tasks';
  }
  getIcon() {
    return 'list-checks';
  }
  async onOpen() {
    const p = this.plugin;
    this.contentEl.empty();
    this.contentEl.addClass('nd-root', 'nd-pattern-host', 'nt-view');
    this.scroller = this.contentEl.createDiv('nt-scroll');
    const grid = this.scroller.createDiv('nt-view-grid');
    if (p.settings.showTimeline !== false) this.mountTimeline(grid); // fork: Mermaid Gantt of due-dated tasks
    const tasks = widget(grid, 'nt-view-card nt-view-tasks', 'Tasks', 'list-checks', `${p.settings.taskTag || 'Tasks'} across your notes · by date`);
    const todo = widget(grid, 'nt-view-card nt-view-todo', 'Todo', 'star', p.quickPath());
    this.handles.push(p.mountTasks(tasks), p.mountGlobal(todo));
    this.mountPattern();
    this.registerEvent(this.app.workspace.on('neon-deck:core-ready', () => this.mountPattern()));
    this.registerEvent(this.app.workspace.on('neon-deck:core-unloaded', () => this.unmountPattern()));
  }
  async onClose() {
    for (const h of this.handles) if (h && h.destroy) h.destroy();
    this.handles = [];
    this.unmountPattern();
    this.contentEl.empty();
  }
  /** The dashboard's pattern behind the cards, when Neon Deck is on. */
  mountPattern() {
    this.unmountPattern();
    const api = deckApi(this.app);
    if (api && api.mountPattern) this.pattern = api.mountPattern(this.contentEl, this.scroller, '.nd-card');
  }
  unmountPattern() {
    if (this.pattern) this.pattern.destroy();
    this.pattern = null;
  }
}
