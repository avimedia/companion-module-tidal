import {
	InstanceBase,
	InstanceStatus,
	type CompanionHTTPRequest,
	type CompanionHTTPResponse,
	type SomeCompanionConfigField,
} from '@companion-module/base'
import { execFile } from 'node:child_process'
import { platform } from 'node:process'

import { GetConfigFields, GetDefaultConfig, type ModuleConfig } from './config.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { UpdateVariableDefinitions, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import {
	TIDAL_OAUTH_REDIRECTOR,
	buildAuthorizationUrl,
	exchangeAuthorizationCode,
	fetchClientCredentialsToken,
	generatePkcePair,
	refreshAccessToken,
} from './tidal-auth.js'
import { TidalApi, type SearchKind, type TidalResource, type TidalSearchResponse } from './tidal-api.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

const TOKEN_REFRESH_BUFFER_MS = 60_000

// How many "current playlist" track slots and "search result" slots we publish
// as variables / presets. 32 covers a Stream Deck XL's full key count.
export const PLAYLIST_TRACK_SLOTS = 32
export const SEARCH_RESULT_SLOTS = 10

export type LibraryPlaylistEntry = {
	id: string
	name: string
	numberOfItems: number
	uri: string
}

export type LibraryTrackEntry = {
	id: string
	title: string
	artists: string
	uri: string
}

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig
	api!: TidalApi

	lastSearchCount = 0
	currentTrackExplicit = false

	// Library caches (Tier 1/2/3). Populated by `refreshLibrary()` when the
	// connection is in Authorization Code mode and authenticated. Surfaced to
	// the UI via dynamically-recomputed action choices and preset sections.
	playlistCache: LibraryPlaylistEntry[] = []
	currentPlaylistTracks: LibraryTrackEntry[] = []
	currentPlaylistId: string = ''
	currentPlaylistName: string = ''
	lastSearchEntries: LibraryTrackEntry[] = []
	libraryRefreshedAt: number = 0

	private libraryRefreshInFlight: Promise<void> | null = null
	private playlistTracksCache: Map<string, LibraryTrackEntry[]> = new Map()

	private refreshTimer: NodeJS.Timeout | null = null
	private refreshInFlight: Promise<string | null> | null = null
	// Incremented every time credentials change. doTokenRefresh() captures the
	// counter when it starts and refuses to commit its result (or surface its
	// error) if the value has moved on by the time the network call resolves.
	// Without this, a slow refresh against the old creds can win the race and
	// overwrite the freshly-wiped tokens in `configUpdated`.
	private credsGeneration = 0

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = { ...GetDefaultConfig(), ...config }
		this.normalizeConfig()
		this.api = new TidalApi(this)

		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
		this.resetTransientVariables()

		await this.bootstrapAuth()
	}

	// Apply input-shape normalisation that should be invariant for the rest of
	// the module. Today this is only the ISO 3166-1 alpha-2 country code, which
	// TIDAL requires in uppercase — the config regex allows mixed case for
	// convenience, but every API call must see "US", "NO" etc.
	private normalizeConfig(): void {
		const cc = (this.config.countryCode ?? '').trim()
		this.config.countryCode = cc.toUpperCase()
	}

	async destroy(): Promise<void> {
		if (this.refreshTimer) {
			clearTimeout(this.refreshTimer)
			this.refreshTimer = null
		}
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		const previous = this.config
		this.config = { ...GetDefaultConfig(), ...config }
		this.normalizeConfig()

		const credsChanged =
			previous.clientId !== this.config.clientId ||
			previous.clientSecret !== this.config.clientSecret ||
			previous.authMode !== this.config.authMode ||
			previous.scopes !== this.config.scopes

		if (credsChanged) {
			this.config.accessToken = ''
			this.config.refreshToken = ''
			this.config.tokenExpiresAt = 0
			this.config.authStatus = 'Not authenticated'
			// Wipe any pending PKCE pair so the next bootstrap generates a fresh
			// one that matches the new client id / scopes.
			this.config.codeVerifier = ''
			this.config.authUrl = ''
			// Abandon any in-flight refresh against the old creds and any
			// scheduled proactive refresh; otherwise their resolved values would
			// leak into the new credential's auth state. The generation bump
			// additionally makes doTokenRefresh discard its result if the old
			// refresh is still in flight in the background.
			this.credsGeneration++
			this.refreshInFlight = null
			if (this.refreshTimer) {
				clearTimeout(this.refreshTimer)
				this.refreshTimer = null
			}
		}

		this.saveConfig(this.config)
		await this.bootstrapAuth()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	hasValidToken(): boolean {
		return Boolean(this.config.accessToken) && this.config.tokenExpiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS
	}

	private resetTransientVariables(): void {
		const values: Record<string, string | number | undefined> = {
			auth_status: this.config.authStatus || 'Not authenticated',
			auth_expires_at: this.config.tokenExpiresAt ? new Date(this.config.tokenExpiresAt).toISOString() : '',
			current_track_id: '',
			current_track_title: '',
			current_track_artists: '',
			current_track_album: '',
			current_track_isrc: '',
			current_track_duration: '',
			current_track_explicit: 'false',
			current_track_uri: '',
			last_search_count: 0,
			last_search_query: '',
			last_search_kind: '',
			last_search_first_id: '',
			last_search_first_title: '',
			current_user_id: '',
			current_user_name: '',
			current_user_country: '',
			library_playlist_count: 0,
			library_refreshed_at: '',
			last_loaded_playlist_id: '',
			last_loaded_playlist_name: '',
			last_loaded_playlist_count: 0,
		}
		for (let i = 1; i <= PLAYLIST_TRACK_SLOTS; i++) {
			values[`playlist_track_${i}_id`] = ''
			values[`playlist_track_${i}_title`] = ''
			values[`playlist_track_${i}_artists`] = ''
			values[`playlist_track_${i}_uri`] = ''
		}
		for (let i = 1; i <= SEARCH_RESULT_SLOTS; i++) {
			values[`last_search_result_${i}_id`] = ''
			values[`last_search_result_${i}_title`] = ''
			values[`last_search_result_${i}_artists`] = ''
			values[`last_search_result_${i}_uri`] = ''
		}
		this.setVariableValues(values as never)
	}

	private setStatusFromAuth(): void {
		if (!this.config.clientId || !this.config.clientSecret) {
			this.updateStatus(InstanceStatus.BadConfig, 'Missing Client ID/Secret')
			return
		}
		if (this.hasValidToken()) {
			this.updateStatus(InstanceStatus.Ok)
		} else if (this.config.refreshToken) {
			this.updateStatus(InstanceStatus.AuthenticationFailure, 'Access token expired, refreshing')
		} else {
			this.updateStatus(
				InstanceStatus.AuthenticationFailure,
				this.config.authMode === 'authorization_code'
					? 'Awaiting user login (see Auth URL in config)'
					: 'Not yet authenticated',
			)
		}
	}

	private async bootstrapAuth(): Promise<void> {
		this.setStatusFromAuth()
		this.setVariableValues({
			auth_status: this.config.authStatus,
			auth_expires_at: this.config.tokenExpiresAt ? new Date(this.config.tokenExpiresAt).toISOString() : '',
		})
		this.checkFeedbacks('authenticated')

		if (!this.config.clientId || !this.config.clientSecret) {
			return
		}

		if (this.config.authMode === 'client_credentials') {
			try {
				await this.ensureAccessToken(true)
			} catch (err) {
				this.log('error', `Initial client-credentials token fetch failed: ${(err as Error).message}`)
			}
			return
		}

		if (this.config.refreshToken) {
			try {
				await this.ensureAccessToken(true)
			} catch (err) {
				this.log('warn', `Refreshing existing TIDAL session failed: ${(err as Error).message}`)
			}
			return
		}

		this.prepareAuthorizationCodeFlow()
	}

	private prepareAuthorizationCodeFlow(): void {
		// Preserve any pending PKCE pair across config saves. If the user has
		// the previous Auth URL open in a browser and is about to submit it,
		// regenerating the verifier here would invalidate that flow — the
		// code returned by TIDAL could not be redeemed. We only generate a
		// fresh pair when no verifier exists (first run, or after creds
		// changed in configUpdated()).
		if (!this.config.codeVerifier || !this.config.authUrl) {
			const { verifier, challenge } = generatePkcePair()
			this.config.codeVerifier = verifier
			this.config.authUrl = buildAuthorizationUrl({
				clientId: this.config.clientId,
				redirectUri: TIDAL_OAUTH_REDIRECTOR,
				scopes: this.config.scopes,
				state: this.id,
				codeChallenge: challenge,
			})
			this.log('info', `TIDAL authorization URL ready. Open it in a browser:\n${this.config.authUrl}`)
		}
		this.config.authStatus = 'Awaiting user login'
		this.saveConfig(this.config)
		this.setVariableValues({ auth_status: this.config.authStatus })
		this.checkFeedbacks('authenticated')
	}

	async ensureAccessToken(forceRefresh = false): Promise<string | null> {
		if (!forceRefresh && this.hasValidToken()) {
			return this.config.accessToken
		}

		if (this.refreshInFlight) {
			return this.refreshInFlight
		}

		this.refreshInFlight = this.doTokenRefresh().finally(() => {
			this.refreshInFlight = null
		})
		return this.refreshInFlight
	}

	async refreshTokenNow(): Promise<void> {
		await this.ensureAccessToken(true)
	}

	private async doTokenRefresh(): Promise<string | null> {
		if (!this.config.clientId || !this.config.clientSecret) {
			this.updateStatus(InstanceStatus.BadConfig, 'Missing Client ID/Secret')
			return null
		}

		// Capture the credentials-generation at the moment this refresh starts.
		// If the user changes credentials while we're awaiting the network call,
		// `configUpdated` will bump credsGeneration and the resolved value below
		// will be discarded — we will not overwrite the freshly-wiped tokens or
		// surface a stale error on the connection status.
		const generation = this.credsGeneration

		try {
			if (this.config.authMode === 'client_credentials') {
				const tokens = await fetchClientCredentialsToken(this.config.clientId, this.config.clientSecret)
				if (generation !== this.credsGeneration) {
					this.log('debug', 'Discarding token refresh response from a previous credential generation')
					return null
				}
				this.storeTokens(tokens.access_token, undefined, tokens.expires_in)
				return tokens.access_token
			}

			if (!this.config.refreshToken) {
				this.log('warn', 'Cannot refresh — no refresh token. User needs to complete the Auth URL flow.')
				return null
			}

			const tokens = await refreshAccessToken({
				clientId: this.config.clientId,
				clientSecret: this.config.clientSecret,
				refreshToken: this.config.refreshToken,
			})
			if (generation !== this.credsGeneration) {
				this.log('debug', 'Discarding token refresh response from a previous credential generation')
				return null
			}
			this.storeTokens(tokens.access_token, tokens.refresh_token ?? this.config.refreshToken, tokens.expires_in)
			return tokens.access_token
		} catch (err) {
			if (generation !== this.credsGeneration) {
				// Error is from the old credential generation; do not surface it
				// — the new generation's own refresh attempt will determine the
				// connection status.
				return null
			}
			const message = (err as Error).message
			this.log('error', `Token refresh failed: ${message}`)
			this.config.authStatus = `Token refresh failed: ${message}`
			this.saveConfig(this.config)
			this.setVariableValues({ auth_status: this.config.authStatus })
			this.updateStatus(InstanceStatus.AuthenticationFailure, message)
			this.checkFeedbacks('authenticated')
			return null
		}
	}

	private storeTokens(accessToken: string, refreshToken: string | undefined, expiresInSeconds: number): void {
		const expiresAt = Date.now() + expiresInSeconds * 1000
		this.config.accessToken = accessToken
		if (refreshToken) this.config.refreshToken = refreshToken
		this.config.tokenExpiresAt = expiresAt
		this.config.authStatus = `Authenticated (expires ${new Date(expiresAt).toISOString()})`
		this.saveConfig(this.config)

		this.setVariableValues({
			auth_status: this.config.authStatus,
			auth_expires_at: new Date(expiresAt).toISOString(),
		})
		this.updateStatus(InstanceStatus.Ok)
		this.checkFeedbacks('authenticated')
		this.scheduleProactiveRefresh()

		// Soft-degrade: only the user-scoped Authorization Code flow can surface
		// the user's owned playlists. In Client Credentials mode the catalog is
		// available but no per-user library exists — skip the refresh and leave
		// the dynamic dropdowns empty with a clear "no library" sentinel.
		if (this.config.authMode === 'authorization_code') {
			// Surface the user ID immediately from the JWT so it's available
			// for variable bindings even before the (legacy) /users/me lookup.
			// v2 doesn't ship that endpoint; we keep loadCurrentUser() as a
			// best-effort enrichment for display name / country.
			const userId = this.getAuthenticatedUserId()
			if (userId) this.setVariableValues({ current_user_id: userId })
			void this.refreshLibrary().catch((err) => {
				this.log('debug', `Initial library refresh failed: ${(err as Error).message}`)
			})
		}
	}

	private scheduleProactiveRefresh(): void {
		if (this.refreshTimer) clearTimeout(this.refreshTimer)
		const ms = Math.max(5_000, this.config.tokenExpiresAt - Date.now() - TOKEN_REFRESH_BUFFER_MS)
		this.refreshTimer = setTimeout(() => {
			void this.ensureAccessToken(true)
		}, ms)
	}

	async handleHttpRequest(request: CompanionHTTPRequest): Promise<CompanionHTTPResponse> {
		if (request.path !== '/oauth/callback') {
			return { status: 404, body: 'Not found' }
		}

		const code = typeof request.query?.code === 'string' ? request.query.code : undefined
		const state = typeof request.query?.state === 'string' ? request.query.state : undefined
		const error = typeof request.query?.error === 'string' ? request.query.error : undefined
		if (error) {
			const description = typeof request.query?.error_description === 'string' ? request.query.error_description : ''
			const message = `Login failed: ${error} ${description}`.trim()
			this.config.authStatus = message
			this.saveConfig(this.config)
			this.setVariableValues({ auth_status: this.config.authStatus })
			this.updateStatus(InstanceStatus.AuthenticationFailure, message)
			this.checkFeedbacks('authenticated')
			return { status: 400, body: `TIDAL login failed: ${error}\n${description}` }
		}
		if (!code) {
			return { status: 400, body: 'Missing authorization code' }
		}
		// OAuth 2.1 §4.1.2.1: the client MUST verify that the `state` returned
		// in the redirect matches what it sent in the authorize URL. We pass
		// this.id as the state value when building the URL.
		if (!state || state !== this.id) {
			this.log('error', `OAuth callback rejected: state mismatch (expected "${this.id}", got "${state ?? ''}")`)
			return {
				status: 400,
				body: 'OAuth state mismatch — this callback does not belong to this connection. Re-save the config to issue a fresh Auth URL and try again.',
			}
		}
		if (!this.config.codeVerifier) {
			return {
				status: 400,
				body: 'Missing PKCE code verifier — re-save the connection config to generate a new Auth URL.',
			}
		}

		try {
			const tokens = await exchangeAuthorizationCode({
				clientId: this.config.clientId,
				clientSecret: this.config.clientSecret,
				code,
				redirectUri: TIDAL_OAUTH_REDIRECTOR,
				codeVerifier: this.config.codeVerifier,
			})
			this.config.codeVerifier = ''
			this.storeTokens(tokens.access_token, tokens.refresh_token, tokens.expires_in)
			this.log('info', 'TIDAL OAuth login succeeded')
			void this.loadCurrentUser()
			return { status: 200, body: 'TIDAL login complete. You can close this tab.' }
		} catch (err) {
			const message = (err as Error).message
			this.log('error', `TIDAL OAuth exchange failed: ${message}`)
			return { status: 500, body: `Token exchange failed:\n${message}` }
		}
	}

	async performSearch(query: string, kind: SearchKind, limit: number): Promise<void> {
		if (!query) {
			this.log('warn', 'search action called with empty query')
			return
		}
		try {
			const response = await this.api.search(query, kind, this.config.countryCode, limit)
			const items = collectResources(response)
			const count = items.length
			this.lastSearchCount = count
			const first = items[0]
			this.setVariableValues({
				last_search_query: query,
				last_search_kind: kind,
				last_search_count: count,
				last_search_first_id: first?.id ?? '',
				last_search_first_title: extractTitle(first),
			})
			this.checkFeedbacks('has_search_results')

			// Materialise the full result set for the "Search results" preset
			// section + play_search_result action. Bounded by SEARCH_RESULT_SLOTS
			// so we never publish more variables than the schema declares.
			this.lastSearchEntries = items.slice(0, SEARCH_RESULT_SLOTS).map((item) => {
				const uri = uriForResource(item, kind)
				return {
					id: item.id,
					title: extractTitle(item),
					artists: extractArtistNames(item, response),
					uri,
				}
			})
			this.publishSearchResultVariables()

			if (first && kind === 'tracks') {
				this.applyTrackResource(first, response)
			}
		} catch (err) {
			this.log('error', `Search failed: ${(err as Error).message}`)
		}
	}

	async loadTrack(id: string): Promise<void> {
		if (!id) return
		try {
			const response = await this.api.getTrack(id, this.config.countryCode)
			const primary = pickPrimary(response)
			if (primary) this.applyTrackResource(primary, response)
		} catch (err) {
			this.log('error', `Load track failed: ${(err as Error).message}`)
		}
	}

	async loadTrackByIsrc(isrc: string): Promise<void> {
		if (!isrc) return
		try {
			const response = await this.api.getTrackByIsrc(isrc, this.config.countryCode)
			const primary = collectResources(response)[0]
			if (primary) this.applyTrackResource(primary, response)
			else this.log('info', `No track found for ISRC ${isrc}`)
		} catch (err) {
			this.log('error', `ISRC lookup failed: ${(err as Error).message}`)
		}
	}

	async loadAlbum(id: string): Promise<void> {
		if (!id) return
		try {
			const response = await this.api.getAlbum(id, this.config.countryCode)
			const primary = pickPrimary(response)
			const attrs = primary?.attributes ?? {}
			this.setVariableValues({
				current_track_album: stringAttr(attrs.title),
				current_track_artists: stringAttr(attrs.artists),
				current_track_uri: primary ? `tidal://album/${primary.id}` : '',
			})
		} catch (err) {
			this.log('error', `Load album failed: ${(err as Error).message}`)
		}
	}

	async loadPlaylist(id: string): Promise<void> {
		if (!id) return
		try {
			const response = await this.api.getPlaylist(id, this.config.countryCode)
			const primary = pickPrimary(response)
			const attrs = primary?.attributes ?? {}
			this.setVariableValues({
				last_search_first_title: stringAttr(attrs.name),
				current_track_uri: primary ? `tidal://playlist/${primary.id}` : '',
			})
		} catch (err) {
			this.log('error', `Load playlist failed: ${(err as Error).message}`)
		}
	}

	async loadCurrentUser(): Promise<void> {
		try {
			const response = await this.api.getCurrentUser()
			const user = pickPrimary(response)
			if (!user) return
			const attrs = user.attributes ?? {}
			this.setVariableValues({
				current_user_id: user.id,
				current_user_name: stringAttr(attrs.username ?? attrs.displayName),
				current_user_country: stringAttr(attrs.country ?? attrs.countryCode),
			})
		} catch (err) {
			this.log('warn', `Could not load current user: ${(err as Error).message}`)
		}
	}

	private applyTrackResource(resource: TidalResource, full: TidalSearchResponse): void {
		const attrs = resource.attributes ?? {}
		const explicit = parseBooleanAttr(attrs.explicit)
		this.currentTrackExplicit = explicit

		const artistNames = extractArtistNames(resource, full)
		const albumTitle = extractAlbumTitle(resource, full)

		this.setVariableValues({
			current_track_id: resource.id,
			current_track_title: stringAttr(attrs.title),
			current_track_artists: artistNames,
			current_track_album: albumTitle,
			current_track_isrc: stringAttr(attrs.isrc),
			current_track_duration: parseDurationSeconds(attrs.duration),
			current_track_explicit: explicit ? 'true' : 'false',
			current_track_uri: `tidal://track/${resource.id}`,
		})
		this.checkFeedbacks('track_explicit')
	}

	// Decode the TIDAL access token's `sub` claim to obtain the authenticated
	// user's TIDAL ID. The v2 public API does not expose a `/users/me` shortcut
	// (despite the v1-era convention), so callers that need to filter by owner
	// rely on this lookup. JWT structure is base64url-decoded without
	// signature verification — we trust the token because we just received it
	// from our own OAuth exchange.
	getAuthenticatedUserId(): string {
		const token = this.config.accessToken
		if (!token || token.split('.').length !== 3) return ''
		try {
			const payload = token.split('.')[1]
			const padded = payload + '==='.slice(0, (4 - (payload.length % 4)) % 4)
			const json = Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
			const parsed = JSON.parse(json) as Record<string, unknown>
			const sub = parsed.sub ?? parsed.uid ?? parsed.userId ?? parsed.user_id
			if (typeof sub === 'string' && sub) return sub
			if (typeof sub === 'number') return String(sub)
		} catch {
			/* fall through */
		}
		return ''
	}

	// Fetch the user's owned playlists and replace the cache. Idempotent;
	// concurrent invocations share the same in-flight promise so the action
	// definitions / preset section aren't churned multiple times in parallel.
	async refreshLibrary(): Promise<void> {
		if (this.libraryRefreshInFlight) return this.libraryRefreshInFlight
		this.libraryRefreshInFlight = this.doRefreshLibrary().finally(() => {
			this.libraryRefreshInFlight = null
		})
		return this.libraryRefreshInFlight
	}

	private async doRefreshLibrary(): Promise<void> {
		if (this.config.authMode !== 'authorization_code') {
			this.log(
				'info',
				'refresh_library: Authorization Code mode is required for user-library features. Switch authMode to "authorization_code" and complete the Auth URL flow to populate your playlists.',
			)
			this.playlistCache = []
			this.playlistTracksCache.clear()
			this.publishLibraryVariables()
			this.updateActions()
			this.updatePresets()
			return
		}
		const userId = this.getAuthenticatedUserId()
		if (!userId) {
			this.log(
				'warn',
				'refresh_library: could not determine TIDAL user ID from the current access token; cannot list owned playlists.',
			)
			return
		}
		try {
			const playlists = await this.api.listOwnedPlaylists(userId, this.config.countryCode)
			this.playlistCache = playlists
				.map((p) => {
					const attrs = p.attributes ?? {}
					const name = stringAttr(attrs.name ?? attrs.title)
					const num = Number(attrs.numberOfItems ?? attrs.itemCount ?? 0)
					return {
						id: p.id,
						name: name || `Playlist ${p.id}`,
						numberOfItems: Number.isFinite(num) ? num : 0,
						uri: `tidal://playlist/${p.id}`,
					}
				})
				.sort((a, b) => a.name.localeCompare(b.name))
			this.playlistTracksCache.clear()
			this.libraryRefreshedAt = Date.now()
			this.publishLibraryVariables()
			this.log('info', `Library refreshed: ${this.playlistCache.length} playlists.`)
			// Re-emit action definitions and preset structure so the new
			// dropdown choices and per-playlist presets show up in the UI.
			this.updateActions()
			this.updatePresets()
		} catch (err) {
			this.log('error', `Library refresh failed: ${(err as Error).message}`)
		}
	}

	// Load a playlist's tracks into the "Current playlist" variable slots so
	// the matching preset section comes alive. Caches per-playlist results so
	// repeated loads of the same playlist don't re-hit the API.
	async loadPlaylistIntoVariables(playlistId: string, limit: number = PLAYLIST_TRACK_SLOTS): Promise<void> {
		if (!playlistId) return
		const capped = Math.max(1, Math.min(PLAYLIST_TRACK_SLOTS, Math.trunc(limit)))
		try {
			// Cache invariant: entries[] is always fetched at the full
			// PLAYLIST_TRACK_SLOTS bound so re-loading the same playlist with a
			// larger `count` reuses the cache instead of returning a truncated
			// stale list. The slicing happens at publish time below.
			let entries = this.playlistTracksCache.get(playlistId)
			if (!entries) {
				const items = await this.api.listPlaylistItems(playlistId, this.config.countryCode, PLAYLIST_TRACK_SLOTS)
				entries = items.map((item) => {
					const attrs = item.attributes ?? {}
					return {
						id: item.id,
						title: stringAttr(attrs.title ?? attrs.name),
						artists: '',
						uri: `tidal://${item.type === 'videos' ? 'video' : 'track'}/${item.id}`,
					}
				})
				this.playlistTracksCache.set(playlistId, entries)
			}
			this.currentPlaylistTracks = entries.slice(0, capped)
			this.currentPlaylistId = playlistId
			const matched = this.playlistCache.find((p) => p.id === playlistId)
			this.currentPlaylistName = matched?.name ?? playlistId
			this.publishCurrentPlaylistVariables()
			// Preset section "TIDAL — Current playlist tracks" is regenerated
			// so its button labels reflect the freshly-loaded titles.
			this.updatePresets()
		} catch (err) {
			this.log('error', `Load playlist into variables failed: ${(err as Error).message}`)
		}
	}

	async playSearchResult(index: number): Promise<void> {
		const idx = Math.max(1, Math.min(SEARCH_RESULT_SLOTS, Math.trunc(index)))
		const entry = this.lastSearchEntries[idx - 1]
		if (!entry || !entry.uri) {
			this.log('warn', `play_search_result: no cached result at index ${idx}. Run a search first.`)
			return
		}
		try {
			await launchUri(entry.uri)
			this.log('info', `Opened search result ${idx}: ${entry.title || entry.uri}`)
		} catch (err) {
			this.log('error', `play_search_result ${idx} failed: ${(err as Error).message}`)
		}
	}

	private publishLibraryVariables(): void {
		this.setVariableValues({
			library_playlist_count: this.playlistCache.length,
			library_refreshed_at: this.libraryRefreshedAt ? new Date(this.libraryRefreshedAt).toISOString() : '',
		})
	}

	private publishCurrentPlaylistVariables(): void {
		const values: Record<string, string | number | undefined> = {
			last_loaded_playlist_id: this.currentPlaylistId,
			last_loaded_playlist_name: this.currentPlaylistName,
			last_loaded_playlist_count: this.currentPlaylistTracks.length,
		}
		for (let i = 0; i < PLAYLIST_TRACK_SLOTS; i++) {
			const entry = this.currentPlaylistTracks[i]
			const n = i + 1
			values[`playlist_track_${n}_id`] = entry?.id ?? ''
			values[`playlist_track_${n}_title`] = entry?.title ?? ''
			values[`playlist_track_${n}_artists`] = entry?.artists ?? ''
			values[`playlist_track_${n}_uri`] = entry?.uri ?? ''
		}
		this.setVariableValues(values as never)
	}

	private publishSearchResultVariables(): void {
		const values: Record<string, string | number | undefined> = {}
		for (let i = 0; i < SEARCH_RESULT_SLOTS; i++) {
			const entry = this.lastSearchEntries[i]
			const n = i + 1
			values[`last_search_result_${n}_id`] = entry?.id ?? ''
			values[`last_search_result_${n}_title`] = entry?.title ?? ''
			values[`last_search_result_${n}_artists`] = entry?.artists ?? ''
			values[`last_search_result_${n}_uri`] = entry?.uri ?? ''
		}
		this.setVariableValues(values as never)
	}
}

