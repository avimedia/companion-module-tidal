import { execFile } from 'node:child_process'
import { platform, env } from 'node:process'

// Cross-platform helper for the Playback: actions.
//
// The TIDAL public Web API has no playback-control endpoint, so every engine
// here operates on the locally installed TIDAL desktop app. Three engines are
// available:
//
//   focus_keystroke - Activates the TIDAL window and synthesises an in-app
//                      keyboard shortcut. Reliable and deterministic, but
//                      briefly steals window focus.
//   media_keys      - Sends OS-level media keys (Play/Pause/Next/Previous,
//                      and Volume/Mute on Windows). Does not steal focus,
//                      but targets whichever app currently owns the OS
//                      media session.
//   playerctl       - Linux-only; sends MPRIS commands targeted at TIDAL via
//                      `playerctl --player=tidal,tidal-hifi`. Does not steal
//                      focus, and is deterministic for TIDAL specifically.
//
// A fourth value `disabled` makes every call a no-op (with a result.ok=false
// so the caller can surface a helpful log message).

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type PlaybackEngine = 'disabled' | 'focus_keystroke' | 'media_keys' | 'playerctl'

// Sentinel value used by per-button engine dropdowns to mean "fall through to
// the connection-level Playback control engine setting". Exported so the
// preset definitions and action callbacks share a single source of truth.
export const PLAYBACK_ENGINE_DEFAULT_CHOICE = '__use_connection_default__'

export type AbstractModifier = 'cmdOrCtrl' | 'shift' | 'alt'

export type ShortcutKey =
	| 'space'
	| 'left'
	| 'right'
	| 'up'
	| 'down'
	| 'enter'
	| 'escape'
	| 'tab'
	| 'a'
	| 'b'
	| 'c'
	| 'd'
	| 'e'
	| 'f'
	| 'g'
	| 'h'
	| 'i'
	| 'j'
	| 'k'
	| 'l'
	| 'm'
	| 'n'
	| 'o'
	| 'p'
	| 'q'
	| 'r'
	| 's'
	| 't'
	| 'u'
	| 'v'
	| 'w'
	| 'x'
	| 'y'
	| 'z'
	| '0'
	| '1'
	| '2'
	| '3'
	| '4'
	| '5'
	| '6'
	| '7'
	| '8'
	| '9'

export const SUPPORTED_SHORTCUT_KEYS: ShortcutKey[] = [
	'space',
	'left',
	'right',
	'up',
	'down',
	'enter',
	'escape',
	'tab',
	'a',
	'b',
	'c',
	'd',
	'e',
	'f',
	'g',
	'h',
	'i',
	'j',
	'k',
	'l',
	'm',
	'n',
	'o',
	'p',
	'q',
	'r',
	's',
	't',
	'u',
	'v',
	'w',
	'x',
	'y',
	'z',
	'0',
	'1',
	'2',
	'3',
	'4',
	'5',
	'6',
	'7',
	'8',
	'9',
]

export type SemanticCommand =
	| 'play_pause'
	| 'next'
	| 'previous'
	| 'seek_forward'
	| 'seek_backward'
	| 'volume_up'
	| 'volume_down'
	| 'mute_toggle'
	| 'shuffle_toggle'
	| 'repeat_toggle'

export type CustomShortcutCommand = {
	type: 'custom_shortcut'
	key: ShortcutKey
	modifiers: AbstractModifier[]
}

export type PlaybackCommand = { type: SemanticCommand } | CustomShortcutCommand

export interface PlaybackOptions {
	engine: PlaybackEngine
	restoreFocus: boolean
}

export interface PlaybackResult {
	ok: boolean
	engine: PlaybackEngine
	reason?: string
}

const TIDAL_APP_NAME = 'TIDAL'
// Time the OS needs to actually switch focus before the keystroke is delivered.
// 80 ms is empirically enough on macOS and Windows; raise if presses sometimes
// fail to register.
const FOCUS_DELAY_SECONDS = 0.08

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

export function isSupportedShortcutKey(value: unknown): value is ShortcutKey {
	return typeof value === 'string' && (SUPPORTED_SHORTCUT_KEYS as readonly string[]).includes(value)
}

