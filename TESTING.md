# TIDAL module — testing & installation guide

This guide walks through installing this module into a local Bitfocus Companion or Bitfocus Buttons instance and exercising every action, feedback, and variable it exposes.

- Repository: <https://github.com/avimedia/companion-module-tidal>
- Module id (from `companion/manifest.json`): `tidal`
- Legacy id auto-migrated: `tidal-music`

All shell snippets below assume your terminal's working directory is the **project root** (the folder containing `package.json` and the `src/` directory). The next section explains how to get there.

---

## 0. Get the project on disk

### Open a terminal

| OS          | How                                                                              |
| ----------- | -------------------------------------------------------------------------------- |
| **macOS**   | Spotlight (`⌘ Space`) → type `Terminal` → return. Or use _iTerm2_ if you prefer. |
| **Windows** | Press `⊞ Win` → type `PowerShell` → return. _Windows Terminal_ is also fine.     |
| **Linux**   | Your distro's terminal app, or `Ctrl+Alt+T` on most desktops.                    |

Pick a folder where you keep code projects. Common choices:

- macOS: `~/Developer` or `~/dev`
- Linux: `~/dev` or `~/code`
- Windows: `C:\dev` or `%USERPROFILE%\source`

Create that parent folder if it doesn't exist, move into it, clone the repo, and move into the resulting project folder:

### macOS / Linux (zsh, bash)

```bash
mkdir -p ~/dev
cd ~/dev
git clone https://github.com/avimedia/companion-module-tidal.git
cd companion-module-tidal
```

### Windows (PowerShell)

```powershell
mkdir $HOME\dev -Force
cd $HOME\dev
git clone https://github.com/avimedia/companion-module-tidal.git
cd companion-module-tidal
```

### Verify you're in the right place

After the final `cd`, the project root should look like this:

```bash
pwd                # expect: …/dev/companion-module-tidal
ls                 # expect: companion/  src/  package.json  tsconfig.json  README.md  TESTING.md  …
```

> Every later snippet in this document assumes `pwd` ends in `companion-module-tidal`. If you open a new terminal tab/window later, you'll need to `cd` back into this folder first — shell `cd` does not persist across windows. A quick way to teleport back:
>
> ```bash
> cd ~/dev/companion-module-tidal      # macOS/Linux
> cd $HOME\dev\companion-module-tidal  # Windows PowerShell
> ```
>
> The **absolute path** to this folder is also what you'll paste into Companion/Buttons' _Developer modules path_ setting in §2A below. Grab it any time with `pwd` (macOS/Linux) or `(Get-Location).Path` (Windows).

### Updating to a newer version later

From the project root:

```bash
git pull
corepack yarn@4.12.0 install      # picks up any new/removed dependencies
corepack yarn@4.12.0 build        # rebuild dist/ so Companion/Buttons sees the changes
```

Then restart the TIDAL connection in Companion/Buttons (Connections list → kebab menu → _Restart_) so the new `dist/main.js` is loaded.

---

## 1. Prerequisites

| Requirement                                           | Notes                                                                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Node.js 22.x**                                      | Install from <https://nodejs.org> or your package manager of choice. Companion/Buttons ship their own Node runtime; this one is only needed for the build steps. |
| **Yarn 4** (build/dev only)                           | Comes with Node 22 via Corepack. All snippets use `corepack yarn@4.12.0 …` so no global install is required.                                                     |
| **A TIDAL developer app**                             | Create one at <https://developer.tidal.com/dashboard>. Note the Client ID and Client Secret.                                                                     |
| **TIDAL desktop app** _(optional)_                    | Only required to test the "Open URI in TIDAL desktop" actions. macOS/Windows/Linux all support `tidal://` URIs when the desktop client is installed.             |
| **Bitfocus Companion 4.0+** _or_ **Bitfocus Buttons** | The connection module ecosystem is shared between the two products.                                                                                              |

### TIDAL Developer Portal — one-time setup

1. Sign in at <https://developer.tidal.com/dashboard> with your TIDAL account.
2. _Create app_. Give it any name (e.g. `Bitfocus Local Test`).
3. Under _Redirect URIs_, add **exactly**:
   ```
   https://bitfocus.github.io/companion-oauth/callback
   ```
   This is the Bitfocus-hosted redirector. It is only needed for the **Authorization Code + PKCE** mode (user-scoped data). Client-Credentials mode does not use a redirect URI at all.