function stringAttr(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	return ''
}

// Defensive boolean coercion for JSON:API attributes. TIDAL typically returns
// a real `boolean`, but defensive code matters: `Boolean("false")` is `true`,
// which would silently miscategorise an explicit-flag round-trip through any
// string-shaped intermediary.
function parseBooleanAttr(value: unknown): boolean {
	if (value === true) return true
	if (value === false) return false
	if (typeof value === 'string') return value.toLowerCase() === 'true' || value === '1'
	if (typeof value === 'number') return value !== 0
	return false
}

// TIDAL's `attributes.duration` field is an ISO 8601 duration string for most
// catalog endpoints (e.g. `PT3M25S`). The corresponding Companion variable is
// documented as "duration (seconds)" — parse to total seconds so users binding
// the variable to button text get a number they can do arithmetic with. If the
// upstream ever returns a plain numeric string or a number, pass it through.
function parseDurationSeconds(value: unknown): string {
	if (typeof value === 'number' && Number.isFinite(value)) return String(Math.round(value))
	if (typeof value !== 'string') return ''
	const trimmed = value.trim()
	if (!trimmed) return ''
	const iso = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(trimmed)
	if (iso) {
		const hours = iso[1] ? Number(iso[1]) : 0
		const minutes = iso[2] ? Number(iso[2]) : 0
		const seconds = iso[3] ? Number(iso[3]) : 0
		const total = hours * 3600 + minutes * 60 + seconds
		return total > 0 ? String(Math.round(total)) : trimmed
	}
	if (/^\d+(?:\.\d+)?$/.test(trimmed)) return String(Math.round(Number(trimmed)))
	return trimmed
}

