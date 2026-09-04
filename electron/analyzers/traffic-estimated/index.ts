import type { Analyzer } from '../types';
import type { CredentialStore } from '../../credentials';
import { fetchText } from '../../http';
import {
	classifyError,
	errorCodeOf,
	isQuotaError,
	parseSemrushCsv,
	toEstimatedTraffic
} from './parse';
import type { EstimatedTrafficData } from './parse';

export type TrafficEstimatedSettings = { database: string };

export type TrafficEstimatedData = EstimatedTrafficData & { nothingFound: boolean };

export const SEMRUSH_CREDENTIAL_KEY = 'semrush.apiKey';

const ENDPOINT = 'https://api.semrush.com/';

export function createTrafficEstimatedAnalyzer(
	credentials: CredentialStore
): Analyzer<TrafficEstimatedSettings> {
	return {
		id: 'traffic-estimated',
		label: 'Traffic (estimated)',
		concurrency: 'parallel',
		timeoutMs: 30_000,
		// 'au' is the Australian database; clients are Australian businesses.
		defaultSettings: { database: 'au' },

		async preflight() {
			return (await credentials.has(SEMRUSH_CREDENTIAL_KEY))
				? { available: true }
				: { available: false, reason: 'No Semrush API key is saved in Settings.' };
		},

		async analyze(domain, settings, signal): Promise<TrafficEstimatedData> {
			const key = await credentials.get(SEMRUSH_CREDENTIAL_KEY);
			if (!key) {
				throw new Error('UNAVAILABLE: No Semrush API key is saved in Settings.');
			}

			const params = new URLSearchParams({
				type: 'domain_rank',
				key,
				domain: new URL(domain).hostname.replace(/^www\./, ''),
				database: settings.database,
				export_columns: 'Db,Dt,Or,Ot,Oc,Ad'
			});

			// The key never reaches an error message or log line: on failure we
			// report the HTTP status or the Semrush error code, never the URL.
			let status: number;
			let body: string;
			try {
				({ status, body } = await fetchText(`${ENDPOINT}?${params.toString()}`, {
					signal,
					timeoutMs: 25_000
				}));
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				if (/^Aborted/.test(message) || /^Timed out/.test(message)) {
					throw err;
				}
				throw new Error('The Semrush request could not be completed.');
			}

			// Running out of API units is a billing state the operator can fix, not
			// a failure of the analyzer, so it is reported as unavailable.
			if (isQuotaError(body)) {
				const code = errorCodeOf(body);
				throw new Error(`UNAVAILABLE: Semrush reported an account issue (error ${code ?? '?'}).`);
			}

			// Semrush reports an unknown/unindexed domain as a normal response
			// body, not an HTTP error, so it is an ok result with null figures.
			if (/NOTHING FOUND/i.test(body)) {
				return {
					organicKeywords: null,
					organicTraffic: null,
					organicCost: null,
					adwordsKeywords: null,
					nothingFound: true
				};
			}

			const code = errorCodeOf(body);
			if (code !== null) {
				const kind = classifyError(code);
				throw new Error(
					kind === 'unavailable'
						? `UNAVAILABLE: Semrush reported an account issue (error ${code}).`
						: `Semrush reported error ${code}.`
				);
			}

			if (status < 200 || status >= 300) {
				throw new Error(`Semrush responded with status ${status}.`);
			}

			return { ...toEstimatedTraffic(parseSemrushCsv(body)), nothingFound: false };
		}
	};
}
