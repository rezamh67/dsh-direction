#!/usr/bin/env node
/**
 * Install dsh-direction into a DSH profile.
 *
 * Three writes, all inside `<DSH_HOME>/profiles/<name>/`, and nothing else:
 *
 *   1. node_modules/dsh-direction/   the built package (copy, or a link)
 *   2. profiles/<name>/package.json  add the dependency and the bundle row
 *   3. (nothing — the patch ships inside the package, and the profile's own
 *      cordis.patch.yml is never touched)
 *
 * A DSH profile marks a package as a bundle through `dsh.profile.bundles`, and
 * the bundle's own `cordis.patch.yml` is then applied as a loader patch layer.
 * That is the only supported way for an external package to add a Loader row, so
 * this script edits exactly those two fields and leaves every other byte of the
 * profile alone.
 *
 * Usage:
 *   node scripts/install.mjs [--profile desktop] [--home <DSH_HOME>]
 *                            [--link] [--keep-patch] [--uninstall] [--dry-run]
 *
 * @module dsh-direction/install
 */

import { cp, lstat, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** Default DSH home, matching @deepseek-ai/dsh-home-paths. */
const DEFAULT_HOME = process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh');

/**
 * Parse the command line.
 *
 * @param {string[]} argv - `process.argv.slice(2)`.
 * @returns {{ profile: string, home: string, link: boolean, uninstall: boolean, dryRun: boolean, keepPatch: boolean }} options.
 */
function parseArgs(argv) {
  /** @type {{ profile: string, home: string, link: boolean, uninstall: boolean, dryRun: boolean, keepPatch: boolean, allProfiles: boolean, explicitProfile: boolean }} */
  const options = {
    /* The ACTIVE profile is the one to default to. A profile is not a global
       setting: `dsh web` reads DSH_PROFILE at startup, so installing into a
       different profile than the running server is a silent no-op that looks
       exactly like a broken plugin. */
    profile: process.env.DSH_PROFILE ?? 'desktop',
    home: DEFAULT_HOME,
    link: false,
    uninstall: false,
    dryRun: false,
    keepPatch: false,
    allProfiles: false,
    explicitProfile: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    if (flag === '--profile' && next !== undefined) {
      options.profile = next;
      options.explicitProfile = true;
      index += 1;
    } else if (flag === '--home' && next !== undefined) {
      options.home = next;
      index += 1;
    } else if (flag === '--all-profiles') options.allProfiles = true;
    else if (flag === '--link') options.link = true;
    else if (flag === '--uninstall') options.uninstall = true;
    else if (flag === '--dry-run') options.dryRun = true;
    else if (flag === '--keep-patch') options.keepPatch = true;
    else if (flag === '--help' || flag === '-h') {
      console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('@module')[0].split('/**')[1]);
      process.exit(0);
    } else {
      throw new Error(`install: unknown argument "${flag}" (try --help)`);
    }
  }
  return options;
}

/**
 * Every profile in the Harness home that has a manifest.
 *
 * @param {string} home - the DSH home.
 * @returns {string[]} profile names.
 */
function listProfiles(home) {
  const root = path.join(home, 'profiles');
  if (!existsSync(root)) return [];
  return readdirSync(root).filter((entry) => existsSync(path.join(root, entry, 'package.json')));
}

/**
 * Resolve the profile directory and refuse to continue when it does not exist,
 * so a typo in `--profile` cannot create a half-profile somewhere unexpected.
 *
 * @param {string} home - the DSH home.
 * @param {string} profile - the profile name.
 * @returns {string} the absolute profile directory.
 */
function profileDir(home, profile) {
  const dir = path.join(home, 'profiles', profile);
  if (!existsSync(dir)) {
    const names = listProfiles(home);
    throw new Error(
      `install: no profile at ${dir}${names.length > 0 ? ` (available: ${names.join(', ')})` : ''}\n` +
        '         pass --profile <name> or --home <DSH_HOME>'
    );
  }
  return dir;
}

/**
 * Force a forward-slash relative path, which is what npm/pnpm manifests use.
 *
 * @param {string} value - a path.
 * @returns {string} the path with forward slashes.
 */
function toPosix(value) {
  return value.split(path.sep).join('/');
}

/**
 * Place the built package inside the profile's node_modules.
 *
 * @param {object} options - installation options.
 * @param {string} target - the destination directory.
 * @returns {Promise<'copied'|'linked'>} what was done.
 */
async function placePackage({ link, dryRun }, target) {
  if (dryRun) return link ? 'linked' : 'copied';
  await rm(target, { recursive: true, force: true });
  await mkdir(path.dirname(target), { recursive: true });
  if (link) {
    /* A junction on Windows and a directory symlink elsewhere: both keep the
       profile reading the live build, which is what a link install is for. */
    await symlink(ROOT, target, process.platform === 'win32' ? 'junction' : 'dir');
    return 'linked';
  }
  await cp(path.join(ROOT, 'dist'), target, { recursive: true });
  return 'copied';
}

/**
 * Parse JSON that may carry a UTF-8 BOM (Windows editors add one).
 *
 * @param {string} text - raw file contents.
 * @returns {any} the parsed value.
 */
function parseJson(text) {
  return JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
}

/**
 * Read and shape the profile manifest.
 *
 * @param {string} file - absolute path to the profile package.json.
 * @returns {Promise<any>} the parsed manifest.
 */
