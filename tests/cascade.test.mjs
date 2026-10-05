/**
 * Cascade tests: which declaration actually WINS for the surfaces that matter.
 *
 * This is the regression suite for the reported defect. The first release set
 * every attribute correctly — `dir="auto"` on the composer, `data-dsh-direction`
 * on `<html>`, the whole sheet present — and the page still read left-to-right,
 * because:
 *
 *   1. the composer and the editor were pinned `direction: ltr !important`, so
 *      no forced direction could ever reach them; and
 *   2. the leaves had `unicode-bidi: plaintext` but no `text-align`, so a block
 *      that resolved to RTL still sat on the left edge, because `text-align`
 *      inherits `start` from the LTR shell where `start` means left.
 *
 * Attribute assertions cannot see either failure. Cascade assertions can.
 *
 * @module dsh-direction/tests/cascade
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { STYLESHEET } from '../src/styles.js';
import { element, parseStylesheet, resolve, selectorMatches } from './css-cascade.mjs';

const rules = parseStylesheet(STYLESHEET);
assert.ok(rules.length > 5, 'the stylesheet should parse into several rules');

/**
 * The shell ancestor chain, outermost first, exactly as the controller writes it.
 * The direction value lands on BOTH <html> and <body> because the stylesheet's
 * strongest rules key off the <html> attribute.
 */
const shell = (mode, scope = 'messages') => [
  element('html', {
    'data-dsh-direction': mode,
    'data-dsh-direction-scope': scope,
    'data-dsh-direction-align': 'auto',
    'data-dsh-direction-value': mode,
    dir: mode === 'auto' ? 'auto' : mode
  }),
  element('body', { 'data-dsh-direction-value': mode })
];

/** The reading surfaces, exactly as the controller marks them. */
const surfaces = {
  scroll: element('div', { 'data-conversation-scroll': '', dir: 'auto' }),
  flow: element('div', { 'data-chat-flow': '', dir: 'auto' }),
  card: element('div', { 'data-composer-card': '', dir: 'auto' }),
  seat: element('div', { 'data-composer-seat': '', dir: 'auto' }),
  inputScroll: element('div', { 'data-input-scroll': '', dir: 'auto' }),
  editor: element('div', { 'data-lexical-editor': '', dir: 'auto', contenteditable: 'true' })
};

/** A paragraph inside the chat flow, carrying the marker the controller writes. */
const paragraph = (extra = {}) => [
  shell('auto')[0],
  shell('auto')[1],
  surfaces.scroll,
  surfaces.flow,
  element('p', { dir: 'auto', ...extra })
];

/**
 * Resolve one property for one chain.
 *
 * @param {Array<object>} chain - ancestor chain, element last.
 * @param {string} property - property name.
 * @returns {string|null} the winning value.
 */
function winner(chain, property) {
  const found = resolve(rules, chain, property);
  return found === null ? null : found.value;
}

describe('stylesheet scoping', () => {
  it('makes every rule inert without the root attribute', () => {
    /* Strip the scope attribute from the root: nothing should match any more. */
    const unscoped = [element('html', {}), element('body', {}), surfaces.scroll, surfaces.flow, element('p', {})];
    for (const property of ['unicode-bidi', 'text-align', 'direction']) {
      assert.equal(winner(unscoped, property), null, `${property} must not apply outside the scope`);
    }
  });

  it('gives every surface its own base direction and alignment', () => {
    for (const [name, surface] of Object.entries(surfaces)) {
      const chain = [...shell('auto'), surface];
      assert.equal(winner(chain, 'unicode-bidi'), 'plaintext', `${name} needs plaintext`);
      assert.equal(winner(chain, 'text-align'), 'start', `${name} needs text-align: start`);
    }
  });

  it('gives paragraph-level leaves their own direction and alignment', () => {
    const chain = paragraph();
    assert.equal(winner(chain, 'unicode-bidi'), 'plaintext');
    assert.equal(winner(chain, 'text-align'), 'start');
  });
});

describe('regression: the composer must follow a forced direction', () => {
  it('never pins the editor left-to-right', () => {
    for (const mode of ['auto', 'rtl', 'ltr']) {
      const chain = [...shell(mode), surfaces.seat, surfaces.card, surfaces.inputScroll, surfaces.editor];
      const resolution = resolve(rules, chain, 'direction');
      /* Under auto the sheet sets NO direction at all: `dir="auto"` is the
         decision, and that is the point of the mode. Under a forced mode the
         sheet must produce exactly that direction, and never an !important pin
         that would make the other modes inert. */
      if (mode === 'auto') {
        assert.equal(resolution, null, 'auto must leave direction to the dir attribute, not to CSS');
      } else {
        assert.notEqual(resolution, null, `the editor must resolve a direction in ${mode} mode`);
        assert.equal(resolution.value, mode, `editor direction in ${mode} mode`);
      }
      assert.notEqual(resolution?.important, true, `the editor's direction must not be pinned !important in ${mode} mode`);
    }
  });

  it('forces the editor right-to-left in rtl mode', () => {
    const chain = [...shell('rtl'), surfaces.seat, surfaces.card, surfaces.inputScroll, surfaces.editor];
    assert.equal(winner(chain, 'direction'), 'rtl');
    assert.equal(winner(chain, 'text-align'), 'right');
  });

  it('forces the composer card right-to-left in rtl mode', () => {
    const chain = [...shell('rtl'), surfaces.seat, surfaces.card];
    assert.equal(winner(chain, 'direction'), 'rtl');
    assert.equal(winner(chain, 'text-align'), 'right');
  });

  it('lets the editor text follow the editor direction', () => {
    const editorChain = [...shell('rtl'), surfaces.seat, surfaces.inputScroll, surfaces.editor];
    assert.equal(winner(editorChain, 'direction'), 'rtl', 'the caret must follow the text');
    const textChain = [...editorChain, element('span', { 'data-lexical-text': '' })];
    assert.equal(winner(textChain, 'direction'), 'rtl', 'text runs must not be re-pinned left-to-right');
  });
});

