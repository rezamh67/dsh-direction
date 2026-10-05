/**
 * Behaviour tests for the direction model.
 *
 * These exercise the pure half — normalization, persistence, the mode cycle and
 * the DOM projection — without a browser, by handing the controller a minimal
 * document stub. The full-bundle path against a real DOM is covered by
 * `scripts/verify.mjs` (jsdom) and `tests/bundle.test.mjs`.
 *
 * @module dsh-direction/tests/direction
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ALIGNS,
  DEFAULT_PREFERENCE,
  DirectionController,
  MAX_WIDTH,
  MODES,
  SHIPPED_CONTENT_WIDTH,
  forcedDirection,
  nextMode,
  normalizePreference,
  readPreference,
  samePreference,
  writePreference
} from '../src/direction.js';

/**
 * A minimal Storage implementation backed by a Map.
 *
 * @param {Record<string, string>} [initial] - seed entries.
 * @returns {Storage} the store.
 */
function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return /** @type {Storage} */ ({
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => map.delete(key),
    setItem: (key, value) => map.set(key, String(value))
  });
}

/** A document stub that records attributes, matching only the selectors the plugin uses. */
class FakeElement {
  constructor(name) {
    this.name = name;
    this.attributes = new Map();
    this.style = {
      properties: new Map(),
      setProperty: (key, value) => this.style.properties.set(key, value),
      removeProperty: (key) => this.style.properties.delete(key)
    };
  }

  setAttribute(key, value) {
    this.attributes.set(key, String(value));
  }

  getAttribute(key) {
    return this.attributes.has(key) ? this.attributes.get(key) : null;
  }

  removeAttribute(key) {
    this.attributes.delete(key);
  }

  hasAttribute(key) {
    return this.attributes.has(key);
  }
}

/**
 * Build a document stub with a few content containers.
 *
 * @param {number} [containers] - how many containers to create.
 * @returns {{ document: Document, containers: FakeElement[], root: FakeElement, body: FakeElement }} the stub.
 */
function fakeDocument(containers = 2) {
  const root = new FakeElement('html');
  const body = new FakeElement('body');
  const nodes = Array.from({ length: containers }, (_, index) => new FakeElement(`container-${index}`));
  const document = /** @type {any} */ ({
    documentElement: root,
    body,
    defaultView: undefined,
    querySelectorAll: () => nodes,
    querySelector: () => null
  });
  return { document, containers: nodes, root, body };
}

/**
 * Build a controller over a stub document.
 *
 * @param {object} [options] - options.
 * @param {Storage} [options.storage] - storage to seed.
 * @param {number} [options.containers] - container count.
 * @returns {{ controller: DirectionController, root: FakeElement, body: FakeElement, containers: FakeElement[] }} the fixture.
 */
function fixture({ storage, containers = 2 } = {}) {
  const { document, root, body, containers: nodes } = fakeDocument(containers);
  const controller = new DirectionController({
    document,
    window: storage === undefined ? undefined : /** @type {any} */ ({ localStorage: storage }),
    containerSelector: '[data-chat-flow]'
  });
  return { controller, root, body, containers: nodes };
}

describe('normalizePreference', () => {
  it('returns the defaults for every unusable input', () => {
    for (const input of [undefined, null, 0, 'rtl', [], { mode: 'sideways' }, { scope: 7 }]) {
      assert.deepEqual(normalizePreference(input), { ...DEFAULT_PREFERENCE });
    }
  });

  it('accepts every documented value', () => {
    for (const mode of MODES) {
      assert.equal(normalizePreference({ mode }).mode, mode);
    }
    for (const align of ALIGNS) {
      assert.equal(normalizePreference({ align }).align, align);
    }
  });

  it('clamps the width into range and rounds it', () => {
    assert.equal(normalizePreference({ width: -50 }).width, 0);
    assert.equal(normalizePreference({ width: 99999 }).width, MAX_WIDTH);
    assert.equal(normalizePreference({ width: 640.6 }).width, 641);
    assert.equal(normalizePreference({ width: 'nope' }).width, 0);
  });

  it('never throws on a partially valid object', () => {
    assert.deepEqual(normalizePreference({ mode: 'rtl', scope: 'nope', align: 'start', width: 700 }), {
      mode: 'rtl',
      scope: 'messages',
      align: 'start',
      width: 700
    });
  });
});

describe('mode helpers', () => {
  it('maps a mode onto its forced direction', () => {
    assert.equal(forcedDirection('auto'), null);
    assert.equal(forcedDirection('rtl'), 'rtl');
    assert.equal(forcedDirection('ltr'), 'ltr');
  });

  it('cycles auto -> rtl -> ltr -> auto', () => {
    assert.equal(nextMode('auto'), 'rtl');
    assert.equal(nextMode('rtl'), 'ltr');
    assert.equal(nextMode('ltr'), 'auto');
  });

  it('compares preferences on every axis', () => {
    assert.ok(samePreference({ ...DEFAULT_PREFERENCE }, { ...DEFAULT_PREFERENCE }));
    assert.ok(!samePreference({ ...DEFAULT_PREFERENCE }, { ...DEFAULT_PREFERENCE, width: 640 }));
  });
});

