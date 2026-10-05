/**
 * The dsh-direction stylesheet.
 *
 * The model, in the order the rules apply:
 *
 * 1. **Containers resolve their own direction.** The controller writes
 *    `dir="auto"` onto the chat flow, the composer and the editor, and the
 *    browser's first-strong algorithm decides from there. That attribute is
 *    honored against an LTR ancestor, which is precisely why the mode is a real
 *    decision rather than a no-op. (There is deliberately no `direction: auto`
 *    declaration here: `auto` is not a CSS value. `dir="auto"` is markup, and
 *    the markup is the controller's job.)
 * 2. **Paragraph-level leaves get their own base direction** via
 *    `unicode-bidi: plaintext`. This is what makes a Persian paragraph and an
 *    English paragraph in one transcript each read naturally.
 * 3. **`text-align: start` on those same leaves and containers.** Without it a
 *    block whose direction resolved to RTL still sits on the LEFT edge, because
 *    `text-align` inherits `start` from the LTR shell, where `start` means left.
 *    This is the single most important declaration in the sheet.
 * 4. **Left-to-right islands**: code, terminals, diffs and tool payloads are
 *    pinned LTR and isolated, so a right-to-left page can never reverse a
 *    command, a path or a code sample.
 * 5. **A forced direction overrides 1-3 on the containers**, so RTL/LTR always
 *    beats detection — and the editor is flipped too, because a contenteditable
 *    that keeps an LTR caret while its text runs RTL is unusable.
 *
 * Every rule is scoped under an attribute the controller writes to <html>, so
 * injecting this sheet unconditionally is safe and unloading the plugin leaves
 * the document untouched.
 */

/** Attribute set on <html> by the controller; every rule is scoped under it. */
export const SCOPE_ATTRIBUTE = 'data-dsh-direction';
const SCOPE = `[${SCOPE_ATTRIBUTE}]`;
/** Scope marker for a mirrored shell. */
const INTERFACE = '[data-dsh-direction-scope="interface"]';
/** Marker for a forced right-to-left document. */
const RTL = '[data-dsh-direction-value="rtl"]';
/** Marker for a forced left-to-right document. */
const LTR = '[data-dsh-direction-value="ltr"]';

/** The selectors `installStylesheet` writes `dir="auto"` onto. */
const READING_SURFACES = [
  '[data-conversation-scroll]',
  '[data-chat-flow]',
  '[data-composer-card]',
  '[data-composer-seat]',
  '[data-input-scroll]',
  '[data-lexical-editor]'
];

/**
 * Content containers that receive `dir="auto"` from the controller.
 * These are the extension points DSH itself marks with stable data attributes,
 * so the selection survives class-name hashing.
 */
export const CONTENT_CONTAINERS = READING_SURFACES.join(',');

/**
 * Code, terminal, tool-payload and diff surfaces that must keep their internal
 * left-to-right order inside a right-to-left page.
 *
 * Editor surfaces are deliberately NOT here. Two earlier revisions pinned
 * `[data-lexical-editor]` and `[data-input-scroll]` LTR with `!important`, which
 * made every composer control silently inert; a caret on the wrong side of a
 * right-to-left line is worse than a mirrored editor.
 *
 * `direction: ltr` here is deliberately NOT `!important`: it has to be able to
 * lose to the forced-direction rules, or "force RTL" would be defeated by every
 * code block on the page. The `unicode-bidi: isolate` is what actually protects
 * the payload's glyph order, and that one IS !important.
 */
const LTR_ISLANDS = [
  'pre',
  'code',
  'kbd',
  'samp',
  '[data-system-prompt-body]',
  '[data-context-injection-body]',
  '[data-turn-usage-details]',
  '[data-session-stats-usage]',
  '[class*="markdown-code"]',
  '[class*="codeBlock"]',
  '[class*="CodeBlock"]',
  '[class*="diff"]',
  '[class*="Diff"]',
  '[class*="terminal"]',
  '[class*="Terminal"]'
];

/**
 * The subset of {@link LTR_ISLANDS} a forced direction must also flip the EDGE
 * of. Elements not listed here (media, for one) are simply left alone: they have
 * no text to order, and inheriting the flow's direction is already correct.
 */
const CODE_LEAVES = ['pre', 'code', 'kbd', 'samp', '[data-system-prompt-body]', '[data-context-injection-body]'];

/** Paragraph-level leaves that each get their own base direction. */
const PLAINTEXT_LEAVES = [
  'p',
  'li',
  'blockquote',
  'dt',
  'dd',
  'figcaption',
  'summary',
  'th',
  'td',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6'
];

