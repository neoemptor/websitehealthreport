import * as crypto from 'crypto';
import type { CredentialStore } from '../../credentials';

// Read-only throughout. This application never writes to a client's Google account.
export const SCOPES = [
	'https://www.googleapis.com/auth/webmasters.readonly',
	'https://www.googleapis.com/auth/analytics.readonly'
];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_TIMEOUT_MS = 20_000;

export class TokenError extends Error {
	code: string | null;
	constructor(message: string, code: string | null) {
		super(message);
		this.name = 'TokenError';
		this.code = code;
	}
}

function base64url(input: Buffer): string {
	return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function createPkce(): { verifier: string; challenge: string } {
	const verifier = base64url(crypto.randomBytes(32));
	const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
	return { verifier, challenge };
}

export function refreshTokenKey(domain: string): string {
	return `google.refresh.${new URL(domain).hostname.replace(/^www\./, '')}`;
}

export function generateState(): string {
	return base64url(crypto.randomBytes(16));
}

export function buildAuthUrl(opts: {
	clientId: string;
	redirectUri: string;
	scopes: string[];
	codeChallenge: string;
	state?: string;
}): string {
	const url = new URL(AUTH_URL);
	url.searchParams.set('client_id', opts.clientId);
	url.searchParams.set('redirect_uri', opts.redirectUri);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('scope', opts.scopes.join(' '));
	// offline + consent guarantees a refresh token, including on re-authorisation.
	url.searchParams.set('access_type', 'offline');
	url.searchParams.set('prompt', 'consent');
	url.searchParams.set('include_granted_scopes', 'true');
	url.searchParams.set('code_challenge', opts.codeChallenge);
	url.searchParams.set('code_challenge_method', 'S256');
	if (opts.state) url.searchParams.set('state', opts.state);
	return url.toString();
}

// Posts to Google's token endpoint with a timeout and abort support. Never logs or throws
// the response body verbatim — only the `error` code, which is a short machine string like
// `invalid_grant`, never a token.
async function postToken(
	body: URLSearchParams,
	signal?: AbortSignal
): Promise<Record<string, unknown>> {
	if (signal?.aborted) {
		throw new Error('Aborted: the task timed out or the run was cancelled.');
	}

	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, TOKEN_TIMEOUT_MS);
	const onAbort = (): void => controller.abort();
	signal?.addEventListener('abort', onAbort);

	try {
		const response = await fetch(TOKEN_URL, {
			method: 'POST',
			signal: controller.signal,
			body
		});

		const payload = (await response.json().catch(() => ({}))) as { error?: string };
		if (!response.ok) {
			const suffix = payload.error ? ` (${payload.error})` : '';
			throw new TokenError(`Google did not accept the sign-in.${suffix}`, payload.error ?? null);
		}
		return payload;
	} catch (err) {
		if (timedOut) {
			throw new TokenError('Google did not accept the sign-in. (timed out)', null);
		}
		throw err;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}
}

export async function exchangeCode(opts: {
	code: string;
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	codeVerifier: string;
}): Promise<{ refreshToken: string }> {
	const payload = (await postToken(
		new URLSearchParams({
			code: opts.code,
			client_id: opts.clientId,
			client_secret: opts.clientSecret,
			redirect_uri: opts.redirectUri,
			grant_type: 'authorization_code',
			code_verifier: opts.codeVerifier
		})
	)) as { refresh_token?: string };

	if (!payload.refresh_token) {
		throw new Error(
			"Google did not return a refresh token. Remove the app's access in your Google account and try again."
		);
	}
	return { refreshToken: payload.refresh_token };
}

/**
 * Access tokens Google has already issued. Google's tokens last an hour, so a
 * run that reads Search Console and GA4 for the same site would otherwise pay
 * for a token round-trip each time. Entries are dropped on any failure so a
 * broken or revoked connection is never served from here.
 *
 * The key covers the site *and* the refresh token that minted the entry, so
 * reconnecting a different Google account for the same site cannot be served
 * the previous account's access token. The token itself is never used as a
 * key: only its SHA-256, so this map holds no credential material.
 */
const accessTokenCache = new Map<string, { token: string; expiresAt: number }>();

function cacheKeyFor(domain: string, refreshToken: string): string {
	return `${refreshTokenKey(domain)}:${crypto
		.createHash('sha256')
		.update(refreshToken)
		.digest('hex')}`;
}

/** Refresh a little before expiry so a token cannot lapse mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

/** Test seam: the cache is module state and must not leak between tests. */
export function clearAccessTokenCache(): void {
	accessTokenCache.clear();
}

export async function accessTokenFor(
	domain: string,
	credentials: CredentialStore,
	clientId: string,
	clientSecret: string,
	signal?: AbortSignal
): Promise<string> {
	const refreshToken = await credentials.get(refreshTokenKey(domain));
	if (!refreshToken) {
		throw new Error("UNAVAILABLE: This site's Google account has not been connected in Settings.");
	}

	const cacheKey = cacheKeyFor(domain, refreshToken);
	const cached = accessTokenCache.get(cacheKey);
	if (cached && Date.now() < cached.expiresAt - EXPIRY_MARGIN_MS) {
		return cached.token;
	}

	let payload: { access_token?: string; expires_in?: number };
	try {
		payload = (await postToken(
			new URLSearchParams({
				refresh_token: refreshToken,
				client_id: clientId,
				client_secret: clientSecret,
				grant_type: 'refresh_token'
			}),
			signal
		)) as { access_token?: string; expires_in?: number };
	} catch (err) {
		// Any failure invalidates whatever was cached: the connection may have
		// been revoked, and a stale token must not outlive it.
		accessTokenCache.delete(cacheKey);
		if (err instanceof TokenError && err.code === 'invalid_grant') {
			throw new Error(
				'UNAVAILABLE: The Google connection for this site has expired. Connect it again in Settings.'
			);
		}
		throw err;
	}

	if (!payload.access_token) {
		accessTokenCache.delete(cacheKey);
		throw new Error(
			'UNAVAILABLE: Google did not return an access token. Connect the site again in Settings.'
		);
	}

	// A missing expires_in means the token cannot be trusted to last, so it is
	// used once and not cached.
	if (typeof payload.expires_in === 'number' && Number.isFinite(payload.expires_in)) {
		accessTokenCache.set(cacheKey, {
			token: payload.access_token,
			expiresAt: Date.now() + payload.expires_in * 1000
		});
	} else {
		accessTokenCache.delete(cacheKey);
	}

	return payload.access_token;
}
