# TIDAL

This module connects [Bitfocus Companion](https://bitfocus.io/companion) and [Bitfocus Buttons](https://bitfocus.io/) to the [TIDAL Developer Platform](https://developer.tidal.com). It lets you authenticate against TIDAL, query the catalog, look up tracks by ID or ISRC, and launch `tidal://` deep links in the desktop client.

> **Heads up:** TIDAL's current public Web API is catalog-focused and does not expose a public "play on device" endpoint comparable to Spotify Connect. Playback control is therefore implemented locally: the module brings the TIDAL desktop app to the foreground and synthesises the same keyboard shortcuts you'd press on the keyboard. The TIDAL desktop app must be installed on the same machine as the Companion/Buttons host, and the module declares the `child-process` runtime permission so Buttons will allow the local spawn.

## Getting started

1. Sign in at [developer.tidal.com/dashboard](https://developer.tidal.com/dashboard) and create an application.
2. Add `https://bitfocus.github.io/companion-oauth/callback` as a redirect URI on your app (only required for **Authorization Code** mode).
3. Copy the Client ID and Client Secret into this connection's config.
4. Pick the authentication mode:
   - **Client Credentials** — catalog access only (no user data). Good for searching, looking up tracks/albums by ID, etc.
   - **Authorization Code + PKCE** — needed for any user-scoped data (playlists, library, current user).
5. Set your Country Code (ISO 3166-1 alpha-2, e.g. `US`, `NO`, `GB`) — TIDAL requires it on most catalog endpoints.
6. Save. The module obtains a token automatically. In Authorization Code mode an **Auth URL** is generated; open it in any browser, complete the login, and the redirector hands the code back to this module's instance.

## Actions

| Action                                  | Description                                                                                                                       |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Search catalog                          | Search tracks/albums/artists/playlists/videos. Stores the first result in the loaded-track variables and updates `last_search_*`. |
| Load track by ID                        | Fetch a track by its numeric TIDAL ID.                                                                                            |
| Load track by ISRC                      | Look up a track by ISRC (useful for cue sheets).                                                                                  |
| Load album by ID                        | Populate album-related variables.                                                                                                 |
| Load playlist by ID                     | Populate playlist-related variables.                                                                                              |
| Refresh access token                    | Force a token refresh (or fetch a fresh client-credentials token).                                                                |
| Open URI in TIDAL desktop               | Launch any `tidal://...` (or `https://tidal.com/...`) URL through the OS.                                                         |
| Open track in TIDAL desktop             | Convenience wrapper for `tidal://track/<id>`.                                                                                     |
| Playback: Play / Pause                  | Sends `Space` to the TIDAL desktop window.                                                                                        |
| Playback: Next track                    | Sends `⌘/Ctrl + →` to the TIDAL desktop window.                                                                                   |
| Playback: Previous track                | Sends `⌘/Ctrl + ←` to the TIDAL desktop window.                                                                                   |
| Playback: Seek forward                  | Sends `Shift + →` to the TIDAL desktop window.                                                                                    |
| Playback: Seek backward                 | Sends `Shift + ←` to the TIDAL desktop window.                                                                                    |
| Playback: Volume up / down              | Sends `⌘/Ctrl + ↑ / ↓` to the TIDAL desktop window.                                                                               |
| Playback: Toggle mute                   | Sends `⌘/Ctrl + M` to the TIDAL desktop window.                                                                                   |
| Playback: Send custom keyboard shortcut | Generic escape hatch — pick any supported key and any combination of `⌘/Ctrl`, `Shift`, `Alt`.                                    |

### Playback actions — how they work

All `Playback:` actions activate the TIDAL desktop window and then send TIDAL's own in-app keyboard shortcut. **Window focus is briefly stolen** — if you were typing in another app, the next key would go to TIDAL until you click away. For live-show usage that has overlays where focus theft is a problem, prefer triggering these from a hardware Stream Deck / Companion surface rather than a button on the same display as your show software.

Per-OS implementation:

- **macOS**: `osascript` activates TIDAL and uses `System Events` to send the key code with the chosen modifiers.
- **Windows**: PowerShell + `WScript.Shell.AppActivate` + `SendKeys`. PowerShell must be on `PATH` (it is by default on Windows 10/11).
- **Linux (X11)**: `xdotool search --name TIDAL windowactivate --sync key <combo>`. Wayland sessions are not supported by this path yet — use `playerctl` externally or wait for the planned media-keys engine.

If the TIDAL desktop app isn't running, the action will simply have no effect (and may log a warning on Linux where `xdotool search` returns no matches).

`auth_status`, `auth_expires_at`, `current_track_id`, `current_track_title`, `current_track_artists`, `current_track_album`, `current_track_isrc`, `current_track_duration`, `current_track_explicit`, `current_track_uri`, `last_search_count`, `last_search_query`, `last_search_kind`, `last_search_first_id`, `last_search_first_title`, `current_user_id`, `current_user_name`, `current_user_country`.

Reference them in button text as `$(tidal:variable_name)`.

## Feedbacks

- **TIDAL is authenticated** — true while a non-expired access token is held.
- **Last search returned results** — true when the most recent search returned ≥ 1 result.
- **Loaded track is explicit** — true when the currently loaded track is flagged explicit.

## Presets

The module ships with starter presets under the categories _Loaded track_, _Search_, _Status_, and _Transport_ (Play/Pause, Next, Previous, Volume ±, Mute).

## Compatibility

This is a standard `companion-module-base` v2 connection module, so it works the same way in both Bitfocus Companion and Bitfocus Buttons — the connection ecosystem is shared between those products. Buttons enforces the runtime permission declarations from the manifest, and this module declares `child-process: true` so the _Open URI in TIDAL desktop_ actions are allowed to run.

The module had a previous internal id `tidal-music`; that name is listed in `legacyIds`, so existing connections will be migrated automatically.

## OAuth callback

The Authorization Code flow uses TIDAL's hosted login page and the Bitfocus-hosted redirector at `https://bitfocus.github.io/companion-oauth/callback`. The redirector forwards back to this module's HTTP handler (`/oauth/callback`), so you do not need to expose Companion or Buttons publicly. Your TIDAL app must list `https://bitfocus.github.io/companion-oauth/callback` as a redirect URI.

## Limitations

- Network playback control is not part of TIDAL's public Web API. The _Playback:_ actions instead drive the local TIDAL desktop app by activating its window and sending in-app keyboard shortcuts. They cannot control a TIDAL Connect device on the network.
- Each _Playback:_ press briefly steals window focus to the TIDAL app. A "restore previous focus" variant and a non-focus-stealing media-keys engine are on the roadmap.
- Linux Wayland sessions are not supported by the _Playback:_ actions yet (X11 only, via `xdotool`). On Linux, `xdotool` must be installed for the _Playback:_ actions to work.
- All catalog endpoints require a `countryCode`; if you get `403`/`401` responses, double-check the configured value matches your TIDAL subscription region.
- TIDAL's API version is referenced as `application/vnd.tidal.v1+json` in this module; if the upstream API changes, update `src/tidal-api.ts` accordingly.
