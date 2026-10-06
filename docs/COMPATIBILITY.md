# Compatibility notes

This plugin was built and verified against specific DSH releases. This file
records the exact contracts it depends on, so an upgrade can be re-checked
mechanically instead of by trial and error.

**Verified against:** DSH `0.1.5-rc.1` (client `0.1.5-rc.2`) — the build and test
target — and DSH `0.2.0-rc.2` (client `0.2.0-rc.2`) — the host it is installed
into. Windows, Node `24.18.1`, pnpm `11.7.0`.

## Locate the profile you are actually running

A DSH profile is not a global setting: `dsh web` reads `DSH_PROFILE` at startup
and composes its entry list from that profile only. Installing into a different
profile is a silent no-op that looks exactly like a broken plugin, so the
installer now defaults to the active profile and warns on a mismatch.

```sh
echo $DSH_PROFILE                                   # the profile the host uses
node scripts/inspect-profile.mjs                    # defaults to DSH_PROFILE
node scripts/install.mjs                            # installs into DSH_PROFILE
node scripts/install.mjs --all-profiles             # every profile with a manifest
node <dsh>/lib/bin.js --dump-config --profile web   # the composed entry tree
```

**The `desktop` profile is managed exclusively by the Electron application.** The
CLI refuses to read it (`error: profile "desktop" is managed exclusively by the
Electron application`), and the application rewrites its
`dsh.profile.bundles` list on its own reconciliation schedule. Installing the
plugin there is therefore unsupported: use the profile the `dsh` CLI runs.

## Verified against 0.2.0-rc.2 (host moved from 0.1.5)

The client packages the host serves moved from `0.1.5-rc.2` to `0.2.0-rc.2`
between releases. Every contract this plugin depends on was re-checked against the
served bundles:

| Contract | Result on `0.2.0-rc.2` |
|---|---|
| `window.__ModuleLoader__.load({ id, factory })` | Unchanged; `factory` is `(require) => Record<string, unknown>`. |
| `dsh.client` / `exports["./client"]` | Unchanged; `dsh-client-modules` parses the same declaration. |
| `shell.overlay` seat | Still declared by `ui-layout` (alongside a new `shell.leading`). |
| `settings.general.item` seat | Still declared; registrants now include `ui-conversation`. |
| `data-conversation-scroll`, `data-chat-flow` | Still in `ui-chat`. |
| `data-composer-card`, `data-composer-seat`, `data-composer-placeholder`, `data-input-scroll`, `data-lexical-editor` | Still present, but **moved from `ui-chat` to `ui-conversation`**. The selectors are attribute-based, so nothing in this plugin changed — but the re-verification command must scan `ui-conversation` too. |

That last row is the upgrade-relevant lesson: 0.2.0 split the conversation and
composer surfaces across two packages. A selector written against a class name
would have broken; an attribute selector survived. Use the shipped attributes.

Two other 0.2.0 changes are on the upgrade radar but do not affect this plugin:
`transcriptView` became optional (`ui-chat` config), and the Web work-details
default moved to `detailed` (client code, not config).

## Host-side contracts

| Contract | What the plugin does | Where it is checked |
|---|---|---|
| `dsh.bundle.patch` | `package.json` points at `./cordis.patch.yml`; that file is one top-level `insert:` list adding a row whose `id` and `name` are both `dsh-direction`. | `scripts/verify.mjs` → patch gate |
| `dsh.profile.bundles` | The profile lists `dsh-direction`, which is what makes the bundle's patch layer apply. | `scripts/install.mjs` |
| `dsh.client` | `platform: "web"`, `inject: []`, `external: ["react"]`. | `scripts/verify.mjs` → package gate |
| `exports["./client"]` | Must resolve, or `dsh-client-modules` throws `declares dsh.client but exports no "./client" bundle` at activation. | `scripts/verify.mjs` → package gate |
| Cordis plugin shape | The host half exports `name`, `inject: ['clientModules']`, and `apply(ctx)`. The `inject` means the fiber waits for the client-module registry before activating, so the row is composed in the same pass that scans it. | `scripts/verify.mjs` → host-half gate (real `@deepseek-ai/cordis`) |

## Client-side contracts

| Contract | What the plugin does |
|---|---|
| `window.__ModuleLoader__.load({ id, factory })` | Exactly one registration per bundle; `id` is the npm package name; the whole body lives inside the factory so no side effect runs before materialization. |
| `factory(require)` | Called lazily at materialization. `require("react")` must be declared in `dsh.client.external` — the host orders a row declaring `external` *after* the row that provides it. |
| `ctx.slots.inject` + `ctx.slots.register` | Used for both seats, so the contributions are transactional and retract on fiber unload. |
| `ctx.effect(callback, label)` | Used for the stylesheet, the controller, and the console face. The callback returns a disposer. |
| Slot `shell.overlay` | A **list** slot, additive, click-through until an entry opts into pointer events. The plugin sets `pointer-events: auto` on its own button. |
| Slot `settings.general.item` | A list seat whose owner passes **no props**: the row owns its copy, controls and write path. It must render only its internals. |

## DOM contracts

These selectors are data attributes DSH's own components emit, so they survive
the class-name hashing that would break a selector based on CSS module names.
Re-check them after an upgrade with:

```sh
# from the DSH checkout or an installed profile
rg -n 'data-conversation-scroll|data-chat-flow|data-composer-card|data-composer-seat|data-shell-overlay|data-lexical-editor|data-composer-placeholder' packages/client
```

