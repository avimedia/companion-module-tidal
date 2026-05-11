import { combineRgb } from '@companion-module/base'
import type ModuleInstance from './main.js'

export type FeedbacksSchema = {
	authenticated: { type: 'boolean'; options: Record<string, never> }
	has_search_results: { type: 'boolean'; options: Record<string, never> }
	track_explicit: { type: 'boolean'; options: Record<string, never> }
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		authenticated: {
			type: 'boolean',
			name: 'TIDAL is authenticated',
			description: 'True when a valid (non-expired) access token is present.',
			defaultStyle: {
				bgcolor: combineRgb(0, 102, 51),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.hasValidToken(),
		},
		has_search_results: {
			type: 'boolean',
			name: 'Last search returned results',
			description: 'True when the most recent search produced one or more results.',
			defaultStyle: {
				bgcolor: combineRgb(0, 51, 153),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.lastSearchCount > 0,
		},
		track_explicit: {
			type: 'boolean',
			name: 'Loaded track is explicit',
			description: 'True when the currently loaded track is flagged explicit.',
			defaultStyle: {
				bgcolor: combineRgb(153, 0, 0),
				color: combineRgb(255, 255, 255),
			},
			options: [],
			callback: () => self.currentTrackExplicit,
		},
	})
}
