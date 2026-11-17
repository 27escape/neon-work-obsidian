/* ---- module views after a restart (fork) -------------------------------------------------------------------
 * Switching the plugin (or a module) off and on again left its open tabs as Obsidian's placeholder for a view
 * nobody provides: titled with the internal view type (e.g. "neon-deck-cards") and a ghost icon, and Obsidian
 * saves that title. The kernel notes the view types each module registers, marks the views they build, and once a
 * module has started rebuilds any loaded tab of one of its types still showing a placeholder. Background tabs that
 * Obsidian hasn't loaded yet (deferred) are left alone: they load with the registered view when opened. */
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
  /** Rebuild loaded tabs of these view types that still show Obsidian's placeholder. Returns how many. */
  reviveViews(types) {
    if (!types || !types.size) return 0;
    const stale = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.isDeferred || !leaf.view || leaf.view.neonView) return;
      const state = leaf.getViewState();
      if (state && types.has(state.type)) stale.push(leaf);
    });
    for (const leaf of stale) leaf.rebuildView().catch((e) => console.error(`${appName()}: could not reopen a ${leaf.getViewState().type} tab`, e));
    return stale.length;
  },
});
