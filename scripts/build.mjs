#!/usr/bin/env node
/**
 * The dsh-direction build: `src/` → `dist/`.
 *
 * Deliberately dependency-free. The plugin's requirement is narrower than a
 * general bundler's: every relative import must be inlined, every bare
 * specifier must become a call against the DSH client module table at
 * materialization time, and the result must be exactly one
 * `window.__ModuleLoader__.load({id, factory})` registration. A few hundred
 * lines of ESM keeps the build reproducible on a machine that has nothing but
 * Node — no install step stands between a checkout and a working plugin.
 *
 * The transform is statement-level (never a blind regex over the whole file),
 * so a `from` inside a string or a comment cannot corrupt the bundle, and a
 * post-transform assertion fails the build rather than shipping a bundle with a
 * statement the transform did not understand.
 *
 * Output:
 *   dist/index.js          the host half (verbatim ESM, loaded by the Loader)
 *   dist/client.js         the wrapped client bundle
 *   dist/client.js.map     a source map naming every inlined module
 *   dist/cordis.patch.yml  the bundle patch
 *   dist/package.json      the published manifest
 *   dist/README.md, dist/LICENSE
 *
 * @module dsh-direction/build
 */

import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const SRC = path.join(ROOT, 'src');
const DIST = path.join(ROOT, 'dist');

/** The client entry whose import graph is inlined. */
const CLIENT_ENTRY = 'client.js';

/**
 * One `import` statement at the start of a line:
 * `import <clause> from '<specifier>'` or `import '<specifier>'`.
 * Group 1 is the clause (absent for a side-effect import), group 3 the specifier.
 */
