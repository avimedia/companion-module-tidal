import type ModuleInstance from './main.js'
import { PLAYLIST_TRACK_SLOTS, SEARCH_RESULT_SLOTS } from './main.js'

type SlotVariableKey =
	| `playlist_track_${number}_id`
	| `playlist_track_${number}_title`
	| `playlist_track_${number}_artists`
	| `playlist_track_${number}_uri`
	| `last_search_result_${number}_id`
	| `last_search_result_${number}_title`
	| `last_search_result_${number}_artists`
	| `last_search_result_${number}_uri`

// The slot-indexed variables (playlist_track_N_*, last_search_result_N_*) are
// programmatically generated below — keeping the schema shape open via this
// index signature keeps each slot strictly-typed while avoiding a 256-line
// hand-written enumeration.
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

	library_playlist_count: number | undefined
	library_refreshed_at: string | undefined

	last_loaded_playlist_id: string | undefined
	last_loaded_playlist_name: string | undefined
	last_loaded_playlist_count: number | undefined
} & { [K in SlotVariableKey]: string | undefined }

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	const defs: Record<string, { name: string }> = {
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

		library_playlist_count: { name: 'Library: cached playlist count' },
		library_refreshed_at: { name: 'Library: last refresh (ISO8601)' },

		last_loaded_playlist_id: { name: 'Loaded playlist: ID' },
		last_loaded_playlist_name: { name: 'Loaded playlist: name' },
		last_loaded_playlist_count: { name: 'Loaded playlist: track count' },
	}

	for (let i = 1; i <= PLAYLIST_TRACK_SLOTS; i++) {
		defs[`playlist_track_${i}_id`] = { name: `Loaded playlist: track ${i} ID` }
		defs[`playlist_track_${i}_title`] = { name: `Loaded playlist: track ${i} title` }
		defs[`playlist_track_${i}_artists`] = { name: `Loaded playlist: track ${i} artists` }
		defs[`playlist_track_${i}_uri`] = { name: `Loaded playlist: track ${i} TIDAL URI` }
	}

	for (let i = 1; i <= SEARCH_RESULT_SLOTS; i++) {
		defs[`last_search_result_${i}_id`] = { name: `Last search: result ${i} ID` }
		defs[`last_search_result_${i}_title`] = { name: `Last search: result ${i} title` }
		defs[`last_search_result_${i}_artists`] = { name: `Last search: result ${i} artists` }
		defs[`last_search_result_${i}_uri`] = { name: `Last search: result ${i} TIDAL URI` }
	}

	self.setVariableDefinitions(defs as never)
}
