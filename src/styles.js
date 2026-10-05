/**
 * The dsh-direction stylesheet.
 *
 * Three load-bearing techniques, in order of importance:
 *
 * 1. `dir="auto"` on the conversation and composer containers (written by the
 *    controller, not by CSS). One wrapper is not enough on its own — a single
 *    message mixes scripts — but it establishes the base direction for the
 *    block as a whole.
 * 2. `unicode-bidi: plaintext` on paragraph-level content leaves. The CSS
 *    plaintext algorithm gives EVERY block its own base direction from its
 *    first strong character, which is what makes a Persian paragraph and an
 *    English paragraph side by side each read naturally. This is why the plugin
 *    needs no MutationObserver and no per-node JavaScript.
 * 3. `direction: ltr; unicode-bidi: isolate` pinned on code, terminals, diffs
 *    and editors, so a right-to-left page can never reverse a command, a file
 *    path or a code sample.
 *
 * Rules are ordered so that later, more specific intent wins: container base
 * direction, then plaintext leaves, then the LTR islands that override both,
 * then neutral leaves, then the forced-direction and mirrored-shell layers.
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

/**
 * Content containers that receive `dir="auto"` from the controller.
 * These are the extension points DSH itself marks with stable data attributes,
 * so the selection survives class-name hashing.
 */
export const CONTENT_CONTAINERS = [
  '[data-conversation-scroll]',
  '[data-chat-flow]',
  '[data-composer-card]',
  '[data-composer-seat]'
].join(',');

/** Containers that additionally need their caret-free text flow isolated. */
export const EDITOR_CONTAINERS = ['[data-lexical-editor]', '[data-input-scroll]'].join(',');

/**
 * Contexts that must stay left-to-right and isolated from the surrounding bidi
 * run: code, terminals, tool payloads, file paths, and every editor surface.
 */
const LTR_ISLANDS = [
  'pre',
  'code',
  'kbd',
  'samp',
  'textarea',
  'input',
  '[data-lexical-editor]',
  '[data-input-scroll]',
  '[data-lexical-text]',
  '[data-lexical-decorator]',
  '[data-lexical-slot]',
  '[data-composer-chip]',
  '[data-composer-text-ref]',
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

/** Paragraph-level leaves that each get their own base direction. */
const PLAINTEXT_LEAVES = ['p', 'li', 'blockquote', 'dt', 'dd', 'figcaption', 'summary', 'th', 'td'];

/** Media and path-like leaves pinned left-to-right so glyph order survives. */
const NEUTRAL_TAGS = ['img', 'svg', 'video', 'audio', 'canvas', 'iframe'];

/** Join a selector list under a shared scope prefix. */
const scoped = (list) => list.map((selector) => `${SCOPE} ${selector}`).join(',\n');

const css = `
/* ============================================================
   dsh-direction — text direction for the DeepSeek Harness Web UI
   Inert until the controller writes ${SCOPE_ATTRIBUTE} on <html>.
   ============================================================ */

/* The conversation column and the composer share one width variable in DSH.
   Overriding both keeps the composer card exactly as wide as the transcript. */
${SCOPE} {
  --dsh-chat-user-width: var(--dsh-direction-content-width);
  --dsh-chat-content-width: var(--dsh-direction-content-width);
}

/* ---- 1. Per-block base direction for paragraph-level leaves ------- */

${scoped(PLAINTEXT_LEAVES)} {
  unicode-bidi: plaintext;
}

/* ---- 2. Left-to-right islands: code, terminals, editors ----------- */

${scoped(LTR_ISLANDS)} {
  direction: ltr !important;
  unicode-bidi: isolate !important;
  text-align: left;
}

/* ---- 3. Neutral leaves ------------------------------------------- */

${scoped(NEUTRAL_TAGS)},
${scoped(['a[href^="/"]'])} {
  direction: ltr;
  unicode-bidi: isolate;
}

/* ---- 4. Blockquote keeps its start edge inside a flipped flow ----- */

${SCOPE} blockquote {
  border-inline-start: 3px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.3));
  border-left: none;
  border-right: none;
}

/* ---- 5. Forced direction ---------------------------------------- */

/* Only the scroll box is forced. [data-chat-flow] deliberately keeps dir="auto"
   so a forced RTL page still lays out each paragraph by its own first strong
   character — that is the difference between a readable and a mangled mix. */
${SCOPE}${RTL} [data-conversation-scroll] {
  direction: rtl;
}

${SCOPE}${RTL} [data-lexical-editor] {
  text-align: right;
}

/* A right-aligned editor is the one place the plaintext algorithm would fight
   the caret, so the editor keeps direction:ltr from rule 2 and only its text
   alignment follows the flow. */
${SCOPE}${RTL} [data-lexical-editor] [data-lexical-text] {
  unicode-bidi: plaintext !important;
}

/* The placeholder is absolutely positioned from the left edge and must follow
   the text edge or it detaches from the caret. */
${SCOPE}${RTL} [data-composer-placeholder] {
  left: auto;
  right: 0;
}

${SCOPE}${RTL} [data-chat-flow] table {
  direction: rtl;
}

${SCOPE}${RTL} [data-chat-flow] ul,
${SCOPE}${RTL} [data-chat-flow] ol {
  padding-inline-start: 1.6em;
  padding-inline-end: 0;
}

/* ---- 6. Mirrored shell (scope = interface) ----------------------- */

/* The overlay seat is a fixed-position layer: mirroring the frame must never
   move the plugin's own controls, and a fixed box inside a flipped flow would
   otherwise inherit the flip. */
${SCOPE}${INTERFACE} [data-shell-overlay] {
  direction: ltr;
}

/* Positional utilities only need replacing inside a mirrored shell. Under
   scope = messages the frame is never flipped, so nothing else is touched. */
${SCOPE}${INTERFACE} .hWmORq_actions {
  margin-left: 0;
  margin-right: -6px;
}

${SCOPE}${INTERFACE} .Sixlwa_userRow,
${SCOPE}${INTERFACE} .Sixlwa_userStack {
  align-items: flex-start;
}

${SCOPE}${INTERFACE} [data-chat-flow] {
  text-align: right;
}
`.trim();

/** The single stylesheet text, computed once per materialization. */
export const STYLESHEET = css;

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
