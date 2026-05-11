import type { CompanionActionDefinitions } from '@companion-module/base'
import { exec } from 'node:child_process'
import { platform } from 'node:process'
import type ModuleInstance from './main.js'
import type { SearchKind } from './tidal-api.js'

export type ActionsSchema = {
	search: { options: { query: string; kind: string; limit: number } }
	load_track: { options: { id: string } }
	load_track_by_isrc: { options: { isrc: string } }
	load_album: { options: { id: string } }
	load_playlist: { options: { id: string } }
	refresh_token: { options: Record<string, never> }
	open_tidal_uri: { options: { uri: string } }
	open_track_in_desktop: { options: { id: string } }
}

const SEARCH_KIND_CHOICES = [
	{ id: 'tracks', label: 'Tracks' },
	{ id: 'albums', label: 'Albums' },
	{ id: 'artists', label: 'Artists' },
	{ id: 'playlists', label: 'Playlists' },
	{ id: 'videos', label: 'Videos' },
]

async function openExternal(uri: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const command =
			platform === 'darwin'
				? `open ${JSON.stringify(uri)}`
				: platform === 'win32'
					? `start "" ${JSON.stringify(uri)}`
					: `xdg-open ${JSON.stringify(uri)}`

		exec(command, (error) => {
			if (error) reject(error)
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
				const limit = Number(event.options.limit ?? 10)
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
	}

	self.setActionDefinitions(actions)
}