4. Copy the **Client ID** and the **Client Secret**.

> ⚠️ The Client Secret is sensitive. The module currently stores it in the connection config (matches the upstream `companion-module-template-ts`). Companion/Buttons keep that config server-side, but treat the secret as you would a password — don't paste it into screenshots, chat logs, or shared notes.

---

## 2. Install the module into Companion / Buttons

You have two options.

### Option A — Developer modules path (recommended while iterating)

This points the host app at the source folder, so any rebuild is picked up after restarting the connection.

1. Make sure the build output exists:
   ```bash
   corepack yarn@4.12.0 install
   corepack yarn@4.12.0 build
   ```
2. Open **Companion** (or **Buttons**) → _Settings_ → _Modules_.
3. Find the **Developer modules path** field (Companion v4 UI calls it _"Modules path"_ under _Developer settings_; Buttons exposes it in the same place).
4. Point it at the **parent directory** that holds this repo, and ensure the repo folder is named `companion-module-tidal` (which is what `git clone` produces by default). For example, if you cloned into `~/dev/companion-module-tidal`, set the path to `~/dev`.
   - If the connection does not appear after restart, try setting the path to the project folder itself instead.
   - Or symlink the repo into a parent folder under the expected name, e.g. `ln -s "$PWD" ../companion-module-tidal` and point the dev path at the parent.
5. Restart the connections (or the whole app) so the module list is rescanned.
6. _Connections → Add connection → search "TIDAL"_ → the module should appear with **Manufacturer: TIDAL, Product: TIDAL**.

### Option B — Drag-in the packaged tgz

Use this when you want a clean install or to share the module with another machine.

1. Build the package:
   ```bash
   corepack yarn@4.12.0 install
   corepack yarn@4.12.0 package
   # → writes ./tidal-<version>.tgz (e.g. tidal-0.4.0.tgz)
   ```
2. In Companion/Buttons go to _Modules → Import module package_ and select the produced `tidal-<version>.tgz`.

---

## 3. Configure the connection

After adding the connection you'll see this config UI:

| Field                         | What to enter                                                                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authentication mode**       | Pick `Client Credentials (catalog only)` for the first round of tests. Switch to `Authorization Code + PKCE` later for user-scoped tests.          |
| **Country code**              | Two-letter ISO code matching your TIDAL subscription, e.g. `NO`, `US`, `GB`. TIDAL returns `403`/`401` on most catalog endpoints if this is wrong. |
| **Client ID**                 | From the TIDAL developer dashboard.                                                                                                                |
| **Client Secret**             | From the TIDAL developer dashboard.                                                                                                                |
| **Scopes**                    | Default `user.read playlists.read collection.read` works for Authorization Code mode. Ignored by Client Credentials.                               |
| **Auth URL** _(read-only)_    | Populated automatically once you save with Authorization Code mode selected. Open it in any browser to complete the login.                         |
| **Auth status** _(read-only)_ | Live status string — also exposed as the `auth_status` variable.                                                                                   |

### Client-Credentials test (catalog only)

1. Mode: `Client Credentials`. Save.
2. Check the log pane for `Authenticated (expires …)`. Connection status badge should be green/Ok.
3. The `auth_status` variable should now read `Authenticated (expires <ISO timestamp>)`.

### Authorization-Code + PKCE test (user data)

1. Mode: `Authorization Code + PKCE`. Save.
2. The log will print `TIDAL authorization URL ready. Open it in a browser: https://login.tidal.com/authorize?…`. The same URL is in the `Auth URL` config field.
3. Open the URL in any browser. Log in to TIDAL and approve the requested scopes.
4. The Bitfocus redirector at `bitfocus.github.io/companion-oauth/callback` will forward back to your local Companion/Buttons instance, the module exchanges the code for tokens, the page shows "TIDAL login complete. You can close this tab."
5. `auth_status` becomes `Authenticated (expires …)` and `current_user_*` variables populate from `/users/me`.

> If you ever need to re-run the OAuth dance, just blank the `Client Secret`, save, paste it back, save again — that clears the cached tokens and regenerates a fresh `Auth URL`.

### Playback control (v0.3.0+, expanded in v0.4.0)

Below the auth fields is the **Playback control** section:

