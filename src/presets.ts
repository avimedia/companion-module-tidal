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
	]

	self.setPresetDefinitions(structure, presets)
}
