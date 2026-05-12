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

TIDAL's public Web API (`openapi.tidal.com/v2`) is JSON:API-shaped and currently focuses on catalog data. Authorization uses OAuth 2.1 with PKCE on the authorization-code flow.

If a future release adds public "now playing" or playback-control endpoints, extend `src/tidal-api.ts` and add corresponding actions/feedbacks rather than fanning out new files.

## Notes for Buttons compatibility

- The manifest declares `runtime.permissions.child-process: true` because the module spawns:
  - `open` / `start` / `xdg-open` for the _Open URI in TIDAL desktop_ actions.
  - `osascript` (macOS), `powershell` (Windows), or `xdotool` (Linux/X11) for the _Playback:_ actions, which activate the TIDAL window and synthesise keyboard shortcuts.

  Buttons enforces these declared permissions; without the flag, the spawns would be denied.

- The previous module id `tidal-music` is listed in `legacyIds`, so an existing connection from an earlier build will be auto-migrated.

## Playback control

TIDAL's public Web API does not expose a "play on device" endpoint comparable to Spotify Connect. The _Playback:_ actions implement local control by automating the TIDAL desktop app on the same machine.

The behaviour is governed by a single connection-config setting — **Playback control engine** — with four options:

| Engine                          | What it does                                               | Focus theft   | Cross-platform                                                                     |
| ------------------------------- | ---------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| `Disabled`                      | _Playback:_ actions log a warning and do nothing           | n/a           | n/a                                                                                |
| `Focus + keystroke` _(default)_ | Activates TIDAL window, sends the in-app keyboard shortcut | yes (briefly) | macOS / Windows / Linux X11                                                        |
| `OS media keys`                 | Sends global media keys; non-focus-stealing                | no            | macOS (needs `nowplaying-cli`), Windows (built-in), Linux (redirects to playerctl) |
| `playerctl`                     | Targets TIDAL specifically over MPRIS                      | no            | Linux only                                                                         |

An additional checkbox — **Restore previously focused app after each press** — only applies to the `Focus + keystroke` engine and best-effort returns focus to the previous foreground app after the keystroke is delivered.

### Per-engine implementation notes

- **Focus + keystroke** (cross-platform): macOS via `osascript` + `System Events`; Windows via PowerShell + `WScript.Shell.AppActivate` + `SendKeys`; Linux X11 via `xdotool search --name TIDAL windowactivate --sync key <combo>`. Linux Wayland not supported — `wtype` cannot reliably target a backgrounded TIDAL window.
- **OS media keys**:
  - macOS: shells out to [`nowplaying-cli`](https://github.com/kirtan-shah/nowplaying-cli) (`brew install nowplaying-cli`). The CLI wraps Apple's private `MRMediaRemoteSendCommand`. Only Play/Pause, Next, Previous are supported in this engine on macOS — for Volume/Seek/Mute fall back to `Focus + keystroke`.
  - Windows: PowerShell P/Invoke to `user32.dll!keybd_event` with `VK_MEDIA_PLAY_PAUSE` / `VK_MEDIA_NEXT_TRACK` / `VK_MEDIA_PREV_TRACK` / `VK_VOLUME_UP` / `VK_VOLUME_DOWN` / `VK_VOLUME_MUTE`. Seek isn't a Windows media key.
  - Linux: transparently redirects to the `playerctl` engine because Linux's equivalent of "global media keys" is the MPRIS bus.
- **playerctl**: targets `playerctl --player=tidal-hifi,tidal,TIDAL` so it works against both the unofficial [tidal-hifi](https://github.com/Mastermindzh/tidal-hifi) Electron client and the official desktop app where it exposes MPRIS. Volume actions use `0.05+`/`0.05-` increments; seek actions use `±10` second offsets.

All engines share the same _Playback:_ actions in the UI — switching engines does not require re-wiring buttons.

## License

MIT — see [LICENSE](./LICENSE).
