/**
 * Client half of dsh-direction.
 *
 * Materialized by the DSH client module table (`window.__ModuleLoader__.load` →
 * factory → `apply(ctx)`). Two seats are registered, both through
 * `ctx.slots.inject` so that registration is transactional and unloading the
 * fiber retracts every contribution:
 *
 *   shell.overlay          the floating mode toggle
 *   settings.general.item  the General preferences row
 *
 * Both surfaces read one shared {@link sharedStore}; the store owns the only
 * `DirectionController`, which is the only writer to the host document.
 *
 * React arrives through the bundle's `require` binding (declared in
 * `dsh.client.external`). It is resolved LAZILY and in a guarded block: a
 * missing `react` row must not throw while the module table is materializing,
 * because that would take down every consumer of this bundle instead of only
 * this plugin.
 *
 * @module dsh-direction/client
 */

import { CONTENT_CONTAINERS, installStylesheet } from './styles.js';
import { createOverlayButton } from './overlay-button.js';
import { createSettingsRow } from './settings-row.js';
import { resolveLocale, translator } from './i18n.js';
import { sharedStore } from './store.js';

/** Author-visible plugin name, used by fiber diagnostics. */
export const name = 'direction';

/** Services this client plugin requires; Cordis holds the fiber until they exist. */
export const inject = ['slots'];

/**
 * The module table hands every factory a synchronous `require`. The generated
 * bundle's outer registration wrapper calls {@link setRequireBinding} once, so
 * the ESM source stays plain Node-runnable and testable.
 */
let requireBinding = null;

/**
 * Record the module-table require binding supplied by the generated wrapper.
 *
 * @param {unknown} require - the module-table require binding.
 * @returns {void}
 */
export function setRequireBinding(require) {
  requireBinding = require;
}

/**
 * Resolve one module off the bundle's require binding.
 * Failure is recorded once and reported as `undefined` so callers can decide.
 *
 * @param {string} specifier - module specifier.
 * @returns {unknown} the module exports, or undefined.
 */
function external(specifier) {
  if (requireBinding === null) return undefined;
  try {
    return /** @type {(spec: string) => unknown} */ (requireBinding)(specifier);
  } catch (error) {
    console.warn(`[dsh-direction] could not resolve external module "${specifier}"`, error);
    return undefined;
  }
}

/**
 * Resolve the locale tag the host reports, tolerating the shapes the locale
 * service may expose. Never throws: copy falls back to English.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the client root context.
 * @returns {string} a BCP-47-ish tag.
 */
function readLocaleTag(ctx) {
  try {
    const locale = ctx.get('locale');
    if (locale !== null && locale !== undefined) {
      if (typeof locale.getLocale === 'function') {
        const snapshot = locale.getLocale();
        if (typeof snapshot === 'string') return snapshot;
        if (snapshot !== null && typeof snapshot === 'object' && typeof snapshot.locale === 'string') {
          return snapshot.locale;
        }
      }
      if (typeof locale.locale === 'string') return locale.locale;
      if (typeof locale.current === 'string') return locale.current;
    }
  } catch {
    /* a locale face that throws while booting must not take the plugin down */
  }
  return typeof navigator === 'object' && navigator !== null && typeof navigator.language === 'string'
    ? navigator.language
    : 'en';
}

/**
 * Client plugin body.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the client root context.
 * @returns {void}
 */
export function apply(ctx) {
  const document = /** @type {Document|undefined} */ (globalThis.document);
  if (document === undefined || document === null) {
    throw new Error('dsh-direction: no document to direct — the client plugin loaded outside a browser');
  }
  const view = /** @type {Window|undefined} */ (globalThis.window);

  const React = external('react') ?? /** @type {any} */ (ctx.get('react'));
  if (React === undefined || React === null || typeof React.createElement !== 'function') {
    throw new Error(
      'dsh-direction: React is unavailable. Add "react" to dsh.client.external in package.json and reinstall the plugin.'
    );
  }

  ctx.effect(() => installStylesheet(document, 'dsh-direction/styles.css'), 'dsh-direction: stylesheet');

  const store = sharedStore();
  store.bind({ document, window: view });
  ctx.effect(
    () => () => {
      store.unbind();
    },
    'dsh-direction: detach the direction controller'
  );

  const t = translator(resolveLocale(readLocaleTag(ctx)));

  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      { name: 'shell.overlay', id: 'dsh-direction-toggle', order: 60, label: t('overlay.label') },
      createOverlayButton({ React, store, t, document })
    )
  );

  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register(
      { name: 'settings.general.item', id: 'dsh-direction', order: 40 },
      createSettingsRow({ React, store, t, document })
    )
  );

  /* A small read/write face for tests, for the browser console, and for a
     future host integration. Additive and namespaced; retracted on unload. */
  const scope = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (globalThis));
  scope.__DSH_DIRECTION__ = {
    getSnapshot: () => store.getSnapshot(),
    getPreference: () => store.getSnapshot().preference,
    setMode: (/** @type {import('./direction.js').Mode} */ mode) => store.setMode(mode),
    cycleMode: () => store.cycleMode(),
    setScope: (/** @type {import('./direction.js').Scope} */ value) => store.update({ scope: value }),
    setAlign: (/** @type {import('./direction.js').Align} */ value) => store.update({ align: value }),
    setWidth: (/** @type {number} */ value) => store.update({ width: value }),
    reset: () => store.reset()
  };
  ctx.effect(
    () => () => {
      delete scope.__DSH_DIRECTION__;
    },
    'dsh-direction: retract the console face'
  );
}

export { CONTENT_CONTAINERS };
