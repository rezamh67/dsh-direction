/**
 * Direction model for the dsh-direction client plugin.
 *
 * Four independent axes, applied to the DOM from one place so that a single
 * reconcile() call is the only writer:
 *
 *   mode   auto | rtl | ltr       how text blocks are directed
 *   scope  messages | interface   how far a forced mode reaches
 *   align  auto | start | justify horizontal text alignment
 *   width  number                 conversation column override in px (0 = shipped)
 *
 * `auto` is not "do nothing": the stylesheet installs a per-block bidi resolver,
 * and the controller marks the content containers with `dir="auto"`, so each
 * paragraph follows its own first strong character while code stays
 * left-to-right. `ltr` exists as an explicit escape hatch.
 *
 * @module dsh-direction/direction
 */

/** Every accepted mode, in cycle order for the overlay button. */
export const MODES = ['auto', 'rtl', 'ltr'];
/** Accepted reach for a forced mode. */
export const SCOPES = ['messages', 'interface'];
/** Accepted text alignment. */
export const ALIGNS = ['auto', 'start', 'justify'];

/** localStorage key holding the persisted selection. */
const STORAGE_KEY = 'dsh-direction.preference.v1';
/** Root data attribute driving every stylesheet rule. */
export const ROOT_ATTRIBUTE = 'data-dsh-direction';
/** Body data attribute naming the resolved text direction. */
const DIRECTION_ATTRIBUTE = 'data-dsh-direction-value';
/** Root attribute naming the active reach. */
const SCOPE_ATTRIBUTE = 'data-dsh-direction-scope';
/** Root attribute naming the active alignment. */
const ALIGN_ATTRIBUTE = 'data-dsh-direction-align';
/** The CSS variable carrying the conversation-width override. */
const WIDTH_VARIABLE = '--dsh-direction-content-width';
/** The width DSH ships, restored when the override is off. */
export const SHIPPED_CONTENT_WIDTH = 748;
/** The `dir` value written onto content containers. */
export const AUTO_DIRECTION = 'auto';

/** @typedef {'auto'|'rtl'|'ltr'} Mode */
/** @typedef {'messages'|'interface'} Scope */
/** @typedef {'auto'|'start'|'justify'} Align */
/** @typedef {{ mode: Mode, scope: Scope, align: Align, width: number }} Preference */

/** The preference applied before any stored value is read. */
export const DEFAULT_PREFERENCE = Object.freeze({
  mode: 'auto',
  scope: 'messages',
  align: 'auto',
  width: 0
});

/** Inclusive bounds for the conversation-width override, in CSS pixels. */
export const MIN_WIDTH = 0;
export const MAX_WIDTH = 1200;

/**
 * Narrow an unknown value onto a member of `allowed`.
 *
 * @param {readonly string[]} allowed - accepted values.
 * @param {unknown} value - candidate.
 * @param {string} fallback - returned when the candidate is not accepted.
 * @returns {string} the accepted value, or the fallback.
 */
function oneOf(allowed, value, fallback) {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

/**
 * Validate and complete a partial preference.
 * Never throws: unknown or out-of-range fields fall back to a default, so a
 * hand-edited localStorage entry can never wedge the client.
 *
 * @param {unknown} raw - candidate preference.
 * @returns {Preference} a complete, valid preference.
 */
export function normalizePreference(raw) {
  const source = raw !== null && typeof raw === 'object' ? /** @type {Record<string, unknown>} */ (raw) : {};
  const width = Number(source.width);
  return {
    mode: /** @type {Mode} */ (oneOf(MODES, source.mode, DEFAULT_PREFERENCE.mode)),
    scope: /** @type {Scope} */ (oneOf(SCOPES, source.scope, DEFAULT_PREFERENCE.scope)),
    align: /** @type {Align} */ (oneOf(ALIGNS, source.align, DEFAULT_PREFERENCE.align)),
    width: Number.isFinite(width)
      ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width)))
      : DEFAULT_PREFERENCE.width
  };
}

/**
 * Resolve the text direction a mode forces.
 * `auto` forces nothing and resolves to the browser default.
 *
 * @param {Mode} mode - selected mode.
 * @returns {'ltr'|'rtl'|null} the forced direction, or null under `auto`.
 */
export function forcedDirection(mode) {
  return mode === 'rtl' ? 'rtl' : mode === 'ltr' ? 'ltr' : null;
}

/**
 * The next mode in the overlay button's cycle.
 *
 * @param {Mode} mode - current mode.
 * @returns {Mode} the next mode.
 */
export function nextMode(mode) {
  const index = MODES.indexOf(mode);
  return /** @type {Mode} */ (MODES[(index + 1) % MODES.length]);
}

/**
 * Whether two preferences are equal on every axis.
 *
 * @param {Preference} left - first preference.
 * @param {Preference} right - second preference.
 * @returns {boolean} true when no axis differs.
 */
