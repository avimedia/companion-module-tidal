import type ModuleInstance from './main.js'

export const TIDAL_API_BASE = 'https://openapi.tidal.com/v2'

export type TidalResource = {
	id: string
	type: string
	attributes?: Record<string, unknown>
}

export type TidalSearchResponse = {
	data?: TidalResource[]
	included?: TidalResource[]
}

export type SearchKind = 'tracks' | 'albums' | 'artists' | 'playlists' | 'videos'

// Per-request timeout for the catalog API. Catalog responses are typically
// sub-second; 15 s bounds the worst case while still tolerating slow networks.
const TIDAL_API_TIMEOUT_MS = 15_000

export class TidalApi {
	private readonly self: ModuleInstance

	constructor(self: ModuleInstance) {
		this.self = self
	}

	private async request(path: string, query?: Record<string, string | undefined>): Promise<unknown> {
		const url = new URL(path.startsWith('http') ? path : `${TIDAL_API_BASE}${path}`)
		if (query) {
			for (const [key, value] of Object.entries(query)) {
				if (value !== undefined) url.searchParams.set(key, value)
			}
		}

		const sendOnce = async (forceRefresh: boolean): Promise<Response> => {
			const token = await this.self.ensureAccessToken(forceRefresh)
			if (!token) {
				throw new Error('No TIDAL access token available')
			}
			return fetch(url.toString(), {
				headers: {
					Authorization: `Bearer ${token}`,
					Accept: 'application/vnd.tidal.v1+json',
				},
				signal: AbortSignal.timeout(TIDAL_API_TIMEOUT_MS),
			})
		}

		// Best-effort 401 retry: if TIDAL rejects the cached token (e.g. the
		// user revoked the session, or the token expired between our buffer
		// check and the actual request), force a fresh refresh and try once
		// more. Other status codes propagate as the first error.
		let response = await sendOnce(false)
		if (response.status === 401) {
			response = await sendOnce(true)
		}

		const text = await response.text()
		if (!response.ok) {
			throw new Error(`TIDAL API ${response.status} ${response.statusText} on ${url.pathname}: ${text}`)
		}

		if (!text) return {}
		return JSON.parse(text)
	}

	async search(query: string, kind: SearchKind, countryCode: string, limit = 10): Promise<TidalSearchResponse> {
		const path = `/searchResults/${encodeURIComponent(query)}/relationships/${kind}`
		return (await this.request(path, {
			countryCode,
			'page[limit]': String(limit),
			include: kind,
		})) as TidalSearchResponse
	}

	async getTrack(id: string, countryCode: string): Promise<TidalSearchResponse> {
		return (await this.request(`/tracks/${encodeURIComponent(id)}`, { countryCode })) as TidalSearchResponse
	}

	async getAlbum(id: string, countryCode: string): Promise<TidalSearchResponse> {
		return (await this.request(`/albums/${encodeURIComponent(id)}`, { countryCode })) as TidalSearchResponse
	}

	async getArtist(id: string, countryCode: string): Promise<TidalSearchResponse> {
		return (await this.request(`/artists/${encodeURIComponent(id)}`, { countryCode })) as TidalSearchResponse
	}

	async getPlaylist(id: string, countryCode: string): Promise<TidalSearchResponse> {
		return (await this.request(`/playlists/${encodeURIComponent(id)}`, { countryCode })) as TidalSearchResponse
	}

	async getTrackByIsrc(isrc: string, countryCode: string): Promise<TidalSearchResponse> {
		return (await this.request(`/tracks`, {
			countryCode,
			'filter[isrc]': isrc,
		})) as TidalSearchResponse
	}

	async getCurrentUser(): Promise<TidalSearchResponse> {
		return (await this.request('/users/me')) as TidalSearchResponse
	}
}
