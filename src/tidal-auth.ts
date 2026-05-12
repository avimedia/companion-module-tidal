import { Buffer } from 'node:buffer'
import { createHash, randomBytes } from 'node:crypto'

export const TIDAL_AUTH_BASE = 'https://auth.tidal.com'
export const TIDAL_LOGIN_BASE = 'https://login.tidal.com'
export const TIDAL_OAUTH_REDIRECTOR = 'https://bitfocus.github.io/companion-oauth/callback'

export type TokenResponse = {
	access_token: string
	token_type: string
	expires_in: number
	refresh_token?: string
	scope?: string
}

function base64UrlEncode(buf: Buffer): string {
	return buf.toString('base64').replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export function generatePkcePair(): { verifier: string; challenge: string } {
	const verifier = base64UrlEncode(randomBytes(48))
	const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest())
	return { verifier, challenge }
}

export function buildAuthorizationUrl(params: {
	clientId: string
	redirectUri: string
	scopes: string
	state: string
	codeChallenge: string
}): string {
	const url = new URL('/authorize', TIDAL_LOGIN_BASE)
	url.searchParams.set('response_type', 'code')
	url.searchParams.set('client_id', params.clientId)
	url.searchParams.set('redirect_uri', params.redirectUri)
	url.searchParams.set('scope', params.scopes)
	url.searchParams.set('code_challenge_method', 'S256')
	url.searchParams.set('code_challenge', params.codeChallenge)
	url.searchParams.set('state', params.state)
	return url.toString()
}

// Conservative timeout for the OAuth token endpoint. TIDAL's auth service
// typically responds in well under a second; 15 s leaves headroom for slow
// networks while still bounding action callbacks so they can never hang
// indefinitely on a stalled server.
const TIDAL_AUTH_TIMEOUT_MS = 15_000

async function postToken(body: URLSearchParams, basicAuth?: string): Promise<TokenResponse> {
	const headers: Record<string, string> = {
		'Content-Type': 'application/x-www-form-urlencoded',
		Accept: 'application/json',
	}
	if (basicAuth) headers.Authorization = `Basic ${basicAuth}`

	const response = await fetch(`${TIDAL_AUTH_BASE}/v1/oauth2/token`, {
		method: 'POST',
		headers,
		body: body.toString(),
		signal: AbortSignal.timeout(TIDAL_AUTH_TIMEOUT_MS),
	})

	const text = await response.text()
	if (!response.ok) {
		throw new Error(`TIDAL token endpoint returned ${response.status}: ${text}`)
	}

	return JSON.parse(text) as TokenResponse
}

export async function fetchClientCredentialsToken(clientId: string, clientSecret: string): Promise<TokenResponse> {
	const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
	const body = new URLSearchParams({ grant_type: 'client_credentials' })
	return postToken(body, basic)
}

export async function exchangeAuthorizationCode(params: {
	clientId: string
	clientSecret: string
	code: string
	redirectUri: string
	codeVerifier: string
}): Promise<TokenResponse> {
	const body = new URLSearchParams({
		grant_type: 'authorization_code',
		client_id: params.clientId,
		code: params.code,
		redirect_uri: params.redirectUri,
		code_verifier: params.codeVerifier,
	})
	const basic =
		params.clientSecret.length > 0
			? Buffer.from(`${params.clientId}:${params.clientSecret}`).toString('base64')
			: undefined
	return postToken(body, basic)
}

export async function refreshAccessToken(params: {
	clientId: string
	clientSecret: string
	refreshToken: string
}): Promise<TokenResponse> {
	const body = new URLSearchParams({
		grant_type: 'refresh_token',
		refresh_token: params.refreshToken,
	})
	const basic =
		params.clientSecret.length > 0
			? Buffer.from(`${params.clientId}:${params.clientSecret}`).toString('base64')
			: undefined
	return postToken(body, basic)
}