const IMPORT_STATEMENT = /^[ \t]*import\s+(?:([\s\S]*?)\s+from\s+)?(['"])([^'"]+)\2\s*;?[ \t]*$/gm;

/**
 * One `export <clause> from '<specifier>'` re-export statement. Like an import,
 * it must reach `from` on the same line: a re-export clause is always on one
 * line in this repository, and requiring that keeps the pattern from matching
 * across an unrelated declaration.
 */
const EXPORT_FROM_STATEMENT = /^[ \t]*export\s+([^{}\n]*(?:\{[^}\n]*\})?[^{}\n]*?)\s+from\s+(['"])([^'"]+)\2\s*;?[ \t]*$/gm;

/** One `export default <expression>` statement. */
const EXPORT_DEFAULT_STATEMENT = /^[ \t]*export\s+default[ \t]+([^\n]*?);?[ \t]*$/gm;

/** One `export const|let|var <declarators> = <initializer>` statement. */
const EXPORT_VARIABLE_STATEMENT = /^[ \t]*export\s+(const|let|var)[ \t]+([^=\n]+?)[ \t]*=[ \t]*([\s\S]*?);?[ \t]*$/gm;

/** One `export function`/`export async function`/`export class` declaration. */
const EXPORT_DECLARATION = /^[ \t]*export\s+(?:async\s+)?(function\s*\*?|class)[ \t]+([A-Za-z_$][\w$]*)/gm;

/** One `export { a, b as c };` clause with no `from`. */
const EXPORT_BARE_CLAUSE = /^[ \t]*export\s*\{([^}\n]*)\}[ \t]*;?[ \t]*$/gm;

/** Any residual ESM syntax, used only by the post-transform assertion. */
const RESIDUAL_ESM = /^[ \t]*(?:import|export)\s/m;

/**
 * Replace every top-level `export` declaration with a plain declaration and
 * collect the names it binds, so the registry factory can publish them through
 * its own `exports` object at the end of the module body.
 *
 * The registry wrapper already passes `module` and `exports`, so a transform is
 * all that is needed — and because every binding in this bundle is a `const`,
 * `let` or `function` with a static name, no temporary rewrites are required.
 *
 * @param {string} id - module id, for diagnostics.
 * @param {string} source - module source with imports already rewritten.
 * @returns {{ body: string, names: string[] }} the stripped body and its exports.
 */
function stripExports(id, source) {
  /** @type {string[]} */
  const names = [];

  /* Each form is matched by its own anchored pattern instead of one generic
     `export\s+` prefix. A single generic pattern is what makes this class of
     transform dangerous: `export` followed by whitespace also occurs inside a
     string, a comment, or a JSDoc line, and the match then silently swallows
     unrelated source. Requiring the actual declaration keyword makes every
     replacement decidable by inspection. */
  let body = source.replace(EXPORT_DEFAULT_STATEMENT, (whole, expression) => {
    names.push('default');
    return `const __default__ = ${expression.trim()};`;
  });

  body = body.replace(EXPORT_VARIABLE_STATEMENT, (whole, keyword, declarators, initializer) => {
    for (const name of declaredNames(declarators)) names.push(name);
    return `${keyword} ${declarators.trim()} = ${initializer}`;
  });

  body = body.replace(EXPORT_DECLARATION, (whole, kind, local) => {
    names.push(local);
    return whole.replace(/^([ \t]*)export\s+/, '$1');
  });

  /* `export { a, b as c }` re-exports the local binding, but the local may have
     been introduced by the re-export transform with exactly that name, so the
     name is published directly instead of being collected. */
  body = body.replace(EXPORT_BARE_CLAUSE, (_whole, clause) => {
    /** @type {string[]} */
    const lines = [];
    for (const entry of String(clause).split(',')) {
      const name = entry.trim();
      if (name === '') continue;
      const aliased = /^(\S+)\s+as\s+(\S+)$/.exec(name);
      const local = aliased === null ? name : aliased[2];
      const exported = aliased === null ? name : aliased[1];
      lines.push(`exports[${JSON.stringify(exported)}] = ${local};`);
    }
    return lines.join('\n');
  });

  return { body, names };
}

/**
 * The top-level binding names of one declarator list such as
 * `a = 1, b = 2` or `{ x } = y`.
 *
 * @param {string} declarators - the text after `const`/`let`/`var`.
 * @returns {string[]} binding names.
 */
function declaredNames(declarators) {
  /** @type {string[]} */
  const names = [];
  for (const part of splitTopLevel(declarators)) {
    const name = /^([A-Za-z_$][\w$]*)/.exec(part.trim());
    if (name !== null) names.push(name[1]);
  }
  return names;
}

/**
 * Split a declarator list on top-level commas, ignoring commas inside braces,
 * brackets, parentheses and string literals.
 *
 * @param {string} text - the declarator list text.
 * @returns {string[]} the parts.
 */
function splitTopLevel(text) {
  /** @type {string[]} */
  const parts = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote !== '') {
      if (character === '\\') index += 1;
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }
    if (character === '{' || character === '[' || character === '(') depth += 1;
    else if (character === '}' || character === ']' || character === ')') depth -= 1;
    else if (character === ',' && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.filter((part) => part.trim() !== '');
}


/**
 * A stable, identifier-safe key for one module id.
 *
 * @param {string} id - module id relative to src/, POSIX separators.
 * @returns {string} the key.
 */
function moduleKey(id) {
  return `m_${id.replace(/\.js$/, '').replace(/[^A-Za-z0-9]+/g, '_')}`;
}

/**
 * Resolve a relative specifier against the importing module's id.
 *
 * @param {string} importer - module id of the importing file.
 * @param {string} specifier - the raw specifier.
 * @returns {string} the target module id.
 */
function resolveRelative(importer, specifier) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
}

/**
 * Split an import clause into the locals it binds.
 *
 * Handles default, named (with `as`), namespace, and default+named — the four
 * shapes the ES grammar allows — and emits `<slot>` as the placeholder for the
 * module-table lookup, which the caller substitutes.
 *
 * @param {string} clause - the text between `import` and `from`.
 * @returns {string[]} one declaration per bound local, in clause order.
 */
function clauseToDeclarations(clause) {
  const text = clause.trim();
  /** @type {string[]} */
  const lines = [];
  if (text === '') return lines;

  const braceIndex = text.indexOf('{');
  const head = (braceIndex === -1 ? text : text.slice(0, braceIndex)).trim().replace(/,$/, '').trim();
  const tail = braceIndex === -1 ? '' : text.slice(braceIndex);

  if (head.startsWith('*')) {
    const local = head.replace(/^\*\s*as\s*/, '').trim();
    if (local !== '') lines.push(`const ${local} = <slot>;`);
  } else if (head !== '') {
    lines.push(`const ${head} = <slot>.default;`);
  }

  if (tail !== '') {
    const inner = tail.replace(/^\{/, '').replace(/\}\s*$/, '');
    for (const entry of inner.split(',')) {
      const name = entry.trim();
      if (name === '') continue;
      const match = /^(\S+)\s+as\s+(\S+)$/.exec(name);
      const imported = match === null ? name : match[1];
      const local = match === null ? name : match[2];
      lines.push(`const ${local} = <slot>[${JSON.stringify(imported)}];`);
    }
  }
  return lines;
}

/**
 * Marks the one module that consumes the bundle's `require` binding.
 * Tested against the module body AFTER the export transform ran, so the marker
 * is the plain (export-stripped) declaration, not the source spelling.
 */
const REQUIRE_BINDING_STATEMENT = /^[ \t]*function\s+setRequireBinding\s*\(/m;

/**
 * Rewrite one module body into registry-factory form.
 *
 * @param {string} id - module id.
 * @param {string} source - module source.
 * @param {Set<string>} inlined - every module id present in the registry.
 * @param {Set<string>} externals - bare specifiers collected from the graph.
 * @returns {string} the rewritten body.
 */
function rewriteModule(id, source, inlined, externals) {
  /** @type {string[]} */
  const prelude = [];

  const body = source.replace(IMPORT_STATEMENT, (whole, clause, _quote, specifier) => {
    if (specifier.startsWith('node:')) {
      throw new Error(`build: "${id}" imports the Node builtin "${specifier}", which cannot exist in a browser bundle`);
    }
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    if (isRelative && !inlined.has(resolveRelative(id, specifier))) {
      throw new Error(`build: "${specifier}" from "${id}" was not inlined`);
    }
    if (!isRelative && !externals.has(specifier)) {
      throw new Error(`build: "${specifier}" from "${id}" is external but was never collected`);
    }
    const slot = isRelative ? `__load(${JSON.stringify(moduleKey(resolveRelative(id, specifier)))})` : `__external(${JSON.stringify(specifier)})`;
    if (clause === undefined || clause.trim() === '') {
      prelude.push(`${slot};`);
      return '';
    }
    for (const line of clauseToDeclarations(clause)) prelude.push(line.replace('<slot>', slot));
    return '';
  });

  const withReExports = body.replace(EXPORT_FROM_STATEMENT, (whole, clause, _quote, specifier) => {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      throw new Error(`build: "${id}" re-exports the bare module "${specifier}"; import it and re-export the binding instead`);
    }
    const target = resolveRelative(id, specifier);
    if (!inlined.has(target)) throw new Error(`build: re-export "${specifier}" from "${id}" was not inlined`);
    const slot = `__load(${JSON.stringify(moduleKey(target))})`;
    const inner = clause.trim();
    if (inner.startsWith('*')) {
      const local = inner.replace(/^\*\s*as\s*/, '').trim();
      return `const ${local} = ${slot};`;
    }
    const names = inner
      .replace(/^\{/, '')
      .replace(/\}\s*$/, '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    /* `const { a, b } = <slot>`; the exported names are re-exported below. */
    return `const { ${names.join(', ')} } = ${slot};`;
  });

  const { body: stripped, names } = stripExports(id, withReExports);
  const epilogue = names
    .map((name) => `exports[${JSON.stringify(name)}] = ${name === 'default' ? '__default__' : name};`)
    .join('\n');
  /* The bundle's own module-table `require` must reach src/client.js, which is
     the only module that talks to the table. It is handed over at the END of the
     module body: the receiving module declares the cell it stores the binding in,
     and a `let`/`const` is in its temporal dead zone until its declaration is
     evaluated. This is threaded by name rather than through a global, so the
     generated code keeps no hidden state. */
  const needsRequire = REQUIRE_BINDING_STATEMENT.test(stripped) ? '\nsetRequireBinding(__moduleTableRequire);' : '';
  const assembled = [prelude.join('\n'), stripped, epilogue]
    .filter((part) => part.trim() !== '')
    .join('\n')
    .concat(needsRequire);

  if (RESIDUAL_ESM.test(assembled)) {
    throw new Error(
      `build: "${id}" still contains ESM syntax the transform did not understand — ` +
        'keep import/export clauses on a single statement and avoid comments inside them'
    );
  }
  return assembled;
}

/**
 * Every module specifier named by an import or re-export in one source file.
 *
 * @param {string} source - module source.
 * @returns {string[]} the specifiers, in source order.
 */
function specifiersOf(source) {
  /** @type {string[]} */
  const found = [];
  for (const pattern of [IMPORT_STATEMENT, EXPORT_FROM_STATEMENT]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) found.push(match[3]);
  }
  return found;
}

/**
 * Collect the transitive relative-import graph rooted at one entry.
 *
 * @param {string} entry - entry module id inside src/.
 * @returns {Promise<{ order: string[], sources: Map<string, string>, externals: Set<string> }>} the graph.
 */
async function collect(entry) {
  /** @type {Map<string, string>} */
  const sources = new Map();
  /** @type {Set<string>} */
  const externals = new Set();
  /** @type {string[]} */
  const order = [];
  /** @type {Set<string>} */
  const seen = new Set();

  /**
   * Depth-first walk in dependency-first order.
   *
   * @param {string} id - module id to load.
   * @returns {Promise<void>} resolves once the subtree is recorded.
   */
  async function walk(id) {
    if (seen.has(id)) return;
    seen.add(id);
    const absolute = path.join(SRC, id);
    if (!existsSync(absolute)) throw new Error(`build: "${id}" does not exist under src/`);
    const source = await readFile(absolute, 'utf8');
    for (const specifier of specifiersOf(source)) {
      if (specifier.startsWith('./') || specifier.startsWith('../')) await walk(resolveRelative(id, specifier));
      else if (!specifier.startsWith('node:')) externals.add(specifier);
    }
    sources.set(id, source);
    order.push(id);
  }

  await walk(entry);
  return { order, sources, externals };
}

/**
 * Indent every non-empty line of a block.
 *
 * @param {string} text - block text.
 * @param {number} spaces - indent width.
 * @returns {string} indented text.
 */
function indent(text, spaces) {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.trim() === '' ? '' : pad + line))
    .join('\n');
}

