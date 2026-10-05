/**
 * Tests for the two surfaces' pure helpers plus the bundled dictionaries.
 *
 * @module dsh-direction/tests/surfaces
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { DICTIONARIES, RTL_LOCALES, en, fa, resolveLocale, translator } from '../src/i18n.js';
import { STYLESHEET, installStylesheet } from '../src/styles.js';
import { DirectionStore, sharedStore } from '../src/store.js';

describe('i18n', () => {
  it('resolves a locale tag onto a shipped language', () => {
    assert.equal(resolveLocale('fa'), 'fa');
    assert.equal(resolveLocale('fa-IR'), 'fa');
    assert.equal(resolveLocale('FA_ir'), 'fa');
    assert.equal(resolveLocale('en-GB'), 'en');
    assert.equal(resolveLocale('de'), 'en');
    assert.equal(resolveLocale(undefined), 'en');
    assert.equal(resolveLocale(42), 'en');
  });

  it('translates with placeholder substitution', () => {
    const t = translator('fa');
    assert.equal(t('overlay.state.rtl'), 'راست‌به‌چپ');
    assert.equal(
      t('overlay.title', { mode: 'A', scope: 'B', align: 'C' }),
      'جهت متن: A · دامنه: B · ترازبندی: C'
    );
  });

  it('falls back to English and then to the key', () => {
    const t = translator('fa');
    assert.equal(t('not.a.key'), 'not.a.key');
    const english = translator('en');
    assert.equal(english('overlay.state.auto'), 'Auto');
  });

  it('keeps both dictionaries at the same key set', () => {
    assert.deepEqual(Object.keys(fa).sort(), Object.keys(en).sort());
  });

  it('translates every overlay state and settings mode key', () => {
    for (const language of Object.keys(DICTIONARIES)) {
      const t = translator(language);
      for (const mode of ['auto', 'rtl', 'ltr']) {
        assert.notEqual(t(`overlay.state.${mode}`), `overlay.state.${mode}`);
        assert.notEqual(t(`settings.mode.${mode}`), `settings.mode.${mode}`);
        assert.notEqual(t(`settings.mode.${mode}Hint`), `settings.mode.${mode}Hint`);
      }
      for (const scope of ['messages', 'interface']) {
        assert.notEqual(t(`settings.scope.${scope}`), `settings.scope.${scope}`);
      }
    }
  });

  it('declares the RTL locale list without duplicates', () => {
    assert.equal(new Set(RTL_LOCALES).size, RTL_LOCALES.length);
  });
});

describe('stylesheet', () => {
  it('scopes every rule under the root attribute', () => {
    const lines = STYLESHEET.split('\n').filter((line) => line.trim().endsWith('{') && !line.trim().startsWith('@'));
    assert.ok(lines.length > 5, 'expected a non-trivial sheet');
    for (const line of lines) {
      assert.ok(
        line.includes('[data-dsh-direction'),
        `unscoped rule would leak outside the plugin: ${line.trim()}`
      );
    }
  });

  it('pins the code islands left-to-right', () => {
    assert.match(STYLESHEET, /\[data-dsh-direction\] pre,/);
    assert.match(STYLESHEET, /direction: ltr !important;/);
    assert.match(STYLESHEET, /unicode-bidi: isolate !important;/);
  });

  it('gives paragraph leaves their own base direction', () => {
    assert.match(STYLESHEET, /unicode-bidi: plaintext;/);
  });

  it('leaves the overlay layer alone when the shell mirrors', () => {
    assert.match(STYLESHEET, /\[data-shell-overlay\] \{\s*direction: ltr;/);
  });

  it('installs one tagged style element and removes it again', () => {
    const created = [];
    const document = /** @type {any} */ ({
      head: {
        appendChild: (element) => created.push(element)
      },
      querySelector: () => null,
      createElement: () => ({
        dataset: {},
        textContent: '',
        parentNode: { removeChild: () => {} }
      })
    });
    const dispose = installStylesheet(document, 'dsh-direction/styles.css');
    assert.equal(created.length, 1);
    assert.equal(created[0].dataset.plugin, 'dsh-direction');
    assert.equal(created[0].dataset.pluginCss, 'dsh-direction/styles.css');
    assert.equal(created[0].textContent, STYLESHEET);
    assert.doesNotThrow(dispose);
  });

  it('does not install twice', () => {
    const document = /** @type {any} */ ({
      head: { appendChild: () => assert.fail('must not append') },
      querySelector: () => ({}),
      createElement: () => assert.fail('must not create')
    });
    assert.doesNotThrow(() => installStylesheet(document, 'x'));
  });
});

