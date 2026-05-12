import type { CompanionActionDefinitions, DropdownChoice } from '@companion-module/base'
import { execFile } from 'node:child_process'
import { platform } from 'node:process'
import type ModuleInstance from './main.js'
import { PLAYLIST_TRACK_SLOTS, SEARCH_RESULT_SLOTS } from './main.js'
import type { SearchKind } from './tidal-api.js'
import {
	type AbstractModifier,
	PLAYBACK_ENGINE_DEFAULT_CHOICE,
	type PlaybackCommand,
	type PlaybackEngine,
	type SemanticCommand,
	SUPPORTED_SHORTCUT_KEYS,
	isSupportedShortcutKey,
	sendPlaybackCommand,
} from './playback.js'

type PlaybackActionOptions = { engine: string }

export type ActionsSchema = {
	search: { options: { query: string; kind: string; limit: number } }
	load_track: { options: { id: string } }
	load_track_by_isrc: { options: { isrc: string } }
	load_album: { options: { id: string } }
	load_playlist: { options: { id: string } }
	refresh_token: { options: Record<string, never> }
	refresh_library: { options: Record<string, never> }
	play_playlist: { options: { playlistId: string } }
	load_playlist_into_variables: { options: { playlistId: string; count: number } }
	play_search_result: { options: { index: number } }
	open_tidal_uri: { options: { uri: string } }
	open_track_in_desktop: { options: { id: string } }
	playback_play_pause: { options: PlaybackActionOptions }
	playback_next: { options: PlaybackActionOptions }
	playback_previous: { options: PlaybackActionOptions }
	playback_seek_forward: { options: PlaybackActionOptions }
	playback_seek_backward: { options: PlaybackActionOptions }
	playback_volume_up: { options: PlaybackActionOptions }
	playback_volume_down: { options: PlaybackActionOptions }
	playback_mute_toggle: { options: PlaybackActionOptions }
	playback_shuffle_toggle: { options: PlaybackActionOptions }
	playback_repeat_toggle: { options: PlaybackActionOptions }
	playback_send_shortcut: { options: { key: string; modifiers: string[]; engine: string } }
}

const PLAYBACK_ENGINE_CHOICES = [
	{
		id: PLAYBACK_ENGINE_DEFAULT_CHOICE,
		label: 'Use connection config default',
	},
	{ id: 'disabled', label: 'Disabled' },
	{ id: 'focus_keystroke', label: 'Focus + keystroke' },
	{ id: 'media_keys', label: 'OS media keys' },
	{ id: 'playerctl', label: 'playerctl (Linux MPRIS)' },
]

function resolveEngine(self: ModuleInstance, raw: unknown): PlaybackEngine {
	if (typeof raw === 'string' && raw !== PLAYBACK_ENGINE_DEFAULT_CHOICE && raw !== '') {
		if (raw === 'disabled' || raw === 'focus_keystroke' || raw === 'media_keys' || raw === 'playerctl') {
			return raw
		}
	}
	return self.config.playbackEngine
}

const SEARCH_KIND_CHOICES = [
	{ id: 'tracks', label: 'Tracks' },
	{ id: 'albums', label: 'Albums' },
	{ id: 'artists', label: 'Artists' },
	{ id: 'playlists', label: 'Playlists' },
	{ id: 'videos', label: 'Videos' },
]

// Launches a URI through the OS via argv-array spawn — never via a shell — so
// arbitrary user-supplied URI strings cannot inject shell metacharacters.
//   macOS:   `open <uri>`
//   Linux:   `xdg-open <uri>`
//   Windows: `rundll32.exe url.dll,FileProtocolHandler <uri>` (the standard
//            Windows URL protocol-handler entry point; doesn't shell-interpret).
async function openExternal(uri: string): Promise<void> {
	const [cmd, args]: [string, string[]] =
		platform === 'darwin'
			? ['open', [uri]]
			: platform === 'win32'
				? ['rundll32.exe', ['url.dll,FileProtocolHandler', uri]]
				: ['xdg-open', [uri]]

	return new Promise((resolve, reject) => {
		execFile(cmd, args, (error) => {
			if (error) reject(error instanceof Error ? error : new Error(`${cmd} failed`))
			else resolve()
		})
	})
}

