#!/usr/bin/env node
/**
 * Run the community naming profile against this plugin's declaration.
 *
 * The validator and the policy it reads are owned by the community
 * `dsh-plugin-upgrade-skill` repository, not by this plugin, so they are
 * vendored into `scripts/upstream/` unmodified and the exact upstream revision
 * is recorded in `scripts/upstream/PROVENANCE.md`.
 *
 * The validator needs `references/naming-policy.v1.json` beside itself, and
 * resolves that path relative to ITS OWN location — so this wrapper points it at
 * the vendored copy instead of expecting a `references/` directory in the
 * plugin root.
 *
 * Exit status: 0 compatible, 1 errors (or warnings under `--strict`), 2 invalid
 * arguments. Warnings are reported but do not fail the default run: this plugin
 * deliberately keeps the published package name and the recommended-prefix rule
 * is a collision *recommendation*, not a compatibility requirement.
 *
 * Usage: node scripts/check-naming.mjs [--strict] [--json]
 *
 * @module dsh-direction/check-naming
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const VALIDATOR = path.join(HERE, 'upstream', 'validate-names.mjs');
const POLICY = path.join(HERE, 'upstream', 'references', 'naming-policy.v1.json');
const MANIFEST = path.join(ROOT, 'dsh-plugin.naming.json');

for (const [label, file] of [
  ['validator', VALIDATOR],
  ['policy', POLICY],
  ['manifest', MANIFEST]
]) {
  if (!existsSync(file)) {
    console.error(`check-naming: the ${label} is missing at ${file}`);
    process.exitCode = 2;
    process.exit();
  }
}

/* The validator derives its default policy path from its own location, so the
   vendored tree must mirror the upstream layout. */
const result = spawnSync(process.execPath, [VALIDATOR, '--manifest', MANIFEST, '--policy', POLICY, ...process.argv.slice(2)], {
  stdio: 'inherit'
});
process.exit(result.status ?? 2);
