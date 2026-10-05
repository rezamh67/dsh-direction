# Vendored upstream tooling

These files are **not** part of dsh-direction. They are verbatim copies of the
community naming-profile tooling from
[`oh-my-dsh/dsh-plugin-upgrade-skill`](https://github.com/oh-my-dsh/dsh-plugin-upgrade-skill),
vendored so that `pnpm run check:naming` is reproducible offline and reviews can
diff what was checked against.

| File | Upstream path |
|---|---|
| `validate-names.mjs` | `skills/plugin-write/scripts/validate-names.mjs` |
| `references/naming-policy.v1.json` | `skills/plugin-write/references/naming-policy.v1.json` |
| `references/plugin-naming.schema.json` | `skills/plugin-write/references/plugin-naming.schema.json` |

**Upstream revision:** the `main` branch as fetched on 2026-09-28 (repository
tree SHA `ef075767b476e8000c716a18f848028eebcd5aef`).

The policy file's own `officialBaseline` records the Harness revision it was
verified against (`dsh-v0.1.2-alpha.2`, commit
`0a53fb55bea101816fa226bb964ae2bed71c343b`), which is older than the Harness
this plugin targets. Treat a naming verdict as advisory and re-verify against
the exact target release.

To refresh: re-download the three files from the upstream paths above, re-run
`node scripts/check-naming.mjs`, and update the revision line here.

`scripts/check-naming.mjs` invokes the validator with an explicit `--policy`
path, because the validator otherwise looks for `references/` beside the
repository root rather than beside itself.
