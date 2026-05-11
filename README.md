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

TIDAL's public Web API does not expose a "play on device" endpoint comparable to Spotify Connect. The _Playback:_ actions implement local control by:

1. Bringing the TIDAL desktop window to the foreground.
2. Synthesising the in-app keyboard shortcut that TIDAL itself listens for (e.g. `Space` for play/pause, `⌘/Ctrl + →` for next track).

This is implemented in [`src/playback.ts`](./src/playback.ts) with per-OS branches:

- **macOS**: `osascript` → `System Events` keystroke
- **Windows**: PowerShell → `WScript.Shell.AppActivate` + `SendKeys`
- **Linux (X11)**: `xdotool search --name TIDAL windowactivate --sync key <combo>`

Trade-off: each press briefly steals focus to TIDAL. A non-focus-stealing engine using OS media keys (macOS `MRMediaRemoteSendCommand`, Windows `keybd_event` with `VK_MEDIA_*`, Linux `playerctl`) is on the roadmap for v0.3.0.

## License

MIT — see [LICENSE](./LICENSE).