| Field                                            | What to enter                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Playback control engine**                      | Pick `Disabled` to make _Playback:_ actions no-op, `Focus + keystroke` for the v0.2.0 behaviour, `OS media keys` for non-focus-stealing presses (macOS: built-in via private MediaRemote since v0.4.0, fallback to `nowplaying-cli` if installed), or `playerctl` for Linux MPRIS.                                                              |
| **Restore previously focused app on each press** | Only affects `Focus + keystroke`. When ticked, the module records the active window before activating TIDAL and best-effort re-focuses it after the keystroke. Adds ~80–200 ms latency per press. _Silently ignored on Linux Wayland_ — the Wayland focus+keystroke path (added in v0.4.0) cannot activate windows from outside the compositor. |

You can leave both at their defaults if you only intend to use the catalog/auth features. The _Playback:_ actions will be visible in the action picker either way, but with `Disabled` selected they'll log a warning and do nothing.

> **Per-button engine override (v0.4.0+):** every _Playback:_ action also has an **Engine** dropdown on the action itself, defaulting to _Use connection config default_. Test it by setting one button's engine to something different than the connection default and confirming that single button uses the overridden engine while everything else keeps using the config-level setting.

---

## 4. Smoke tests — every action

Create one Companion/Buttons button per action and verify the corresponding variables update.

### 4.1 Search catalog

- **Action options:** Query = `daft punk`, Kind = `tracks`, Limit = `10`.
- **Expected variables after press:**
  - `last_search_query` = `daft punk`
  - `last_search_kind` = `tracks`
  - `last_search_count` ≥ 1
  - `last_search_first_id` populated
  - `last_search_first_title` populated
  - `current_track_*` variables populated (because Kind = tracks)
- **Feedback:** _Last search returned results_ should turn green.

Repeat with Kind = `albums`, `artists`, `playlists`, `videos`. Tracks Kind is the only one that auto-populates `current_track_*` — the others just update the `last_search_*` set.

### 4.2 Load track by ID

- **Action option:** Track ID = `12345` (replace with a real numeric TIDAL track ID; you can grab one from `last_search_first_id` after a tracks search).
- **Expected:** `current_track_id`, `current_track_title`, `current_track_artists`, `current_track_album`, `current_track_isrc`, `current_track_duration`, `current_track_explicit`, `current_track_uri` all update.

### 4.3 Load track by ISRC

- **Action option:** ISRC = `USQX91901206` (or any valid ISRC).
- **Expected:** Same variables as 4.2 update. If TIDAL has no track for that ISRC the log says `No track found for ISRC <code>`.

### 4.4 Load album by ID / Load playlist by ID

- Album → `current_track_album`, `current_track_artists`, `current_track_uri` update with `tidal://album/<id>`.
- Playlist → `last_search_first_title` and `current_track_uri` (`tidal://playlist/<uuid>`) update.

### 4.5 Refresh access token

- Press the button; log should say `Authenticated (expires …)` again with a fresh expiry.
- For Client-Credentials mode this also tests that a brand-new token is obtainable on demand.

### 4.6 Open URI in TIDAL desktop _(local only)_

- Default option: `tidal://track/$(tidal:current_track_id)`.
- Press after a successful "Load track" — TIDAL desktop should focus and play the track.
- macOS spawns `open <uri>`, Windows `start "" <uri>`, Linux `xdg-open <uri>` (see `src/actions.ts → openExternal`).
- **Buttons specifically:** the module declares `runtime.permissions.child-process: true` in `companion/manifest.json`. If you see _"permission denied"_ in the log, the manifest didn't get picked up — rebuild and re-import.

### 4.7 Open track in TIDAL desktop

- Convenience wrapper for `tidal://track/<id>`. Quick way to chain Load-track → Open-track in a two-step preset.

### 4.8 Playback actions — engine-aware _(v0.3.0+, expanded shortcuts/engines in v0.4.0)_

**Prerequisite:** in the connection config, set **Playback control engine** to whichever engine you want to test. The default is `Focus + keystroke`. To verify the no-op path, set it to `Disabled` and confirm presses log a warning instead of doing anything.

Common test preconditions for any non-`Disabled` engine:

- TIDAL desktop app is **running** (open and signed in) on the **same machine** as Companion/Buttons.
- A track or playlist is loaded in TIDAL so you can hear/see the effect.
- The `child-process` runtime permission is granted (Companion grants automatically; Buttons enforces strictly).

