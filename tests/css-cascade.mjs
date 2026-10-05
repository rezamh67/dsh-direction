/**
 * A minimal CSS cascade evaluator, used to assert which declaration WINS for a
 * given element.
 *
 * Why this exists: the bug that made the first release look "installed but
 * doing nothing" was not a wrong value — every value was right — it was a
 * declaration losing a specificity fight (an `!important` pin on the composer,
 * and an inherited `text-align` that beat the intended one). Attributes in the
 * DOM were all correct, so attribute assertions passed. What was needed was the
 * answer to "which rule actually wins here", and that is a pure function of the
 * selector, the declaration's origin, its importance, and source order.
 *
 * This is deliberately NOT a layout engine. It resolves the cascade; it does not
 * render. A rendering assertion still needs a real browser, which is why
 * `scripts/browser-check.mjs` exists separately.
 *
 * Supported subset — exactly what this project's stylesheet uses:
 *   - selectors: type, attribute (`[a]`, `[a="v"]`), class, `*`, and descendant
 *     combinators, each optionally preceded by the scope attribute
 *   - declarations `prop: value`, at most one `!important`
 *   - no at-rules, no pseudo-classes, no inline styles
 *
 * @module dsh-direction/tests/css-cascade
 */

/**
 * Parse a stylesheet into ordered rules.
 *
 * @param {string} css - stylesheet text.
 * @returns {Array<{ selectorText: string, selectors: string[], declarations: Array<{ property: string, value: string, important: boolean }>, order: number }>} the rules.
 */
export function parseStylesheet(css) {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  /** @type {ReturnType<typeof parseStylesheet>} */
  const rules = [];
  let order = 0;
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = rulePattern.exec(withoutComments)) !== null) {
    const selectorText = match[1].trim().replace(/\s+/g, ' ');
    if (selectorText === '') continue;
    const declarations = match[2]
      .split(';')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
      .map((entry) => {
        const colon = entry.indexOf(':');
        if (colon === -1) return null;
        const property = entry.slice(0, colon).trim();
        let value = entry.slice(colon + 1).trim();
        let important = false;
        const bang = /!important$/i.exec(value);
        if (bang !== null) {
          important = true;
          value = value.slice(0, bang.index).trim();
        }
        return { property, value, important };
      })
      .filter((declaration) => declaration !== null);
    rules.push({
      selectorText,
      selectors: selectorText.split(',').map((selector) => selector.trim()).filter((selector) => selector !== ''),
      declarations: declarations.filter(Boolean),
      order: order++
    });
  }
  return rules;
}

/**
 * A tiny element model: tag name plus attributes.
 *
 * @param {string} tag - tag name, lower case.
 * @param {Record<string, string>} [attributes] - attributes.
 * @returns {{ tag: string, attributes: Record<string, string> }} the element.
 */
export function element(tag, attributes = {}) {
  return { tag: tag.toLowerCase(), attributes };
}

/**
 * Peel the zero-specificity wrappers this stylesheet uses, keeping note of them
 * so specificity can account for `:where()` contributing nothing.
 *
 * Supported: `:where(...)`, `:is(...)`, `:not(...)`, `:has(...)` (each with a
 * single level of nesting, which is all this project uses) and `:scope`.
 *
 * @param {string} selector - one complex selector.
 * @returns {{ selector: string, wrappers: string[] }} the unwrapped selector.
 */
function unwrapPseudo(selector) {
  let current = selector.trim();
  /** @type {string[]} */
  const wrappers = [];
  let changed = true;
  while (changed) {
    changed = false;
    const match = /:(where|is|not|has|matches|scope)\(([^()]*)\)/.exec(current);
    if (match !== null) {
      wrappers.push(match[1]);
      current = `${current.slice(0, match.index)} ${match[2]} ${current.slice(match.index + match[0].length)}`.trim();
      changed = true;
    }
  }
  return { selector: current, wrappers };
}

/**
 * Specificity of one complex selector as `[ids, classes, types]`.
 * `:where()` arguments contribute nothing, per the Selectors 4 specification.
 *
 * @param {string} selector - a complex selector such as `[data-x] pre`.
 * @returns {[number, number, number]} the specificity triple.
 */