export async function sendPlaybackCommand(command: PlaybackCommand, options: PlaybackOptions): Promise<PlaybackResult> {
	if (options.engine === 'disabled') {
		return {
			ok: false,
			engine: 'disabled',
			reason:
				'Playback control engine is set to "Disabled" in the connection config. Pick an engine to enable Playback: actions.',
		}
	}

	if (command.type === 'custom_shortcut') {
		// Custom shortcuts only make sense for the focus_keystroke engine —
		// media_keys and playerctl have a fixed semantic command vocabulary.
		if (options.engine !== 'focus_keystroke') {
			return {
				ok: false,
				engine: options.engine,
				reason:
					'Custom keyboard shortcuts only work with the "Focus + keystroke" engine. Switch the Playback control engine to use this action.',
			}
		}
		try {
			await sendShortcutViaFocus(command.key, command.modifiers, options.restoreFocus)
			return { ok: true, engine: 'focus_keystroke' }
		} catch (err) {
			return { ok: false, engine: 'focus_keystroke', reason: (err as Error).message }
		}
	}

	switch (options.engine) {
		case 'focus_keystroke':
			return executeFocusKeystroke(command.type, options.restoreFocus)
		case 'media_keys':
			return executeMediaKeys(command.type)
		case 'playerctl':
			return executePlayerctl(command.type)
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function execFilePromise(cmd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
	return await new Promise((resolve, reject) => {
		execFile(cmd, args, (error, stdout, stderr) => {
			if (error) {
				const err = error instanceof Error ? error : new Error(`${cmd} failed`)
				reject(err)
			} else {
				resolve({ stdout: stdout.toString(), stderr: stderr.toString() })
			}
		})
	})
}

function isLikelyWayland(): boolean {
	return (env.XDG_SESSION_TYPE ?? '').toLowerCase() === 'wayland' || Boolean(env.WAYLAND_DISPLAY)
}

// ---------------------------------------------------------------------------
// Engine: focus + keystroke
// ---------------------------------------------------------------------------

// TIDAL desktop in-app keyboard shortcuts. Verified against the documented
// shortcut set (TutorialTactic, AudFree, DefKey, TuneSmake, CheatKeys) in
// May 2026. If TIDAL rebinds any of these in a future update, users can
// override via the per-button engine option or fall back to the
// "Send custom keyboard shortcut" action.
//
// Notes:
// - Seek ±10s requires Ctrl + Shift (not Shift alone) — this was fixed in v0.4.0.
// - TIDAL does NOT publish a native mute shortcut. The `mute_toggle` semantic
//   command therefore has no in-app shortcut; with the focus_keystroke engine
//   it falls back to nothing and logs a warning. Use the OS media keys engine
//   on Windows for the OS-level mute, or playerctl `volume 0` on Linux.
const SEMANTIC_TO_SHORTCUT: Partial<Record<SemanticCommand, { key: ShortcutKey; modifiers: AbstractModifier[] }>> = {
	play_pause: { key: 'space', modifiers: [] },
	next: { key: 'right', modifiers: ['cmdOrCtrl'] },
	previous: { key: 'left', modifiers: ['cmdOrCtrl'] },
	seek_forward: { key: 'right', modifiers: ['cmdOrCtrl', 'shift'] },
	seek_backward: { key: 'left', modifiers: ['cmdOrCtrl', 'shift'] },
	volume_up: { key: 'up', modifiers: ['cmdOrCtrl'] },
	volume_down: { key: 'down', modifiers: ['cmdOrCtrl'] },
	shuffle_toggle: { key: 's', modifiers: ['cmdOrCtrl'] },
	repeat_toggle: { key: 'r', modifiers: ['cmdOrCtrl'] },
	// mute_toggle deliberately omitted — TIDAL has no native mute shortcut.
}

async function executeFocusKeystroke(cmd: SemanticCommand, restoreFocus: boolean): Promise<PlaybackResult> {
	const mapping = SEMANTIC_TO_SHORTCUT[cmd]
	if (!mapping) {
		return {
			ok: false,
			engine: 'focus_keystroke',
			reason:
				cmd === 'mute_toggle'
					? 'TIDAL desktop does not have a native mute keyboard shortcut, so the focus_keystroke engine cannot toggle mute. Use the "OS media keys" engine on Windows for the OS-level mute, or "playerctl" on Linux (sets volume to 0).'
					: `Semantic command "${cmd}" has no TIDAL keyboard shortcut mapped in this module. Use the "Playback: Send custom keyboard shortcut" action to send an arbitrary key combo.`,
		}
	}
	try {
		await sendShortcutViaFocus(mapping.key, mapping.modifiers, restoreFocus)
		return { ok: true, engine: 'focus_keystroke' }
	} catch (err) {
		return { ok: false, engine: 'focus_keystroke', reason: (err as Error).message }
	}
}

async function sendShortcutViaFocus(
	key: ShortcutKey,
	modifiers: AbstractModifier[],
	restoreFocus: boolean,
): Promise<void> {
	switch (platform) {
		case 'darwin':
			return sendShortcutMacos(key, modifiers, restoreFocus)
		case 'win32':
			return sendShortcutWindows(key, modifiers, restoreFocus)
		default:
			return sendShortcutLinux(key, modifiers, restoreFocus)
	}
}

// ---- macOS focus + keystroke ---------------------------------------------

const MACOS_KEY_CODES: Partial<Record<ShortcutKey, number>> = {
	space: 49,
	left: 123,
	right: 124,
	down: 125,
	up: 126,
	enter: 36,
	escape: 53,
	tab: 48,
}

function macosModifierClause(modifiers: AbstractModifier[]): string {
	if (modifiers.length === 0) return ''
	const tokens: string[] = []
	for (const m of modifiers) {
		if (m === 'cmdOrCtrl') tokens.push('command down')
		else if (m === 'shift') tokens.push('shift down')
		else if (m === 'alt') tokens.push('option down')
	}
	return tokens.length ? ` using {${tokens.join(', ')}}` : ''
}

async function sendShortcutMacos(
	key: ShortcutKey,
	modifiers: AbstractModifier[],
	restoreFocus: boolean,
): Promise<void> {
	const keyCode = MACOS_KEY_CODES[key]
	const modClause = macosModifierClause(modifiers)
	const action =
		keyCode !== undefined ? `key code ${keyCode}${modClause}` : `keystroke "${key.replace(/"/g, '\\"')}"${modClause}`

	const scriptLines: string[] = []

	if (restoreFocus) {
		scriptLines.push(
			'tell application "System Events" to set previousApp to name of first application process whose frontmost is true',
		)
	}
	scriptLines.push(`tell application "${TIDAL_APP_NAME}" to activate`)
	scriptLines.push(`delay ${FOCUS_DELAY_SECONDS}`)
	scriptLines.push(`tell application "System Events" to ${action}`)
	if (restoreFocus) {
		scriptLines.push(`delay ${FOCUS_DELAY_SECONDS}`)
		scriptLines.push('tell application previousApp to activate')
	}

	const args = scriptLines.flatMap((line) => ['-e', line])
	await execFilePromise('osascript', args)
}

// ---- Windows focus + keystroke -------------------------------------------

const WINDOWS_KEY_MAP: Partial<Record<ShortcutKey, string>> = {
	space: ' ',
	left: '{LEFT}',
	right: '{RIGHT}',
	up: '{UP}',
	down: '{DOWN}',
	enter: '{ENTER}',
	escape: '{ESC}',
	tab: '{TAB}',
}

function windowsModifierPrefix(modifiers: AbstractModifier[]): string {
	let prefix = ''
	for (const m of modifiers) {
		if (m === 'cmdOrCtrl') prefix += '^'
		else if (m === 'shift') prefix += '+'
		else if (m === 'alt') prefix += '%'
	}
	return prefix
}

function escapePowerShellSingleQuoted(value: string): string {
	return value.replace(/'/g, "''")
}

async function sendShortcutWindows(
	key: ShortcutKey,
	modifiers: AbstractModifier[],
	restoreFocus: boolean,
): Promise<void> {
	const keyToken = WINDOWS_KEY_MAP[key] ?? key
	const combo = windowsModifierPrefix(modifiers) + keyToken
	const ms = Math.round(FOCUS_DELAY_SECONDS * 1000)

	const lines: string[] = ['$w = New-Object -ComObject WScript.Shell']
	if (restoreFocus) {
		// Capture the window title of the currently foreground window. We can't
		// reliably reactivate "the previous app" via WScript.Shell, but we can
		// re-AppActivate by title which gets us close enough for the common case.
		lines.push(
			'Add-Type @\'\nusing System.Runtime.InteropServices;\nusing System.Text;\npublic class W { [DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern int GetWindowText(System.IntPtr h, StringBuilder s, int c); }\n\'@',
		)
		lines.push('$sb = New-Object System.Text.StringBuilder 256')
		lines.push('[void][W]::GetWindowText([W]::GetForegroundWindow(), $sb, 256)')
		lines.push('$prevTitle = $sb.ToString()')
	}
	lines.push(`[void]$w.AppActivate('${escapePowerShellSingleQuoted(TIDAL_APP_NAME)}')`)
	lines.push(`Start-Sleep -Milliseconds ${ms}`)
	lines.push(`[void]$w.SendKeys('${escapePowerShellSingleQuoted(combo)}')`)
	if (restoreFocus) {
		lines.push(`Start-Sleep -Milliseconds ${ms}`)
		lines.push('if ($prevTitle) { [void]$w.AppActivate($prevTitle) }')
	}

	await execFilePromise('powershell', ['-NoProfile', '-Command', lines.join('; ')])
}

// ---- Linux focus + keystroke ---------------------------------------------

const LINUX_KEY_MAP: Partial<Record<ShortcutKey, string>> = {
	space: 'space',
	left: 'Left',
	right: 'Right',
	up: 'Up',
	down: 'Down',
	enter: 'Return',
	escape: 'Escape',
	tab: 'Tab',
}

function linuxModifierPrefix(modifiers: AbstractModifier[]): string {
	const parts: string[] = []
	for (const m of modifiers) {
		if (m === 'cmdOrCtrl') parts.push('ctrl')
		else if (m === 'shift') parts.push('shift')
		else if (m === 'alt') parts.push('alt')
	}
	return parts.length ? parts.join('+') + '+' : ''
}

async function sendShortcutLinux(
	key: ShortcutKey,
	modifiers: AbstractModifier[],
	restoreFocus: boolean,
): Promise<void> {
	const keyToken = LINUX_KEY_MAP[key] ?? key
	const combo = linuxModifierPrefix(modifiers) + keyToken

	if (isLikelyWayland()) {
		await sendShortcutLinuxWayland(key, keyToken, modifiers, combo)
		return
	}

	// X11 path. Without restoreFocus we send the combo to the TIDAL window and
	// leave focus there. With restoreFocus we capture the active window first,
	// activate TIDAL, send the combo, then re-activate the previous window.
	if (!restoreFocus) {
		await execFilePromise('xdotool', ['search', '--name', TIDAL_APP_NAME, 'windowactivate', '--sync', 'key', combo])
		return
	}

	const { stdout: prevWid } = await execFilePromise('xdotool', ['getactivewindow'])
	await execFilePromise('xdotool', ['search', '--name', TIDAL_APP_NAME, 'windowactivate', '--sync', 'key', combo])
	const trimmed = prevWid.trim()
	if (trimmed) {
		await execFilePromise('xdotool', ['windowactivate', '--sync', trimmed])
	}
}

// ---- Wayland focus + keystroke (best effort) -----------------------------

// Wayland intentionally prevents apps from injecting keystrokes into other
// windows without compositor cooperation, so there's no clean equivalent to
// xdotool. Best-effort approach:
//
//   1. Prefer `ydotool` if available. ydotool injects events at the kernel
//      uinput layer, so it works compositor-agnostic — *if* the user has set
//      up `ydotoold` (the system daemon) and either runs Companion as root or
//      added their user to the `input` group.
//   2. Fall back to `wtype`, which only sends keys to the currently focused
//      window. The user needs to ensure TIDAL is the focused app, or wire the
//      Stream Deck press to a workflow that briefly focuses TIDAL first
//      (e.g. via a compositor-specific helper like `kdotool` for KDE Wayland).
//
// In both cases we cannot reliably activate the TIDAL window from outside, so
// `restoreFocus` is silently ignored on Wayland.
async function sendShortcutLinuxWayland(
	key: ShortcutKey,
	keyToken: string,
	modifiers: AbstractModifier[],
	combo: string,
): Promise<void> {
	const ydotoolAvailable = await commandExists('ydotool')
	if (ydotoolAvailable) {
		await sendWaylandKeystrokeYdotool(key, modifiers)
		return
	}

	const wtypeAvailable = await commandExists('wtype')
	if (wtypeAvailable) {
		await sendWaylandKeystrokeWtype(keyToken, modifiers)
		return
	}

	throw new Error(
		`Linux Wayland focus_keystroke needs either \`ydotool\` (with the \`ydotoold\` daemon running and your user in the \`input\` group) or \`wtype\` installed. Neither was found on PATH. Combo we tried to send: ${combo}. Alternatives: switch the Playback control engine to "playerctl" (deterministic) or "media_keys" (which redirects to playerctl on Linux).`,
	)
}

// Check whether `cmd` is invokable from PATH. We use `which` (a real binary on
// every Linux distro that ships Wayland) as the primary check; the previous
// `command -v` attempt was dead code because `command` is a POSIX shell
// builtin, not a binary on PATH that `execFile` can locate. The `sh -c
// 'command -v …'` fallback covers ultra-minimal images that omit `which`.
async function commandExists(cmd: string): Promise<boolean> {
	try {
		await execFilePromise('which', [cmd])
		return true
	} catch {
		try {
			// cmd is always a hard-coded internal value ('ydotool' / 'wtype' /
			// 'playerctl'), never user input, so direct interpolation here is
			// safe; we also redirect output so callers can't be tricked by
			// stderr-only writes into thinking the lookup succeeded.
			await execFilePromise('sh', ['-c', `command -v ${cmd} >/dev/null 2>&1`])
			return true
		} catch {
			return false
		}
	}
}

// ydotool key codes for our supported keys. ydotool uses Linux input event
// codes from <linux/input-event-codes.h>; the syntax is `ydotool key
// <code>:<state>` with state=1 for press and 0 for release.
const YDOTOOL_KEYCODES: Partial<Record<ShortcutKey, number>> = {
	space: 57,
	left: 105,
	right: 106,
	up: 103,
	down: 108,
	enter: 28,
	escape: 1,
	tab: 15,
	a: 30,
	b: 48,
	c: 46,
	d: 32,
	e: 18,
	f: 33,
	g: 34,
	h: 35,
	i: 23,
	j: 36,
	k: 37,
	l: 38,
	m: 50,
	n: 49,
	o: 24,
	p: 25,
	q: 16,
	r: 19,
	s: 31,
	t: 20,
	u: 22,
	v: 47,
	w: 17,
	x: 45,
	y: 21,
	z: 44,
	'0': 11,
	'1': 2,
	'2': 3,
	'3': 4,
	'4': 5,
	'5': 6,
	'6': 7,
	'7': 8,
	'8': 9,
	'9': 10,
}

const YDOTOOL_MOD_KEYCODES: Record<AbstractModifier, number> = {
	cmdOrCtrl: 29, // KEY_LEFTCTRL
	shift: 42, // KEY_LEFTSHIFT
	alt: 56, // KEY_LEFTALT
}

async function sendWaylandKeystrokeYdotool(key: ShortcutKey, modifiers: AbstractModifier[]): Promise<void> {
	const keyCode = YDOTOOL_KEYCODES[key]
	if (keyCode === undefined) {
		throw new Error(`Wayland/ydotool path has no key-code mapping for "${key}".`)
	}

	// Press modifiers, press key, release key, release modifiers.
	const pressArgs: string[] = ['key']
	const releaseArgs: string[] = ['key']
	for (const mod of modifiers) {
		pressArgs.push(`${YDOTOOL_MOD_KEYCODES[mod]}:1`)
		releaseArgs.unshift(`${YDOTOOL_MOD_KEYCODES[mod]}:0`)
	}
	pressArgs.push(`${keyCode}:1`, `${keyCode}:0`)

	await execFilePromise('ydotool', pressArgs)
	if (releaseArgs.length > 1) {
		await execFilePromise('ydotool', releaseArgs)
	}
}

// wtype takes a -k flag with the X11 keysym name plus -M/-m for modifiers.
async function sendWaylandKeystrokeWtype(keyToken: string, modifiers: AbstractModifier[]): Promise<void> {
	const wtypeModNames: string[] = []
	for (const mod of modifiers) {
		if (mod === 'cmdOrCtrl') wtypeModNames.push('ctrl')
		else if (mod === 'shift') wtypeModNames.push('shift')
		else if (mod === 'alt') wtypeModNames.push('alt')
	}

	const args: string[] = []
	for (const m of wtypeModNames) args.push('-M', m)
	args.push('-k', keyToken)
	for (const m of wtypeModNames) args.push('-m', m)

	await execFilePromise('wtype', args)
}

// ---------------------------------------------------------------------------
// Engine: OS media keys (no focus stealing)
// ---------------------------------------------------------------------------

async function executeMediaKeys(cmd: SemanticCommand): Promise<PlaybackResult> {
	try {
		switch (platform) {
			case 'darwin':
				return await mediaKeysMacos(cmd)
			case 'win32':
				return await mediaKeysWindows(cmd)
			default: {
				// On Linux there's no separate "media keys" API; the equivalent is
				// the MPRIS bus which is exactly what the playerctl engine targets.
				// We transparently redirect so users don't have to know the
				// distinction — but rewrite the result so the user-facing engine
				// stays "media_keys", with the playerctl provenance noted in the
				// reason (if any).
				const r = await executePlayerctl(cmd)
				return {
					...r,
					engine: 'media_keys',
					reason: r.reason ? `(via playerctl on Linux) ${r.reason}` : r.reason,
				}
			}
		}
	} catch (err) {
		return { ok: false, engine: 'media_keys', reason: (err as Error).message }
	}
}

// macOS media keys.
//
// Primary path: a JXA (JavaScript-for-Automation) script that dlopen()s the
// private MediaRemote framework and calls MRMediaRemoteSendCommand directly.
// No external dependencies. Apple has kept this private function stable
// across macOS versions since ~10.12.5, but since it's private we transparently
// fall back to nowplaying-cli if present.
//
// MRMediaRemoteCommand enum (reverse-engineered):
//   0 Play, 1 Pause, 2 TogglePlayPause, 3 Stop,
//   4 NextTrack, 5 PreviousTrack,
//   6 AdvanceShuffleMode, 7 AdvanceRepeatMode,
//   8 BeginFastForward, 9 EndFastForward, 10 BeginRewind, 11 EndRewind, ...
const MACOS_MRMEDIA_COMMANDS: Partial<Record<SemanticCommand, number>> = {
	play_pause: 2,
	next: 4,
	previous: 5,
	shuffle_toggle: 6,
	repeat_toggle: 7,
}

const MACOS_NOWPLAYING_PATHS = ['/opt/homebrew/bin/nowplaying-cli', '/usr/local/bin/nowplaying-cli', 'nowplaying-cli']

const MACOS_NOWPLAYING_COMMANDS: Partial<Record<SemanticCommand, string>> = {
	play_pause: 'togglePlayPause',
	next: 'next',
	previous: 'previous',
}

async function mediaKeysMacos(cmd: SemanticCommand): Promise<PlaybackResult> {
	const mrCommand = MACOS_MRMEDIA_COMMANDS[cmd]
	if (mrCommand === undefined) {
		return {
			ok: false,
			engine: 'media_keys',
			reason: `${cmd} is not supported by the macOS media-keys engine. Supported: play_pause, next, previous, shuffle_toggle, repeat_toggle. Use the focus_keystroke engine for volume/seek/mute.`,
		}
	}

	// Primary: JXA + MRMediaRemoteSendCommand via dlopen.
	try {
		await sendMacosMediaRemoteCommand(mrCommand)
		return { ok: true, engine: 'media_keys' }
	} catch (primaryErr) {
		// Fallback: nowplaying-cli if installed (covers play/next/previous only).
		const nowplayingArg = MACOS_NOWPLAYING_COMMANDS[cmd]
		if (nowplayingArg) {
			for (const path of MACOS_NOWPLAYING_PATHS) {
				try {
					await execFilePromise(path, [nowplayingArg])
					return { ok: true, engine: 'media_keys' }
				} catch {
					// try next path
				}
			}
		}

		return {
			ok: false,
			engine: 'media_keys',
			reason: `JXA MRMediaRemoteSendCommand failed (${(primaryErr as Error).message}); fallback nowplaying-cli is also unavailable. Install nowplaying-cli with \`brew install nowplaying-cli\` as a backup, or switch the Playback control engine to "focus_keystroke".`,
		}
	}
}

async function sendMacosMediaRemoteCommand(command: number): Promise<void> {
	// dlopen flag 6 = RTLD_NOW | RTLD_GLOBAL — required so the symbol becomes
	// visible to ObjC.bindFunction. After bindFunction the C function is
	// accessible on the JXA global `$` namespace as $.MRMediaRemoteSendCommand.
	const script = [
		"ObjC.import('Foundation')",
		"ObjC.import('CoreFoundation')",
		"const h = $.dlopen('/System/Library/PrivateFrameworks/MediaRemote.framework/MediaRemote', 6)",
		"if (!h) { throw new Error('dlopen MediaRemote returned null') }",
		"ObjC.bindFunction('MRMediaRemoteSendCommand', ['void', ['int', 'id']])",
		`$.MRMediaRemoteSendCommand(${command}, $())`,
	].join('\n')

	await execFilePromise('osascript', ['-l', 'JavaScript', '-e', script])
}

// Windows media keys via PowerShell P/Invoke into user32.dll!keybd_event.
const WINDOWS_VK_CODES: Partial<Record<SemanticCommand, number>> = {
	play_pause: 0xb3,
	next: 0xb0,
	previous: 0xb1,
	volume_up: 0xaf,
	volume_down: 0xae,
	mute_toggle: 0xad,
}

async function mediaKeysWindows(cmd: SemanticCommand): Promise<PlaybackResult> {
	const vk = WINDOWS_VK_CODES[cmd]
	if (vk === undefined) {
		return {
			ok: false,
			engine: 'media_keys',
			reason: `${cmd} is not supported by the Windows media-keys engine. Windows VK_MEDIA_* covers Play/Pause, Next, Previous, Volume ±, and Mute only; for seek / shuffle / repeat actions switch this button (or the connection) to the "Focus + keystroke" engine.`,
		}
	}

	const ps = `Add-Type @'
using System.Runtime.InteropServices;
public class TidalMediaKeys {
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, int extra);
    public const uint KEYEVENTF_KEYUP = 0x0002;
    public static void Press(byte vk) {
        keybd_event(vk, 0, 0, 0);
        keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
    }
}
'@; [TidalMediaKeys]::Press(${vk})`

	await execFilePromise('powershell', ['-NoProfile', '-Command', ps])
	return { ok: true, engine: 'media_keys' }
}

// ---------------------------------------------------------------------------
// Engine: playerctl (Linux MPRIS)
// ---------------------------------------------------------------------------

// Common MPRIS bus names for the various TIDAL Linux clients. Order matters
// only insofar as we pass it as the comma-separated --player= list; playerctl
// targets the first one that's online.
const PLAYERCTL_PLAYERS = 'tidal-hifi,tidal,TIDAL'

const PLAYERCTL_COMMANDS: Partial<Record<SemanticCommand, string[]>> = {
	play_pause: ['play-pause'],
	next: ['next'],
	previous: ['previous'],
	volume_up: ['volume', '0.05+'],
	volume_down: ['volume', '0.05-'],
	mute_toggle: ['volume', '0'], // best effort — true mute toggle is not in MPRIS
	seek_forward: ['position', '10+'],
	seek_backward: ['position', '10-'],
	shuffle_toggle: ['shuffle', 'Toggle'],
	// repeat_toggle intentionally omitted — playerctl has `loop None|Track|Playlist`
	// but no Toggle verb, so we cannot cycle without reading current state.
}

async function executePlayerctl(cmd: SemanticCommand): Promise<PlaybackResult> {
	const args = PLAYERCTL_COMMANDS[cmd]
	if (!args) {
		return {
			ok: false,
			engine: 'playerctl',
			reason: `${cmd} is not mapped to a playerctl command.`,
		}
	}

	try {
		await execFilePromise('playerctl', ['--player', PLAYERCTL_PLAYERS, ...args])
		return { ok: true, engine: 'playerctl' }
	} catch (err) {
		const message = (err as Error).message
		// playerctl returns non-zero when no MPRIS player matching --player is
		// found. Surface that clearly so the user knows the TIDAL desktop client
		// either isn't running or isn't exposing MPRIS.
		if (message.toLowerCase().includes('no player') || message.includes('exit code 1')) {
			return {
				ok: false,
				engine: 'playerctl',
				reason: `playerctl could not find an MPRIS-exposing TIDAL client (looked for: ${PLAYERCTL_PLAYERS}). Make sure the TIDAL desktop app or tidal-hifi is running.`,
			}
		}
		return { ok: false, engine: 'playerctl', reason: message }
	}
}