Per-engine prerequisites:

| Engine                | Extra requirements                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Disabled**          | none — every press logs a warning and is a no-op                                                                                                                                                                                                                                                                                                                                                   |
| **Focus + keystroke** | macOS: Accessibility permission granted to host (Companion/Buttons). Linux X11: `xdotool` installed. Linux Wayland (v0.4.0+): `ydotool` _with `ydotoold` daemon running and user in `input` group_ (recommended) OR `wtype` (limited; only injects to focused window). Note: on Wayland we cannot activate the TIDAL window from outside, so `Restore previously focused app` is silently ignored. |
| **OS media keys**     | macOS (v0.4.0+): no install needed — uses Apple's private MediaRemote via `osascript -l JavaScript`. Optional `brew install nowplaying-cli` acts as a fallback. Windows: nothing (PowerShell built-in). Linux: redirects to `playerctl`.                                                                                                                                                           |
| **playerctl**         | Linux only. `apt install playerctl` / `dnf install playerctl`. TIDAL desktop or `tidal-hifi` running with MPRIS on.                                                                                                                                                                                                                                                                                |

Now create one button per action and verify (✓ = works, ✗ = not supported, logs a warning):

| Action                               | Focus + keystroke shortcut sent                                                  | OS media keys (macOS / Windows)                                      | playerctl (Linux)                         |
| ------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------- |
| Playback: Play / Pause               | `Space`                                                                          | ✓ macOS (`MRMediaRemote` cmd 2), ✓ Windows (`VK_MEDIA_PLAY_PAUSE`)   | `playerctl play-pause`                    |
| Playback: Next track                 | `Ctrl + →`                                                                       | ✓ macOS (cmd 4), ✓ Windows (`VK_MEDIA_NEXT_TRACK`)                   | `playerctl next`                          |
| Playback: Previous track             | `Ctrl + ←`                                                                       | ✓ macOS (cmd 5), ✓ Windows (`VK_MEDIA_PREV_TRACK`)                   | `playerctl previous`                      |
| Playback: Seek forward (±10s)        | `Ctrl + Shift + →` _(corrected in v0.4.0; was just `Shift + →` in v0.2.0/0.3.0)_ | ✗ macOS / ✗ Windows — log warning                                    | `playerctl position 10+`                  |
| Playback: Seek backward (±10s)       | `Ctrl + Shift + ←` _(corrected in v0.4.0)_                                       | ✗ macOS / ✗ Windows — log warning                                    | `playerctl position 10-`                  |
| Playback: Volume up                  | `Ctrl + ↑`                                                                       | ✗ macOS / ✓ Windows (`VK_VOLUME_UP` — system volume, not TIDAL-app)  | `playerctl volume 0.05+`                  |
| Playback: Volume down                | `Ctrl + ↓`                                                                       | ✗ macOS / ✓ Windows (`VK_VOLUME_DOWN`)                               | `playerctl volume 0.05-`                  |
| Playback: Toggle mute                | _no native TIDAL shortcut_ — log warning (v0.4.0)                                | ✗ macOS / ✓ Windows (`VK_VOLUME_MUTE` — system mute)                 | `playerctl volume 0`                      |
| Playback: Toggle shuffle _(v0.4.0+)_ | `Ctrl + S`                                                                       | ✓ macOS (cmd 6) / ✗ Windows                                          | `playerctl shuffle Toggle`                |
| Playback: Cycle repeat _(v0.4.0+)_   | `Ctrl + R`                                                                       | ✓ macOS (cmd 7) / ✗ Windows                                          | ✗ — playerctl has no Toggle verb for loop |
| Playback: Send custom keyboard …     | works                                                                            | **error log** — falls through to focus_keystroke per engine selector | **error log**                             |

**What "works" looks like:**

- With **Focus + keystroke**: TIDAL window flashes / comes to front, shortcut takes effect. If **Restore previously focused app** is enabled (X11 / macOS / Windows only), focus snaps back to your previous app after ~80–200 ms.
- With **OS media keys**: nothing visible happens to TIDAL's window; the playback state simply changes (Play→Pause etc.). On Windows volume actions affect the **system** volume, not TIDAL's per-app volume. On macOS v0.4.0+ commands are routed straight to whichever app owns the OS media session — usually TIDAL when it's actively playing.
- With **playerctl**: same — no window movement; TIDAL responds because MPRIS is targeted at it by name.
- With **Disabled**: nothing visible; the connection log shows `playback_play_pause skipped (engine=disabled): Playback control engine is set to "Disabled"…`.

