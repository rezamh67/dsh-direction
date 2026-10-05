#!/usr/bin/env node
/**
 * dsh-direction verification.
 *
 * Static checks that must pass before an install, plus an optional real-DOM
 * pass when `jsdom` is available. Everything here is read-only: it builds
 * nothing and writes nothing.
 *
 * Gates:
 *   1. package contract  — dsh.bundle.patch, dsh.client, exports["./client"], type: module
 *   2. dist completeness — every file the manifest promises exists and is non-empty
 *   3. bundle contract   — one __ModuleLoader__.load registration, matching id, no stray import
 *   4. externals         — every require("x") in the bundle is declared in dsh.client.external
 *   5. patch contract    — the patch parses as YAML and inserts the declared row id
 *   6. source map        — parses as Source Map v3 and names every src module
 *   7. behaviour         — the client bundle drives the DOM correctly (needs jsdom)
 *
 * @module dsh-direction/verify
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** @type {string[]} */
const failures = [];
/** @type {string[]} */
const notes = [];

/**
 * Record a failed gate.
 *
 * @param {string} message - the failure.
 * @returns {void}
 */
function fail(message) {
  failures.push(message);
}

/**
 * Record a passing gate.
 *
 * @param {string} message - the pass note.
 * @returns {void}
 */
function pass(message) {
  notes.push(`  ok    ${message}`);
}

/**
 * Assert a condition, recording either outcome.
 *
 * @param {boolean} condition - the condition.
 * @param {string} message - the gate description.
 * @returns {boolean} the condition.
 */
function check(condition, message) {
  if (condition) pass(message);
  else fail(message);
  return condition;
}

/**
 * Read and parse a JSON file.
 *
 * @param {string} file - absolute path.
 * @returns {Promise<any>} the parsed value.
 */
async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

/** ------------------------------------------------------------------ gates 1-4 */

/**
 * Validate the package manifest and the built artifacts against the DSH
 * external-plugin contract.
 *
 * @returns {Promise<{ pkg: any, bundle: string }>} the manifest and bundle text.
 */