/** Media embedded in prose. Kept as documentation of a deliberate non-rule. */
const NEUTRAL_TAGS = ['img', 'svg', 'video', 'audio', 'canvas', 'iframe'];

/** Join a selector list under the `<html>` scope attribute. */
const scoped = (list) => list.map((selector) => `${SCOPE} ${selector}`).join(',\n');

/**
 * Join a selector list under the scope attribute, wrapped in `:where()` so the
 * whole rule contributes ZERO specificity.
 *
 * This is the load-bearing trick of the sheet. Both the detection rules and the
 * forced-direction rules target the same elements, so they tie on specificity
 * and the winner would come down to source order — fragile, and silent when it
 * breaks. Wrapping the detection rules in `:where()` removes the tie entirely:
 * a forced direction always outranks detection, in either direction, whatever
 * the source order.
 */
const whereScoped = (list) =>
  list.map((selector) => `:where(${SCOPE} ${selector})`).join(',\n');

/**
 * Join a selector list under the scope attribute plus a forced direction.
 *
 * The mode arrives as a plain string and the prefix is built HERE, on purpose.
 * Writing a `${SCOPE}${RTL}` template at each call site means writing a template
 * literal inside the CSS template literal, and one stray backtick there silently
 * truncates the sheet while still producing valid JavaScript — a failure mode
 * that cost this file three debugging rounds. Call sites now pass `'rtl'` or
 * `'ltr'` and cannot make that mistake.
 *
 * @param {'rtl'|'ltr'} mode - the forced direction to prefix.
 * @param {string[]} list - selectors to prefix.
 * @returns {string} the joined selector list.
 */
const forced = (mode, list) =>
  list.map((selector) => `${SCOPE}[${SCOPE_ATTRIBUTE}-value="${mode}"] ${selector}`).join(',\n');

