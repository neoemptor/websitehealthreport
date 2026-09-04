import type { Analyzer } from '../types';
import type { CredentialStore } from '../../credentials';
import type { DateRange } from './google-http';
import { accessTokenFor } from './oauth';
import { fetchSearchAnalytics, type GscData } from './gsc';
import { fetchGa4, type Ga4Data } from './ga4';

export type TrafficOwnedSettings = {
	ga4PropertyId: string | null;
	days: number;
};

export type SourceResult<T> = { status: 'ok'; data: T } | { status: 'unavailable'; reason: string };

export type OwnedTrafficData = {
	searchConsole: SourceResult<GscData>;
	ga4: SourceResult<Ga4Data>;
	range: { start: string; end: string };
};

export type OauthConfig = { clientId: string; clientSecret: string };

const GOOGLE_CLIENT_ID_KEY = 'google.clientId';
const GOOGLE_CLIENT_SECRET_KEY = 'google.clientSecret';

function dateRange(days: number): DateRange {
	const end = new Date();
	const start = new Date(end.getTime() - days * 86_400_000);
	const iso = (d: Date): string => d.toISOString().slice(0, 10);
	return { startDate: iso(start), endDate: iso(end) };
}

// UNAVAILABLE errors are user-facing reasons, not internal detail, so the
// prefix is stripped once here rather than at every call site.
function reasonOf(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.replace(/^UNAVAILABLE:\s*/, '');
}

/**
 * Owned traffic (Search Console + GA4) is client-only by construction: the
 * analyzer only ever receives a domain, so it needs a way to tell the run's
 * client apart from a competitor. `isClient` is that dependency, wired by the
 * run orchestrator rather than passed through settings.
 */
export function createTrafficOwnedAnalyzer(
	credentials: CredentialStore,
	oauth: OauthConfig,
	isClient: (domain: string) => boolean
): Analyzer<TrafficOwnedSettings> {
	return {
		id: 'traffic-owned',
		label: 'Traffic (owned)',
		concurrency: 'parallel',
		timeoutMs: 60_000,
		defaultSettings: { ga4PropertyId: null, days: 90 },

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
			if (!isClient(domain)) {
				throw new Error(
					"UNAVAILABLE: Owned traffic is only available for the client's own site, with its owner's permission."
				);
			}

			const clientId = await credentials.get(GOOGLE_CLIENT_ID_KEY);
			const clientSecret = await credentials.get(GOOGLE_CLIENT_SECRET_KEY);
			if (!clientId || !clientSecret) {
				throw new Error('UNAVAILABLE: Google has not been set up in Settings.');
			}

			const range = dateRange(settings.days);

			// If the connection itself is the problem (not connected, or expired),
			// this throws straight out of analyze so the whole cell reads
			// unavailable, rather than reporting two independently-empty sources.
			const token = await accessTokenFor(domain, credentials, clientId, clientSecret, signal);

			// Either source may fail on its own without costing the other, so each
			// is captured independently once a token is in hand.
			let searchConsole: SourceResult<GscData>;
			try {
				searchConsole = {
					status: 'ok',
					data: await fetchSearchAnalytics(domain, token, range, signal)
				};
			} catch (error) {
				searchConsole = { status: 'unavailable', reason: reasonOf(error) };
			}

			let ga4: SourceResult<Ga4Data>;
			if (!settings.ga4PropertyId) {
				ga4 = {
					status: 'unavailable',
					reason: 'No GA4 property id is set for this site in Settings.'
				};
			} else {
				try {
					ga4 = {
						status: 'ok',
						data: await fetchGa4(settings.ga4PropertyId, token, range, signal)
					};
				} catch (error) {
					ga4 = { status: 'unavailable', reason: reasonOf(error) };
				}
			}

			return { searchConsole, ga4, range: { start: range.startDate, end: range.endDate } };
		}
	};
}