| Attribute | Used for |
|---|---|
| `[data-conversation-scroll]` | The scroll box a forced direction is applied to. Deliberately the *scroll* box and not `[data-chat-flow]`, so `dir="auto"` on the flow keeps working under a forced RTL. |
| `[data-chat-flow]` | The transcript column: receives `dir="auto"` and is the ancestor for the RTL table/list rules. |
| `[data-composer-card]`, `[data-composer-seat]` | Composer surfaces: receive `dir="auto"`. |
| `[data-lexical-editor]`, `[data-input-scroll]` | The contenteditable composer: pinned `direction: ltr` with `unicode-bidi: isolate`, then only its `text-align` follows a forced RTL, so the caret cannot fight the bidi algorithm. |
| `[data-composer-placeholder]` | Absolutely positioned from the left; repositioned to `right: 0` under RTL so it stays attached to the caret. |
| `[data-shell-overlay]` | The fixed-position overlay layer, forced back to `direction: ltr` so mirroring the shell cannot move the plugin's own control. |

Two hashed class names are used, both only inside the **mirrored-shell** scope,
where a positional utility must be replaced rather than inherited:

- `.hWmORq_actions` — `AssistantMarkdown` action row (`margin-left: -6px`)
- `.Sixlwa_userRow` / `.Sixlwa_userStack` — the user bubble stack (`align-items: flex-end`)

If those hashes change, the only consequence is a slightly misaligned action row
or user bubble **while a forced direction is mirrored at interface scope**; the
stylesheet degrades quietly. Prefer replacing them with a data attribute if DSH
ever adds one.

## Negative evidence (what is deliberately *not* used)

The following were checked and are **not** relied upon, so their absence or
change cannot break this plugin:

- No `SessionEventMap` extension, no message projection, no session-log entry —
  nothing this plugin does is reconstructible from, or written to, the log.
- No host-side service, tool, command, event, settings namespace or HTTP route.
- No `cordis.yml` edits and no writes inside the DSH installation.
- No dependence on `@deepseek-ai/dsh-client-ui-primitives` (not installed in
  0.1.5-rc.1; `MarkdownText` lives inside `ui-chat`).

## Verify the re-verification command itself

The `rg` command in the DOM-contracts section must scan **every** client package,
not just `ui-chat`, or a relocated attribute looks like a removed one:

```sh
rg -n 'data-conversation-scroll|data-chat-flow|data-composer-card|data-composer-seat|data-lexical-editor|data-composer-placeholder|data-shell-overlay|data-input-scroll' \
   node_modules/@deepseek-ai/dsh-client-ui-*/lib/client.js
```

## Upgrade checklist

1. `pnpm install && pnpm run build && pnpm test && pnpm run verify`.
2. Re-run the `rg` command above and confirm every DOM attribute still exists.
3. Load the plugin in a scratch profile (`scripts/install.mjs --profile <name>`)
   and confirm three things in the browser console:
   - `window.__DSH_DIRECTION__` exists;
   - the toggle button is visible bottom-right;
   - **Settings → General** shows the *Text direction* row.
4. Refresh with `localStorage.clear()` and confirm the default is `auto` with no
   mirroring.
5. If a data attribute was renamed, update `CONTENT_CONTAINERS` in
   `src/styles.js`, `LTR_ISLANDS` in `src/styles.js`, and the tests, then rebuild.

## Diagnostics

`window.__DSH_DIRECTION__.diagnose()` answers "the control is on screen but the
page still reads left-to-right" in one call. It reports the mode, scope, root and
body attributes, whether the stylesheet is present and byte-identical to the
source, how many containers were marked `dir="auto"` out of how many matched, and
for each probed surface its `dir`, computed `direction`, computed `text-align`
and computed `unicode-bidi`.

The three failure classes it separates:

| Symptom in the report | Meaning |
|---|---|
| `stylesheet.present: false`, or `matchesSource: false` | The bundle the page loaded is not the bundle on disk — restart the host, then hard-refresh. |
| `containers.markedAuto: 0` of `matched: 6` | The controller never reconciled. Check `rootAttributes` for a missing `data-dsh-direction`. |
| `probes.*.direction` / `.textAlign` still at the LTR default | A rule lost the cascade. `tests/cascade.test.mjs` asserts the winner for every surface — run it before touching the sheet. |

`scripts/browser-check.mjs` is a real-Chrome rendering check (it measures the
media box of a Persian paragraph against the flow's right edge). **It skips in a
sandboxed environment**: Chrome's renderer needs named pipes, which the DSH file
sandbox blocks, so the process exits with no output. The cascade tests exist
because attribute-level assertions and layout assertions are not
interchangeable, and only the first is always available.

## Known limitations

- **Under `interface` scope the shell geometry mirrors** (sidebars swap sides,
  absolute-positioned elements follow). This is correct RTL presentation and it
  is opt-in; the default `messages` scope never moves a panel.
- **`auto` cannot fix a mixed-script paragraph.** The CSS plaintext algorithm and
  `dir="auto"` both decide per block from its first strong character. A paragraph
  that opens with English and continues in Persian is laid out left-to-right.
  Force `rtl` for that content.
- **In `ltr` mode on an already-LTR page nothing visibly changes.** That is the
  point of the mode: it is the escape hatch for a block that resolved the wrong
  way, not a transformation.
- **The composer's caret in rtl mode follows the browser's own contenteditable
  direction handling.** The editor is flipped along with the transcript rather
  than left alone; if a future DSH editor reports caret problems under RTL, exclude
  `[data-lexical-editor]` from `READING_SURFACES` and the forced rules at once —
  the cascade tests will fail until both are changed together, which is the
  intended coupling.
- **The width override moves two DSH variables together**
  (`--dsh-chat-user-width` and `--dsh-chat-content-width`). If DSH derives the
  composer card from a third variable in a later version, the card and the
  transcript can disagree; the composer's own `--dsh-composer-card-max-width`
  is computed from the transcript width in 0.1.5, so it follows automatically.
