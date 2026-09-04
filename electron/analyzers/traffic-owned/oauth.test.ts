import { afterEach, describe, expect, it, vi } from 'vitest';
import * as crypto from 'crypto';
import {
	SCOPES,
	accessTokenFor,
	buildAuthUrl,
	createPkce,
	exchangeCode,
	refreshTokenKey
} from './oauth';
import type { CredentialStore } from '../../credentials';

function fakeCredentials(store: Record<string, string> = {}): CredentialStore {
	return {
		get: vi.fn(async (key: string) => store[key] ?? null),
		set: vi.fn(async (key: string, value: string) => {
			store[key] = value;
		}),
		has: vi.fn(async (key: string) => key in store),
		remove: vi.fn(async (key: string) => {
			delete store[key];
		})
	} as unknown as CredentialStore;
}

describe('refreshTokenKey', () => {
	it('scopes the token to one domain', () => {
		expect(refreshTokenKey('https://cjsgaragedoors.com.au/')).toBe(
			'google.refresh.cjsgaragedoors.com.au'
		);
	});

	it('ignores www so one grant covers both hosts', () => {
		expect(refreshTokenKey('https://www.example.com/')).toBe('google.refresh.example.com');
	});
});

describe('createPkce', () => {
	it('returns a challenge equal to base64url(sha256(verifier))', () => {
		const { verifier, challenge } = createPkce();
		const expected = crypto
			.createHash('sha256')
			.update(verifier)
			.digest('base64')
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
		expect(challenge).toBe(expected);
	});
});

describe('buildAuthUrl', () => {
	const url = () =>
		new URL(
			buildAuthUrl({
				clientId: 'cid',
				redirectUri: 'http://127.0.0.1:9999',
				scopes: SCOPES,
				codeChallenge: 'test-challenge'
			})
		);

	it('requests offline access so a refresh token is issued', () => {
		expect(url().searchParams.get('access_type')).toBe('offline');
	});

	it('forces the consent screen so a refresh token is always returned', () => {
		expect(url().searchParams.get('prompt')).toBe('consent');
	});

	it('includes previously granted scopes', () => {
		expect(url().searchParams.get('include_granted_scopes')).toBe('true');
	});

	it('requests read-only scopes only', () => {
		for (const scope of url().searchParams.get('scope')!.split(' ')) {
			expect(scope).toMatch(/readonly$/);
		}
	});

	it('carries the PKCE challenge and method', () => {
		expect(url().searchParams.get('code_challenge')).toBe('test-challenge');
		expect(url().searchParams.get('code_challenge_method')).toBe('S256');
	});
});

describe('exchangeCode', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('posts the PKCE code_verifier and returns the refresh token', async () => {
		let body: URLSearchParams | undefined;
		const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
			body = init.body as URLSearchParams;
			return new Response(JSON.stringify({ refresh_token: 'rt-123' }), { status: 200 });
		});
		vi.stubGlobal('fetch', fetchMock);

		const result = await exchangeCode({
			code: 'code-abc',
			clientId: 'cid',
			clientSecret: 'secret',
			redirectUri: 'http://127.0.0.1:9999',
			codeVerifier: 'verifier-xyz'
		});

		expect(result).toEqual({ refreshToken: 'rt-123' });
		expect(body?.get('code_verifier')).toBe('verifier-xyz');
	});

	it('throws a safe message (no token) when Google rejects the exchange', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))
		);

		await expect(
			exchangeCode({
				code: 'bad',
				clientId: 'cid',
				clientSecret: 'secret',
				redirectUri: 'http://127.0.0.1:9999',
				codeVerifier: 'verifier-xyz'
			})
		).rejects.toThrow(/Google did not accept the sign-in\..*invalid_grant/);
	});

	it('throws when Google does not return a refresh token', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
		);

		await expect(
			exchangeCode({
				code: 'code-abc',
				clientId: 'cid',
				clientSecret: 'secret',
				redirectUri: 'http://127.0.0.1:9999',
				codeVerifier: 'verifier-xyz'
			})
		).rejects.toThrow(
			"Google did not return a refresh token. Remove the app's access in your Google account and try again."
		);
	});
});

