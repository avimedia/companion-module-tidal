import type ModuleInstance from './main.js'

export const TIDAL_API_BASE = 'https://openapi.tidal.com/v2'

export type TidalResource = {
	id: string
	type: string
	attributes?: Record<string, unknown>
	relationships?: Record<string, { data?: TidalRelationshipRef | TidalRelationshipRef[]; links?: TidalLinks }>
}

export type TidalRelationshipRef = { id: string; type: string }

export type TidalLinks = {
	self?: string
	next?: string
	prev?: string
}

export type TidalSearchResponse = {
	data?: TidalResource[] | TidalResource
	included?: TidalResource[]
	links?: TidalLinks
}

export type SearchKind = 'tracks' | 'albums' | 'artists' | 'playlists' | 'videos'

// Conservative hard cap on how many pages we'll follow when paginating a
// library list. 100 pages × 20 items/page = 2 000 entries — well past any
// realistic personal-library size and still bounded against pathological
// cursor loops or runaway accounts.
const MAX_PAGES = 100
const DEFAULT_PAGE_SIZE = 20

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
			// Drain (or cancel) the first response body before re-issuing the
			// request, otherwise the underlying socket/connection stays pinned
			// to the un-read body until garbage collection. The cancel() call
			// is best-effort — if the runtime doesn't expose a ReadableStream
			// body we fall through to reading text() and discarding it.
			try {
				await response.body?.cancel()
			} catch {
				try {
					await response.text()
				} catch {
					/* best effort */
				}
			}
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

	// Owned playlists. The v2 API exposes no `/users/me/playlists` shortcut, so
	// we filter the general /playlists endpoint by owner id. Cursor pagination
	// is followed automatically up to MAX_PAGES.
	async listOwnedPlaylists(userId: string, countryCode: string): Promise<TidalResource[]> {
		if (!userId) return []
		return this.collectPaginated(`/playlists`, {
			countryCode,
			'filter[owners.id]': userId,
			'page[size]': String(DEFAULT_PAGE_SIZE),
		})
	}

	// Items (tracks/videos) inside a specific playlist. `include=items` hydrates
	// each item's attributes inline under the `included` array — we merge those
	// back into a flat track-shaped list keyed by the relationship order.
	async listPlaylistItems(playlistId: string, countryCode: string, maxItems: number = 200): Promise<TidalResource[]> {
		if (!playlistId) return []
		const path = `/playlists/${encodeURIComponent(playlistId)}/relationships/items`
		const refs = await this.collectPaginated(
			path,
			{ countryCode, 'page[size]': String(DEFAULT_PAGE_SIZE), include: 'items' },
			maxItems,
		)

		// The relationships endpoint returns refs (`{id, type}`) in `data` and
		// the full resource attributes in `included`. We zip them back together
		// preserving playlist order.
		const hydratedById = new Map<string, TidalResource>()
		for (const page of this.lastIncludedAccumulator) {
			hydratedById.set(`${page.type}:${page.id}`, page)
		}

		const ordered: TidalResource[] = []
		for (const ref of refs) {
			const hydrated = hydratedById.get(`${ref.type}:${ref.id}`)
			if (hydrated) ordered.push(hydrated)
			else ordered.push(ref)
		}
		return ordered
	}

	// Buffer used by `listPlaylistItems` to surface the `included` blobs from
	// every page of a paginated response back to the caller. Reset on each
	// `collectPaginated` invocation that's called from a hydrating list method.
	private lastIncludedAccumulator: TidalResource[] = []

	private async collectPaginated(
		startPath: string,
		query: Record<string, string | undefined>,
		maxItems: number = Number.POSITIVE_INFINITY,
	): Promise<TidalResource[]> {
		this.lastIncludedAccumulator = []
		const out: TidalResource[] = []
		let nextPath: string | undefined = startPath
		let nextQuery: Record<string, string | undefined> | undefined = query
		let pages = 0

		while (nextPath && pages < MAX_PAGES && out.length < maxItems) {
			const response = (await this.request(nextPath, nextQuery)) as TidalSearchResponse
			pages++
			const data = response.data
			if (Array.isArray(data)) {
				for (const item of data) {
					out.push(item)
					if (out.length >= maxItems) break
				}
			} else if (data && typeof data === 'object') {
				out.push(data)
			}
			if (Array.isArray(response.included)) {
				this.lastIncludedAccumulator.push(...response.included)
			}

			const next = response.links?.next
			if (!next) break
			// `next` may be a fully-qualified URL or a relative path; the
			// request() helper handles both shapes.
			nextPath = next
			// All cursor params are encoded into the `next` URL, so we no
			// longer need our own query parameters.
			nextQuery = undefined
		}

		return out
	}
}
