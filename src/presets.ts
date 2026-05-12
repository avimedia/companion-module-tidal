import { combineRgb } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'
import { PLAYLIST_TRACK_SLOTS, SEARCH_RESULT_SLOTS } from './main.js'
import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import { PLAYBACK_ENGINE_DEFAULT_CHOICE } from './playback.js'

// Cap how many "Your playlists" presets we emit. The Companion preset library
// renders fine up to several hundred, but past ~300 the scroll experience
// degrades; users with very large libraries can still use the play_playlist
// dropdown for the long tail. (The dropdown is unlimited.)
const MAX_PLAYLIST_PRESETS = 300

// Frozen so a single shared reference cannot be accidentally mutated by callers
// across the 8 transport presets that share it.
const PLAYBACK_DEFAULT_ENGINE_OPTION = Object.freeze({ engine: PLAYBACK_ENGINE_DEFAULT_CHOICE })

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {
		now_playing: {
			type: 'simple',
			name: 'Now-loaded track title',
			style: {
				text: '$(tidal:current_track_title)\n$(tidal:current_track_artists)',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(0, 0, 0),
			},
			steps: [
				{
					down: [],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'track_explicit',
					options: {},
					style: {
						bgcolor: combineRgb(153, 0, 0),
						color: combineRgb(255, 255, 255),
					},
				},
			],
		},
		search_first_result: {
			type: 'simple',
			name: 'Search first result',
			style: {
				text: 'Search:\n$(tidal:last_search_query)\n→ $(tidal:last_search_first_title)',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(0, 51, 153),
			},
			steps: [
				{
					down: [],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'has_search_results',
					options: {},
					style: {
						bgcolor: combineRgb(0, 102, 51),
						color: combineRgb(255, 255, 255),
					},
				},
			],
		},
		auth_status: {
			type: 'simple',
			name: 'TIDAL authentication state',
			style: {
				text: 'TIDAL\n$(tidal:auth_status)',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(64, 64, 64),
			},
			steps: [
				{
					down: [
						{
							actionId: 'refresh_token',
							options: {},
						},
					],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'authenticated',
					options: {},
					style: {
						bgcolor: combineRgb(0, 102, 51),
						color: combineRgb(255, 255, 255),
					},
				},
			],
		},
		playback_play_pause: {
			type: 'simple',
			name: 'Play / Pause',
			style: {
				text: '⏯\nPlay / Pause',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(0, 102, 51),
			},
			steps: [
				{
					down: [{ actionId: 'playback_play_pause', options: PLAYBACK_DEFAULT_ENGINE_OPTION }],
					up: [],
				},
			],
			feedbacks: [],
		},
		playback_next: {
			type: 'simple',
			name: 'Next track',
			style: {
				text: '⏭\nNext',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(32, 32, 32),
			},
			steps: [
				{
					down: [{ actionId: 'playback_next', options: PLAYBACK_DEFAULT_ENGINE_OPTION }],
					up: [],
				},
			],
			feedbacks: [],
		},
		playback_previous: {
			type: 'simple',
			name: 'Previous track',
			style: {
				text: '⏮\nPrev',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(32, 32, 32),
			},
			steps: [
				{
					down: [{ actionId: 'playback_previous', options: PLAYBACK_DEFAULT_ENGINE_OPTION }],
					up: [],
				},
			],
			feedbacks: [],
		},
		playback_volume_up: {
			type: 'simple',
			name: 'Volume up',
			style: {
				text: '🔊\nVol +',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(64, 64, 64),
			},
			steps: [
				{
					down: [{ actionId: 'playback_volume_up', options: PLAYBACK_DEFAULT_ENGINE_OPTION }],
					up: [],
				},
			],
			feedbacks: [],
		},
		playback_volume_down: {
			type: 'simple',
			name: 'Volume down',
			style: {
				text: '🔉\nVol −',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(64, 64, 64),
			},
			steps: [
				{
					down: [{ actionId: 'playback_volume_down', options: PLAYBACK_DEFAULT_ENGINE_OPTION }],
					up: [],
				},
			],
			feedbacks: [],
		},
		playback_mute_toggle: {
			type: 'simple',
			name: 'Mute / Unmute',
			style: {
				text: '🔇\nMute',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(64, 64, 64),
			},
			steps: [
				{
					down: [{ actionId: 'playback_mute_toggle', options: PLAYBACK_DEFAULT_ENGINE_OPTION }],
					up: [],
				},
			],
			feedbacks: [],
		},
		playback_shuffle_toggle: {
			type: 'simple',
			name: 'Shuffle',
			style: {
				text: '🔀\nShuffle',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(64, 64, 64),
			},
			steps: [
				{
					down: [{ actionId: 'playback_shuffle_toggle', options: PLAYBACK_DEFAULT_ENGINE_OPTION }],
					up: [],
				},
			],
			feedbacks: [],
		},
		playback_repeat_toggle: {
			type: 'simple',
			name: 'Repeat',
			style: {
				text: '🔁\nRepeat',
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(64, 64, 64),
			},
			steps: [
				{
					down: [{ actionId: 'playback_repeat_toggle', options: PLAYBACK_DEFAULT_ENGINE_OPTION }],
					up: [],
				},
			],
			feedbacks: [],
		},
	}

	// "Your playlists" — one auto-generated preset per cached playlist. Names
	// are sanitised to fit a button cell at the auto size; the actual TIDAL
	// playlist name is also surfaced via $(tidal:last_loaded_playlist_name)
	// once the user triggers a load.
	const playlistPresetIds: string[] = []
	for (const playlist of self.playlistCache.slice(0, MAX_PLAYLIST_PRESETS)) {
		const presetId = `library_playlist_${playlist.id}`
		playlistPresetIds.push(presetId)
		presets[presetId as keyof typeof presets] = {
			type: 'simple',
			name: `Playlist: ${playlist.name}`,
			style: {
				text: `♪\n${truncate(playlist.name, 40)}`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(0, 64, 128),
			},
			steps: [
				{
					down: [{ actionId: 'play_playlist', options: { playlistId: playlist.id } }],
					up: [],
				},
			],
			feedbacks: [],
		}
	}

	// "Current playlist tracks" — N fixed presets that reference the
	// playlist_track_<n>_* variable family. They render empty until the user
	// runs "Load playlist tracks into variables", then come alive without
	// requiring a preset re-emission per playlist.
	const currentTrackPresetIds: string[] = []
	for (let i = 1; i <= PLAYLIST_TRACK_SLOTS; i++) {
		const presetId = `current_playlist_track_${i}`
		currentTrackPresetIds.push(presetId)
		presets[presetId as keyof typeof presets] = {
			type: 'simple',
			name: `Current playlist: track ${i}`,
			style: {
				text: `${i}.\n$(tidal:playlist_track_${i}_title)`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(64, 0, 96),
			},
			steps: [
				{
					down: [
						{
							actionId: 'open_tidal_uri',
							options: { uri: `$(tidal:playlist_track_${i}_uri)` },
						},
					],
					up: [],
				},
			],
			feedbacks: [],
		}
	}

	// "Search results" — N fixed presets backed by last_search_result_<n>_*
	// variables, regenerated transparently after every search action.
	const searchResultPresetIds: string[] = []
	for (let i = 1; i <= SEARCH_RESULT_SLOTS; i++) {
		const presetId = `search_result_${i}`
		searchResultPresetIds.push(presetId)
		presets[presetId as keyof typeof presets] = {
			type: 'simple',
			name: `Search result ${i}`,
			style: {
				text: `${i}.\n$(tidal:last_search_result_${i}_title)`,
				size: 'auto',
				color: combineRgb(255, 255, 255),
				bgcolor: combineRgb(96, 64, 0),
			},
			steps: [
				{
					down: [{ actionId: 'play_search_result', options: { index: i } }],
					up: [],
				},
			],
			feedbacks: [],
		}
	}

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{
			id: 'loaded_track',
			name: 'Loaded track',
			definitions: ['now_playing'],
		},
		{
			id: 'search',
			name: 'Search',
			definitions: ['search_first_result'],
		},
		{
			id: 'status',
			name: 'Status',
			definitions: ['auth_status'],
		},
		{
			id: 'transport',
			name: 'Transport',
			definitions: [
				'playback_previous',
				'playback_play_pause',
				'playback_next',
				'playback_volume_down',
				'playback_volume_up',
				'playback_mute_toggle',
				'playback_shuffle_toggle',
				'playback_repeat_toggle',
			],
		},
		{
			id: 'library_playlists',
			name: 'Your playlists',
			definitions: playlistPresetIds,
		},
		{
			id: 'current_playlist_tracks',
			name: 'Current playlist tracks',
			definitions: currentTrackPresetIds,
		},
		{
			id: 'search_results',
			name: 'Search results',
			definitions: searchResultPresetIds,
		},
	]

	self.setPresetDefinitions(structure, presets)
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s
	return `${s.slice(0, max - 1)}…`
}