export function UpdateActions(self: ModuleInstance): void {
	const actions: CompanionActionDefinitions<ActionsSchema> = {
		search: {
			name: 'Search catalog',
			description: 'Search the TIDAL catalog. Stores the first result in the loaded-track variables.',
			options: [
				{
					type: 'textinput',
					id: 'query',
					label: 'Query',
					default: '',
					useVariables: true,
				},
				{
					type: 'dropdown',
					id: 'kind',
					label: 'Kind',
					default: 'tracks',
					choices: SEARCH_KIND_CHOICES,
				},
				{
					type: 'number',
					id: 'limit',
					label: 'Result limit',
					default: 10,
					min: 1,
					max: 50,
				},
			],
			callback: async (event) => {
				const query = String(event.options.query ?? '').trim()
				const kind = event.options.kind as SearchKind
				const rawLimit = Number(event.options.limit ?? 10)
				const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, Math.trunc(rawLimit))) : 10
				await self.performSearch(query, kind, limit)
			},
		},
		load_track: {
			name: 'Load track by ID',
			description: 'Fetch track metadata by its numeric TIDAL ID and store it in variables.',
			options: [
				{
					type: 'textinput',
					id: 'id',
					label: 'Track ID',
					default: '',
					useVariables: true,
				},
			],
			callback: async (event) => {
				await self.loadTrack(String(event.options.id ?? '').trim())
			},
		},
		load_track_by_isrc: {
			name: 'Load track by ISRC',
			description: 'Look up a track by its ISRC code (useful for stage/cue sheets).',
			options: [
				{
					type: 'textinput',
					id: 'isrc',
					label: 'ISRC',
					default: '',
					useVariables: true,
				},
			],
			callback: async (event) => {
				await self.loadTrackByIsrc(String(event.options.isrc ?? '').trim())
			},
		},
		load_album: {
			name: 'Load album by ID',
			options: [
				{
					type: 'textinput',
					id: 'id',
					label: 'Album ID',
					default: '',
					useVariables: true,
				},
			],
			callback: async (event) => {
				await self.loadAlbum(String(event.options.id ?? '').trim())
			},
		},
		load_playlist: {
			name: 'Load playlist by ID',
			options: [
				{
					type: 'textinput',
					id: 'id',
					label: 'Playlist ID (UUID)',
					default: '',
					useVariables: true,
				},
			],
			callback: async (event) => {
				await self.loadPlaylist(String(event.options.id ?? '').trim())
			},
		},
		refresh_token: {
			name: 'Refresh access token',
			description: 'Force a token refresh now (or fetch a new client-credentials token).',
			options: [],
			callback: async () => {
				await self.refreshTokenNow()
			},
		},
		refresh_library: {
			name: 'Refresh user library (playlists)',
			description:
				'Re-fetch your owned playlists from TIDAL and repopulate the "Your playlists" dropdown and preset section. Requires Authorization Code mode — Client Credentials cannot see user-scoped data.',
			options: [],
			callback: async () => {
				await self.refreshLibrary()
			},
		},
		play_playlist: {
			name: 'Play playlist (from your library)',
			description:
				'Launches tidal://playlist/<id> in the TIDAL desktop app for a playlist you own. The dropdown is populated from the most recent library refresh; run "Refresh user library" if you don\'t see a freshly-created playlist.',
			options: [
				{
					type: 'dropdown',
					id: 'playlistId',
					label: 'Playlist',
					default: '',
					choices: buildPlaylistChoices(self),
					allowCustom: true,
				},
			],
			callback: async (event) => {
				const id = String(event.options.playlistId ?? '').trim()
				if (!id) {
					self.log('warn', 'play_playlist called with no playlist selected')
					return
				}
				try {
					await openExternal(`tidal://playlist/${id}`)
					self.log('info', `Opened playlist ${id} in TIDAL`)
				} catch (err) {
					self.log('error', `play_playlist failed for ${id}: ${(err as Error).message}`)
				}
			},
		},
		load_playlist_into_variables: {
			name: 'Load playlist tracks into variables',
			description:
				'Fetch up to N tracks of the chosen playlist and publish them as playlist_track_1_* … playlist_track_N_* variables. Also regenerates the "Current playlist tracks" preset section so each track can be dragged onto a button.',
			options: [
				{
					type: 'dropdown',
					id: 'playlistId',
					label: 'Playlist',
					default: '',
					choices: buildPlaylistChoices(self),
					allowCustom: true,
				},
				{
					type: 'number',
					id: 'count',
					label: `Tracks to load (max ${PLAYLIST_TRACK_SLOTS})`,
					default: PLAYLIST_TRACK_SLOTS,
					min: 1,
					max: PLAYLIST_TRACK_SLOTS,
				},
			],
			callback: async (event) => {
				const id = String(event.options.playlistId ?? '').trim()
				const rawCount = Number(event.options.count ?? PLAYLIST_TRACK_SLOTS)
				const count = Number.isFinite(rawCount)
					? Math.max(1, Math.min(PLAYLIST_TRACK_SLOTS, Math.trunc(rawCount)))
					: PLAYLIST_TRACK_SLOTS
				if (!id) {
					self.log('warn', 'load_playlist_into_variables called with no playlist selected')
					return
				}
				await self.loadPlaylistIntoVariables(id, count)
			},
		},
		play_search_result: {
			name: 'Play search result (by index)',
			description: `Plays the Nth result of the most recent search (1-${SEARCH_RESULT_SLOTS}). Useful for "Search X" → "Play 1st result" two-button workflows.`,
			options: [
				{
					type: 'number',
					id: 'index',
					label: `Result index (1-${SEARCH_RESULT_SLOTS})`,
					default: 1,
					min: 1,
					max: SEARCH_RESULT_SLOTS,
				},
			],
			callback: async (event) => {
				const rawIndex = Number(event.options.index ?? 1)
				const index = Number.isFinite(rawIndex) ? Math.max(1, Math.min(SEARCH_RESULT_SLOTS, Math.trunc(rawIndex))) : 1
				await self.playSearchResult(index)
			},
		},
		open_tidal_uri: {
			name: 'Open URI in TIDAL desktop app',
			description:
				'Launches a tidal:// URI through the OS. Companion needs to be running on a machine where the TIDAL desktop app is installed.',
			options: [
				{
					type: 'textinput',
					id: 'uri',
					label: 'URI (e.g. tidal://track/12345 or https://tidal.com/track/12345)',
					default: 'tidal://track/$(tidal:current_track_id)',
					useVariables: true,
				},
			],
			callback: async (event) => {
				const uri = String(event.options.uri ?? '').trim()
				if (!uri) {
					self.log('warn', 'open_tidal_uri called with empty URI')
					return
				}
				try {
					await openExternal(uri)
					self.log('info', `Opened ${uri}`)
				} catch (err) {
					self.log('error', `Failed to open URI ${uri}: ${(err as Error).message}`)
				}
			},
		},
		open_track_in_desktop: {
			name: 'Open track in TIDAL desktop app',
			description: 'Convenience wrapper that opens tidal://track/<id> via the OS.',
			options: [
				{
					type: 'textinput',
					id: 'id',
					label: 'Track ID',
					default: '$(tidal:current_track_id)',
					useVariables: true,
				},
			],
			callback: async (event) => {
				const id = String(event.options.id ?? '').trim()
				if (!id) {
					self.log('warn', 'open_track_in_desktop called with empty ID')
					return
				}
				try {
					await openExternal(`tidal://track/${id}`)
				} catch (err) {
					self.log('error', `Failed to open track ${id}: ${(err as Error).message}`)
				}
			},
		},
		playback_play_pause: makePlaybackAction(self, 'Playback: Play / Pause', 'play_pause'),
		playback_next: makePlaybackAction(self, 'Playback: Next track', 'next'),
		playback_previous: makePlaybackAction(self, 'Playback: Previous track', 'previous'),
		playback_seek_forward: makePlaybackAction(self, 'Playback: Seek forward', 'seek_forward'),
		playback_seek_backward: makePlaybackAction(self, 'Playback: Seek backward', 'seek_backward'),
		playback_volume_up: makePlaybackAction(self, 'Playback: Volume up', 'volume_up'),
		playback_volume_down: makePlaybackAction(self, 'Playback: Volume down', 'volume_down'),
		playback_mute_toggle: makePlaybackAction(self, 'Playback: Toggle mute', 'mute_toggle'),
		playback_shuffle_toggle: makePlaybackAction(self, 'Playback: Toggle shuffle', 'shuffle_toggle'),
		playback_repeat_toggle: makePlaybackAction(self, 'Playback: Cycle repeat mode', 'repeat_toggle'),
		playback_send_shortcut: {
			name: 'Playback: Send custom keyboard shortcut to TIDAL',
			description:
				'Sends an arbitrary keystroke to the TIDAL desktop window. Requires the chosen engine to resolve to "Focus + keystroke" — other engines will log a warning and skip. Use the per-button Engine dropdown below to override the connection-level engine for this single button.',
			options: [
				{
					type: 'dropdown',
					id: 'key',
					label: 'Key',
					default: 'space',
					choices: SUPPORTED_SHORTCUT_KEYS.map((k) => ({ id: k, label: k })),
				},
				{
					type: 'multidropdown',
					id: 'modifiers',
					label: 'Modifiers',
					default: [],
					choices: [
						{ id: 'cmdOrCtrl', label: '⌘ on macOS / Ctrl on Windows & Linux' },
						{ id: 'shift', label: 'Shift' },
						{ id: 'alt', label: '⌥ Option / Alt' },
					],
				},
				{
					type: 'dropdown',
					id: 'engine',
					label: 'Engine (overrides connection config)',
					default: PLAYBACK_ENGINE_DEFAULT_CHOICE,
					choices: PLAYBACK_ENGINE_CHOICES,
				},
			],
			callback: async (event) => {
				const rawKey = String(event.options.key ?? '').trim()
				if (!isSupportedShortcutKey(rawKey)) {
					self.log('error', `playback_send_shortcut called with unsupported key "${rawKey}"`)
					return
				}
				const rawMods = Array.isArray(event.options.modifiers) ? event.options.modifiers : []
				const modifiers = rawMods.filter(
					(m): m is AbstractModifier => m === 'cmdOrCtrl' || m === 'shift' || m === 'alt',
				)
				const engine = resolveEngine(self, event.options.engine)
				const command: PlaybackCommand = { type: 'custom_shortcut', key: rawKey, modifiers }
				await dispatchPlayback(self, `playback_send_shortcut (${rawKey}, [${modifiers.join(', ')}])`, command, engine)
			},
		},
	}

	self.setActionDefinitions(actions)
}

