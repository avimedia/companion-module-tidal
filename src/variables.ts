import type ModuleInstance from './main.js'

export type VariablesSchema = {
	auth_status: string | undefined
	auth_expires_at: string | undefined

	current_track_id: string | undefined
	current_track_title: string | undefined
	current_track_artists: string | undefined
	current_track_album: string | undefined
	current_track_isrc: string | undefined
	current_track_duration: string | undefined
	current_track_explicit: string | undefined
	current_track_uri: string | undefined

	last_search_count: number | undefined
	last_search_query: string | undefined
	last_search_kind: string | undefined
	last_search_first_id: string | undefined
	last_search_first_title: string | undefined

	current_user_id: string | undefined
	current_user_name: string | undefined
	current_user_country: string | undefined
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions({
		auth_status: { name: 'Authentication status' },
		auth_expires_at: { name: 'Access token expiry (ISO8601)' },

		current_track_id: { name: 'Loaded track: ID' },
		current_track_title: { name: 'Loaded track: title' },
		current_track_artists: { name: 'Loaded track: artists' },
		current_track_album: { name: 'Loaded track: album' },
		current_track_isrc: { name: 'Loaded track: ISRC' },
		current_track_duration: { name: 'Loaded track: duration (seconds)' },
		current_track_explicit: { name: 'Loaded track: explicit (true/false)' },
		current_track_uri: { name: 'Loaded track: TIDAL URI' },

		last_search_count: { name: 'Last search: result count' },
		last_search_query: { name: 'Last search: query' },
		last_search_kind: { name: 'Last search: kind' },
		last_search_first_id: { name: 'Last search: first result ID' },
		last_search_first_title: { name: 'Last search: first result title' },

		current_user_id: { name: 'Signed-in user: ID' },
		current_user_name: { name: 'Signed-in user: display name' },
		current_user_country: { name: 'Signed-in user: country' },
	})
}
