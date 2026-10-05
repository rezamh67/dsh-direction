# dsh-direction

**Give DeepSeek Harness a right-to-left mode.** A DSH plugin that adds an **Auto / RTL / LTR** text-direction control to the Web UI — a one-click toggle in the shell overlay, plus a Settings row for the fine details.

**به DeepSeek Harness حالت راست‌به‌چپ بده.** یک پلاگین DSH که کنترل **خودکار / RTL / LTR** را به رابط وب اضافه می‌کند — یک دکمهٔ یک‌کلیکی روی صفحه، به‌همراه یک ردیف تنظیمات برای جزئیات.

---

## Why

DSH renders every conversation left-to-right. Persian, Arabic, Hebrew and Urdu text therefore comes out with English punctuation on the wrong side: a sentence ending in `.` or `?` jumps to the front, list bullets sit on the wrong edge, and mixed English/Persian prose looks scrambled.

DSH ships no `direction` handling of its own — the shipped client bundles for `0.1.5-rc.1` contain no `dir`/`rtl`/`unicode-bidi` handling at all — so this plugin adds the whole feature from the outside, through the documented client-plugin contracts.

## What you get

| Mode | Behaviour |
|---|---|
| **Auto** (default) | Every text block is laid out by its own first strong character. Persian paragraphs read right-to-left, English paragraphs keep reading left-to-right, and code stays left-to-right. |
| **RTL** | Forces the conversation right-to-left. With the *whole interface* scope the shell mirrors too. |
| **LTR** | Explicitly forces left-to-right — the escape hatch when a block inherited the wrong direction. |

Two scopes decide **how far** a mode reaches:

| Scope | Effect |
|---|---|
| **Messages only** (default) | Only the conversation is directed. Sidebars, panels, docks and the composer keep their positions — the safest choice. |
| **Whole interface** | The document root is flipped too, so the shell mirrors (conversation on the right, sidebars swapped). Correct RTL presentation, at the cost of a mirrored application chrome. |

Text alignment is a separate knob (**Follow direction / Start edge / Justify**), and **conversation width** sets how wide the transcript and composer may grow — narrow measures read much better in RTL.

Mode, scope, alignment and width are remembered per browser and re-applied on every page load. The overlay button shows the current mode; hovering it shows the full state and the click cycle.

## Install

```sh
pnpm install
pnpm run build

# install into a DSH profile (defaults to the DSH_PROFILE env var, else `desktop`)
node scripts/install.mjs --profile desktop

# restart the DSH Web UI
dsh web
```

`scripts/install.mjs` does three things and nothing else:

1. copies `dist/` into `<DSH_HOME>/profiles/<profile>/node_modules/dsh-direction/`;
2. adds `"dsh-direction": "link:./node_modules/dsh-direction"` to that profile's `package.json` dependencies;
3. appends `dsh-direction` to `dsh.profile.bundles`, which is what makes the package's `cordis.patch.yml` apply as a loader patch layer.

It backs up the profile manifest to `package.json.dsh-direction.bak` before the first write, never touches the plugin's own `dist`, and never writes inside the DSH installation.

```sh
# prove the profile loads, using DSH's own boot code (read-only)
node scripts/inspect-profile.mjs --profile desktop

# link instead of copy, for development
node scripts/install.mjs --profile desktop --link

# remove everything the installer added
node scripts/install.mjs --profile desktop --uninstall
```

Nothing about the plugin is model-visible: no tool, no command, no service, no
session event, no log entry. It is presentation only, and uninstalling it leaves
no trace in a session.

## Use

Click the direction button in the bottom-right corner of the shell; it cycles **Auto → RTL → LTR → Auto**. Open **Settings → General** for scope, alignment and width.

From the browser console:

```js
window.__DSH_DIRECTION__.getPreference()      // { mode, scope, align, width }
window.__DSH_DIRECTION__.setMode('rtl')
window.__DSH_DIRECTION__.setScope('interface')
window.__DSH_DIRECTION__.setWidth(640)
window.__DSH_DIRECTION__.reset()
```

## Code safety

Code, terminal output and tool payloads are never mirrored. Code blocks, tables, tool payloads and diffs keep `direction: ltr` and are isolated with `unicode-bidi: isolate`, so a right-to-left page can never reverse a `diff`, a shell command or a file path — while the block itself still moves to the mode's edge. See [Known limitations](docs/COMPATIBILITY.md#known-limitations) for the composer and mixed-script cases.

## Troubleshooting

If the toggle is on screen but the page still reads left-to-right, run this in the browser console:

```js
window.__DSH_DIRECTION__.diagnose()
```

It reports the mode, the root and body attributes, whether the stylesheet is present and identical to the source, and the computed `direction`/`text-align`/`unicode-bidi` of every directed surface — enough to tell "a stale bundle is loaded" apart from "a rule lost the cascade".

## How it works

The short version:

1. **Containers** (`[data-chat-flow]`, `[data-composer-card]`, the editor) get `dir="auto"` from the controller, plus `unicode-bidi: plaintext` and `text-align: start`. The attribute is the decision; `text-align: start` is what lets that decision choose the edge — without it, `text-align` inherits `start` from the LTR shell, where `start` means left, and right-to-left text stays pinned to the left edge.
2. **Paragraph-level leaves** (`p`, `li`, headings, cells) get `unicode-bidi: plaintext`, so each block resolves its own base direction from its first strong character. That is what lets a Persian paragraph and an English paragraph in one transcript each read naturally.
3. **Code and tool payloads** are isolated with `unicode-bidi: isolate`, so their glyph order survives.
4. **A forced mode** overrides 1–2 at both the container and the leaf level.

The rules that implement 1–3 are wrapped in `:where()`, so they contribute **zero specificity** and a forced direction always outranks detection without depending on source order. That tie was the root cause of a real defect in 0.1.0: the forced rules and the detection rules targeted the same elements with equal specificity, so the winner came down to rule order.

Under `interface` scope the document root gets `dir`, and only then are two positional utilities replaced by class name (the assistant action row and the user bubble stack). Everything else inherits the mirror from the framework's own logical properties. The plugin's own overlay is deliberately outside the frame, so mirroring can never move it.

The whole stylesheet is scoped under `[data-dsh-direction]` on `<html>`, so it is inert until the controller writes that attribute — and retracting the attribute, the `dir` values and the CSS variable on unload restores the document exactly.

## Layout

```
dsh-direction/
├── package.json              # dsh.bundle + dsh.client declarations
├── cordis.patch.yml          # the single Loader insert row
├── src/
│   ├── index.js              # host half: mounts the client bundle, logs the version
│   ├── client.js             # client entry: registers the overlay + settings seats
│   ├── direction.js          # mode/scope/align/width state, persistence, DOM applier
│   ├── styles.js             # the injected stylesheet
│   ├── store.js              # the shared observable the two seats read
│   ├── overlay-button.js     # the floating toggle
│   ├── settings-row.js       # the Settings → General row
│   └── i18n.js               # en + fa dictionaries
├── scripts/
│   ├── build.mjs             # zero-dependency ESM bundler
│   ├── verify.mjs            # contract + real-DOM behaviour gates
│   ├── install.mjs           # profile installer / uninstaller
│   ├── inspect-profile.mjs   # loads a real profile with DSH's own boot code
│   ├── check-naming.mjs      # community naming profile
│   └── upstream/             # vendored naming tooling (see PROVENANCE.md)
├── tests/                    # node:test behaviour suites
├── docs/COMPATIBILITY.md     # exact contracts + upgrade checklist
└── dsh-plugin.naming.json
```

## Development

```sh
pnpm run check      # build + verify + tests + naming profile
pnpm run build      # src/ -> dist/
pnpm test           # node:test suites (86 tests)
pnpm run verify     # contract + DOM behaviour gates
pnpm run inspect    # load the installed profile with DSH's boot code
```

`pnpm run build` is a dependency-free ESM bundler. It inlines relative `./x.js` imports, rewrites bare specifiers into lazy `require()` calls against the DSH client module table, strips the module-level `export` syntax into the registry factories' own `exports` object, and emits exactly one `window.__ModuleLoader__.load({ id, factory })` registration. Every bare import must be declared in `dsh.client.external`; the build and the verifier both enforce that.

The transform is statement-level rather than a blind regex, and every stage is asserted: an import/export form the transform does not understand fails the build instead of shipping a broken bundle. That property is the reason the bundler is longer than its job sounds, and it is what caught the two real bugs found during development — a module factory parameter shadowing the module table's `require`, and a temporal-dead-zone read of the persisted binding.

## Verified

- **86 tests** (`node --test`): the state machine, i18n, the real generated bundle in jsdom, and **`tests/cascade.test.mjs`**, which resolves the CSS cascade and asserts which declaration actually WINS for every directed surface.
- **Contract + DOM behaviour gates** in `scripts/verify.mjs`, including a live Cordis activation of the host half and a real-DOM pass that asserts every document effect and its exact retraction on unload.
- **Profile inspection with DSH's own `loadProfileDirectory()`**: the bundle row resolves, its patch parses, and the client declaration is accepted.
- **Community naming profile**: compatible (two advisory warnings about the published package name, documented below).

The cascade suite exists because attribute assertions passed while the feature was
broken. In 0.1.0 the controller wrote every attribute correctly and the page still
read left-to-right: the composer and editor were pinned `direction: ltr
!important` (so no mode could reach them) and the paragraph leaves had
`unicode-bidi: plaintext` but no `text-align`, so blocks that resolved to RTL
stayed on the left edge. Both defects are assertion-invisible at the attribute
level and assertion-obvious at the cascade level. `:where()` on the detection
rules now guarantees the forced rules win regardless of source order.

Naming warnings, for transparency: the namespace `dsh-direction` resembles the
community-reserved `dsh` prefix, and the loader id does not carry the
collision-resistant `dsh-direction-direction` prefix. Both are *recommendations*
from a community profile, not Harness requirements, and the upstream policy was
verified against an older Harness (`dsh-v0.1.2-alpha.2`) than this plugin
targets — so the published name is kept. See
[`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md) for the exact contracts, the
diagnostics entry point, and the upgrade checklist.

Verified on **DSH `0.1.5-rc.1`** (client packages `0.1.5-rc.2`), Windows, Node 24,
pnpm 11.

## License

MIT