function specificityOf(selector) {
  const { wrappers } = unwrapPseudo(selector);
  if (wrappers.includes('where')) return [0, 0, 0];
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes =
    (selector.match(/\.[\w-]+/g) ?? []).length +
    (selector.match(/\[[^\]]+\]/g) ?? []).length +
    (selector.match(/:(?!where\b)[\w-]+/g) ?? []).length;
  const types = (selector.match(/(?:^|[\s>+~])([a-zA-Z][\w-]*)/g) ?? []).length;
  return [ids, classes, types];
}

/**
 * Compare two specificity triples.
 *
 * @param {[number, number, number]} left - first.
 * @param {[number, number, number]} right - second.
 * @returns {number} negative when left is weaker, positive when stronger.
 */
function compareSpecificity(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

/**
 * Split a compound selector into its simple parts.
 * Brackets are respected, so `[a][b="v"]` yields two parts rather than one.
 *
 * @param {string} compound - compound selector text.
 * @returns {string[]} the simple parts, in source order.
 */
function splitCompound(compound) {
  /** @type {string[]} */
  const parts = [];
  let index = 0;
  while (index < compound.length) {
    const character = compound[index];
    if (character === ' ' || character === '\t') {
      index += 1;
      continue;
    }
    if (character === '[') {
      const close = compound.indexOf(']', index);
      if (close === -1) throw new Error(`css-cascade: unterminated attribute selector in "${compound}"`);
      parts.push(compound.slice(index, close + 1));
      index = close + 1;
      continue;
    }
    /* A class, id, or type name runs until the next part starts. */
    let end = index;
    while (end < compound.length && !' \t[.#'.includes(compound[end])) end += 1;
    if (end === index) {
      /* The character itself opens a new part (a class or an id). */
      let next = index + 1;
      while (next < compound.length && !' \t[.#'.includes(compound[next])) next += 1;
      parts.push(compound.slice(index, next));
      index = next;
      continue;
    }
    parts.push(compound.slice(index, end));
    index = end;
  }
  return parts;
}

/**
 * Whether one compound selector matches one element.
 *
 * @param {string} compound - compound selector text.
 * @param {{ tag: string, attributes: Record<string, string> }} target - the element.
 * @returns {boolean} true when it matches.
 */
function compoundMatches(compound, target) {
  if (compound === '*') return true;
  for (const part of splitCompound(compound)) {
    if (part === '*') continue;
    if (part.startsWith('[')) {
      const attributeMatch = /^\[([\w-]+)(?:([~^$*|]?=)"?([^"\]]*)"?)?\]$/.exec(part);
      if (attributeMatch === null) throw new Error(`css-cascade: unsupported attribute selector "${part}"`);
      const [, name, operator, rawValue] = attributeMatch;
      const actual = target.attributes[name];
      if (actual === undefined) return false;
      if (operator === undefined) continue;
      if (operator === '=' && actual !== rawValue) return false;
      if (operator === '^=' && !actual.startsWith(rawValue)) return false;
      if (operator === '$=' && !actual.endsWith(rawValue)) return false;
      if (operator === '*=' && !actual.includes(rawValue)) return false;
      continue;
    }
    if (part.startsWith('.')) {
      const classes = (target.attributes.class ?? '').split(/\s+/).filter((entry) => entry !== '');
      if (!classes.includes(part.slice(1))) return false;
      continue;
    }
    if (part.startsWith('#')) {
      if (target.attributes.id !== part.slice(1)) return false;
      continue;
    }
    if (part === '') continue;
    if (target.tag !== part.toLowerCase()) return false;
  }
  return true;
}

/**
 * Whether a descendant-combinator selector matches an ancestor chain.
 * The chain is ordered outermost-first and must include the element itself last.
 *
 * @param {string} selector - one complex selector.
 * @param {Array<{ tag: string, attributes: Record<string, string> }>} chain - ancestor chain, element last.
 * @returns {boolean} true when the selector matches.
 */