async function readProfileManifest(file) {
  const manifest = parseJson(await readFile(file, 'utf8'));
  manifest.dependencies ??= {};
  manifest.dsh ??= {};
  manifest.dsh.profile ??= {};
  manifest.dsh.profile.bundles ??= [];
  return manifest;
}

/**
 * Install the plugin into one profile.
 *
 * @param {ReturnType<typeof parseArgs>} options - parsed command line.
 * @param {string} profile - the profile name to write.
 * @returns {Promise<void>} resolves after the report.
 */
async function installInto(options, profile) {
  const dir = profileDir(options.home, profile);
  const manifestPath = path.join(dir, 'package.json');
  const target = path.join(dir, 'node_modules', 'dsh-direction');
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const originalManifest = await readFile(manifestPath, 'utf8');
  const manifest = await readProfileManifest(manifestPath);

  if (!existsSync(path.join(ROOT, 'dist', 'client.js'))) {
    throw new Error('install: dist/ is missing — run `node scripts/build.mjs` first');
  }

  const mode = await placePackage(options, target);

  let changed = false;
  if (manifest.dependencies[pkg.name] !== undefined) {
    manifest.dependencies[pkg.name] = options.link ? `link:${toPosix(ROOT)}` : `file:${toPosix(target)}`;
  } else {
    /* `link:` keeps pnpm from trying to fetch the package from a registry, and
       is valid for both a copied directory and a real link. */
    manifest.dependencies[pkg.name] = `link:${toPosix(target)}`;
    changed = true;
  }
  if (!manifest.dsh.profile.bundles.includes(pkg.name)) {
    manifest.dsh.profile.bundles.push(pkg.name);
    changed = true;
  }

  if (changed) {
    if (!options.dryRun) {
      const backup = `${manifestPath}.dsh-direction.bak`;
      if (!existsSync(backup)) await writeFile(backup, originalManifest, 'utf8');
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`, 'utf8');
    }
  }

  console.log(`dsh-direction ${pkg.version} -> ${profile} profile`);
  console.log(`  package : ${mode} ${target}`);
  console.log(`  manifest: ${changed ? 'updated' : 'already current'} ${manifestPath}`);
  if (changed && !options.dryRun) console.log(`  backup  : ${manifestPath}.dsh-direction.bak`);
  console.log(`  bundles : ${manifest.dsh.profile.bundles.join(', ')}`);
}

/**
 * Install into the selected profile, or into every profile with `--all-profiles`,
 * and warn when the target is not the profile the host is actually running.
 *
 * @param {ReturnType<typeof parseArgs>} options - parsed command line.
 * @returns {Promise<void>} resolves after the report.
 */
async function install(options) {
  const active = process.env.DSH_PROFILE;
  const targets = options.allProfiles ? listProfiles(options.home) : [options.profile];
  if (options.allProfiles && targets.length === 0) {
    throw new Error(`install: no profiles with a manifest under ${path.join(options.home, 'profiles')}`);
  }

  for (const profile of targets) {
    await installInto(options, profile);
  }

  console.log(`\nDSH_PROFILE is "${active ?? '(unset)'}"; the running host reads its bundles from that profile only.`);
  if (!options.allProfiles && active !== undefined && active !== options.profile) {
    console.log(`  warning: installed into "${options.profile}" but the active profile is "${active}".`);
    console.log(`           re-run with --profile ${active} (or --all-profiles) or the host will not see the plugin.`);
  }
  console.log('\nRestart the DSH Web UI (`dsh web`) and refresh the page, or reload the profile.');
  console.log('Verify in the browser console: window.__DSH_DIRECTION__');
}

/**
 * Remove everything {@link install} wrote.
 *
 * @param {ReturnType<typeof parseArgs>} options - parsed command line.
 * @returns {Promise<void>} resolves after the report.
 */
async function uninstall(options) {
  const targets = options.allProfiles ? listProfiles(options.home) : [options.profile];
  for (const profile of targets) {
    await uninstallFrom(options, profile);
  }
}

/**
 * Remove the plugin from one profile.
 *
 * @param {ReturnType<typeof parseArgs>} options - parsed command line.
 * @param {string} profile - the profile name to clean.
 * @returns {Promise<void>} resolves after the report.
 */
async function uninstallFrom(options, profile) {
  const dir = profileDir(options.home, profile);
  const manifestPath = path.join(dir, 'package.json');
  const target = path.join(dir, 'node_modules', 'dsh-direction');
  const pkg = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const manifest = await readProfileManifest(manifestPath);

  const installed = existsSync(target);
  if (installed && !options.dryRun) await rm(target, { recursive: true, force: true });
  delete manifest.dependencies[pkg.name];
  const bundles = manifest.dsh.profile.bundles.filter((entry) => entry !== pkg.name);
  const bundlesChanged = bundles.length !== manifest.dsh.profile.bundles.length;
  manifest.dsh.profile.bundles = bundles;
  if (!options.dryRun) await writeFile(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`, 'utf8');

  console.log(`dsh-direction <- ${profile} profile`);
  console.log(`  package : ${installed ? 'removed' : 'not present'} ${target}`);
  console.log(`  manifest: bundle row ${bundlesChanged ? 'removed' : 'was not present'}`);
  console.log('\nRestart the DSH Web UI to unload the plugin.');
}

const options = parseArgs(process.argv.slice(2));
if (options.uninstall) await uninstall(options);
else await install(options);