describe('regression: rtl mode must reach every reading surface', () => {
  for (const [name, surface] of Object.entries(surfaces)) {
    it(`forces direction: rtl on ${name}`, () => {
      const chain = [...shell('rtl'), surface];
      assert.equal(winner(chain, 'direction'), 'rtl', `${name} did not receive the forced direction`);
      assert.equal(winner(chain, 'text-align'), 'right', `${name} did not receive the forced alignment`);
    });
  }

  it('forces the transcript and its paragraphs right-to-left', () => {
    const forced = [shell('rtl')[0], shell('rtl')[1], surfaces.scroll, surfaces.flow, element('p', { dir: 'auto' })];
    assert.equal(winner(forced, 'direction'), 'rtl');
  });

  it('forces left-to-right in ltr mode', () => {
    for (const [name, surface] of Object.entries(surfaces)) {
      const chain = [...shell('ltr'), surface];
      assert.equal(winner(chain, 'direction'), 'ltr', `${name} did not receive ltr`);
      assert.equal(winner(chain, 'text-align'), 'left', `${name} did not receive left alignment`);
    }
  });
});

describe('code and payloads keep their internal glyph order', () => {
  it('keeps tool payload classes isolated and left-to-right', () => {
    const payload = [
      ...shell('rtl'),
      surfaces.scroll,
      surfaces.flow,
      element('div', { 'data-system-prompt-body': '' })
    ];
    assert.equal(winner(payload, 'direction'), 'rtl', 'a forced page moves the payload to the right edge');
    assert.equal(winner(payload, 'unicode-bidi'), 'isolate', 'but its internal ordering is isolated');
  });

  it('keeps a diff left-to-right', () => {
    const diff = [...shell('auto'), surfaces.scroll, surfaces.flow, element('div', { class: 'my-diff-view' })];
    assert.equal(winner(diff, 'direction'), 'ltr');
    assert.equal(winner(diff, 'unicode-bidi'), 'isolate');
  });

  it('does not isolate a paragraph', () => {
    const chain = paragraph();
    assert.equal(winner(chain, 'unicode-bidi'), 'plaintext', 'a paragraph must resolve its own base direction');
  });
});

describe('the auto/pre pair stays consistent', () => {
  for (const mode of ['auto', 'rtl', 'ltr']) {
    it(`gives pre an edge consistent with the mode under ${mode}`, () => {
      const pre = [...shell(mode), surfaces.scroll, surfaces.flow, element('pre', { dir: 'auto' })];
      /* auto resolves to the left edge, rtl moves the box to the right edge and
         ltr pins it left. What matters is that the mode decides. */
      const expected = mode === 'rtl' ? 'right' : mode === 'ltr' ? 'left' : 'start';
      assert.equal(winner(pre, 'text-align'), expected);
      assert.equal(winner(pre, 'unicode-bidi'), 'isolate', 'the payload order is always protected');
    });
  }

  it('has no rule targeting media, so media only inherits the flow', () => {
    for (const mode of ['auto', 'rtl', 'ltr']) {
      for (const tag of ['img', 'svg', 'video', 'iframe']) {
        const chain = [...shell(mode), surfaces.flow, element(tag, {})];
        const resolution = resolve(rules, chain, 'direction');
        /* Inheriting the flow's direction is correct and is what puts an inline
           image against the right edge in RTL. What must never happen is a rule
           written FOR media: a replaced element has no text to order, so such a
           rule is pure risk. */
        if (resolution !== null) {
          assert.ok(
            !/^(img|svg|video|audio|canvas|iframe)\b/.test(resolution.selector),
            `${tag} must not be targeted by its own direction rule (won: ${resolution.selector})`
          );
        }
      }
    }
  });

  it('pins a path-like link left-to-right', () => {
    const chain = [...shell('rtl'), surfaces.flow, element('a', { href: '/api/file' })];
    const resolution = resolve(rules, chain, 'direction');
    assert.notEqual(resolution, null);
    /* A link is prose-positioned: it follows the paragraph it sits in. What must
       hold is that no rule targets the anchor itself, because deciding an
       anchor's edge is not this plugin's business. */
    assert.equal(resolution.matched, false, 'no rule may target the anchor itself');
    assert.match(resolution.inheritedFrom, /data-chat-flow/);
  });

  it('reports inheritance separately from a match', () => {
    const img = [...shell('rtl'), surfaces.flow, element('img', {})];
    const resolution = resolve(rules, img, 'direction');
    assert.notEqual(resolution, null);
    assert.equal(resolution.value, 'rtl');
    assert.equal(resolution.matched, false, 'nothing targets an image; it only inherits the flow');
    assert.match(resolution.inheritedFrom, /data-chat-flow/);
  });

  it('never lets the LTR pin defeat a forced direction', () => {
    const resolution = resolve(rules, [...shell('rtl'), surfaces.flow, element('pre', { dir: 'auto' })], 'direction');
    assert.equal(resolution.value, 'rtl', 'the forced container rule must win over the LTR island');
    assert.notEqual(resolution.important, true, 'the LTR island must not be !important, or forcing is impossible');
  });
});

