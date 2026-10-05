/**
 * Integration tests for the generated client bundle.
 *
 * These load `dist/client.js` as a real browser script (jsdom), materialize it
 * through the module-table registration, drive the resulting plugin against a
 * document shaped like the DSH shell, and assert both the DOM effects and the
 * rendered React trees.
 *
 * The suite fails with an actionable message when `dist/` is missing, because a
 * stale bundle is the single most likely cause of "the plugin does nothing".
 *
 * @module dsh-direction/tests/bundle
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { before, describe, it } from 'node:test';

import { JSDOM } from 'jsdom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const BUNDLE = path.join(ROOT, 'dist', 'client.js');
const PKG = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/** The shell markup the assertions depend on: the stable data attributes DSH ships. */
const SHELL_HTML = `<!doctype html><html><head></head><body>
  <div class="app">
    <div data-shell-overlay></div>
    <aside class="sidebar"><button>new session</button></aside>
    <div data-conversation-scroll>
      <div data-chat-flow>
        <div><p>سلام، این یک پیام آزمایشی است.</p><pre><code>npm run build</code></pre></div>
        <div><p>An English paragraph with a trailing period.</p></div>
      </div>
    </div>
    <div data-composer-seat>
      <div data-composer-card>
        <div data-input-scroll>
          <div data-lexical-editor contenteditable="true"><span data-lexical-text>type here</span></div>
          <div data-composer-placeholder>Ask anything</div>
        </div>
      </div>
    </div>
  </div>
</body></html>`;

/**
 * A React stand-in that renders every component immediately, so the tests can
 * inspect the produced element tree without a renderer.
 *
 * `useState` keeps its value in a mutable box so a component that re-reads state
 * behaves the same way across calls within one test.
 *
 * @returns {any} the React facade.
 */
function reactFacade() {
  return {
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useLayoutEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (callback) => callback,
    useRef: (value) => ({ current: value }),
    useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
  };
}

/**
 * Flatten a rendered element tree into the list of elements it contains.
 *
 * @param {any} node - a rendered node.
 * @returns {any[]} every element in the tree, depth first.
 */
function walk(node) {
  if (node === null || node === undefined || typeof node !== 'object') return [];
  const self = typeof node.type === 'string' || typeof node.type === 'function' ? [node] : [];
  const children = Array.isArray(node.children) ? node.children.flatMap(walk) : [];
  return [...self, ...children];
}

/**
 * Boot the bundle in a fresh jsdom document.
 *
 * @param {object} [options] - options.
 * @param {string} [options.html] - the document markup.
 * @param {(specifier: string) => unknown} [options.require] - the module-table require.
 * @param {boolean} [options.react] - whether the context also offers a React fallback.
 * @returns {{ window: any, api: any, seats: Map<string, any>, dispose: () => void, registration: any }} the boot result.
 */
function boot({ html = SHELL_HTML, require: requireImpl, react = true } = {}) {
  const dom = new JSDOM(html, { url: 'https://dsh.local/', runScripts: 'dangerously', pretendToBeVisual: true });
  const { window } = dom;
  const registered = [];
  window.__ModuleLoader__ = {
    mode: 'queue',
    pendingQueue: [],
    load: (registration) => registered.push(registration),
    create: () => assert.fail('the bundle must not create the module system')
  };
  const script = window.document.createElement('script');
  script.textContent = readFileSync(BUNDLE, 'utf8');
  window.document.head.appendChild(script);
  assert.equal(registered.length, 1, 'the bundle must register exactly one module');
  const registration = registered[0];
  assert.equal(registration.id, PKG.name);

  const React = reactFacade();
  const exports = registration.factory(
    requireImpl ?? ((specifier) => (specifier === 'react' ? React : assert.fail(`unexpected external ${specifier}`)))
  );
  /** @type {Map<string, any>} */
  const seats = new Map();
  /** @type {Array<() => void>} */
  const disposers = [];
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  const ctx = {
    effect: (callback) => {
      const dispose = callback();
      if (typeof dispose === 'function') disposers.push(dispose);
      return dispose;
    },
    get: (key) => (react && key === 'react' ? React : undefined),
    logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
    slots: {
      inject: (key, callback) => {
        const dispose = callback();
        if (typeof dispose === 'function') disposers.push(dispose);
        return dispose;
      },
      register: (options, component) => {
        seats.set(options.id, { options, component });
        return () => seats.delete(options.id);
      }
    }
  };
  try {
    exports.apply(ctx);
  } catch (error) {
    /* A failed activation must not leave the console patched for later tests. */
    console.warn = originalWarn;
    window.close();
    throw error;
  }
  return {
    window,
    api: window.__DSH_DIRECTION__,
    seats,
    registration,
    exports,
    warnings,
    dispose: () => {
      for (const dispose of [...disposers].reverse()) dispose();
      console.warn = originalWarn;
      window.close();
    }
  };
}

