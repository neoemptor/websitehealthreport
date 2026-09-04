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

export function buildAuthUrl(opts: {
	clientId: string;
	redirectUri: string;
	scopes: string[];
	codeChallenge: string;
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
			throw new Error(`Google did not accept the sign-in.${suffix}`);
		}
		return payload;
	} catch (err) {
		if (timedOut) {
			throw new Error('Google did not accept the sign-in. (timed out)');
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

	let payload: { access_token?: string };
	try {
		payload = (await postToken(
			new URLSearchParams({
				refresh_token: refreshToken,
				client_id: clientId,
				client_secret: clientSecret,
				grant_type: 'refresh_token'
			}),
			signal
		)) as { access_token?: string };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (message.includes('invalid_grant')) {
			throw new Error(
				'UNAVAILABLE: The Google connection for this site has expired. Connect it again in Settings.'
			);
		}
		throw err;
	}

	return payload.access_token as string;
}
