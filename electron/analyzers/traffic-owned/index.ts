import type { Analyzer } from '../types';
import type { CredentialStore } from '../../credentials';
import { normaliseDomain } from '../../../src/lib/shared/url';
import type { DateRange } from './google-http';
import { accessTokenFor } from './oauth';
import { fetchSearchAnalytics, type GscData } from './gsc';
import { fetchGa4, type Ga4Data } from './ga4';

export type TrafficOwnedSettings = {
	/** GA4 property id per site, keyed by hostname with no leading www. */
	ga4PropertyIds: Record<string, string>;
	days: number;
	/**
	 * The client site of the run this analysis belongs to, injected per run by
	 * the orchestrator. Owned traffic is read only for the client, and which
	 * domain that is belongs to the run, not to the process.
	 */
	clientUrl?: string;
};

export type SourceResult<T> = { status: 'ok'; data: T } | { status: 'unavailable'; reason: string };

export type OwnedTrafficData = {
	searchConsole: SourceResult<GscData>;
	ga4: SourceResult<Ga4Data>;
	range: { start: string; end: string };
};

const GOOGLE_CLIENT_ID_KEY = 'google.clientId';
const GOOGLE_CLIENT_SECRET_KEY = 'google.clientSecret';

function dateRange(days: number, now: Date = new Date()): DateRange {
	const end = new Date(now.getTime() - 86_400_000);
	const start = new Date(end.getTime() - days * 86_400_000);
	const iso = (d: Date): string => d.toISOString().slice(0, 10);
	return { startDate: iso(start), endDate: iso(end) };
}

// Settings are keyed the same way refresh tokens are, so one client site has
// one key everywhere.
function hostOf(domain: string): string {
	return new URL(domain).hostname.replace(/^www\./, '');
}

const UNAVAILABLE_PREFIX = /^UNAVAILABLE:\s*/;

// normaliseDomain throws on anything it cannot read as a site. A settings
// value that isn't a URL must read as "not the client", never as a crash.
function sameSite(a: string, b: string): boolean {
	try {
		return normaliseDomain(a) === normaliseDomain(b);
	} catch {
		return false;
	}
}

// Defence in depth: neither the Google client secret nor a bearer token
// should ever reach a user-facing message, but errors can originate from
// several layers (Google's own API, the OAuth token endpoint). Scrubbing
// here means a secret leaking through any one of them still can't surface.
function scrubSecrets(message: string, secrets: Array<string | null | undefined>): string {
	return secrets
		.filter((secret): secret is string => !!secret)
		.reduce((msg, secret) => msg.split(secret).join('[redacted]'), message);
}

// Only an UNAVAILABLE-tagged error is a per-source condition the report can
// present as "this source isn't available"; anything else is an unexpected
// failure and must propagate so the whole cell reports failed rather than
// silently nesting an unrelated bug as a source reason.
function unavailableReasonOf(error: unknown, secrets: Array<string | null | undefined>): string {
	const message = error instanceof Error ? error.message : String(error);
	if (!UNAVAILABLE_PREFIX.test(message)) {
		throw error;
	}
	return scrubSecrets(message.replace(UNAVAILABLE_PREFIX, ''), secrets);
}

export type TrafficOwnedDeps = { now?: () => Date };

export function createTrafficOwnedAnalyzer(
	credentials: CredentialStore,
	deps: TrafficOwnedDeps = {}
): Analyzer<TrafficOwnedSettings> {
	const now = deps.now ?? ((): Date => new Date());
	return {
		id: 'traffic-owned',
		label: 'Traffic (measured)',
		concurrency: 'parallel',
		timeoutMs: 60_000,
		defaultSettings: { ga4PropertyIds: {}, days: 90 },

		async preflight() {
			const hasClientId = await credentials.has(GOOGLE_CLIENT_ID_KEY);
			const hasClientSecret = await credentials.has(GOOGLE_CLIENT_SECRET_KEY);
			return hasClientId && hasClientSecret
				? { available: true }
				: { available: false, reason: 'Google has not been set up in Settings.' };
		},

		async analyze(domain, settings, signal): Promise<OwnedTrafficData> {
			// Competitors never grant access. This is a property of the data, not
			// a failure, and the report presents it as client-only rather than a gap.
			// Both sides are normalised: the run stores a normalised client URL
			// and the row domain comes from the same run, but normalising again
			// keeps a hand-written setting or an older run file from silently
			// turning the client into a competitor.
			const clientUrl = settings.clientUrl;
			if (!clientUrl || !sameSite(domain, clientUrl)) {
				throw new Error(
					"UNAVAILABLE: Owned traffic is only available for the client's own site, with its owner's permission."
				);
			}

			const clientId = await credentials.get(GOOGLE_CLIENT_ID_KEY);
			const clientSecret = await credentials.get(GOOGLE_CLIENT_SECRET_KEY);
			if (!clientId || !clientSecret) {
				throw new Error('UNAVAILABLE: Google has not been set up in Settings.');
			}

			const propertyId = settings.ga4PropertyIds?.[hostOf(domain)] ?? null;
			const range = dateRange(settings.days, now());

			// If the connection itself is the problem (not connected, or expired),
			// this throws straight out of analyze so the whole cell reads
			// unavailable, rather than reporting two independently-empty sources.
			let token: string;
			try {
				token = await accessTokenFor(domain, credentials, clientId, clientSecret, signal);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				throw new Error(scrubSecrets(message, [clientSecret]));
			}

			// Either source may fail on its own without costing the other, so each
			// is captured independently once a token is in hand.
			let searchConsole: SourceResult<GscData>;
			try {
				searchConsole = {
					status: 'ok',
					data: await fetchSearchAnalytics(domain, token, range, signal)
				};
			} catch (error) {
				searchConsole = {
					status: 'unavailable',
					reason: unavailableReasonOf(error, [clientSecret, token])
				};
			}

			let ga4: SourceResult<Ga4Data>;
			if (!propertyId) {
				ga4 = {
					status: 'unavailable',
					reason: 'No GA4 property id is set for this site in Settings.'
				};
			} else {
				try {
					ga4 = {
						status: 'ok',
						data: await fetchGa4(propertyId, token, range, signal)
					};
				} catch (error) {
					ga4 = {
						status: 'unavailable',
						reason: unavailableReasonOf(error, [clientSecret, token])
					};
				}
			}

			return { searchConsole, ga4, range: { start: range.startDate, end: range.endDate } };
		}
	};
}
