import { execFile } from 'node:child_process'
import { platform } from 'node:process'

// Cross-platform helper that brings the TIDAL desktop app to the foreground and
// then synthesises a keyboard shortcut. TIDAL handles the shortcut natively,
// which is how playback control works today (the public TIDAL Web API does not
// expose play/pause/next/previous endpoints).
//
// Trade-off: each shortcut press briefly steals window focus. A "restore focus"
// variant could be added later by recording the previous frontmost app before
// activating TIDAL.

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

const TIDAL_APP_NAME = 'TIDAL'
// Time the OS needs to actually switch focus before the keystroke is delivered.
// 80 ms is empirically enough on macOS and Windows; raise if presses sometimes
// fail to register.
const FOCUS_DELAY_SECONDS = 0.08

async function execFilePromise(cmd: string, args: string[]): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		execFile(cmd, args, (error) => {
			if (error) {
				// node's typings already mark `error` as Error | null, but be defensive
				// in case a future runtime passes something else through this callback.
				const err = error instanceof Error ? error : new Error(`${cmd} failed`)
				reject(err)
			} else {
				resolve()
			}
		})
	})
}

export function isSupportedShortcutKey(value: unknown): value is ShortcutKey {
	return typeof value === 'string' && (SUPPORTED_SHORTCUT_KEYS as readonly string[]).includes(value)
}

export async function sendShortcutToTidal(key: ShortcutKey, modifiers: AbstractModifier[] = []): Promise<void> {
	switch (platform) {
		case 'darwin':
			return sendShortcutMacos(key, modifiers)
		case 'win32':
			return sendShortcutWindows(key, modifiers)
		default:
			return sendShortcutLinux(key, modifiers)
	}
}

// ---------------------------------------------------------------------------
// macOS — osascript + System Events
// ---------------------------------------------------------------------------

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

async function sendShortcutMacos(key: ShortcutKey, modifiers: AbstractModifier[]): Promise<void> {
	const keyCode = MACOS_KEY_CODES[key]
	const modClause = macosModifierClause(modifiers)
	const action =
		keyCode !== undefined ? `key code ${keyCode}${modClause}` : `keystroke "${key.replace(/"/g, '\\"')}"${modClause}`

	await execFilePromise('osascript', [
		'-e',
		`tell application "${TIDAL_APP_NAME}" to activate`,
		'-e',
		`delay ${FOCUS_DELAY_SECONDS}`,
		'-e',
		`tell application "System Events" to ${action}`,
	])
}

// ---------------------------------------------------------------------------
// Windows — PowerShell + WScript.Shell SendKeys
// ---------------------------------------------------------------------------

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

async function sendShortcutWindows(key: ShortcutKey, modifiers: AbstractModifier[]): Promise<void> {
	const keyToken = WINDOWS_KEY_MAP[key] ?? key
	const combo = windowsModifierPrefix(modifiers) + keyToken
	const ms = Math.round(FOCUS_DELAY_SECONDS * 1000)
	const ps = [
		`$w = New-Object -ComObject WScript.Shell`,
		`[void]$w.AppActivate('${escapePowerShellSingleQuoted(TIDAL_APP_NAME)}')`,
		`Start-Sleep -Milliseconds ${ms}`,
		`[void]$w.SendKeys('${escapePowerShellSingleQuoted(combo)}')`,
	].join('; ')

	await execFilePromise('powershell', ['-NoProfile', '-Command', ps])
}

// ---------------------------------------------------------------------------
// Linux — xdotool (X11) / wmctrl fallback
// ---------------------------------------------------------------------------

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

async function sendShortcutLinux(key: ShortcutKey, modifiers: AbstractModifier[]): Promise<void> {
	const keyToken = LINUX_KEY_MAP[key] ?? key
	const combo = linuxModifierPrefix(modifiers) + keyToken
	// `xdotool search --name TIDAL windowactivate --sync key <combo>` activates
	// the first window whose title contains "TIDAL" and sends the combo to it.
	// On Wayland this will fail — Wayland users need to swap in `wtype`/`ydotool`
	// or use Strategy B (system media keys via playerctl), which is on the
	// roadmap.
	await execFilePromise('xdotool', ['search', '--name', TIDAL_APP_NAME, 'windowactivate', '--sync', 'key', combo])
}
