/**
 * Host half of dsh-direction.
 *
 * Purpose, and deliberately the only purpose: be a real Loader row so that
 * `@deepseek-ai/dsh-client-modules` discovers this package's `dsh.client`
 * declaration, serves `./client` from `/plugins/dsh-direction/client.js`, and
 * composes the row into `window.__DSH_BOOT__`.
 *
 * All behaviour belongs to the client half. There is no host-side state, no
 * model-visible surface, no tool, no service, and no filesystem access, so
 * nothing here can affect a session, the log, or the Agent loop. The single
 * configuration value is a diagnostic log line.
 *
 * @module dsh-direction
 */

/** Author-visible plugin name, used by fiber diagnostics and logger names. */
export const name = 'direction';

/**
 * Optional: mount only once the client-module registry exists, so the row is
 * composed into the boot graph in the same activation pass that scans it.
 * Cordis holds the fiber until the service is available, and this plugin has no
 * other dependency to wait on.
 */
export const inject = ['clientModules'];

/**
 * Whether to log the mount. Keep this on: the row is invisible in the UI until
 * the client bundle materializes, so a host-side line is the cheapest way to
 * tell "plugin not mounted" apart from "plugin mounted, browser stale".
 */
export const VERBOSE = true;

/**
 * Mount the plugin.
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx - the host root context.
 * @returns {void}
 */
export function apply(ctx) {
  if (!VERBOSE) return;
  try {
    const logger = ctx.logger('dsh-direction');
    logger.info('mounted — client seats: shell.overlay, settings.general.item');
  } catch {
    /* A missing logger must never break a purely client-side plugin. */
  }
}
