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
   # → writes ./tidal-0.1.0.tgz
   ```
2. In Companion/Buttons go to _Modules → Import module package_ and select `tidal-0.1.0.tgz`.

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

### 4.8 Playback actions — Play/Pause, Next, Previous, etc. _(v0.2.0+)_

Each Playback action activates the TIDAL desktop window and sends an in-app keyboard shortcut. Test preconditions:

- TIDAL desktop app is **running** (open and signed in).
- A track or playlist is loaded in TIDAL so you can hear/see the effect.
- The Companion/Buttons host is on the **same machine** as the TIDAL desktop app (these actions cannot cross machines).
- On **Linux**, `xdotool` is installed and you're on an **X11** session (Wayland is not supported by this path yet — check with `echo $XDG_SESSION_TYPE`).

Create one button per action and verify:

| Action                           | Default shortcut sent       | Expected effect in TIDAL                                          |
| -------------------------------- | --------------------------- | ----------------------------------------------------------------- |
| Playback: Play / Pause           | `Space`                     | Currently playing track toggles between playing and paused        |
| Playback: Next track             | `⌘/Ctrl + →`                | Skips to the next track in the queue                              |
| Playback: Previous track         | `⌘/Ctrl + ←`                | Goes to the previous track (or restarts current if past ~3s)      |
| Playback: Seek forward           | `Shift + →`                 | Seeks forward (~10s in current TIDAL builds)                      |
| Playback: Seek backward          | `Shift + ←`                 | Seeks backward (~10s)                                             |
| Playback: Volume up              | `⌘/Ctrl + ↑`                | TIDAL's internal volume increases one step                        |
| Playback: Volume down            | `⌘/Ctrl + ↓`                | TIDAL's internal volume decreases one step                        |
| Playback: Toggle mute            | `⌘/Ctrl + M`                | TIDAL mutes/unmutes (verify; the binding can vary across updates) |
| Playback: Send custom keyboard … | the key + modifiers you set | Whatever TIDAL has bound that shortcut to                         |

**What "works" looks like:**

- The TIDAL window flashes / comes to the front for each press.
- The shortcut takes effect in TIDAL (track changes, playback toggles, etc.).
- The previously focused app loses focus to TIDAL — this is expected with the current engine and will be addressed by a non-focus-stealing engine in v0.3.0.

**Troubleshooting per OS:**

- **macOS first run**: macOS prompts for _Accessibility_ permission for whatever process is running `osascript` (Companion or Buttons itself). Approve under _System Settings → Privacy & Security → Accessibility_. If you skip, presses are silently no-ops.
- **Windows**: if the action seems to do nothing, run `Get-Command powershell` in PowerShell to confirm `powershell` resolves. PowerShell 5.1 (built-in) is what we use; PowerShell 7 (`pwsh`) is **not** required.
- **Linux**: `which xdotool` must succeed. On Wayland (`echo $XDG_SESSION_TYPE` returns `wayland`), `xdotool` won't work and these actions will fail silently.
- **All OS**: confirm the connection has `child-process` permission. Companion grants it automatically from `companion/manifest.json`; Buttons enforces it strictly. If denied, the log will show `child_process spawn denied`.

**Quick smoke-test sequence (~30s):**

1. Start a track playing in TIDAL.
2. Press **Play / Pause** → audio stops.
3. Press **Play / Pause** again → audio resumes.
4. Press **Next track** → moves to next track.
5. Press **Volume down** twice → audible drop.
6. Press **Volume up** twice → audible rise.

If any step fails, check the connection log for the specific error string (`osascript`, `powershell`, or `xdotool` will appear in the error message and tell you which platform branch failed).

### 4.9 Playback: Send custom keyboard shortcut

Use this to bind any TIDAL shortcut we haven't wrapped explicitly.

- **Action options:** Key = `f` (or any key from the dropdown), Modifiers = `[]` (or any combination).
- **Expected:** TIDAL window activates and receives `F` (which favorites the current track in current builds), or whatever shortcut you chose.
- **Use case:** custom power-user mappings without needing a module update.

---

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
- _Transport / Play-Pause, Next, Previous, Volume ± , Mute_ — drag onto a button page for an instant transport bar.

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

current_user_id        current_user_name         current_user_country
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
corepack yarn@4.12.0 package      # writes ./tidal-0.1.0.tgz
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