async function checkPackageContract() {
  const pkg = await readJson(path.join(ROOT, 'package.json'));
  console.log(`dsh-direction v${pkg.version} — package contract`);

  check(pkg.type === 'module', 'package.json sets "type": "module"');
  check(pkg.dsh?.bundle?.patch === './cordis.patch.yml', 'package.json declares dsh.bundle.patch');
  check(pkg.dsh?.client?.platform === 'web', 'package.json declares dsh.client.platform = web');
  check(Array.isArray(pkg.dsh?.client?.external), 'package.json declares dsh.client.external');
  check(
    pkg.exports?.['./client'] !== undefined,
    'package.json exports the "./client" subpath (required by dsh-client-modules)'
  );
  check(pkg.exports?.['.'] !== undefined, 'package.json exports the "." host entry');
  check(
    typeof pkg.peerDependencies?.['@deepseek-ai/cordis'] === 'string',
    'package.json declares the @deepseek-ai/cordis peer range'
  );

  const promised = (await readJson(path.join(ROOT, 'dist', 'package.json'))).files ?? [];
  for (const entry of promised) {
    if (entry.includes('*')) continue;
    const target = path.join(ROOT, 'dist', entry);
    const exists = existsSync(target);
    check(exists, `dist/${entry} exists`);
    if (exists) {
      const info = await stat(target);
      check(info.size > 0, `dist/${entry} is non-empty (${info.size} bytes)`);
    }
  }
  check(
    existsSync(path.join(ROOT, pkg.main)) && existsSync(path.join(ROOT, pkg.exports['./client'].default)),
    'the "." and "./client" exports resolve to real files'
  );

  const bundlePath = path.join(ROOT, 'dist', 'client.js');
  if (!existsSync(bundlePath)) {
    fail('dist/client.js is missing — run the build first');
    return { pkg, bundle: '' };
  }
  const bundle = await readFile(bundlePath, 'utf8');

  const registrations = bundle.match(/__ModuleLoader__\.load\(/g) ?? [];
  check(registrations.length === 1, `bundle registers exactly one module (found ${registrations.length})`);
  check(bundle.includes(`id: ${JSON.stringify(pkg.name)}`), `bundle registration id matches the package name (${pkg.name})`);
  check(
    /factory:\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*=>/.test(bundle),
    'bundle factory accepts the module-table require binding'
  );
  check(!/^\s*import\s/m.test(bundle), 'bundle contains no residual ESM import statement');

  /* The only route to the module table is the generated `__external` helper.
     Anything else asking the table for a module is a bundling bug, so the
     contract check is that the helper exists and every specifier it is handed
     is declared — not that the string "require" appears somewhere. */
  const externalHelper = /const __external = \(specifier\) => ([A-Za-z_$][\w$]*)\(specifier\);/.exec(bundle);
  check(externalHelper !== null, 'the bundle routes external requests through one helper');
  const required = new Set(
    [...bundle.matchAll(/__external\((['"])([^'"]+)\1\)/g)].map((match) => match[2])
  );
  /** @type {string[]} */
  const undeclared = [];
  for (const specifier of required) {
    if (!(pkg.dsh.client.external ?? []).includes(specifier)) undeclared.push(specifier);
  }
  check(
    undeclared.length === 0,
    undeclared.length === 0
      ? `every external request in the bundle is declared (${required.size} distinct: ${[...required].join(', ') || 'none'})`
      : `bundle requests undeclared externals: ${undeclared.join(', ')}`
  );
  check(
    !/(?<![A-Za-z0-9_$])require\(/.test(bundle),
    'no module body calls a bare require() — the internal lookup has its own name'
  );

  return { pkg, bundle };
}

/** ------------------------------------------------------------------ gate 4b */

/**
 * Import the built host half the way the Cordis Loader does and assert the
 * plugin shape.
 *
 * The host half is loaded by Node, not by the client module table, so this is
 * the only gate that exercises the real load path of `dsh.bundle`'s `insert`
 * row. A missing or malformed export here means the profile fails to boot with
 * a Loader error, which is far more disruptive than a cosmetic client bug.
 *
 * @returns {Promise<void>} resolves when the gate is recorded.
 */
async function checkHostHalf() {
  const file = path.join(ROOT, 'dist', 'index.js');
  if (!existsSync(file)) {
    fail('dist/index.js is missing — run the build first');
    return;
  }
  let host;
  try {
    host = await import(pathToFileURL(file).href);
  } catch (error) {
    fail(`dist/index.js failed to import: ${String(error)}`);
    return;
  }
  check(typeof host.apply === 'function', 'host half exports apply(ctx)');
  check(typeof host.name === 'string' && host.name.length > 0, 'host half exports a non-empty plugin name');
  check(Array.isArray(host.inject), 'host half exports an inject list');

  /* A real Cordis load, using the installed cordis when it is available. */
  try {
    const { Context } = await import('@deepseek-ai/cordis');
    const ctx = new Context();
    const provided = new Set();
    const provider = ctx.plugin({
      name: 'verify-client-modules',
      provide: ['clientModules'],
      apply(inner) {
        provided.add('clientModules');
        /* `inner` is the isolated context that declares the service. */
        void inner;
      }
    });
    await provider;
    const fiber = ctx.plugin(host);
    await fiber;
    check(provided.has('clientModules'), 'the stub clientModules service was provided');
    check(
      fiber !== undefined && fiber.error === undefined,
      `the plugin fiber activates cleanly${fiber !== undefined && fiber.error !== undefined ? `: ${String(fiber.error)}` : ''}`
    );
    await fiber?.dispose();
    await provider?.dispose?.();
  } catch (error) {
    /* A cordis that is absent (peer dependency not installed) is a skip, not a
       failure: the shape checks above already cover the contract. */
    if (String(error).includes('Cannot find package') || String(error).includes('ERR_MODULE_NOT_FOUND')) {
      notes.push('  skip  live Cordis activation (install peerDependencies to enable it)');
      return;
    }
    fail(`live Cordis activation threw: ${String(error)}`);
  }
}

/** ------------------------------------------------------------------- gate 5 */

/**
 * Validate the bundle patch: parse the one construct DSH needs from it, and
 * confirm the inserted row id and package name match the manifest.
 *
 * The parser is intentionally minimal rather than a full YAML implementation:
 * the file is authored by this repository and is exercised as a whole by the
 * install/load path, so a shape assertion here is what actually catches a typo.
 *
 * @param {any} pkg - the package manifest.
 * @returns {Promise<void>} resolves when the gate is recorded.
 */
async function checkPatch(pkg) {
  const file = path.join(ROOT, 'cordis.patch.yml');
  if (!check(existsSync(file), 'cordis.patch.yml exists')) return;
  const text = await readFile(file, 'utf8');
  const body = text
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('#'))
    .join('\n');
  check(/^-\s*insert:\s*$/m.test(body), 'cordis.patch.yml has one top-level "insert:" list');
  const lowered = body.replace(/\s+/g, ' ');
  check(
    new RegExp(`id:\\s*${pkg.name}\\b`).test(lowered),
    `cordis.patch.yml inserts the row id "${pkg.name}"`
  );
  check(
    new RegExp(`name:\\s*${pkg.name}\\b`).test(lowered),
    `cordis.patch.yml mounts the package "${pkg.name}"`
  );
  check(!/^\s*[-a-zA-Z]+:/m.test(body.split('insert:')[0] ?? ''), 'no other top-level patch keys are present');
}

/** ------------------------------------------------------------------- gate 6 */

/**
 * Validate the emitted source map.
 *
 * @returns {Promise<void>} resolves when the gate is recorded.
 */
async function checkSourceMap() {
  const file = path.join(ROOT, 'dist', 'client.js.map');
  if (!check(existsSync(file), 'dist/client.js.map exists')) return;
  let map;
  try {
    map = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    fail(`dist/client.js.map is not valid JSON: ${String(error)}`);
    return;
  }
  check(map.version === 3, 'source map declares version 3');
  check(typeof map.mappings === 'string', 'source map has a mappings string');
  check(Array.isArray(map.sources) && map.sources.length > 0, 'source map names at least one source');
  const sources = new Set(map.sources.map((entry) => path.basename(entry)));
  /* index.js is the host half: it is served by the Node loader, never bundled
     into the client artifact, so it must not appear in the client source map. */
  const srcFiles = (await readdir(path.join(ROOT, 'src'))).filter((name) => name.endsWith('.js') && name !== 'index.js');
  const missing = srcFiles.filter((name) => !sources.has(name));
  check(missing.length === 0, missing.length === 0 ? `source map names every bundled src module (${srcFiles.length})` : `source map omits: ${missing.join(', ')}`);
  check(!sources.has('index.js'), 'source map excludes the host-only src/index.js');
}

/** ------------------------------------------------------------------- gate 7 */

/**
 * Load the real bundle into a real DOM and assert its observable behaviour.
 * Skipped with a note when `jsdom` is not installed, so the static gates still
 * run in a bare checkout.
 *
 * @returns {Promise<void>} resolves when the gate is recorded.
 */
async function checkBehaviour() {
  let JSDOM;
  try {
    ({ JSDOM } = await import('jsdom'));
  } catch {
    notes.push('  skip  behaviour gate (install devDependencies to enable it: pnpm install)');
    return;
  }

  const dom = new JSDOM(
    `<!doctype html><html><head></head><body>
       <div class="app">
         <div data-conversation-scroll><div data-chat-flow><p>سلام</p><pre>npm run build</pre></div></div>
         <div data-composer-seat><div data-composer-card><div data-lexical-editor contenteditable></div></div></div>
       </div>
     </body></html>`,
    { url: 'https://dsh.local/', runScripts: 'dangerously' }
  );
  const { window } = dom;
  const bundle = await readFile(path.join(ROOT, 'dist', 'client.js'), 'utf8');

  /** @type {Map<string, unknown>} */
  const registered = new Map();
  const loader = {
    mode: 'queue',
    pendingQueue: [],
    load(registration) {
      registered.set(registration.id, registration);
    },
    create() {
      throw new Error('not used by the verifier');
    }
  };
  window.__ModuleLoader__ = loader;
  window.document.addEventListener('error', (event) => {
    fail(`the bundle threw while executing: ${String(event.error ?? event.message)}`);
  });
  if (window.__ModuleLoader__ !== loader) {
    fail('window.__ModuleLoader__ was replaced before the bundle ran');
  }

  const pkg = await readJson(path.join(ROOT, 'package.json'));
  /* Execute the bundle the way the page does: a classic <script> element, so
     `window.__ModuleLoader__` is the same object the registration writes to. */
  const script = window.document.createElement('script');
  script.textContent = bundle;
  window.document.head.appendChild(script);
  const registration = registered.get(pkg.name);
  if (!check(registration !== undefined, 'bundle registers itself under the package name when evaluated')) return;

  const React = {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (value) => [value, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useRef: (value) => ({ current: value }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
  };
  const exports = registration.factory((specifier) => {
    if (specifier === 'react') return React;
    throw new Error(`unexpected external: ${specifier}`);
  });
  check(typeof exports.apply === 'function', 'materialized bundle exports apply()');
  check(Array.isArray(exports.inject), 'materialized bundle exports an inject list');

  /** @type {string[]} */
  const registeredSeats = [];
  /** @type {Array<() => void>} */
  const disposers = [];
  const ctx = {
    effect: (callback, _label) => {
      const dispose = callback();
      if (typeof dispose === 'function') disposers.push(dispose);
      return dispose;
    },
    get: (key) => (key === 'react' ? React : undefined),
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    slots: {
      inject: (key, callback) => {
        registeredSeats.push(key);
        const dispose = callback();
        if (typeof dispose === 'function') disposers.push(dispose);
        return dispose;
      },
      register: (options) => {
        registeredSeats.push(`register:${options.name}:${options.id}`);
        return () => {};
      }
    }
  };

  exports.apply(ctx);
  check(registeredSeats.includes('shell.overlay'), 'apply() registers into shell.overlay');
  check(registeredSeats.includes('settings.general.item'), 'apply() registers into settings.general.item');

  const html = window.document.documentElement;
  const body = window.document.body;
  check(html.getAttribute('data-dsh-direction') === 'auto', 'default mode is auto');
  check(html.getAttribute('data-dsh-direction-scope') === 'messages', 'default scope is messages');
  check(
    window.document.querySelectorAll('[dir="auto"]').length >= 3,
    'content containers receive dir="auto"'
  );
  check(body.hasAttribute('data-dsh-direction-value') === false, 'auto forces no direction value');

  const api = /** @type {any} */ (window).__DSH_DIRECTION__;
  if (!check(api !== undefined, 'the console face is installed')) return;

  api.setMode('rtl');
  check(body.getAttribute('data-dsh-direction-value') === 'rtl', 'rtl sets the body direction value');
  check(html.getAttribute('dir') === null, 'rtl under messages scope leaves the shell alone');
  check(
    html.style.getPropertyValue('--dsh-direction-content-width') === '748px',
    'the shipped content width is published when no override is set'
  );

  api.setScope('interface');
  check(html.getAttribute('dir') === 'rtl', 'interface scope mirrors the document element');
  check(body.getAttribute('dir') === 'rtl', 'interface scope mirrors the body');

  api.setWidth(640);
  check(
    html.style.getPropertyValue('--dsh-direction-content-width') === '640px',
    'a width override is published as a CSS variable'
  );

  api.setAlign('justify');
  check(html.getAttribute('data-dsh-direction-align') === 'justify', 'alignment is projected to the root');

  api.setMode('ltr');
  check(body.getAttribute('data-dsh-direction-value') === 'ltr', 'ltr sets the body direction value');

  const stored = window.localStorage.getItem('dsh-direction.preference.v1');
  check(stored !== null && JSON.parse(stored).mode === 'ltr', 'the selection is persisted to localStorage');

  api.reset();
  check(html.getAttribute('data-dsh-direction') === 'auto', 'reset restores auto');
  check(html.getAttribute('dir') === null, 'reset unmirrors the document element');
  check(window.localStorage.getItem('dsh-direction.preference.v1') === null, 'reset clears persistence');

  for (const dispose of disposers.reverse()) {
    try {
      dispose();
    } catch (error) {
      fail(`a disposer threw on unload: ${String(error)}`);
    }
  }
  check(html.getAttribute('data-dsh-direction') === null, 'unloading retracts the root marker');
  check(window.document.querySelectorAll('[dir="auto"]').length === 0, 'unloading retracts every dir="auto"');
  check(/** @type {any} */ (window).__DSH_DIRECTION__ === undefined, 'unloading retracts the console face');
  window.close();
}

/** --------------------------------------------------------------------- main */

/**
 * Run every gate and report.
 *
 * @returns {Promise<void>} resolves after the report; sets a nonzero exit on failure.
 */
async function main() {
  await checkPackageContract().then(async ({ pkg }) => {
    await checkHostHalf();
    await checkPatch(pkg);
    await checkSourceMap();
  });
  await checkBehaviour();

  console.log(notes.join('\n'));
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:`);
    for (const failure of failures) console.error(`  FAIL  ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log('\nAll dsh-direction checks passed.');
}

await main();
