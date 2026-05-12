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

| Action                                  | Description                                                                                                                                                                   |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search catalog                          | Search tracks/albums/artists/playlists/videos. Stores the first result in the loaded-track variables, all results in the search-result slots, and updates `last_search_*`.    |
| Load track by ID                        | Fetch a track by its numeric TIDAL ID.                                                                                                                                        |
| Load track by ISRC                      | Look up a track by ISRC (useful for cue sheets).                                                                                                                              |
| Load album by ID                        | Populate album-related variables.                                                                                                                                             |
| Load playlist by ID                     | Populate playlist-related variables.                                                                                                                                          |
| Refresh access token                    | Force a token refresh (or fetch a fresh client-credentials token).                                                                                                            |
| Refresh user library (playlists)        | Re-fetch your owned playlists from TIDAL and rebuild the dropdown + preset section. Requires **Authorization Code** mode.                                                     |
| Play playlist (from your library)       | Dropdown of your cached playlists. Launches `tidal://playlist/<id>` in the TIDAL desktop app.                                                                                 |
| Load playlist tracks into variables     | Loads up to 32 tracks of a chosen playlist into `playlist_track_1_*` … `playlist_track_32_*` variables, regenerates the _Current playlist tracks_ preset section.             |
| Play search result (by index)           | Plays the Nth result of the most recent search (1-10). Two-button workflow: "Search X" + "Play 1st result".                                                                   |
| Open URI in TIDAL desktop               | Launch any `tidal://...` (or `https://tidal.com/...`) URL through the OS.                                                                                                     |
| Open track in TIDAL desktop             | Convenience wrapper for `tidal://track/<id>`.                                                                                                                                 |
| Playback: Play / Pause                  | Sends `Space` to the TIDAL desktop window.                                                                                                                                    |
| Playback: Next track                    | Sends `Ctrl + →` to the TIDAL desktop window.                                                                                                                                 |
| Playback: Previous track                | Sends `Ctrl + ←` to the TIDAL desktop window.                                                                                                                                 |
| Playback: Seek forward                  | Sends `Ctrl + Shift + →` to the TIDAL desktop window (TIDAL's documented ±10s shortcut).                                                                                      |
| Playback: Seek backward                 | Sends `Ctrl + Shift + ←` to the TIDAL desktop window.                                                                                                                         |
| Playback: Volume up / down              | Sends `Ctrl + ↑ / ↓` to the TIDAL desktop window.                                                                                                                             |
| Playback: Toggle mute                   | TIDAL has no native mute shortcut. With `Focus + keystroke` this action logs a warning. Use the `OS media keys` engine on Windows for OS-level mute, or `playerctl` on Linux. |
| Playback: Toggle shuffle                | Sends `Ctrl + S` to the TIDAL desktop window.                                                                                                                                 |
| Playback: Cycle repeat mode             | Sends `Ctrl + R` to the TIDAL desktop window (cycles Off → All → One).                                                                                                        |
| Playback: Send custom keyboard shortcut | Generic escape hatch — pick any supported key and any combination of `⌘/Ctrl`, `Shift`, `Alt`.                                                                                |

> **Per-button engine override:** every `Playback:` action exposes an _Engine_ dropdown that defaults to **Use connection config default**. Override it per button if, for example, you want a single Play/Pause to use the no-focus-stealing `OS media keys` engine while the rest of your transport stays on `Focus + keystroke`.

### Playback actions — how they work

All `Playback:` actions delegate to a configurable engine (set in the connection config under **Playback control engine**). Pick the one that fits your show:

| Engine                | Behavior                                                           | Focus theft | Notes                                                             |
| --------------------- | ------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------- |
| **Disabled**          | All `Playback:` actions log a warning and do nothing               | n/a         | Default for users who only want catalog/auth features             |
| **Focus + keystroke** | Brings TIDAL forward, sends TIDAL's in-app keyboard shortcut       | yes         | Most reliable; works for every action including custom shortcuts  |
| **OS media keys**     | Sends global media keys (`VK_MEDIA_*`, `MRMediaRemoteSendCommand`) | no          | Targets whatever app owns the OS media session, not TIDAL by name |
| **playerctl**         | MPRIS via `playerctl --player=tidal-hifi,tidal,TIDAL`              | no          | Linux only; deterministic for TIDAL specifically                  |

There's a separate checkbox — **Restore previously focused app after each press** — which only takes effect with the `Focus + keystroke` engine. When enabled, the module records the active window before activating TIDAL and best-effort returns focus afterwards. Adds ~80–200 ms latency to each press.

#### Engine prerequisites

- **Focus + keystroke**
  - macOS: first press will prompt for _Accessibility_ permission for the host (Companion / Buttons). Approve under _System Settings → Privacy & Security → Accessibility_.
  - Windows: `powershell.exe` must be on PATH (it is by default on Windows 10/11).
  - Linux X11: `xdotool` must be installed (`apt install xdotool`).
  - Linux Wayland: best-effort — install either `ydotool` _with the `ydotoold` daemon running and your user in the `input` group_ (recommended, most universal), or `wtype` (only injects to the currently focused window, so the user must focus TIDAL manually first). The Wayland path cannot reliably activate the TIDAL window from outside, so `Restore previously focused app` is silently ignored.
- **OS media keys**
  - macOS: **no install required by default** — the module calls Apple's private `MRMediaRemoteSendCommand` directly via a JXA / `dlopen` trick (`/System/Library/PrivateFrameworks/MediaRemote.framework`). If that path fails (e.g. Apple changes the symbol in a future OS), the module transparently falls back to [`nowplaying-cli`](https://github.com/kirtan-shah/nowplaying-cli) if installed (`brew install nowplaying-cli`). Supported via this engine on macOS: Play/Pause, Next, Previous, Shuffle, Repeat. Volume/Seek/Mute log "not supported" and you should fall back to `Focus + keystroke`.
  - Windows: no installs needed — uses PowerShell P/Invoke. First press has ~1 s `Add-Type` compile latency, subsequent presses are fast.
  - Linux: transparently redirects to `playerctl` (Linux's equivalent of "global media keys" is the MPRIS bus).
- **playerctl**
  - Linux only. Install with `apt install playerctl` / `dnf install playerctl`.
  - Looks for an MPRIS-exposing TIDAL client (`tidal-hifi`, `tidal`, or `TIDAL`). If none is running you'll see `playerctl could not find an MPRIS-exposing TIDAL client` in the log.
  - `Repeat: Cycle repeat mode` is **not supported** via `playerctl` (the CLI has no Toggle verb for `loop`). Use `Focus + keystroke` for that one.

If the TIDAL desktop app isn't running, all engines will fail gracefully with a clear message in the connection log.

## Variables

**Auth / session:** `auth_status`, `auth_expires_at`, `current_user_id`, `current_user_name`, `current_user_country`.

**Loaded track:** `current_track_id`, `current_track_title`, `current_track_artists`, `current_track_album`, `current_track_isrc`, `current_track_duration` (seconds), `current_track_explicit`, `current_track_uri`.

**Last search:** `last_search_count`, `last_search_query`, `last_search_kind`, `last_search_first_id`, `last_search_first_title`, and per-result slots `last_search_result_1_id` / `_title` / `_artists` / `_uri` … through slot 10.

**Library:** `library_playlist_count`, `library_refreshed_at`.

**Loaded playlist:** `last_loaded_playlist_id`, `last_loaded_playlist_name`, `last_loaded_playlist_count`, and per-track slots `playlist_track_1_id` / `_title` / `_artists` / `_uri` … through slot 32.

Reference any of them in button text as `$(tidal:variable_name)`.

## Feedbacks

- **TIDAL is authenticated** — true while a non-expired access token is held.
- **Last search returned results** — true when the most recent search returned ≥ 1 result.
- **Loaded track is explicit** — true when the currently loaded track is flagged explicit.

## Presets

The module ships with starter presets organised by section:

- **Loaded track** — single-button preset showing the title/artists of the most recently loaded track.
- **Search** — single-button preset summarising the most recent search.
- **Status** — single-button preset showing authentication status (tap to refresh the token).
- **Transport** — Previous, Play/Pause, Next, Volume −, Volume +, Mute, Shuffle, Repeat. Each respects the connection-level engine setting unless overridden per button.
- **Your playlists** _(Authorization Code mode only)_ — one preset per playlist you own, auto-generated after a library refresh. Drag any onto a button to bind it to "Play playlist <name>".
- **Current playlist tracks** — 32 numbered presets backed by the `playlist_track_N_*` variables. They render empty until you run _Load playlist tracks into variables_; afterwards the labels and target URIs come alive without any per-preset re-emission.
- **Search results** — 10 numbered presets backed by the `last_search_result_N_*` variables. Pressing one runs _Play search result (by index)_ for that slot. Re-run _Search catalog_ to repopulate.

### Library-feature workflow

1. Switch the connection's **Authentication mode** to _Authorization Code + PKCE_, fill in Client ID / Secret, save.
2. Open the Auth URL surfaced in the connection log (or the _Auth URL_ config field) and complete the TIDAL login.
3. The module auto-runs _Refresh user library_ on first authenticate. You can run it again any time after creating new playlists in TIDAL.
4. The _Your playlists_ preset section now contains one button per playlist. Drag the ones you want straight onto your grid.
5. To play a specific track inside a playlist, bind a button to _Load playlist tracks into variables_, pick the playlist + count. Then drag _Current playlist tracks → track N_ presets for the tracks you want.

## Compatibility

This is a standard `companion-module-base` v2 connection module, so it works the same way in both Bitfocus Companion and Bitfocus Buttons — the connection ecosystem is shared between those products. Buttons enforces the runtime permission declarations from the manifest, and this module declares `child-process: true` so the _Open URI in TIDAL desktop_ actions are allowed to run.

The module had a previous internal id `tidal-music`; that name is listed in `legacyIds`, so existing connections will be migrated automatically.

## OAuth callback

The Authorization Code flow uses TIDAL's hosted login page and the Bitfocus-hosted redirector at `https://bitfocus.github.io/companion-oauth/callback`. The redirector forwards back to this module's HTTP handler (`/oauth/callback`), so you do not need to expose Companion or Buttons publicly. Your TIDAL app must list `https://bitfocus.github.io/companion-oauth/callback` as a redirect URI.

## Limitations

- Network playback control is not part of TIDAL's public Web API. The _Playback:_ actions always operate on the locally installed TIDAL desktop app via the selected **Playback control engine**. They cannot control a TIDAL Connect device on the network.
- The `Focus + keystroke` engine briefly steals window focus on each press. Enable **Restore previously focused app after each press** to mitigate, or switch to `OS media keys` / `playerctl` for non-focus-stealing engines.
- The `OS media keys` engine on macOS uses Apple's private `MRMediaRemoteSendCommand` API and falls back to `nowplaying-cli` if installed. It supports Play/Pause, Next, Previous, Shuffle, Repeat. Volume/Seek/Mute log "not supported" with this engine on macOS — fall back to `Focus + keystroke` for those.
- The `playerctl` engine is Linux-only and requires `playerctl` installed plus a TIDAL client that exposes MPRIS (`tidal-hifi`, or the official desktop app on supporting distros). It supports all transport actions except `Cycle repeat mode` (no Toggle verb in `playerctl loop`).
- TIDAL desktop has no native **Mute** keyboard shortcut. With the `Focus + keystroke` engine, _Playback: Toggle mute_ logs a "no mapping" warning. Use the `OS media keys` engine on Windows for OS-level mute, or `playerctl` on Linux (sets volume to 0 as a best-effort mute).
- Linux Wayland support for `Focus + keystroke` is best-effort. We try `ydotool` first (compositor-agnostic when `ydotoold` is running and the user is in the `input` group), then `wtype` (limited to the currently focused window). The cleanest Wayland path remains `playerctl` / `OS media keys` (which redirects to `playerctl` on Linux).
- All catalog endpoints require a `countryCode`; if you get `403`/`401` responses, double-check the configured value matches your TIDAL subscription region.
- TIDAL's API version is referenced as `application/vnd.tidal.v1+json` in this module; if the upstream API changes, update `src/tidal-api.ts` accordingly.