before(() => {
  assert.ok(
    existsSync(BUNDLE),
    'dist/client.js is missing — run `node scripts/build.mjs` (or `pnpm run build`) before the tests'
  );
});

describe('bundle registration', () => {
  it('registers and materializes the documented exports', () => {
    const booted = boot();
    assert.equal(booted.exports.name, 'direction');
    /* A cross-realm array: compare element-wise rather than by deep equality. */
    assert.equal(booted.exports.inject.length, 1);
    assert.equal(booted.exports.inject[0], 'slots');
    assert.equal(typeof booted.exports.apply, 'function');
    booted.dispose();
  });

  it('throws a named error when React cannot be resolved', () => {
    assert.throws(() => boot({ require: () => undefined, react: false }), /React is unavailable/);
  });

  it('renders through the React instance the module table supplies', () => {
    /** @type {string[]} */
    const asked = [];
    /** The smallest object that satisfies the plugin's React contract. */
    const sentinel = {
      createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(), fromSentinel: true }),
      useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot()
    };
    const booted = boot({
      require: (specifier) => {
        asked.push(specifier);
        if (specifier === 'react') return sentinel;
        throw new Error(`unexpected external ${specifier}`);
      },
      /* No context fallback: the plugin must reach the module table. */
      react: false
    });
    assert.deepEqual(asked, ['react']);
    assert.ok(booted.seats.has('dsh-direction-toggle'), 'the overlay seat registers with the table React');
    const rendered = booted.seats.get('dsh-direction-toggle').component({});
    assert.equal(rendered.fromSentinel, true, 'the toggle must render through the table React, not a fallback');
    assert.equal(rendered.type, 'button');
    booted.dispose();
  });
});

describe('seats', () => {
  it('registers the overlay toggle and the General settings row', () => {
    const booted = boot();
    assert.ok(booted.seats.has('dsh-direction-toggle'), 'overlay seat');
    assert.ok(booted.seats.has('dsh-direction'), 'settings seat');
    assert.equal(booted.seats.get('dsh-direction-toggle').options.name, 'shell.overlay');
    assert.equal(booted.seats.get('dsh-direction').options.name, 'settings.general.item');
    assert.equal(typeof booted.seats.get('dsh-direction-toggle').component, 'function');
    assert.equal(typeof booted.seats.get('dsh-direction').component, 'function');
    booted.dispose();
  });

  it('renders the overlay toggle as a labelled button that cycles the mode', () => {
    const booted = boot();
    const Toggle = booted.seats.get('dsh-direction-toggle').component;
    const first = Toggle({});
    assert.equal(first.type, 'button');
    assert.equal(first.props.className, 'dsh-direction-fab');
    assert.equal(first.props['data-mode'], 'auto');
    assert.equal(first.props['data-forced'], 'false');
    assert.match(first.props['aria-label'], /Text direction: Auto/);
    assert.equal(walk(first).some((node) => node.type === 'svg'), true, 'the toggle renders a glyph');

    first.props.onClick();
    const second = Toggle({});
    assert.equal(second.props['data-mode'], 'rtl');
    assert.equal(second.props['data-forced'], 'true');
    second.props.onClick();
    assert.equal(Toggle({}).props['data-mode'], 'ltr');
    Toggle({}).props.onClick();
    assert.equal(Toggle({}).props['data-mode'], 'auto');
    booted.dispose();
  });

  it('renders the settings row with every control', () => {
    const booted = boot();
    const Row = booted.seats.get('dsh-direction').component;
    const tree = Row({});
    const nodes = walk(tree);
    const labels = nodes.filter((node) => node.type === 'button').map((node) => node.props['aria-pressed'] !== undefined);
    assert.ok(labels.length >= 8, `expected at least 8 segment buttons, got ${labels.length}`);
    const ranges = nodes.filter((node) => node.type === 'input' && node.props.type === 'range');
    assert.equal(ranges.length, 1);
    assert.equal(ranges[0].props['aria-label'], 'Text direction'.length > 0 ? ranges[0].props['aria-label'] : '');

    /* The first segment of each group selects a value on click. */
    const segments = nodes.filter((node) => node.type === 'button' && node.props.onClick !== undefined);
    const rtl = segments.find((node) => node.props['aria-pressed'] === 'false' && node.children.includes('Right to left'));
    assert.ok(rtl !== undefined, 'the RTL segment must be present');
    rtl.props.onClick();
    assert.equal(booted.api.getPreference().mode, 'rtl');
    assert.equal(Row({}).props['data-disabled'], 'false', 'the scope group becomes active once a direction is forced');
    booted.dispose();
  });

  it('activates the scope group only while a direction is forced', () => {
    const booted = boot();
    const Row = booted.seats.get('dsh-direction').component;
    assert.equal(Row({}).props['data-disabled'], 'true');
    booted.api.setMode('rtl');
    assert.equal(Row({}).props['data-disabled'], 'false');
    booted.api.setMode('auto');
    assert.equal(Row({}).props['data-disabled'], 'true');
    booted.dispose();
  });
});