function makePlaybackAction(
	self: ModuleInstance,
	name: string,
	semantic: SemanticCommand,
): CompanionActionDefinitions<ActionsSchema>['playback_play_pause'] {
	return {
		name,
		description:
			'Controls the locally installed TIDAL desktop app. The engine used (focus+keystroke / media keys / playerctl / disabled) defaults to the connection config, but can be overridden per button.',
		options: [
			{
				type: 'dropdown',
				id: 'engine',
				label: 'Engine (overrides connection config)',
				default: PLAYBACK_ENGINE_DEFAULT_CHOICE,
				choices: PLAYBACK_ENGINE_CHOICES,
			},
		],
		callback: async (event) => {
			const engine = resolveEngine(self, event.options.engine)
			await dispatchPlayback(self, name, { type: semantic }, engine)
		},
	}
}

// Computes the playlist-dropdown choices from the module's library cache.
// Called fresh every time UpdateActions runs, so a refresh_library invocation
// (which calls self.updateActions()) repopulates the UI dropdown without
// requiring a Companion reload. The first entry is a "no selection" sentinel
// so users get a clear hint when the library hasn't been refreshed yet.
function buildPlaylistChoices(self: ModuleInstance): DropdownChoice[] {
	const placeholder: DropdownChoice =
		self.playlistCache.length === 0
			? { id: '', label: '— Run "Refresh user library" first (Authorization Code mode) —' }
			: { id: '', label: '— Select a playlist —' }
	return [
		placeholder,
		...self.playlistCache.map((p) => ({
			id: p.id,
			label: p.numberOfItems > 0 ? `${p.name} (${p.numberOfItems} tracks)` : p.name,
		})),
	]
}

async function dispatchPlayback(
	self: ModuleInstance,
	name: string,
	command: PlaybackCommand,
	engine: PlaybackEngine,
): Promise<void> {
	try {
		const result = await sendPlaybackCommand(command, {
			engine,
			restoreFocus: self.config.playbackRestoreFocus,
		})
		if (!result.ok) {
			self.log('warn', `${name} skipped (engine=${result.engine}): ${result.reason ?? 'no reason provided'}`)
		}
	} catch (err) {
		self.log('error', `${name} failed: ${(err as Error).message}`)
	}
}
