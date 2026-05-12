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

const SEMANTIC_TO_SHORTCUT: Record<SemanticCommand, { key: ShortcutKey; modifiers: AbstractModifier[] }> = {
	play_pause: { key: 'space', modifiers: [] },
	next: { key: 'right', modifiers: ['cmdOrCtrl'] },
	previous: { key: 'left', modifiers: ['cmdOrCtrl'] },
	seek_forward: { key: 'right', modifiers: ['shift'] },
	seek_backward: { key: 'left', modifiers: ['shift'] },
	volume_up: { key: 'up', modifiers: ['cmdOrCtrl'] },
	volume_down: { key: 'down', modifiers: ['cmdOrCtrl'] },
	mute_toggle: { key: 'm', modifiers: ['cmdOrCtrl'] },
}

async function executeFocusKeystroke(cmd: SemanticCommand, restoreFocus: boolean): Promise<PlaybackResult> {
	const mapping = SEMANTIC_TO_SHORTCUT[cmd]
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
		// Wayland: no equivalent to xdotool for cross-app keystroke injection
		// without compositor cooperation. wtype only synthesises keys into the
		// currently focused window, so we cannot reliably target TIDAL.
		throw new Error(
			'Linux Wayland sessions do not support the focus_keystroke engine. Switch the Playback control engine to "playerctl" or "media_keys" (which redirects to playerctl on Linux).',
		)
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
			default:
				// On Linux there's no separate "media keys" API; the equivalent is
				// the MPRIS bus which is exactly what the playerctl engine targets.
				// We transparently redirect so users don't have to know the
				// distinction.
				return await executePlayerctl(cmd)
		}
	} catch (err) {
		return { ok: false, engine: 'media_keys', reason: (err as Error).message }
	}
}

// macOS media keys via the private MediaRemote framework. We don't bundle a
// compiled helper; instead we look for `nowplaying-cli` (an open-source CLI
// wrapping the same API). If the binary isn't on PATH we fail with a clear
// install hint.
const MACOS_NOWPLAYING_PATHS = ['/opt/homebrew/bin/nowplaying-cli', '/usr/local/bin/nowplaying-cli', 'nowplaying-cli']

const MACOS_NOWPLAYING_COMMANDS: Partial<Record<SemanticCommand, string>> = {
	play_pause: 'togglePlayPause',
	next: 'next',
	previous: 'previous',
}

async function mediaKeysMacos(cmd: SemanticCommand): Promise<PlaybackResult> {
	const arg = MACOS_NOWPLAYING_COMMANDS[cmd]
	if (!arg) {
		return {
			ok: false,
			engine: 'media_keys',
			reason: `${cmd} is not supported by the macOS media-keys engine (only play_pause/next/previous via nowplaying-cli). Use the focus_keystroke engine for volume/seek/mute.`,
		}
	}

	for (const path of MACOS_NOWPLAYING_PATHS) {
		try {
			await execFilePromise(path, [arg])
			return { ok: true, engine: 'media_keys' }
		} catch {
			// try next path
		}
	}

	return {
		ok: false,
		engine: 'media_keys',
		reason:
			'nowplaying-cli not found. Install it with `brew install nowplaying-cli` (https://github.com/kirtan-shah/nowplaying-cli), or switch the Playback control engine to "focus_keystroke".',
	}
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
			reason: `${cmd} is not supported by the Windows media-keys engine. Use the focus_keystroke engine for seek actions.`,
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