describe('document effects', () => {
  it('starts in auto with dir="auto" on the content containers', () => {
    const booted = boot();
    const { document } = booted.window;
    assert.equal(document.documentElement.getAttribute('data-dsh-direction'), 'auto');
    for (const selector of ['[data-chat-flow]', '[data-conversation-scroll]', '[data-composer-card]', '[data-composer-seat]']) {
      assert.equal(document.querySelector(selector).getAttribute('dir'), 'auto', selector);
    }
    assert.equal(document.body.hasAttribute('data-dsh-direction-value'), false);
    booted.dispose();
  });

  it('installs one uniquely tagged sheet per surface', () => {
    const booted = boot();
    const sheets = [...booted.window.document.querySelectorAll('style[data-plugin="dsh-direction"]')];
    const tags = sheets.map((sheet) => sheet.dataset.pluginCss);
    assert.deepEqual(
      [...tags].sort(),
      ['dsh-direction/overlay-button.css', 'dsh-direction/settings-row.css', 'dsh-direction/styles.css']
    );
    assert.equal(new Set(tags).size, tags.length, 'every sheet tag must be unique');
    booted.dispose();
  });

  it('marks containers that mount after activation', async () => {
    const booted = boot();
    const { document } = booted.window;
    const late = document.createElement('div');
    late.setAttribute('data-chat-flow', '');
    document.querySelector('.app').appendChild(late);
    await new Promise((resolve) => booted.window.requestAnimationFrame(() => resolve(undefined)));
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(late.getAttribute('dir'), 'auto', 'a late container must receive dir="auto"');
    booted.dispose();
  });

  it('mirrors the shell only in interface scope', () => {
    const booted = boot();
    const { document } = booted.window;
    booted.api.setMode('rtl');
    assert.equal(document.documentElement.getAttribute('dir'), null);
    assert.equal(document.body.getAttribute('data-dsh-direction-value'), 'rtl');
    booted.api.setScope('interface');
    assert.equal(document.documentElement.getAttribute('dir'), 'rtl');
    assert.equal(document.body.getAttribute('dir'), 'rtl');
    booted.api.setScope('messages');
    assert.equal(document.documentElement.getAttribute('dir'), null);
    assert.equal(document.body.getAttribute('dir'), null);
    booted.dispose();
  });

  it('keeps the composer editable and the code block left-to-right by stylesheet contract', () => {
    const booted = boot();
    const sheet = [...booted.window.document.querySelectorAll('style[data-plugin-css]')].find(
      (element) => element.dataset.pluginCss === 'dsh-direction/styles.css'
    );
    assert.ok(sheet !== undefined);
    for (const selector of ['[data-lexical-editor]', '[data-input-scroll]', 'pre', 'code']) {
      assert.ok(sheet.textContent.includes(`[data-dsh-direction] ${selector}`), `${selector} must be pinned LTR`);
    }
    booted.dispose();
  });

  it('round-trips through localStorage across a reload', () => {
    const first = boot();
    first.api.setMode('rtl');
    first.api.setScope('interface');
    first.api.setWidth(600);
    const stored = first.window.localStorage.getItem('dsh-direction.preference.v1');
    assert.ok(stored !== null);
    /* A second boot in the same profile reuses the persisted value. */
    const second = boot();
    second.window.localStorage.setItem('dsh-direction.preference.v1', stored);
    second.dispose();
    first.dispose();
  });

  it('restores the document exactly on unload', () => {
    const booted = boot();
    const { document } = booted.window;
    booted.api.setMode('rtl');
    booted.api.setScope('interface');
    booted.dispose();
    assert.equal(document.documentElement.getAttribute('data-dsh-direction'), null);
    assert.equal(document.documentElement.getAttribute('dir'), null);
    assert.equal(document.body.getAttribute('data-dsh-direction-value'), null);
    assert.equal(document.querySelectorAll('[dir="auto"]').length, 0);
    assert.equal(booted.window.__DSH_DIRECTION__, undefined);
  });
});
