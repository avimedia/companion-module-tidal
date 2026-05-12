import type { SomeCompanionConfigField } from '@companion-module/base'

export type AuthMode = 'client_credentials' | 'authorization_code'

export type PlaybackEngine = 'disabled' | 'focus_keystroke' | 'media_keys' | 'playerctl'

export type ModuleConfig = {
	authMode: AuthMode
	clientId: string
	clientSecret: string
	countryCode: string

	scopes: string

	authUrl: string
	authStatus: string

	accessToken: string
	refreshToken: string
	tokenExpiresAt: number

	codeVerifier: string

	playbackEngine: PlaybackEngine
	playbackRestoreFocus: boolean
}

export function GetDefaultConfig(): ModuleConfig {
	return {
		authMode: 'client_credentials',
		clientId: '',
		clientSecret: '',
		countryCode: 'US',
		scopes: 'user.read playlists.read collection.read',
		authUrl: '',
		authStatus: 'Not authenticated',
		accessToken: '',
		refreshToken: '',
		tokenExpiresAt: 0,
		codeVerifier: '',
		// Defaults to focus_keystroke for backward compatibility with v0.2.0.
		// Users wanting a no-op default should switch to 'disabled' explicitly.
		playbackEngine: 'focus_keystroke',
		playbackRestoreFocus: false,
	}
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'intro',
			width: 12,
			label: 'TIDAL connection',
			value:
				'Register an application at <a href="https://developer.tidal.com/dashboard" target="_blank">developer.tidal.com</a>, ' +
				'then paste the Client ID and Client Secret below. For user-scoped data (playlists, library) ' +
				'switch to Authorization Code mode and follow the generated Auth URL.',
		},
		{
			type: 'dropdown',
			id: 'authMode',
			label: 'Authentication mode',
			width: 6,
			default: 'client_credentials',
			choices: [
				{
					id: 'client_credentials',
					label: 'Client Credentials (catalog only)',
				},
				{
					id: 'authorization_code',
					label: 'Authorization Code + PKCE (user scoped)',
				},
			],
		},
		{
			type: 'textinput',
			id: 'countryCode',
			label: 'Country code (ISO 3166-1 alpha-2)',
			width: 6,
			default: 'US',
			regex: '/^[A-Za-z]{2}$/',
		},
		{
			type: 'textinput',
			id: 'clientId',
			label: 'Client ID',
			width: 6,
			default: '',
		},
		{
			type: 'secret-text',
			id: 'clientSecret',
			label: 'Client Secret',
			width: 6,
			default: '',
		},
		{
			type: 'textinput',
			id: 'scopes',
			label: 'Scopes (space separated, Authorization Code only)',
			width: 12,
			default: 'user.read playlists.read collection.read',
		},
		{
			type: 'static-text',
			id: 'authUrlLabel',
			width: 12,
			label: 'Authorization URL',
			value:
				'After saving Client ID/Secret with Authorization Code mode selected, the URL below will be populated. ' +
				'Open it in a browser, complete the TIDAL login, and the redirector will deliver the code back to this module.',
		},
		{
			type: 'textinput',
			id: 'authUrl',
			label: 'Auth URL (read only)',
			width: 12,
			default: '',
		},
		{
			type: 'textinput',
			id: 'authStatus',
			label: 'Auth status (read only)',
			width: 12,
			default: 'Not authenticated',
		},
		{
			type: 'static-text',
			id: 'playbackHeader',
			width: 12,
			label: 'Playback control',
			value:
				"Local desktop-app control for the <em>Playback:</em> actions. TIDAL's public Web API does not expose " +
				'a "play on device" endpoint, so all engines act on the locally installed TIDAL desktop client. ' +
				'Pick the engine that fits your show; presses are no-ops if the engine is set to <em>Disabled</em>.',
		},
		{
			type: 'dropdown',
			id: 'playbackEngine',
			label: 'Playback control engine',
			width: 12,
			default: 'focus_keystroke',
			choices: [
				{
					id: 'disabled',
					label: 'Disabled — Playback: actions log a warning and do nothing',
				},
				{
					id: 'focus_keystroke',
					label: 'Focus + keystroke — brings TIDAL forward and sends in-app shortcut (briefly steals focus)',
				},
				{
					id: 'media_keys',
					label:
						'OS media keys — non-focus-stealing (macOS: needs nowplaying-cli, Windows: built-in, Linux: redirects to playerctl)',
				},
				{
					id: 'playerctl',
					label: 'playerctl (Linux MPRIS only — requires playerctl on PATH)',
				},
			],
		},
		{
			type: 'checkbox',
			id: 'playbackRestoreFocus',
			label: 'Restore previously focused app after each press (focus + keystroke engine only)',
			width: 12,
			default: false,
		},
	]
}
