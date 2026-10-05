# Compatibility notes

This plugin was built and verified against a specific DSH release. This file
records the exact contracts it depends on, so an upgrade can be re-checked
mechanically instead of by trial and error.

**Verified against:** DSH `0.1.5-rc.1` (client packages `0.1.5-rc.2`), Windows,
Node `24.18.1`, pnpm `11.7.0`.

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

## Known limitations

- **The composer is not mirrored.** The caret model in DSH's Lexical editor is
  left-to-right; forcing the editor container to RTL desynchronises the caret
  from the text. The composer therefore keeps `direction: ltr` and follows a
  forced direction only in `text-align`.
- **Under `interface` scope the shell geometry mirrors** (sidebars swap sides,
  absolute-positioned elements follow). This is correct RTL presentation and it
  is opt-in; the default `messages` scope never moves a panel.
- **`auto` cannot fix a mixed-script paragraph.** The CSS plaintext algorithm
  decides per block from its first strong character. A paragraph that opens with
  English and continues in Persian is laid out left-to-right. Force `rtl` for
  that content.
- **The width override moves two DSH variables together**
  (`--dsh-chat-user-width` and `--dsh-chat-content-width`). If DSH derives the
  composer card from a third variable in a later version, the card and the
  transcript can disagree; the composer's own `--dsh-composer-card-max-width`
  is computed from the transcript width in 0.1.5, so it follows automatically.