const css = `
/* ============================================================
   dsh-direction -- text direction for the DeepSeek Harness Web UI
   Inert until the controller writes ${SCOPE_ATTRIBUTE} on <html>.
   ============================================================ */

/* The transcript and the composer share one width variable in DSH. Overriding
   both keeps the composer card exactly as wide as the transcript column. */
${SCOPE} {
  --dsh-chat-user-width: var(--dsh-direction-content-width);
  --dsh-chat-content-width: var(--dsh-direction-content-width);
}

/* ---- 1. Containers ---------------------------------------------- */

/* dir="auto" is written by the controller, so nothing here sets the direction
   property: the attribute IS the decision. What the sheet must supply is the
   isolation and the alignment, because a dir="auto" box would otherwise still
   inherit text-align:start from the LTR shell, where start means left -- which
   is exactly how right-to-left text ends up pinned to the left edge.

   text-align is declared !important because DSH sets an explicit text-align on
   some of these surfaces (the message action rows, for instance), and an
   explicit value on the same element would otherwise beat an inherited one. */
${whereScoped(READING_SURFACES)} {
  unicode-bidi: plaintext;
  text-align: start !important;
}

/* ---- 2. Paragraph-level leaves ---------------------------------- */

/* plaintext gives every block its own base direction from its first strong
   character; text-align:start lets that direction choose the edge. Both are
   required -- either one alone leaves right-to-left text on the left. */
${whereScoped(PLAINTEXT_LEAVES)} {
  unicode-bidi: plaintext;
  text-align: start !important;
}

/* ---- 3. Left-to-right islands ------------------------------------ */

/* direction:ltr without !important: it must be able to lose to the forced
   direction rules below, or "force RTL" would be defeated by every code block.
   The isolation is what actually protects the payload's glyph order.

   text-align is deliberately NOT set here. Leaving it 'start' (inherited) means
   a code block follows the mode's edge automatically -- left in auto and ltr,
   right in rtl -- with no rule needed to keep them in sync. */
${whereScoped(LTR_ISLANDS)} {
  direction: ltr;
  unicode-bidi: isolate !important;
}

/* ---- 4. Media and path-like links ------------------------------- */

/* Deliberately NO rule here.
 
   Media: a replaced element has no text to order, so a 'direction' declaration
   on it can never do anything — and an inline image inside a right-to-left
   transcript *should* sit against the right edge, which inheriting the flow's
   direction already gives it. An earlier revision pinned 'direction: ltr' on
   'img'/'svg'/'video'/'iframe'; it was dead code that read like a safeguard.

   Path-like links: 'href="/…"' contains nothing but ASCII path characters, and
   the LTR islands rule already isolates '<code>', '<pre>' and tool payloads
   where such a path actually appears. Pinning the anchor's own 'direction' would
   change which edge it sits on inside a right-to-left paragraph, which is not
   something this plugin should decide. */

/* ---- 5. Blockquote and list edges follow the text --------------- */

${SCOPE} blockquote {
  border-inline-start: 3px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.3));
  border-left: none;
  border-right: none;
}

${SCOPE} ul,
${SCOPE} ol {
  padding-inline-start: 1.6em;
  padding-inline-end: 0;
}

/* A list marker belongs to its list's direction, and unicode-bidi: plaintext
   does not move it -- so the list itself follows the text, or the bullets end up
   on the opposite edge from the items they label. */
${SCOPE} li {
  direction: inherit;
}

/* ---- 6. Forced right-to-left ------------------------------------ */

/* The forced direction overrides the detection rules at BOTH levels: the
   containers, and the paragraph-level leaves inside them. Overriding only the
   containers is not enough, because a container's forced direction is beaten on
   the leaf by the leaf's own (more specific) rule -- which is how "RTL" can end
   up not moving the text it was supposed to move. */
${forced('rtl', READING_SURFACES)} {
  direction: rtl;
  text-align: right !important;
}

${forced('rtl', PLAINTEXT_LEAVES)},
${forced('rtl', CODE_LEAVES)} {
  direction: rtl;
  text-align: right !important;
}

/* Tool payloads and diffs keep their internal left-to-right glyph order even
   inside a forced right-to-left page: the box moves to the right edge, its
   content does not reverse. text-align ties on importance and wins on source
   order, so the payload's edge follows the mode. */
${SCOPE}${RTL} pre,
${SCOPE}${RTL} code {
  unicode-bidi: isolate;
  text-align: right !important;
}

/* The placeholder is absolutely positioned from the left edge, so it has to
   follow the text edge or it detaches from the caret. */
${SCOPE}${RTL} [data-composer-placeholder] {
  left: auto;
  right: 0;
}

${SCOPE}${RTL} [data-chat-flow] table {
  direction: rtl;
}

/* ---- 7. Forced left-to-right ------------------------------------ */

${forced('ltr', READING_SURFACES)} {
  direction: ltr;
  text-align: left !important;
}

${forced('ltr', PLAINTEXT_LEAVES)} {
  direction: ltr;
  text-align: left !important;
}

/* ---- 8. Mirrored shell (scope = interface) ---------------------- */

/* The overlay seat is a fixed-position layer: mirroring the frame must never
   move the plugin's own controls, and a fixed box inside a flipped flow would
   otherwise inherit the flip. */
${SCOPE}${INTERFACE} [data-shell-overlay] {
  direction: ltr;
}

/* These two positional utilities are the only ones the mirror cannot fix
   through CSS logical properties. Both are replaced only inside a mirrored
   shell, so a stale hash degrades to a slightly misaligned row, never a broken
   page. */
${SCOPE}${INTERFACE} .hWmORq_actions {
  margin-left: 0;
  margin-right: -6px;
}

${SCOPE}${INTERFACE} .Sixlwa_userRow,
${SCOPE}${INTERFACE} .Sixlwa_userStack {
  align-items: flex-start;
}
`.trim();

/** The single stylesheet text, computed once per materialization. */
export const STYLESHEET = css;

/**
 * What `diagnose()` reports on, with a human label.
 * The list is exported so the diagnostics and the tests cannot drift apart.
 */
export const PROBE_SELECTORS = [
  { label: 'conversationScroll', selector: '[data-conversation-scroll]' },
  { label: 'chatFlow', selector: '[data-chat-flow]' },
  { label: 'composerCard', selector: '[data-composer-card]' },
  { label: 'composerEditor', selector: '[data-lexical-editor]' },
  { label: 'paragraph', selector: '[data-chat-flow] p' },
  { label: 'code', selector: '[data-chat-flow] pre' }
];

/**
 * Attach the stylesheet to a document, tagged so DSH's plugin-CSS bookkeeping
 * (and this plugin) can find and remove it again.
 *
 * @param {Document} document - host document.
 * @param {string} tagId - the `data-plugin-css` value to tag the element with.
 * @returns {() => void} a disposer that removes the element if still attached.
 */
export function installStylesheet(document, tagId) {
  if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return () => {};
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-direction';
  style.dataset.pluginCss = tagId;
  style.textContent = STYLESHEET;
  document.head.appendChild(style);
  return () => {
    if (style.parentNode !== null) style.parentNode.removeChild(style);
  };
}