**Troubleshooting per OS & engine:**

- **macOS, Focus + keystroke first run**: macOS prompts for _Accessibility_ permission for whatever process is running `osascript` (Companion or Buttons itself). Approve under _System Settings → Privacy & Security → Accessibility_. Without it, presses are silently no-ops.
- **macOS, OS media keys (v0.4.0+)**: should "just work" without `nowplaying-cli`. If the log says `JXA MRMediaRemoteSendCommand failed`, Apple may have moved the symbol — install `nowplaying-cli` as a fallback (`brew install nowplaying-cli`) and the module will use it transparently.
- **Windows, Focus + keystroke**: if the action seems to do nothing, run `Get-Command powershell` in PowerShell to confirm `powershell` resolves. PowerShell 5.1 (built-in) is what we use; PowerShell 7 (`pwsh`) is **not** required.
- **Windows, OS media keys**: first press has ~1 s of `Add-Type` compile latency. If you see `Add-Type` errors in the log, .NET Framework 4.x is missing — should never happen on Windows 10/11.
- **Linux X11**: `which xdotool` must succeed for Focus+keystroke; `which playerctl` for the playerctl engine.
- **Linux Wayland (v0.4.0+)**: `echo $XDG_SESSION_TYPE` returns `wayland`. Focus+keystroke now attempts `ydotool` first, then `wtype`. To set up `ydotool`: install the package, start the `ydotoold` daemon (`systemctl --user enable --now ydotoold` or `sudo systemctl enable --now ydotoold` depending on your distro), and add your user to the `input` group (`sudo usermod -aG input $USER` and log out/in). To verify: `ydotool key 57:1 57:0` should send a Space keypress to the focused window. If neither tool is installed, the log says `Linux Wayland focus_keystroke needs either ydotool … or wtype …`. The cleanest Wayland path is to use the `playerctl` engine instead.
- **All OS**: confirm the connection has `child-process` permission. If denied, the log will show `child_process spawn denied`.

**Quick smoke-test sequence (~45s):**

1. Start a track playing in TIDAL.
2. Press **Play / Pause** → audio stops.
3. Press **Play / Pause** again → audio resumes.
4. Press **Next track** → moves to next track.
5. Press **Volume down** twice → audible drop.
6. Press **Volume up** twice → audible rise.
7. Press **Shuffle** → TIDAL's shuffle indicator toggles. _(new in v0.4.0)_
8. Press **Repeat** → TIDAL cycles through Off → All → One. _(new in v0.4.0)_
9. Press **Seek forward** → playback position jumps ~10s forward. _(verifies the v0.4.0 Ctrl+Shift+→ fix)_

Repeat for each engine you care about by flipping the **Playback control engine** dropdown in the connection config and **Save**ing.

If any step fails, check the connection log for the specific error string — `osascript`, `powershell`, `xdotool`, `ydotool`, `wtype`, `nowplaying-cli`, or `playerctl` will appear in the error message and tell you which platform branch failed.

### 4.9 Playback: Send custom keyboard shortcut

Use this to bind any TIDAL shortcut we haven't wrapped explicitly. **Requires the chosen Engine to be `Focus + keystroke`** (either at the connection level or via the per-button Engine dropdown). Other engines log a warning and skip.

- **Action options:** Key = `f` (or any key from the dropdown), Modifiers = `[]` (or any combination), Engine = `Use connection config default` (or override per-button).
- **Expected:** TIDAL window activates and receives `F` (which favorites the current track in current builds), or whatever shortcut you chose.
- **Use case:** custom power-user mappings without needing a module update — or a per-button override of the connection's engine (e.g., bind a single button to `Focus + keystroke` while the rest use `OS media keys`).

### 4.10 Engine fall-through tests _(v0.3.0+, per-button overrides in v0.4.0)_

Quick checks that the engine selector behaves cleanly:

1. Set **Playback control engine** = `Disabled`. Press any Playback button **without** overriding the per-button engine. Expected: connection log says `playback_play_pause skipped (engine=disabled): Playback control engine is set to "Disabled"…`. Nothing happens.
2. Set engine = `OS media keys` and press **Playback: Seek forward** (macOS). Expected: log says `playback_seek_forward skipped (engine=media_keys): seek_forward is not supported by the macOS media-keys engine…`.
3. Set engine = `playerctl` and press **Playback: Send custom keyboard shortcut** (any combo). Expected: log says `playback_send_shortcut … skipped (engine=playerctl): Custom keyboard shortcuts only work with the "Focus + keystroke" engine.`
4. Set engine = `playerctl` on macOS/Windows (where it's not supported) and press **Playback: Play / Pause**. Expected: log says `playerctl could not find an MPRIS-exposing TIDAL client…` (because `playerctl` itself isn't on macOS/Windows).
5. With engine = `Focus + keystroke` and **Restore previously focused app** enabled: focus your text editor, press **Playback: Play / Pause** on a Stream Deck — your text editor should regain focus within ~200 ms.
6. **Per-button engine override (v0.4.0)**: With connection engine = `Disabled`, override **one** button's Engine option to `Focus + keystroke`. Pressing that button should still control TIDAL while every other Playback button stays a no-op.
7. **Cycle Repeat under playerctl (v0.4.0)**: with engine = `playerctl`, press **Playback: Cycle repeat mode**. Expected: log says `playback_repeat_toggle skipped (engine=playerctl): repeat_toggle is not in PLAYERCTL_COMMANDS…` (or equivalent). Switch to `Focus + keystroke` and the same button should work.
8. **Mute under focus_keystroke (v0.4.0)**: with engine = `Focus + keystroke`, press **Playback: Toggle mute**. Expected: log says `playback_mute_toggle skipped (engine=focus_keystroke): TIDAL desktop does not have a native mute keyboard shortcut…`. Switch to `OS media keys` (Windows) or `playerctl` (Linux) and the same button should work.

---

### 4.11 Library features _(v0.5.0+, Authorization Code mode only)_

> All steps in 4.11 require the connection's **Authentication mode** to be set to _Authorization Code + PKCE_ and the OAuth flow completed. In _Client Credentials_ mode, the playlist dropdown shows `— Run "Refresh user library" first (Authorization Code mode) —` and the _Your playlists_ preset section is empty.

**Library refresh + playlist preset section**

1. Add a button bound to **Refresh user library (playlists)** and press it. Log shows `Library refreshed: <N> playlists.`
2. Open the preset browser → expand **Your playlists**. You should see one preset per playlist you own, each labelled with the playlist name and track count. Drag one onto a button.
3. Press that button → TIDAL desktop navigates to and (typically) starts playing the playlist.
4. Confirm variables: `$(tidal:library_playlist_count)` shows N, `$(tidal:library_refreshed_at)` shows the ISO timestamp.

**Playlist dropdown action**

5. Add a button bound to **Play playlist (from your library)** → the dropdown lists all cached playlists. Pick one, save, press → TIDAL desktop opens that playlist.

**Per-track variable loading**

6. Add a button bound to **Load playlist tracks into variables** → pick a playlist, set count (e.g. 16), press.
7. Variables `playlist_track_1_id` … `playlist_track_16_id` now hold real track IDs. `last_loaded_playlist_name` shows the playlist name.
8. Open the preset browser → **Current playlist tracks** → presets 1–16 now show their actual track titles. Presets 17–32 remain blank.
9. Drag preset _track 5_ onto a button and press it → TIDAL plays track 5 of that playlist.

**Search-and-play workflow**

10. Add a button bound to **Search catalog** → query "Bohemian Rhapsody", kind=tracks, limit=10. Press.
11. Variables `last_search_result_1_title` … `last_search_result_10_title` are populated. Open preset browser → **Search results** → presets 1–10 show the titles.
12. Drag preset _result 1_ onto a button → press it → TIDAL plays the top hit.
13. Alternatively, bind a button to **Play search result (by index)** with index=1.

**Soft-degrade smoke test**

14. Switch the connection to **Client Credentials** mode (no user login required). Reload the connection.
15. Verify: _Your playlists_ preset section is empty, playlist dropdown shows the "Run Refresh user library first" placeholder, catalog actions (Search, Load track) still work.

## 5. Smoke tests — feedbacks

Apply each as a button feedback and confirm the colour switches:

