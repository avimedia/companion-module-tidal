# companion-module-tidal

A connection module for [Bitfocus Companion](https://bitfocus.io/companion) **and** [Bitfocus Buttons](https://bitfocus.io/) that talks to the [TIDAL Developer Platform](https://developer.tidal.com).

The Companion and Buttons connection ecosystems are shared (same `@companion-module/base`, same `companion/manifest.json`, same `nodejs-ipc` runtime), so a single module loads in both hosts. See [companion/HELP.md](./companion/HELP.md) for user-facing documentation rendered inside the app.

## Development

```bash
yarn install
yarn build       # compile TypeScript → dist/
yarn dev         # watch mode
yarn lint        # eslint
yarn format      # prettier
yarn package     # build + create installable pkg via @companion-module/tools
```

Then point Companion or Buttons at this folder via the developer-modules path. See [Setting up a Dev Folder](https://companion.free/for-developers/module-development/local-modules) for how to register a local module with a Companion or Buttons install.

## Layout

```text
companion/
  manifest.json       # Companion/Buttons module manifest (id: tidal)
  HELP.md             # user-facing help, rendered inside the app
src/
  main.ts             # InstanceBase entry point, lifecycle, OAuth callback handler
  config.ts           # connection config fields + defaults
  tidal-auth.ts       # OAuth 2.1 helpers (client credentials, PKCE, refresh)
  tidal-api.ts        # thin REST client for openapi.tidal.com/v2
  actions.ts          # search, load track/album/playlist, refresh, open URI
  feedbacks.ts        # boolean feedbacks (authenticated, explicit, has results)
  variables.ts        # exposed variable definitions
  presets.ts          # starter presets, grouped into sections
  upgrades.ts         # placeholder for future upgrade scripts
```

## Notes on the TIDAL API

TIDAL's public Web API (`openapi.tidal.com/v2`) is JSON:API-shaped, cursor-paginated, and currently focuses on catalog data. Authorization uses OAuth 2.1 with PKCE on the authorization-code flow.

There is **no `/users/me` endpoint** in the v2 API (despite the v1-era convention). To list a user's owned playlists, the module decodes the JWT access token's `sub` claim to recover the user ID, then filters the catalog: `GET /playlists?filter[owners.id]={userId}`. Pagination follows the `links.next` cursor up to a hard cap (`MAX_PAGES = 100`, ≈ 2 000 entries).

User-library features (owned playlists, playlist track listing, search-result slots) are gated behind **Authorization Code** mode. In **Client Credentials** mode the dynamic dropdowns soft-degrade to "— Run Refresh user library first —" and the catalog actions remain fully functional.

If a future release adds public "now playing" or playback-control endpoints, extend `src/tidal-api.ts` and add corresponding actions/feedbacks rather than fanning out new files.

## Library workflow

The module ships an end-to-end "discover → assign → play" flow for user playlists:

1. **Refresh user library** action — fetches all your owned playlists in one call (paginated transparently), caches them, and re-emits both the `play_playlist` dropdown and a "Your playlists" preset section so each playlist appears as a draggable preset.
2. **Play playlist** action — single dropdown of your cached playlists; runs `tidal://playlist/<id>` through the OS handler.
3. **Load playlist tracks into variables** action — fetches up to 32 tracks of the chosen playlist and publishes them as `playlist_track_1_*` … `playlist_track_32_*` variables. The "Current playlist tracks" preset section is regenerated with their titles, so users drag tracks 1–N straight onto buttons.
4. **Play search result (by index)** — companion to _Search catalog_; each search additionally publishes the top 10 results as `last_search_result_N_*` variables and a 10-button preset section. Two-button workflow: _Search X_ on one button, _Play 1st result_ on another.

## Notes for Buttons compatibility

- The manifest declares `runtime.permissions.child-process: true` because the module spawns:
  - `open` / `start` / `xdg-open` for the _Open URI in TIDAL desktop_ actions.
  - `osascript` (macOS), `powershell` (Windows), or `xdotool` (Linux/X11) for the _Playback:_ actions, which activate the TIDAL window and synthesise keyboard shortcuts.

  Buttons enforces these declared permissions; without the flag, the spawns would be denied.

- The previous module id `tidal-music` is listed in `legacyIds`, so an existing connection from an earlier build will be auto-migrated.

## Playback control

TIDAL's public Web API does not expose a "play on device" endpoint comparable to Spotify Connect. The _Playback:_ actions implement local control by automating the TIDAL desktop app on the same machine.

The behaviour is governed by a single connection-config setting — **Playback control engine** — with four options:

| Engine                          | What it does                                               | Focus theft   | Cross-platform                                                                                                               |
| ------------------------------- | ---------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `Disabled`                      | _Playback:_ actions log a warning and do nothing           | n/a           | n/a                                                                                                                          |
| `Focus + keystroke` _(default)_ | Activates TIDAL window, sends the in-app keyboard shortcut | yes (briefly) | macOS / Windows / Linux (X11 native, Wayland best-effort)                                                                    |
| `OS media keys`                 | Sends global media keys; non-focus-stealing                | no            | macOS (built-in via private MediaRemote, with `nowplaying-cli` fallback), Windows (built-in), Linux (redirects to playerctl) |
| `playerctl`                     | Targets TIDAL specifically over MPRIS                      | no            | Linux only                                                                                                                   |

An additional checkbox — **Restore previously focused app after each press** — only applies to the `Focus + keystroke` engine and best-effort returns focus to the previous foreground app after the keystroke is delivered. _(Ignored on Wayland — the Wayland path cannot reliably activate windows from outside.)_

Every _Playback:_ action also has a per-button **Engine** dropdown that defaults to _Use connection config default_. Set a specific engine on a single button if you want, e.g., a no-focus-stealing Play/Pause via `OS media keys` while the rest of your transport stays on `Focus + keystroke`.

### Per-engine implementation notes

- **Focus + keystroke** (cross-platform):
  - macOS: `osascript` + `System Events`, using key-codes for arrows/space and `keystroke "<letter>"` for alphanumerics.
  - Windows: PowerShell + `WScript.Shell.AppActivate` + `SendKeys`.
  - Linux X11: `xdotool search --name TIDAL windowactivate --sync key <combo>`.
  - Linux Wayland (best-effort, added in 0.4.0): prefers `ydotool` when available (compositor-agnostic via kernel uinput — requires the `ydotoold` daemon running and the user in the `input` group); falls back to `wtype` (only injects to the currently focused window, so the user must have TIDAL focused at the time of the press). If neither tool is installed the engine reports a clear error and points at `playerctl`.
- **OS media keys**:
  - macOS (rewritten in 0.4.0): JXA script that `dlopen`s `/System/Library/PrivateFrameworks/MediaRemote.framework` and calls `MRMediaRemoteSendCommand` directly. No external dependencies. Supports Play/Pause, Next, Previous, Shuffle, Repeat (MRMediaRemoteCommand enum values 2, 4, 5, 6, 7). Transparently falls back to [`nowplaying-cli`](https://github.com/kirtan-shah/nowplaying-cli) if installed and the JXA path ever fails. Volume/Seek/Mute log "not supported" — fall back to `Focus + keystroke`.
  - Windows: PowerShell P/Invoke to `user32.dll!keybd_event` with `VK_MEDIA_PLAY_PAUSE` / `VK_MEDIA_NEXT_TRACK` / `VK_MEDIA_PREV_TRACK` / `VK_VOLUME_UP` / `VK_VOLUME_DOWN` / `VK_VOLUME_MUTE`. Seek/Shuffle/Repeat aren't Windows media keys, so they log "not supported".
  - Linux: transparently redirects to the `playerctl` engine because Linux's equivalent of "global media keys" is the MPRIS bus.
- **playerctl**: targets `playerctl --player=tidal-hifi,tidal,TIDAL` so it works against both the unofficial [tidal-hifi](https://github.com/Mastermindzh/tidal-hifi) Electron client and the official desktop app where it exposes MPRIS. Volume actions use `0.05+`/`0.05-` increments; seek actions use `±10` second offsets; Shuffle uses `shuffle Toggle`. _Repeat cycle is intentionally unsupported_ via `playerctl` because the CLI has no Toggle verb for `loop`; the focus_keystroke engine is the recommended path for repeat.

### TIDAL desktop shortcut bindings

The `Focus + keystroke` engine drives in-app shortcuts. Verified against publicly documented TIDAL desktop bindings (TutorialTactic, AudFree, DefKey, TuneSmake, CheatKeys) in May 2026:

| Action            | Shortcut sent                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------- |
| Play / Pause      | `Space`                                                                                      |
| Next track        | `Ctrl + →`                                                                                   |
| Previous track    | `Ctrl + ←`                                                                                   |
| Seek forward 10s  | `Ctrl + Shift + →`                                                                           |
| Seek backward 10s | `Ctrl + Shift + ←`                                                                           |
| Volume up / down  | `Ctrl + ↑ / Ctrl + ↓`                                                                        |
| Shuffle toggle    | `Ctrl + S`                                                                                   |
| Repeat cycle      | `Ctrl + R`                                                                                   |
| Toggle mute       | _no TIDAL shortcut_ — logs warning; use OS media keys (Windows) or playerctl (Linux) instead |

(`Ctrl` on Windows/Linux, `Cmd` on macOS for those marked Ctrl in TIDAL's docs — the module sends the platform-appropriate modifier.) If TIDAL changes any binding in a future update, override per button with the _Send custom keyboard shortcut_ action.

All engines share the same _Playback:_ actions in the UI — switching engines does not require re-wiring buttons.

## License

MIT — see [LICENSE](./LICENSE).