export function samePreference(left, right) {
  return left.mode === right.mode && left.scope === right.scope && left.align === right.align && left.width === right.width;
}

/**
 * Read the persisted preference from a Storage-like object.
 * Any access failure (disabled storage, opaque origin, corrupt JSON) degrades
 * to the defaults instead of throwing during plugin activation.
 *
 * @param {Storage|undefined} storage - usually `window.localStorage`.
 * @returns {Preference} the stored preference, or the defaults.
 */
export function readPreference(storage) {
  if (storage === undefined || storage === null) return { ...DEFAULT_PREFERENCE };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return { ...DEFAULT_PREFERENCE };
    return normalizePreference(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFERENCE };
  }
}

/**
 * Persist a preference, ignoring a storage that refuses writes.
 *
 * @param {Storage|undefined} storage - usually `window.localStorage`.
 * @param {Preference} preference - the preference to store.
 * @returns {boolean} whether the value reached storage.
 */
export function writePreference(storage, preference) {
  if (storage === undefined || storage === null) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalizePreference(preference)));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a window's storage without throwing.
 * Accessing `window.localStorage` itself throws in some privacy modes.
 *
 * @param {Window|undefined} view - the window to read from.
 * @returns {Storage|undefined} the store, or undefined when unavailable.
 */
export function safeStorage(view) {
  if (view === undefined || view === null) return undefined;
  try {
    return /** @type {Storage|undefined} */ (view.localStorage ?? undefined);
  } catch {
    return undefined;
  }
}

/**
 * The DOM writer for one plugin fiber.
 *
 * Every effect on the host document funnels through {@link DirectionController#reconcile},
 * which makes the feature idempotent: applying the same preference twice is a
 * no-op, and {@link DirectionController#dispose} restores the document exactly.
 */
export class DirectionController {
  /**
   * @param {object} options - construction options.
   * @param {Document} options.document - host document.
   * @param {Window} [options.window] - host window, used for storage.
   * @param {string} [options.containerSelector] - selector for elements that receive `dir="auto"`.
   * @param {(preference: Preference) => void} [options.onChange] - called after every accepted change.
   */
  constructor({ document, window: view, containerSelector = '', onChange }) {
    /** @type {Document} */
    this.document = document;
    /** @type {Window|undefined} */
    this.view = view;
    /** @type {string} */
    this.containerSelector = containerSelector;
    /** @type {((preference: Preference) => void)|undefined} */
    this.onChange = onChange;
    /** @type {Preference} */
    this.preference = readPreference(safeStorage(view));
    /** @type {Set<(preference: Preference) => void>} */
    this.listeners = new Set();
    /** @type {Set<Element>} */
    this.marked = new Set();
    /** @type {boolean} */
    this.disposed = false;
    /** @type {boolean} */
    this.attached = false;
    /** @type {MutationObserver|null} */
    this.observer = null;
    /** @type {number|null} */
    this.frame = null;
  }

  /**
   * Subscribe to preference changes.
   *
   * @param {(preference: Preference) => void} listener - called on every accepted change.
   * @returns {() => void} the unsubscriber.
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Apply the current preference to the document and start tracking.
   * Safe to call once per fiber; later calls are no-ops.
   *
   * @returns {void}
   */
  attach() {
    if (this.disposed || this.attached) return;
    this.attached = true;
    this.reconcile({ persist: false });
    this.watchContent();
  }

  /**
   * Merge a partial preference, persist it, and reconcile the DOM.
   * A patch with no effective change re-reconciles (cheap) but does not notify
   * listeners, so a component cannot loop on its own write.
   *
   * @param {Partial<Preference>} patch - fields to change.
   * @returns {Preference} the resulting preference.
   */
  update(patch) {
    const next = normalizePreference({ ...this.preference, ...patch });
    if (samePreference(next, this.preference)) return this.preference;
    this.preference = next;
    this.reconcile({ persist: true });
    return next;
  }

  /**
   * Set the direction mode.
   *
   * @param {Mode} mode - target mode.
   * @returns {Preference} the resulting preference.
   */
  setMode(mode) {
    return this.update({ mode });
  }

  /**
   * Advance to the next mode in the cycle.
   *
   * @returns {Preference} the resulting preference.
   */
  cycleMode() {
    return this.update({ mode: nextMode(this.preference.mode) });
  }

  /**
   * Set how far a forced mode reaches.
   *
   * @param {Scope} scope - target scope.
   * @returns {Preference} the resulting preference.
   */
  setScope(scope) {
    return this.update({ scope });
  }

  /**
   * Set the text alignment policy.
   *
   * @param {Align} align - target alignment.
   * @returns {Preference} the resulting preference.
   */
  setAlign(align) {
    return this.update({ align });
  }

  /**
   * Set the conversation-width override.
   *
   * @param {number} width - pixels; 0 restores the shipped width.
   * @returns {Preference} the resulting preference.
   */
  setWidth(width) {
    return this.update({ width });
  }

