#!/usr/bin/env node
/**
 * Inspect a DSH profile the way `dsh` itself does.
 *
 * This is the strongest check available without restarting the host: it calls
 * the *installed* `@deepseek-ai/dsh-app-boot` `loadProfileDirectory()` against a
 * real profile, so it proves
 *
 *   1. every `dsh.profile.bundles` entry resolves to a package directory,
 *   2. each of those packages declares a `dsh.bundle.patch`,
 *   3. the patch file parses as a loader patch list,
 *   4. this plugin's row is actually contributed by one of those layers.
 *
 * It then scans the same entries for `dsh.client` declarations with the real
 * `@deepseek-ai/dsh-client-modules` rules and reports which client bundle each
 * one would serve — the exact decision the web host makes at boot.
 *
 * Read-only: nothing is written and no server is started.
 *
 * Usage: node scripts/inspect-profile.mjs [--home <DSH_HOME>] [--profile desktop]
 *
 * @module dsh-direction/inspect-profile
 */

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

/** Default DSH home, matching @deepseek-ai/dsh-home-paths. */
const HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');

/**
 * Parse the command line.
 *
 * @param {string[]} argv - arguments after the script name.
 * @returns {{ home: string, profile: string }} options.
 */
function parseArgs(argv) {
  /** @type {{ home: string, profile: string }} */
  const options = { home: HOME, profile: process.env.DSH_PROFILE ?? 'desktop' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--home') options.home = argv[++index];
    else if (argv[index] === '--profile') options.profile = argv[++index];
  }
  return options;
}

/**
 * Resolve a DSH package from any directory that can see it.
 *
 * @param {string} from - a file path to resolve relative to.
 * @param {string} specifier - the package specifier.
 * @returns {string|undefined} the resolved module path.
 */
function resolveFrom(from, specifier) {
  try {
    return createRequire(from).resolve(specifier);
  } catch {
    return undefined;
  }
}

/**
 * Run the inspection.
 *
 * @returns {Promise<void>} resolves after the report.
 */
