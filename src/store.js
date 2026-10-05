/**
 * The single shared state that every client surface of this plugin reads.
 *
 * One store instance is created per materialization of the client bundle. Both
 * registered seats (the shell overlay and the General settings row) resolve it
 * through {@link sharedStore}, so they always agree and neither can outlive the
 * other's data.
 *
 * The store is deliberately a plain observable rather than a DSH store handle:
 * the preference is browser-local presentation state that must survive a page
 * reload and must not enter the session log, and `useSyncExternalStore` only
 * needs `subscribe` + `getSnapshot`.
 *
 * @module dsh-direction/store
 */

import { DirectionController, DEFAULT_PREFERENCE, forcedDirection, nextMode, normalizePreference } from './direction.js';
import { CONTENT_CONTAINERS } from './styles.js';

/** @typedef {import('./direction.js').Preference} Preference */
/** @typedef {import('./direction.js').Mode} Mode */

/**
 * Read-only projection handed to the UI. Derived fields are computed once per
 * snapshot so the render path never re-derives them.
 *
 * @typedef {object} Snapshot
 * @property {Preference} preference - the live preference.
 * @property {'ltr'|'rtl'|null} forced - the forced direction, or null under auto.
 * @property {boolean} mirrored - whether the shell itself is flipped.
 * @property {number} revision - monotonic change counter, for memo keys.
 */

/** @type {DirectionStore|null} */
let singleton = null;

/**
 * The process-wide store. Created on first use and never torn down, which is
 * what lets a hot reload of the client bundle keep the user's selection.
 *
 * @returns {DirectionStore} the shared store.
 */
export function sharedStore() {
  if (singleton === null) singleton = new DirectionStore();
  return singleton;
}

/**
 * Observable owner of the direction preference, wrapping a
 * {@link DirectionController} that does the actual DOM work.
 */
export class DirectionStore {
  constructor() {
    /** @type {DirectionController|null} */
    this.controller = null;
    /** @type {Set<() => void>} */
    this.listeners = new Set();
    /* Assigned before the first snapshot is derived: class field initializers
       run after the constructor body, so a field declared below would still be
       undefined when buildSnapshot() reads it. */
    /** @type {number} */
    this.revision = 0;
    /** @type {Snapshot} */
    this.snapshot = this.buildSnapshot(DEFAULT_PREFERENCE);
  }

  /**
   * Derive the UI projection of one preference.
   *
   * @param {Preference} preference - the preference to project.
   * @returns {Snapshot} the projection.
   */
  buildSnapshot(preference) {
    const forced = forcedDirection(preference.mode);
    return {
      preference,
      forced,
      mirrored: forced !== null && preference.scope === 'interface',
      revision: this.revision
    };
  }

  /**
   * Ensure the controller exists and is attached to one document.
   * Idempotent for the same document, so a re-activation after an HMR cycle
   * reuses the live controller instead of stacking a second observer.
   *
   * @param {object} options - binding options.
   * @param {Document} options.document - host document.
   * @param {Window} [options.window] - host window.
   * @returns {DirectionController} the attached controller.
   */
  bind({ document, window: view }) {
    if (this.controller !== null) {
      if (this.controller.document === document && !this.controller.disposed) {
        this.controller.attach();
        return this.controller;
      }
      this.controller.dispose();
      this.controller = null;
    }
    this.controller = new DirectionController({
      document,
      window: view,
      containerSelector: CONTENT_CONTAINERS,
      onChange: (preference) => this.publish(preference)
    });
    this.snapshot = this.buildSnapshot(this.controller.preference);
    this.controller.attach();
    return this.controller;
  }

  /**
   * Detach the controller and retract every DOM effect.
   * The preference itself is kept in memory so a reload restores the selection.
   *
   * @returns {void}
   */
  unbind() {
    if (this.controller === null) return;
    this.controller.dispose();
    this.controller = null;
  }

  /**
   * Apply and publish a partial preference change.
   *
   * @param {Partial<Preference>} patch - fields to change.
   * @returns {Preference} the resulting preference.
   */
  update(patch) {
    if (this.controller === null) return this.snapshot.preference;
    return this.controller.update(patch);
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
    return this.update({ mode: nextMode(this.snapshot.preference.mode) });
  }

  /**
   * Restore the defaults and clear persistence.
   *
   * @returns {Preference} the restored defaults.
   */
  reset() {
    if (this.controller === null) return this.snapshot.preference;
    return this.controller.reset();
  }

  /**
   * Publish a new preference to every subscriber.
   *
   * @param {Preference} preference - the new preference; normalized here so a
   *   caller cannot put an out-of-range value into the snapshot.
   * @returns {void}
   */
  publish(preference) {
    this.revision += 1;
    this.snapshot = this.buildSnapshot(normalizePreference(preference));
    for (const listener of this.listeners) listener();
  }

  /**
   * `useSyncExternalStore` subscribe face.
   *
   * @param {() => void} listener - change callback.
   * @returns {() => void} the unsubscriber.
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * `useSyncExternalStore` snapshot face. Referentially stable between changes.
   *
   * @returns {Snapshot} the current projection.
   */
  getSnapshot() {
    return this.snapshot;
  }
}