  /**
   * Restore the defaults, clear persistence, and reconcile.
   *
   * @returns {Preference} the restored defaults.
   */
  reset() {
    this.preference = { ...DEFAULT_PREFERENCE };
    const storage = safeStorage(this.view);
    if (storage !== undefined) {
      try {
        storage.removeItem(STORAGE_KEY);
      } catch {
        /* storage refused the removal: the in-memory default still applies */
      }
    }
    this.reconcile({ persist: false });
    return this.preference;
  }

  /**
   * Project the current preference onto the document.
   *
   * @param {object} options - reconcile options.
   * @param {boolean} options.persist - whether to write the preference to storage.
   * @returns {void}
   */
  reconcile({ persist }) {
    if (this.disposed) return;
    const { mode, scope, align, width } = this.preference;
    const root = this.document.documentElement;
    const body = this.document.body;
    if (root === null || body === null) return;
    const forced = forcedDirection(mode);
    const mirrorShell = forced !== null && scope === 'interface';

    root.setAttribute(ROOT_ATTRIBUTE, mode);
    root.setAttribute(SCOPE_ATTRIBUTE, mirrorShell ? 'interface' : 'messages');
    root.setAttribute(ALIGN_ATTRIBUTE, align);

    if (forced === null) body.removeAttribute(DIRECTION_ATTRIBUTE);
    else body.setAttribute(DIRECTION_ATTRIBUTE, forced);

    if (mirrorShell) {
      root.setAttribute('dir', /** @type {string} */ (forced));
      body.setAttribute('dir', /** @type {string} */ (forced));
    } else {
      root.removeAttribute('dir');
      body.removeAttribute('dir');
    }

    root.style.setProperty(WIDTH_VARIABLE, `${width > 0 ? width : SHIPPED_CONTENT_WIDTH}px`);

    this.markContent();
    if (persist) writePreference(safeStorage(this.view), this.preference);
    for (const listener of this.listeners) listener(this.preference);
    if (this.onChange !== undefined) this.onChange(this.preference);
  }

  /**
   * Mark every current content container with `dir="auto"`.
   * Idempotent, and guarded against a document without a body.
   *
   * @returns {number} how many elements now carry the marker.
   */
  markContent() {
    if (this.containerSelector === '') return 0;
    const found = this.document.querySelectorAll(this.containerSelector);
    for (const element of found) {
      if (element.getAttribute('dir') !== AUTO_DIRECTION) {
        element.setAttribute('dir', AUTO_DIRECTION);
        this.marked.add(element);
      }
    }
    return found.length;
  }

  /**
   * Keep `dir="auto"` on content containers that render after activation.
   *
   * Scene changes, session switches and the composer's own re-renders all mount
   * fresh containers, and the transcript streams new leaves continuously. A
   * childList observer collapsed into one animation frame is enough: every node
   * it sees is only ever given an attribute that the stylesheet already scopes,
   * so a missed batch is cosmetic, never structural.
   *
   * @returns {void}
   */
  watchContent() {
    if (this.containerSelector === '' || this.disposed) return;
    const view = this.view ?? /** @type {Window|undefined} */ (this.document.defaultView ?? undefined);
    if (view === undefined || view === null || typeof view.MutationObserver !== 'function') return;
    const root = this.document.documentElement;
    if (root === null) return;
    this.observer = new view.MutationObserver(() => {
      if (this.disposed || this.frame !== null) return;
      this.frame = view.requestAnimationFrame(() => {
        this.frame = null;
        if (!this.disposed) this.markContent();
      });
    });
    this.observer.observe(root, { childList: true, subtree: true });
  }

  /**
   * Retract every attribute and property this controller wrote, and stop the
   * observer. Runs on fiber unload so disabling the plugin leaves no trace.
   *
   * @returns {void}
   */
  dispose() {
    this.disposed = true;
    if (this.observer !== null) {
      this.observer.disconnect();
      this.observer = null;
    }
    const view = this.view ?? /** @type {Window|undefined} */ (this.document.defaultView ?? undefined);
    if (this.frame !== null && view !== undefined && view !== null) view.cancelAnimationFrame(this.frame);
    this.frame = null;
    for (const element of this.marked) element.removeAttribute('dir');
    this.marked.clear();
    if (!this.attached) {
      this.listeners.clear();
      return;
    }
    const root = this.document.documentElement;
    const body = this.document.body;
    if (root !== null) {
      for (const name of [ROOT_ATTRIBUTE, SCOPE_ATTRIBUTE, ALIGN_ATTRIBUTE]) root.removeAttribute(name);
      root.removeAttribute('dir');
      root.style.removeProperty(WIDTH_VARIABLE);
    }
    if (body !== null) {
      for (const name of [DIRECTION_ATTRIBUTE, ROOT_ATTRIBUTE, SCOPE_ATTRIBUTE, ALIGN_ATTRIBUTE]) body.removeAttribute(name);
      body.removeAttribute('dir');
    }
    this.listeners.clear();
  }
}
