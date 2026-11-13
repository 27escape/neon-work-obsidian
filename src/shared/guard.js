/* ---- read-only guard ----------------------------------------------------
 * Fork addition (27escape). While read-only is on (the default), nothing in Neon Deck can
 * create, change, move, rename or delete anything in the vault. Every module gets a guarded
 * `app` (see guardApp) instead of Obsidian's own: its vault, fileManager and vault.adapter
 * refuse writes. The only writes still allowed are Neon Deck's own settings files inside its
 * plugin folder (.obsidian/plugins/<plugin id>/...). writeNote checks the guard as well, because
 * it can edit an open note through the editor rather than the vault.
 * Obsidian's real `app` is never changed, so other plugins and Obsidian itself are unaffected. */
const NEON_GUARD = {
  readOnly: true, // set from modules.json by the kernel on start; true until then
  allowDir: '', // the plugin's own folder: settings writes there are always allowed
  lastNotice: 0,
  lastGesture: 0, // last click or key press: a blocked write right after one was asked for by you, so it gets a notice
  /** Refuse a write: a console line and an error for the caller, plus a short notice (at most one every 5 s) when you just
   * clicked or typed. Background writes (startup jobs, timers) are refused quietly. */
  block(op, path) {
    const what = `${op}${path ? ` “${path}”` : ''}`;
    console.info(`Neon Deck (read-only): blocked ${what}`);
    if (Date.now() - this.lastGesture < 2000 && Date.now() - this.lastNotice > 5000) {
      this.lastNotice = Date.now();
      new Notice(`Neon Deck is read-only, so it did not ${what}. Turn read-only off in Settings → Neon Deck modules to allow changes to your notes.`, 6000);
    }
    const e = new Error(`Neon Deck is read-only: ${what} was blocked`);
    e.neonReadOnly = true;
    return e;
  },
  /** True when a path is inside Neon Deck's own plugin folder. */
  ownPath(path) {
    const p = normalizePath(String(path || ''));
    return !!this.allowDir && (p === this.allowDir || p.startsWith(this.allowDir + '/'));
  },
};
const pathOf = (x) => (x && typeof x === 'object' ? x.path : x);
const GUARD_VAULT = {
  create: 'create', createBinary: 'create', createFolder: 'create the folder', modify: 'change', modifyBinary: 'change',
  process: 'change', append: 'change', delete: 'delete', trash: 'delete', rename: 'rename', copy: 'copy',
};
const GUARD_FILES = { renameFile: 'move', processFrontMatter: 'change the properties of', trashFile: 'delete', createNewMarkdownFile: 'create' };
const GUARD_ADAPTER = {
  write: 'write', writeBinary: 'write', append: 'write', process: 'write', mkdir: 'create the folder', remove: 'delete',
  rmdir: 'delete', trashSystem: 'delete', trashLocal: 'delete', rename: 'rename', copy: 'copy',
};
/** A stand-in for `obj` whose methods named in `ops` throw while read-only (unless `allowed(args)`); everything else passes through. */
function guardObject(obj, ops, allowed, extra) {
  return new Proxy(obj, {
    get(target, key) {
      if (extra && key in extra) return extra[key];
      const v = Reflect.get(target, key, target);
      if (typeof v !== 'function') return v;
      if (typeof key === 'string' && Object.prototype.hasOwnProperty.call(ops, key)) {
        return function guarded(...args) {
          if (NEON_GUARD.readOnly && !(allowed && allowed(key, args))) return Promise.reject(NEON_GUARD.block(ops[key], pathOf(args[0])));
          return v.apply(target, args);
        };
      }
      return v.bind(target);
    },
  });
}
/** Obsidian's app with a write-guarded vault, fileManager and adapter: what every Neon module sees. */
function guardApp(app) {
  // the plugin's own settings files may still be written; a rename or copy must stay inside that folder too
  const own = (key, args) => NEON_GUARD.ownPath(args[0]) && (!/^(rename|copy)$/.test(key) || NEON_GUARD.ownPath(args[1]));
  const adapter = guardObject(app.vault.adapter, GUARD_ADAPTER, own);
  const vault = guardObject(app.vault, GUARD_VAULT, null, { adapter });
  const fileManager = guardObject(app.fileManager, GUARD_FILES, null);
  return new Proxy(app, {
    get(target, key) {
      if (key === 'vault') return vault;
      if (key === 'fileManager') return fileManager;
      return Reflect.get(target, key, target);
    },
  });
}
