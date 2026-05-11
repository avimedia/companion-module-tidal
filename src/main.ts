import {
	InstanceBase,
	InstanceStatus,
	type CompanionHTTPRequest,
	type CompanionHTTPResponse,
	type SomeCompanionConfigField,
} from '@companion-module/base'

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

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig
	api!: TidalApi

	lastSearchCount = 0
	currentTrackExplicit = false

	private refreshTimer: NodeJS.Timeout | null = null
	private refreshInFlight: Promise<string | null> | null = null

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = { ...GetDefaultConfig(), ...config }
		this.api = new TidalApi(this)

		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
		this.resetTransientVariables()

		await this.bootstrapAuth()
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
		this.setVariableValues({
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
		})
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
		const { verifier, challenge } = generatePkcePair()
		this.config.codeVerifier = verifier
		this.config.authUrl = buildAuthorizationUrl({
			clientId: this.config.clientId,
			redirectUri: TIDAL_OAUTH_REDIRECTOR,
			scopes: this.config.scopes,
			state: this.id,
			codeChallenge: challenge,
		})
		this.config.authStatus = 'Awaiting user login'
		this.saveConfig(this.config)
		this.log('info', `TIDAL authorization URL ready. Open it in a browser:\n${this.config.authUrl}`)
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

		try {
			if (this.config.authMode === 'client_credentials') {
				const tokens = await fetchClientCredentialsToken(this.config.clientId, this.config.clientSecret)
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
			this.storeTokens(tokens.access_token, tokens.refresh_token ?? this.config.refreshToken, tokens.expires_in)
			return tokens.access_token
		} catch (err) {
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
		const error = typeof request.query?.error === 'string' ? request.query.error : undefined
		if (error) {
			const description = typeof request.query?.error_description === 'string' ? request.query.error_description : ''
			this.config.authStatus = `Login failed: ${error} ${description}`.trim()
			this.saveConfig(this.config)
			this.setVariableValues({ auth_status: this.config.authStatus })
			return { status: 400, body: `TIDAL login failed: ${error}\n${description}` }
		}
		if (!code) {
			return { status: 400, body: 'Missing authorization code' }
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
			const primary = response.data?.[0]
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
		const explicit = Boolean(attrs.explicit)
		this.currentTrackExplicit = explicit

		const artistNames = extractArtistNames(resource, full)
		const albumTitle = extractAlbumTitle(resource, full)

		this.setVariableValues({
			current_track_id: resource.id,
			current_track_title: stringAttr(attrs.title),
			current_track_artists: artistNames,
			current_track_album: albumTitle,
			current_track_isrc: stringAttr(attrs.isrc),
			current_track_duration: stringAttr(attrs.duration),
			current_track_explicit: explicit ? 'true' : 'false',
			current_track_uri: `tidal://track/${resource.id}`,
		})
		this.checkFeedbacks('track_explicit')
	}
}

function stringAttr(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean') return String(value)
	return ''
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