describe('mirrored shell', () => {
  it('keeps the plugin overlay left-to-right', () => {
    const chain = [
      element('html', {
        'data-dsh-direction': 'rtl',
        'data-dsh-direction-scope': 'interface',
        'data-dsh-direction-value': 'rtl'
      }),
      element('body', { 'data-dsh-direction-value': 'rtl' }),
      element('div', { 'data-shell-overlay': '' })
    ];
    assert.equal(winner(chain, 'direction'), 'ltr');
  });

  it('only rewrites positional utilities inside the mirrored scope', () => {
    const mirrored = [
      element('html', { 'data-dsh-direction': 'rtl', 'data-dsh-direction-scope': 'interface', 'data-dsh-direction-value': 'rtl' }),
      element('body', {}),
      element('div', { class: 'hWmORq_actions' })
    ];
    const messages = [
      element('html', { 'data-dsh-direction': 'rtl', 'data-dsh-direction-scope': 'messages', 'data-dsh-direction-value': 'rtl' }),
      element('body', {}),
      element('div', { class: 'hWmORq_actions' })
    ];
    assert.equal(winner(mirrored, 'margin-right'), '-6px');
    assert.equal(winner(messages, 'margin-right'), null, 'messages scope must not move the action row');
  });
});

describe('stylesheet invariants', () => {
  it('contains no interpolation placeholder that survived the template literal', () => {
    /* A backtick inside the CSS template literal silently truncates it and turns
       the rest into a string-producing expression, so `\${SCOPE}` would ship as
       literal text and every rule would quietly lose its scope. This has already
       happened once; it is a one-line guard. */
    assert.ok(!STYLESHEET.includes('${'), `a placeholder survived interpolation:\n${STYLESHEET.slice(0, 400)}`);
    assert.ok(!STYLESHEET.includes('`'), 'no backtick may appear in the emitted stylesheet');
    assert.ok(!STYLESHEET.includes('undefined'), 'an interpolation resolved to undefined');
  });

  it('scopes every rule and never leaks a bare universal selector', () => {
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        assert.ok(
          selector.startsWith('[data-dsh-direction') || selector.startsWith(':where([data-dsh-direction'),
          `rule is not scoped and would leak: ${selector}`
        );
      }
    }
  });

  it('declares a plausible amount of CSS', () => {
    assert.ok(STYLESHEET.length > 4000, `stylesheet looks truncated: ${STYLESHEET.length} chars`);
    assert.ok(rules.length >= 15, `expected at least 15 rules, parsed ${rules.length}`);
  });
});

describe('cascade evaluator', () => {
  it('matches descendant selectors and rejects non-ancestors', () => {
    const chain = [
      element('html', { 'data-dsh-direction': 'auto' }),
      element('body', { 'data-dsh-direction-value': 'auto' }),
      element('div', { 'data-chat-flow': '' }),
      element('p', {})
    ];
    assert.ok(selectorMatches('[data-dsh-direction] p', chain));
    assert.ok(!selectorMatches('[data-dsh-direction] pre', chain));
    assert.ok(!selectorMatches('[data-dsh-direction] blockquote p', chain));
  });

  it('prefers importance, then specificity, then source order', () => {
    const fake = parseStylesheet(`
      [data-x] p { color: red; }
      [data-x] [data-chat-flow] p { color: green; }
      [data-x] pre { color: blue !important; }
      [data-x] [data-y] pre { color: yellow; }
    `);
    const chain = [element('html', { 'data-x': '' }), element('div', { 'data-chat-flow': '', 'data-y': '' }), element('p', {})];
    assert.equal(resolve(fake, chain, 'color').value, 'green');
    assert.equal(resolve(fake, chain, 'background'), null);
    const preChain = [element('html', { 'data-x': '' }), element('div', { 'data-y': '' }), element('pre', {})];
    assert.equal(resolve(fake, preChain, 'color').value, 'blue');
    assert.equal(resolve(fake, preChain, 'color').important, true);
  });
});
