/* ---- module views after a restart (fork) -------------------------------------------------------------------
 * Switching the plugin (or a module) off and on again left its open tabs as Obsidian's placeholder for a view
 * nobody provides: titled with the internal view type (e.g. "neon-deck-cards") and a ghost icon, and Obsidian
 * saves that title. The kernel notes the view types each module registers, marks the views they build, and once a
 * module has started rebuilds any loaded tab of one of its types still showing a placeholder. Background tabs that
 * Obsidian hasn't loaded yet (deferred) load with the registered view when opened, but until then lists such as the
 * mobile open-files list show their saved title: one saved as the placeholder ("neon-deck-tickets" for Projects) is
 * loaded now, so the tab gets its real name and icon and Obsidian saves those. Other deferred tabs stay deferred. */
Object.assign(NeonMother.prototype, {
  /** Wrap a module's registerView: remember the type, mark the views it builds. */
  hookViews(child, types) {
    const register = child.registerView;
    child.registerView = (type, make) => {
      types.add(type);
      return register.call(child, type, (leaf) => {
        const view = make(leaf);
        if (view) view.neonView = true;
        return view;
      });
    };
  },
  /** Rebuild loaded tabs of these view types that still show Obsidian's placeholder, and load deferred ones saved
   * under a placeholder title. Returns how many. */
  reviveViews(types) {
    if (!types || !types.size) return 0;
    const stale = [];
    const named = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!leaf.view || leaf.view.neonView) return;
      const state = leaf.getViewState();
      if (!state || !types.has(state.type)) return;
      if (!leaf.isDeferred) return void stale.push(leaf);
      // deferred: its saved title and icon are what the tab lists show until it is opened
      const title = (leaf.view.getDisplayText && leaf.view.getDisplayText()) || '';
      const icon = (leaf.view.getIcon && leaf.view.getIcon()) || '';
      if ((!title || title === state.type || /ghost/.test(icon)) && typeof leaf.loadIfDeferred === 'function') named.push(leaf);
    });
    const fail = (leaf) => (e) => console.error(`${appName()}: could not reopen a ${leaf.getViewState().type} tab`, e);
    for (const leaf of stale) leaf.rebuildView().catch(fail(leaf));
    for (const leaf of named) Promise.resolve(leaf.loadIfDeferred()).catch(fail(leaf));
    return stale.length + named.length;
  },
});
