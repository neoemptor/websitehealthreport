import type { Analyzer } from '../types';
import { fetchText } from '../../http';
import {
	parseCookieFlags,
	parseSecurityHeaders,
	type CookieFinding,
	type HeaderFinding
} from './parse';
import { inspectTls, type TlsInfo } from './tls';

export type SecurityData = {
	headers: HeaderFinding[];
	cookies: CookieFinding[];
	tls: TlsInfo | { error: string };
	servedOverHttps: boolean;
};

// Node's undici Headers implements getSetCookie() (one string per cookie),
// but the TS lib.dom.d.ts type for Headers may not declare it depending on
// the configured lib. Fall back to an empty list rather than falling back
// to get('set-cookie'), which comma-joins multiple cookies and breaks parsing.
function getSetCookieHeaders(headers: Headers): string[] {
	return (headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
}

export const securityAnalyzer: Analyzer<Record<string, never>> = {
	id: 'security',
	label: 'Security',
	concurrency: 'parallel',
	timeoutMs: 45_000,
	defaultSettings: {},

	async preflight() {
		return { available: true };
	},

	async analyze(domain, _settings, signal): Promise<SecurityData> {
		const response = await fetchText(domain, { signal, timeoutMs: 20_000 });
		const hostname = new URL(response.finalUrl).hostname;

		// A TLS failure is a finding about the site, not a failure of the run,
		// so it is captured rather than thrown.
		let tlsResult: TlsInfo | { error: string };
		try {
			tlsResult = await inspectTls(hostname, signal);
		} catch (error) {
			tlsResult = { error: (error as Error).message };
		}

		return {
			headers: parseSecurityHeaders(response.headers),
			cookies: parseCookieFlags(getSetCookieHeaders(response.headers)),
			tls: tlsResult,
			servedOverHttps: new URL(response.finalUrl).protocol === 'https:'
		};
	}
};