| Feedback                       | True when…                                       | Default style |
| ------------------------------ | ------------------------------------------------ | ------------- |
| `TIDAL is authenticated`       | Module holds a non-expired access token.         | green bg      |
| `Last search returned results` | Most recent search returned ≥ 1 result.          | blue bg       |
| `Loaded track is explicit`     | The currently loaded track has `explicit: true`. | red bg        |

Use the bundled presets to get a quick visual confirmation:

- _Status / TIDAL authentication state_ (also acts as a one-tap **Refresh access token** button).
- _Search / Search first result_ (turns green when there are results).
- _Loaded track / Now-loaded track title_ (turns red when explicit).
- _Transport / Previous, Play-Pause, Next, Volume −, Volume +, Mute, Shuffle, Repeat_ — drag onto a button page for an instant transport bar.

---

## 6. Variable reference

Use `$(tidal:variable_name)` in any button text, action option, or expression:

```
auth_status            auth_expires_at

current_track_id       current_track_title       current_track_artists
current_track_album    current_track_isrc        current_track_duration
current_track_explicit current_track_uri

last_search_count      last_search_query         last_search_kind
last_search_first_id   last_search_first_title

# Last search slot variables (1-10), v0.5.0+
last_search_result_<n>_id      last_search_result_<n>_title
last_search_result_<n>_artists last_search_result_<n>_uri

current_user_id        current_user_name         current_user_country

# Library + loaded-playlist variables (v0.5.0+, Authorization Code mode)
library_playlist_count       library_refreshed_at
last_loaded_playlist_id      last_loaded_playlist_name
last_loaded_playlist_count

# Loaded-playlist track slots (1-32), v0.5.0+
playlist_track_<n>_id      playlist_track_<n>_title
playlist_track_<n>_artists playlist_track_<n>_uri
```

---

## 7. Iterating locally

```bash
# One-time setup
corepack yarn@4.12.0 install

# Watch mode while iterating
corepack yarn@4.12.0 dev          # tsc --watch into dist/

# Manual one-shot rebuild + checks
corepack yarn@4.12.0 build
corepack yarn@4.12.0 lint
corepack yarn@4.12.0 format       # prettier

# Produce an installable tgz
corepack yarn@4.12.0 package      # writes ./tidal-<version>.tgz
```

Whenever you change `src/`, restart the connection in Companion/Buttons to pick up the new `dist/main.js`. You do not need to restart the whole app.

---

## 8. Troubleshooting checklist

| Symptom                                                  | Likely cause / fix                                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Module not visible in _Add connection_ picker            | Developer modules path is wrong, or the folder isn't named `companion-module-tidal`. Try the symlink workaround in §2A. |
| Status badge: _Bad config / Missing Client ID/Secret_    | Empty Client ID or Client Secret in the connection config.                                                              |
| Status badge: _Awaiting user login_ (Authorization Code) | Open the `Auth URL` from the config field in any browser.                                                               |
| `403`/`401` on every API call                            | Wrong `countryCode`, or the access token does not have the required scope for that endpoint.                            |
| `permission denied` on `open_tidal_uri` (Buttons)        | Manifest's `runtime.permissions.child-process` is missing or didn't get re-imported. Rebuild and re-import the tgz.     |
| `Failed to open URI` (any OS)                            | TIDAL desktop app isn't installed, or the `tidal://` scheme isn't registered. Install <https://tidal.com/download>.     |
| `Token refresh failed: …` after a long idle              | Refresh token rotated/expired. Re-run the Authorization Code flow (blank Client Secret → save → paste back → save).     |

---

## 9. After-test cleanup

If you want to start completely fresh from the project root:

```bash
rm -rf node_modules dist .yarn yarn.lock *.tgz
corepack yarn@4.12.0 install
corepack yarn@4.12.0 build
```

To remove the connection from Companion/Buttons: _Connections → TIDAL → Remove_. To delete the module entirely from the host app, also clear the Developer modules path or remove the `.tgz` you imported.

---

## 10. Reference links

- Module repo: <https://github.com/avimedia/companion-module-tidal>
- Companion module dev docs: <https://companion.free/for-developers/module-development/>
- Bitfocus developer portal: <https://developer.bitfocus.io/>
- TIDAL Developer Portal: <https://developer.tidal.com/>
- TIDAL OAuth 2.1 / PKCE spec used by this module: <https://developer.tidal.com/documentation/api-sdk/api-sdk-authorization>
- TIDAL Web API reference: <https://developer.tidal.com/apiref>