describe('DirectionStore', () => {
  it('returns the shared instance', () => {
    assert.equal(sharedStore(), sharedStore());
  });

  it('is inert before bind and reports the defaults', () => {
    const store = new DirectionStore();
    assert.deepEqual(store.getSnapshot().preference, {
      mode: 'auto',
      scope: 'messages',
      align: 'auto',
      width: 0
    });
    assert.equal(store.getSnapshot().forced, null);
    assert.equal(store.getSnapshot().mirrored, false);
    assert.doesNotThrow(() => store.setMode('rtl'));
    assert.doesNotThrow(() => store.unbind());
    assert.doesNotThrow(() => store.reset());
  });

  it('derives forced and mirrored from the preference', () => {
    const store = new DirectionStore();
    store.publish({ mode: 'rtl', scope: 'interface', align: 'auto', width: 0 });
    assert.equal(store.getSnapshot().forced, 'rtl');
    assert.equal(store.getSnapshot().mirrored, true);
    store.publish({ mode: 'rtl', scope: 'messages', align: 'auto', width: 0 });
    assert.equal(store.getSnapshot().mirrored, false);
    store.publish({ mode: 'auto', scope: 'interface', align: 'auto', width: 0 });
    assert.equal(store.getSnapshot().forced, null);
    assert.equal(store.getSnapshot().mirrored, false);
  });

  it('bumps the revision on every publish so memo keys change', () => {
    const store = new DirectionStore();
    const before = store.getSnapshot().revision;
    store.publish({ ...store.getSnapshot().preference });
    assert.equal(store.getSnapshot().revision, before + 1);
    assert.notEqual(store.getSnapshot(), undefined);
  });

  it('notifies subscribers and stops after unsubscribe', () => {
    const store = new DirectionStore();
    let calls = 0;
    const off = store.subscribe(() => {
      calls += 1;
    });
    store.publish({ mode: 'rtl', scope: 'messages', align: 'auto', width: 0 });
    assert.equal(calls, 1);
    off();
    store.publish({ mode: 'ltr', scope: 'messages', align: 'auto', width: 0 });
    assert.equal(calls, 1);
  });

  it('rebinds when the document changes and unloads cleanly', () => {
    const store = new DirectionStore();
    const make = () => {
      const root = { attributes: new Map(), setAttribute: (k, v) => root.attributes.set(k, v), getAttribute: (k) => root.attributes.get(k) ?? null, removeAttribute: (k) => root.attributes.delete(k), style: { setProperty: () => {}, removeProperty: () => {} } };
      const body = { attributes: new Map(), setAttribute: (k, v) => body.attributes.set(k, v), getAttribute: (k) => body.attributes.get(k) ?? null, removeAttribute: (k) => body.attributes.delete(k) };
      return /** @type {any} */ ({ documentElement: root, body, querySelectorAll: () => [], defaultView: undefined });
    };
    const first = make();
    const second = make();
    const controller = store.bind({ document: first });
    assert.equal(store.getSnapshot().preference.mode, 'auto');
    assert.equal(controller.document, first);
    const again = store.bind({ document: first });
    assert.equal(again, controller, 'rebinding the same document reuses the controller');
    const rebound = store.bind({ document: second });
    assert.notEqual(rebound, controller, 'a new document replaces the controller');
    store.unbind();
    assert.equal(store.controller, null);
    assert.equal(second.documentElement.getAttribute('data-dsh-direction'), null);
  });
});