describe('preference persistence', () => {
  it('round-trips through storage', () => {
    const storage = memoryStorage();
    assert.ok(writePreference(storage, { mode: 'rtl', scope: 'interface', align: 'justify', width: 640 }));
    assert.deepEqual(readPreference(storage), { mode: 'rtl', scope: 'interface', align: 'justify', width: 640 });
  });

  it('degrades to the defaults on corrupt or absent values', () => {
    assert.deepEqual(readPreference(memoryStorage({ 'dsh-direction.preference.v1': '{ not json' })), { ...DEFAULT_PREFERENCE });
    assert.deepEqual(readPreference(memoryStorage()), { ...DEFAULT_PREFERENCE });
    assert.deepEqual(readPreference(undefined), { ...DEFAULT_PREFERENCE });
  });

  it('survives a storage that refuses to read or write', () => {
    const hostile = /** @type {Storage} */ ({
      get length() {
        return 0;
      },
      clear: () => {},
      getItem: () => {
        throw new Error('denied');
      },
      key: () => null,
      removeItem: () => {},
      setItem: () => {
        throw new Error('denied');
      }
    });
    assert.deepEqual(readPreference(hostile), { ...DEFAULT_PREFERENCE });
    assert.equal(writePreference(hostile, { ...DEFAULT_PREFERENCE }), false);
  });
});

describe('DirectionController', () => {
  it('applies the defaults on attach', () => {
    const { controller, root, body, containers } = fixture();
    controller.attach();
    assert.equal(root.getAttribute('data-dsh-direction'), 'auto');
    assert.equal(root.getAttribute('data-dsh-direction-scope'), 'messages');
    assert.equal(root.getAttribute('data-dsh-direction-align'), 'auto');
    assert.equal(body.hasAttribute('data-dsh-direction-value'), false);
    assert.equal(root.getAttribute('dir'), null);
    assert.equal(root.style.properties.get('--dsh-direction-content-width'), `${SHIPPED_CONTENT_WIDTH}px`);
    for (const container of containers) assert.equal(container.getAttribute('dir'), 'auto');
  });

  it('honours a stored preference', () => {
    const storage = memoryStorage({
      'dsh-direction.preference.v1': JSON.stringify({ mode: 'rtl', scope: 'interface', align: 'justify', width: 0 })
    });
    const { controller, root, body } = fixture({ storage });
    controller.attach();
    assert.equal(body.getAttribute('data-dsh-direction-value'), 'rtl');
    assert.equal(root.getAttribute('dir'), 'rtl');
    assert.equal(body.getAttribute('dir'), 'rtl');
    assert.equal(root.getAttribute('data-dsh-direction-scope'), 'interface');
  });

  it('does not mirror the shell under messages scope', () => {
    const { controller, root } = fixture();
    controller.attach();
    controller.setMode('rtl');
    assert.equal(root.getAttribute('dir'), null);
    controller.setScope('interface');
    assert.equal(root.getAttribute('dir'), 'rtl');
    controller.setScope('messages');
    assert.equal(root.getAttribute('dir'), null);
  });

  it('persists on update and notifies subscribers once per change', () => {
    const storage = memoryStorage();
    const { controller } = fixture({ storage });
    controller.attach();
    let calls = 0;
    controller.subscribe(() => {
      calls += 1;
    });
    controller.setMode('rtl');
    assert.equal(calls, 1);
    controller.setMode('rtl');
    assert.equal(calls, 1, 'a no-op update must not notify');
    assert.equal(JSON.parse(String(storage.getItem('dsh-direction.preference.v1'))).mode, 'rtl');
  });

  it('cycles the mode', () => {
    const { controller } = fixture();
    controller.attach();
    assert.equal(controller.cycleMode().mode, 'rtl');
    assert.equal(controller.cycleMode().mode, 'ltr');
    assert.equal(controller.cycleMode().mode, 'auto');
  });

  it('publishes and clears the width override', () => {
    const { controller, root } = fixture();
    controller.attach();
    controller.setWidth(520);
    assert.equal(root.style.properties.get('--dsh-direction-content-width'), '520px');
    controller.setWidth(0);
    assert.equal(root.style.properties.get('--dsh-direction-content-width'), `${SHIPPED_CONTENT_WIDTH}px`);
  });

  it('reset restores the defaults and clears persistence', () => {
    const storage = memoryStorage();
    const { controller, root } = fixture({ storage });
    controller.attach();
    controller.update({ mode: 'rtl', scope: 'interface', align: 'justify', width: 700 });
    controller.reset();
    assert.deepEqual(controller.preference, { ...DEFAULT_PREFERENCE });
    assert.equal(root.getAttribute('data-dsh-direction'), 'auto');
    assert.equal(root.getAttribute('dir'), null);
    assert.equal(storage.getItem('dsh-direction.preference.v1'), null);
  });

  it('dispose retracts every write, including dir="auto"', () => {
    const { controller, root, body, containers } = fixture();
    controller.attach();
    controller.update({ mode: 'rtl', scope: 'interface', align: 'start', width: 640 });
    controller.dispose();
    for (const element of [root, body]) {
      assert.equal(element.attributes.size, 0, `${element.name} kept ${[...element.attributes.keys()].join(', ')}`);
      assert.equal(element.style.properties.size, 0);
    }
    for (const container of containers) assert.equal(container.getAttribute('dir'), null);
  });

  it('dispose on an unattached controller is a no-op', () => {
    const { controller, root } = fixture();
    controller.dispose();
    assert.equal(root.attributes.size, 0);
    controller.attach();
    assert.equal(root.hasAttribute('data-dsh-direction'), false, 'attach after dispose must do nothing');
  });

  it('a later attach is idempotent', () => {
    const { controller, root } = fixture();
    controller.attach();
    controller.setMode('rtl');
    controller.attach();
    assert.equal(root.getAttribute('data-dsh-direction'), 'rtl');
  });

  it('ignores a document without a body', () => {
    const controller = new DirectionController({
      document: /** @type {any} */ ({ documentElement: null, body: null }),
      containerSelector: '[data-chat-flow]'
    });
    assert.doesNotThrow(() => controller.attach());
  });
});