describe('accessTokenFor', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('throws UNAVAILABLE when no refresh token is stored', async () => {
		const credentials = fakeCredentials();
		await expect(
			accessTokenFor('https://example.com/', credentials, 'cid', 'secret')
		).rejects.toThrow(
			"UNAVAILABLE: This site's Google account has not been connected in Settings."
		);
	});

	it('mints an access token from a stored refresh token', async () => {
		const credentials = fakeCredentials({ 'google.refresh.example.com': 'rt-123' });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ access_token: 'at-abc' }), { status: 200 }))
		);

		const token = await accessTokenFor('https://example.com/', credentials, 'cid', 'secret');
		expect(token).toBe('at-abc');
	});

	it('throws a specific UNAVAILABLE message when the refresh token has expired', async () => {
		const credentials = fakeCredentials({ 'google.refresh.example.com': 'rt-123' });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }))
		);

		await expect(
			accessTokenFor('https://example.com/', credentials, 'cid', 'secret')
		).rejects.toThrow(
			'UNAVAILABLE: The Google connection for this site has expired. Connect it again in Settings.'
		);
	});

	it('throws a plain error for other refresh failures', async () => {
		const credentials = fakeCredentials({ 'google.refresh.example.com': 'rt-123' });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ error: 'server_error' }), { status: 500 }))
		);

		await expect(
			accessTokenFor('https://example.com/', credentials, 'cid', 'secret')
		).rejects.toThrow(/Google did not accept the sign-in\..*server_error/);
	});

	it('does not treat other error codes as an expired connection', async () => {
		const credentials = fakeCredentials({ 'google.refresh.example.com': 'rt-123' });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_client' }), { status: 400 }))
		);

		await expect(
			accessTokenFor('https://example.com/', credentials, 'cid', 'secret')
		).rejects.toThrow(/Google did not accept the sign-in\..*invalid_client/);
	});

	it('throws UNAVAILABLE when the token response has no access token', async () => {
		const credentials = fakeCredentials({ 'google.refresh.example.com': 'rt-123' });
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }))
		);

		await expect(
			accessTokenFor('https://example.com/', credentials, 'cid', 'secret')
		).rejects.toThrow(
			'UNAVAILABLE: Google did not return an access token. Connect the site again in Settings.'
		);
	});

	it('never leaks the refresh token in a thrown error message', async () => {
		const credentials = fakeCredentials({ 'google.refresh.example.com': 'rt-123' });
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: 'invalid_grant', refresh_token: 'rt-123' }), {
						status: 400
					})
			)
		);

		await expect(
			accessTokenFor('https://example.com/', credentials, 'cid', 'secret')
		).rejects.toThrow(/^(?:(?!rt-123).)*$/s);
	});

	it('honours an abort signal from the caller', async () => {
		const credentials = fakeCredentials({ 'google.refresh.example.com': 'rt-123' });
		const controller = new AbortController();
		vi.stubGlobal(
			'fetch',
			vi.fn(async (_url: string, init: RequestInit) => {
				return new Promise((_resolve, reject) => {
					init.signal?.addEventListener('abort', () => {
						reject(new DOMException('Aborted', 'AbortError'));
					});
				});
			})
		);

		const promise = accessTokenFor(
			'https://example.com/',
			credentials,
			'cid',
			'secret',
			controller.signal
		);
		controller.abort();

		await expect(promise).rejects.toThrow();
	});

	it('removes its abort listener once the request settles', async () => {
		const credentials = fakeCredentials({ 'google.refresh.example.com': 'rt-123' });
		const signal = new AbortController().signal;
		const addSpy = vi.spyOn(signal, 'addEventListener');
		const removeSpy = vi.spyOn(signal, 'removeEventListener');
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(JSON.stringify({ access_token: 'at-abc' }), { status: 200 }))
		);

		await accessTokenFor('https://example.com/', credentials, 'cid', 'secret', signal);

		expect(addSpy).toHaveBeenCalledWith('abort', expect.any(Function));
		expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
	});
});
