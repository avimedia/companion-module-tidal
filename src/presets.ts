import { combineRgb } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'
import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'

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
					down: [{ actionId: 'playback_play_pause', options: {} }],
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
					down: [{ actionId: 'playback_next', options: {} }],
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
					down: [{ actionId: 'playback_previous', options: {} }],
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
					down: [{ actionId: 'playback_volume_up', options: {} }],
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
					down: [{ actionId: 'playback_volume_down', options: {} }],
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
					down: [{ actionId: 'playback_mute_toggle', options: {} }],
					up: [],
				},
			],
			feedbacks: [],
		},
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
			],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
