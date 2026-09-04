import type { Analyzer } from '../types';
import { fetchText } from '../../http';
import { parseCdx, type WaybackData } from './parse';

const BASE_URL = 'https://web.archive.org/cdx/search/cdx';

export const waybackAnalyzer: Analyzer<Record<string, never>> = {
	id: 'wayback',
	label: 'Wayback History',
	concurrency: 'parallel',
	timeoutMs: 60_000,
	defaultSettings: {},

	// Nothing to install and nothing to configure.
	async preflight() {
		return { available: true };
	},

	async analyze(domain, _settings, signal): Promise<WaybackData> {
		const url = new URL(BASE_URL);
		url.searchParams.set('url', new URL(domain).hostname);
		url.searchParams.set('output', 'json');
		url.searchParams.set('collapse', 'timestamp:8');
		url.searchParams.set('filter', 'statuscode:200');

		const { status, body } = await fetchText(url.toString(), { signal, timeoutMs: 55_000 });
		if (status !== 200) {
			throw new Error(`The Internet Archive answered with status ${status}.`);
		}
		return parseCdx(body.trim().length === 0 ? [] : JSON.parse(body));
	}
};