function collectResources(response: TidalSearchResponse): TidalResource[] {
	if (Array.isArray(response.data) && response.data.length > 0) return response.data
	if (Array.isArray(response.included)) return response.included
	return []
}

function pickPrimary(response: TidalSearchResponse): TidalResource | undefined {
	if (Array.isArray(response.data) && response.data.length > 0) return response.data[0]
	if (!Array.isArray(response.data) && response.data && typeof response.data === 'object') {
		return response.data
	}
	return response.included?.[0]
}

function extractTitle(resource: TidalResource | undefined): string {
	if (!resource) return ''
	const attrs = resource.attributes ?? {}
	return stringAttr(attrs.title ?? attrs.name ?? attrs.displayName)
}

function extractArtistNames(track: TidalResource, full: TidalSearchResponse): string {
	const included = full.included ?? []
	const artists = included.filter((item) => item.type === 'artists')
	if (artists.length === 0) {
		const attrs = track.attributes ?? {}
		return stringAttr(attrs.artists ?? attrs.artist)
	}
	return artists
		.map((artist) => stringAttr((artist.attributes ?? {}).name))
		.filter(Boolean)
		.join(', ')
}

function extractAlbumTitle(track: TidalResource, full: TidalSearchResponse): string {
	const included = full.included ?? []
	const album = included.find((item) => item.type === 'albums')
	if (album) return stringAttr((album.attributes ?? {}).title)
	const attrs = track.attributes ?? {}
	return stringAttr(attrs.album)
}

function uriForResource(item: TidalResource, kind: SearchKind): string {
	switch (kind) {
		case 'tracks':
			return `tidal://track/${item.id}`
		case 'albums':
			return `tidal://album/${item.id}`
		case 'playlists':
			return `tidal://playlist/${item.id}`
		case 'artists':
			return `tidal://artist/${item.id}`
		case 'videos':
			return `tidal://video/${item.id}`
		default:
			return ''
	}
}

// Internal "launch a URI through the OS" helper used by the new library
// actions. Mirrors the shell-injection-safe execFile pattern from actions.ts —
// no shell interpretation, hard-coded argv.
export async function launchUri(uri: string): Promise<void> {
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