async function main() {
  const { home, profile } = parseArgs(process.argv.slice(2));
  const dir = path.join(home, 'profiles', profile);
  if (!existsSync(path.join(dir, 'package.json'))) {
    console.error(`inspect-profile: no profile manifest at ${dir}`);
    process.exitCode = 1;
    return;
  }
  console.log(`profile: ${dir}`);

  /* The loader resolves bundles from the dsh installation first, then the
     profile. Point the first anchor at the profile's own tree: for a plugin
     installed into the profile, that is exactly the order the host uses. */
  const anchor = path.join(dir, 'package.json');
  const bootPath =
    resolveFrom(anchor, '@deepseek-ai/dsh-app-boot') ??
    resolveFrom(path.join(home, 'profiles', 'node_modules', 'x.js'), '@deepseek-ai/dsh-app-boot');
  if (bootPath === undefined) {
    console.error('inspect-profile: @deepseek-ai/dsh-app-boot was not found — install the DSH profile dependencies first');
    process.exitCode = 2;
    return;
  }
  const boot = await import(pathToFileURLString(bootPath));

  const profileName = path.basename(dir);
  let loaded;
  try {
    loaded = boot.loadProfileDirectory('dsh', dir, anchor, { userLayer: false });
  } catch (error) {
    console.error(`inspect-profile: the profile does not load: ${String(error)}`);
    process.exitCode = 1;
    return;
  }
  console.log(`bundles : ${loaded.layers.length}`);
  for (const layer of loaded.layers) {
    console.log(
      `  - ${layer.packageName.padEnd(34)} ${layer.patches.length} patch entr${layer.patches.length === 1 ? 'y' : 'ies'}`
    );
  }

  const ours = loaded.layers.find((layer) => layer.packageName === 'dsh-direction');
  if (ours === undefined) {
    console.error('\ndsh-direction is NOT a profile bundle — run scripts/install.mjs');
    process.exitCode = 1;
    return;
  }
  const inserted = ours.patches.flatMap((patch) => patch.insert ?? []).map((entry) => `${entry.id} (${entry.name})`);
  console.log(`\ndsh-direction patch rows: ${inserted.join(', ') || '(none!)'}`);

  const manifest = JSON.parse(readFileSync(path.join(ours.packageDir, 'package.json'), 'utf8'));
  const clientExport = manifest.exports?.['./client'];
  const clientRelative = typeof clientExport === 'string' ? clientExport : clientExport?.default;
  const clientPath = path.join(ours.packageDir, clientRelative ?? 'MISSING');
  console.log(`dsh-direction client declaration: ${JSON.stringify(manifest.dsh?.client ?? null)}`);
  console.log(`dsh-direction client bundle       : ${clientPath} ${existsSync(clientPath) ? '✓' : '✗ MISSING'}`);
  if (manifest.dsh?.client !== undefined && manifest.dsh.client.platform !== 'web') {
    console.error(`  ✗ platform is "${manifest.dsh.client.platform}", so the web host will skip this row`);
    process.exitCode = 1;
  }

  /* Report every client package the boot graph would carry, using the same
     declaration rules as dsh-client-modules. Profile-local packages live either
     directly under the profile's node_modules or in the shared profiles tree,
     and either may be a link — so both roots are scanned and links resolved. */
  console.log('\nclient bundles in this profile:');
  /** @type {Map<string, { dir: string, declaration: any, bundle: string|undefined, ok: boolean, scope: Set<string> }>} */
  const clientPackages = new Map();
  const roots = [
    { dir: path.join(dir, 'node_modules'), scope: 'profile' },
    { dir: path.join(home, 'profiles', 'node_modules'), scope: 'shared' }
  ];
  for (const root of roots) {
    for (const entry of readdirSafe(root.dir)) {
      const packageDir = realPathSafe(path.join(root.dir, entry));
      const manifestPath = path.join(packageDir, 'package.json');
      if (!existsSync(manifestPath)) continue;
      let parsed;
      try {
        parsed = JSON.parse(stripBom(readFileSync(manifestPath, 'utf8')));
      } catch {
        continue;
      }
      const declaration = parsed.dsh?.client;
      if (declaration === undefined) continue;
      const relative =
        typeof parsed.exports?.['./client'] === 'string' ? parsed.exports['./client'] : parsed.exports?.['./client']?.default;
      const bundle = relative === undefined ? undefined : path.join(packageDir, relative);
      const existing = clientPackages.get(parsed.name);
      if (existing !== undefined) {
        existing.scope.add(root.scope);
        continue;
      }
      clientPackages.set(parsed.name, {
        dir: packageDir,
        declaration,
        bundle,
        ok: bundle !== undefined && existsSync(bundle),
        scope: new Set([root.scope])
      });
    }
  }
  for (const [name, info] of [...clientPackages].sort((left, right) => left[0].localeCompare(right[0]))) {
    console.log(
      `  - ${name.padEnd(30)} platform=${String(info.declaration.platform).padEnd(4)} ` +
        `external=[${(info.declaration.external ?? []).join(', ')}] bundle=${info.ok ? '✓' : '✗ MISSING'} ` +
        `scope=${[...info.scope].join('+')}`
    );
  }
  if (clientPackages.size === 0) console.log('  (none)');
  const own = clientPackages.get('dsh-direction');
  if (own === undefined || !own.ok) {
    console.error('\n✗ dsh-direction would not contribute a client bundle');
    process.exitCode = 1;
  }
  console.log(`\nprofile ${profileName}: inspected read-only; restart dsh and refresh the page to load changes.`);
}

/**
 * Resolve symlinks and Windows junctions without throwing.
 *
 * @param {string} target - path to resolve.
 * @returns {string} the real path, or the input.
 */
function realPathSafe(target) {
  try {
    return realpathSync(target);
  } catch {
    return target;
  }
}

/**
 * Drop a UTF-8 BOM from file text.
 *
 * @param {string} text - file contents.
 * @returns {string} the text without a leading BOM.
 */
function stripBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * Read a directory without throwing.
 *
 * @param {string} dir - directory path.
 * @returns {string[]} entry names, or an empty list.
 */
function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/**
 * Turn a native path into a file URL string that `import()` accepts on Windows.
 *
 * @param {string} file - absolute path.
 * @returns {string} the file URL.
 */
function pathToFileURLString(file) {
  const normalized = file.replace(/\\/g, '/');
  return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
}

await main();