/**
 * Render the client bundle: the module registry plus the single module-table
 * registration. The entry module's exports are returned from the factory.
 *
 * @param {{ order: string[], sources: Map<string, string>, externals: Set<string> }} graph - import graph.
 * @param {string} pluginId - module-table id (the npm package name).
 * @returns {string} the bundle source.
 */
function renderBundle(graph, pluginId) {
  const inlined = new Set(graph.order);
  const registry = graph.order
    .map((id) => {
      const rewritten = rewriteModule(id, graph.sources.get(id) ?? '', inlined, graph.externals);
      return (
        `    /* ---- src/${id} ---- */\n` +
        `    __modules[${JSON.stringify(moduleKey(id))}] = (module, exports, __moduleTableRequire, __load) => {\n` +
        `${indent(rewritten, 6)}\n` +
        '    };'
      );
    })
    .join('\n\n');
  const entryKey = moduleKey(graph.order[graph.order.length - 1]);

  return `/* Generated by scripts/build.mjs -- do not edit; edit src/ and rebuild. */
window.__ModuleLoader__.load({
  id: ${JSON.stringify(pluginId)},
  factory: (__moduleTableRequire) => {
    /* Names in this wrapper are deliberately distinct from every name the
       module bodies below introduce. An earlier revision reused \`require\` for
       both the module-table binding and the internal registry lookup; each
       module factory's own parameter then shadowed the other one, and the
       failure was silent because both are callable. Keeping the three names
       apart is load-bearing, not cosmetic. */    const __external = (specifier) => __moduleTableRequire(specifier);
    const __modules = {};
    const __cache = {};
    const __load = (key) => {
      if (Object.prototype.hasOwnProperty.call(__cache, key)) return __cache[key];
      const factory = __modules[key];
      if (factory === undefined) throw new Error('dsh-direction: unknown bundled module "' + key + '"');
      const module = { exports: {} };
      __cache[key] = module.exports;
      factory(module, module.exports, __moduleTableRequire, __load);
      __cache[key] = module.exports;
      return module.exports;
    };

${registry}

    return __load(${JSON.stringify(entryKey)});
  }
});
`;
}