export function selectorMatches(selector, chain) {
  const { selector: unwrapped } = unwrapPseudo(selector);
  const parts = unwrapped.trim().split(/\s+/).filter((part) => part !== '');
  let index = chain.length - 1;
  for (let part = parts.length - 1; part >= 0; part -= 1) {
    let found = false;
    while (index >= 0) {
      if (compoundMatches(parts[part], chain[index])) {
        found = true;
        index -= 1;
        break;
      }
      index -= 1;
    }
    if (!found) return false;
  }
  return true;
}

/**
 * Whether a selector matches the TARGET element itself (the last chain entry),
 * as opposed to matching only an ancestor and relying on inheritance.
 *
 * @param {string} selector - one complex selector.
 * @param {Array<{ tag: string, attributes: Record<string, string> }>} chain - ancestor chain, element last.
 * @returns {boolean} true when the selector's final compound matches the element.
 */
export function selectorTargetsElement(selector, chain) {
  if (chain.length === 0) return false;
  const { selector: unwrapped } = unwrapPseudo(selector);
  const parts = unwrapped.trim().split(/\s+/).filter((part) => part !== '');
  if (parts.length === 0) return false;
  return compoundMatches(parts[parts.length - 1], chain[chain.length - 1]);
}

/**
 * Resolve the winning value of one property for an element.
 *
 * Two different questions live here and conflating them hides bugs, so both are
 * answered explicitly:
 *
 *   - `matched`: the declaration that matched THIS element (the last entry in the
 *     chain). Null when no rule targets it.
 *   - `inherited`: when nothing matched, the value the element inherits, reported
 *     with the ancestor selector that produced it.
 *
 * An earlier revision returned the ancestor's value as if it were a match, which
 * masked an element's own rule and made a correct stylesheet look broken.
 *
 * @param {Array<{ selectorText: string, selectors: string[], declarations: Array<{ property: string, value: string, important: boolean }>, order: number }>} rules - parsed rules.
 * @param {Array<{ tag: string, attributes: Record<string, string> }>} chain - ancestor chain, element last.
 * @param {string} property - the property to resolve.
 * @returns {{ value: string, important: boolean, selector: string, matched: boolean, inheritedFrom?: string }|null} the resolution, or null when nothing sets it.
 */
export function resolve(rules, chain, property) {
  /** @type {{ value: string, important: boolean, selector: string, specificity: [number, number, number], order: number }|null} */
  let winner = null;

  /**
   * walk every rule and keep the strongest declaration that matches `prefix`.
   *
   * @param {Array<{ tag: string, attributes: Record<string, string> }>} prefix - the chain slice that participates.
   * @param {boolean} requireTarget - when true, only selectors that target the LAST entry of `prefix` count as a match.
   * @returns {{ value: string, important: boolean, selector: string, specificity: [number, number, number], order: number }|null} the winner.
   */
  const bestFor = (prefix, requireTarget) => {
    /** @type {typeof winner} */
    let best = null;
    if (prefix.length === 0) return null;
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        if (!selectorMatches(selector, prefix)) continue;
        if (requireTarget && !selectorTargetsElement(selector, prefix)) continue;
        for (const declaration of rule.declarations) {
          if (declaration.property !== property) continue;
          const candidate = {
            value: declaration.value,
            important: declaration.important,
            selector,
            specificity: specificityOf(selector),
            order: rule.order
          };
          if (best === null) {
            best = candidate;
            continue;
          }
          if (candidate.important !== best.important) {
            if (candidate.important) best = candidate;
            continue;
          }
          const comparison = compareSpecificity(candidate.specificity, best.specificity);
          if (comparison > 0 || (comparison === 0 && candidate.order >= best.order)) best = candidate;
        }
      }
    }
    return best;
  };

  /* A declaration only counts as `matched` when its selector's FINAL compound
     targets this element. A rule that matches an ancestor and relies on
     inheritance is reported as such — conflating the two hides an element's own
     rule behind an ancestor's, which is precisely the bug class this evaluator
     exists to catch. */
  winner = bestFor(chain, true);
  if (winner !== null) {
    return { value: winner.value, important: winner.important, selector: winner.selector, matched: true };
  }
  const inherited = bestFor(chain, false);
  if (inherited === null) return null;
  return {
    value: inherited.value,
    important: inherited.important,
    selector: inherited.selector,
    matched: false,
    inheritedFrom: inherited.selector
  };
}