/**
 * A source map naming every inlined module, so a browser devtool shows the real
 * file. The mapping is intentionally empty: the output keeps every line of
 * every source, only re-indented and preceded by a prelude.
 *
 * @param {string[]} order - module ids in registry order.
 * @returns {string} the source map JSON.
 */
function renderSourceMap(order) {
  return JSON.stringify({
    version: 3,
    file: 'client.js',
    sources: order.map((id) => `../src/${id}`),
    names: [],
    mappings: '',
    x_dsh_direction: { note: 'unminified concatenation; module bodies appear in registry order' }
  });
}

/**
 * Run the build.
 *
 * @returns {Promise<void>} resolves once dist/ is complete.
 */
async function main() {
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const graph = await collect(CLIENT_ENTRY);
  const declared = new Set(pkg.dsh?.client?.external ?? []);
  for (const specifier of graph.externals) {
    if (!declared.has(specifier)) {
      throw new Error(
        `build: "${specifier}" is imported by the client bundle but not declared in dsh.client.external — ` +
          'add it to package.json so the host orders the providing row before this one'
      );
    }
  }

  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  await writeFile(path.join(DIST, 'client.js'), renderBundle(graph, pkg.name), 'utf8');
  await writeFile(path.join(DIST, 'client.js.map'), renderSourceMap(graph.order), 'utf8');
  await writeFile(path.join(DIST, 'index.js'), await readFile(path.join(SRC, 'index.js'), 'utf8'), 'utf8');
  await copyFile(path.join(ROOT, 'cordis.patch.yml'), path.join(DIST, 'cordis.patch.yml'));
  await copyFile(path.join(ROOT, 'README.md'), path.join(DIST, 'README.md'));
  if (existsSync(path.join(ROOT, 'LICENSE'))) await copyFile(path.join(ROOT, 'LICENSE'), path.join(DIST, 'LICENSE'));

  const published = {
    ...pkg,
    main: 'index.js',
    exports: {
      '.': { default: './index.js' },
      './client': { default: './client.js' },
      './package.json': './package.json'
    },
    files: ['index.js', 'client.js', 'client.js.map', 'cordis.patch.yml', 'README.md', 'LICENSE']
  };
  delete published.scripts;
  delete published.devDependencies;
  await writeFile(path.join(DIST, 'package.json'), `${JSON.stringify(published, null, 2)}\n`, 'utf8');

  const files = (await readdir(DIST)).sort();
  console.log(`dsh-direction: built ${graph.order.length} client modules + host half`);
  console.log(`  inlined : ${graph.order.join(', ')}`);
  console.log(`  external: ${[...graph.externals].join(', ') || '(none)'}`);
  console.log(`  dist/   : ${files.join(', ')}`);
}

await main();
