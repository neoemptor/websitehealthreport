import { describe, expect, it } from 'vitest';
import { trafficCtaView } from './traffic-cta';
import type { AnalyzerId, AnalyzerResult, Run } from '$lib/shared/types';

const BOTH: AnalyzerId[] = ['traffic-estimated', 'traffic-owned'];

const GOOD_ESTIMATE = {
	status: 'ok',
	data: {
		organicTraffic: 1200,
		organicKeywords: 40,
		adwordsKeywords: null,
		organicCost: 900,
		nothingFound: false
	}
} satisfies AnalyzerResult;

const GOOD_OWNED = {
	status: 'ok',
	data: {
		searchConsole: {
			status: 'ok',
			data: { totals: { clicks: 10, impressions: 100, ctr: 0.1, position: 4 }, topQueries: [] }
		},
		ga4: { status: 'ok', data: { sessions: 50, users: 40, engagementRate: 0.5 } },
		range: { start: '2026-01-01', end: '2026-03-31' }
	}
} satisfies AnalyzerResult;

function run(
	analyzers: Partial<Record<AnalyzerId, AnalyzerResult>>,
	options: { enabled?: AnalyzerId[]; competitor?: Partial<Record<AnalyzerId, AnalyzerResult>> } = {}
): Run {
	return {
		id: 'r1',
		createdAt: '2026-09-16T00:00:00.000Z',
		client: 'https://example.com.au',
		competitors: options.competitor ? ['https://rival.com.au'] : [],
		enabledAnalyzers: options.enabled ?? BOTH,
		status: 'complete',
		domains: [
			{ domain: 'https://example.com.au', role: 'client', analyzers },
			...(options.competitor
				? [
						{
							domain: 'https://rival.com.au',
							role: 'competitor' as const,
							analyzers: options.competitor
						}
				  ]
				: [])
		]
	};
}

describe('trafficCtaView', () => {
	it('says nothing when both traffic sections carry figures', () => {
		expect(
			trafficCtaView(run({ 'traffic-estimated': GOOD_ESTIMATE, 'traffic-owned': GOOD_OWNED }))
		).toBeNull();
	});

	it('says nothing when neither traffic analyzer was enabled', () => {
		expect(trafficCtaView(run({}, { enabled: ['lighthouse'] }))).toBeNull();
	});

	it('ignores a competitor with no traffic at all', () => {
		const view = trafficCtaView(
			run({ 'traffic-estimated': GOOD_ESTIMATE, 'traffic-owned': GOOD_OWNED }, { competitor: {} })
		);
		expect(view).toBeNull();
	});

	it('returns nothing when the run has no client domain', () => {
		const r = run({});
		r.domains = [];
		expect(trafficCtaView(r)).toBeNull();
	});

	describe('estimated traffic', () => {
		it('reads an empty Semrush answer as a finding about the site', () => {
			const view = trafficCtaView(
				run({
					'traffic-estimated': { status: 'ok', data: { nothingFound: true } },
					'traffic-owned': GOOD_OWNED
				})
			);
			expect(view?.findings[0]).toMatch(/not ranking for the search terms its index tracks/);
			expect(view?.offer.join(' ')).toMatch(/that is work I do/);
		});

		it('treats an all-null payload the same as nothingFound', () => {
			const view = trafficCtaView(
				run({
					'traffic-estimated': {
						status: 'ok',
						data: {
							organicTraffic: null,
							organicKeywords: null,
							adwordsKeywords: null,
							organicCost: null,
							nothingFound: false
						}
					},
					'traffic-owned': GOOD_OWNED
				})
			);
			expect(view?.findings[0]).toMatch(/not ranking for the search terms its index tracks/);
		});

		it('does not claim the site is unranked when Semrush was never asked', () => {
			const view = trafficCtaView(
				run({
					'traffic-estimated': { status: 'unavailable', reason: 'No Semrush API key.' },
					'traffic-owned': GOOD_OWNED
				})
			);
			expect(view?.findings[0]).toMatch(/did not run on the computer that produced this report/);
			expect(view?.findings.join(' ')).not.toMatch(/not ranking/);
			expect(view?.offer.join(' ')).toMatch(/can be run again/);
		});

		it('treats a crashed check as not retrieved, not as a finding', () => {
			const view = trafficCtaView(
				run({
					'traffic-estimated': { status: 'failed', error: 'ETIMEDOUT' },
					'traffic-owned': GOOD_OWNED
				})
			);
			expect(view?.findings[0]).toMatch(/did not run on the computer that produced this report/);
		});
	});

	describe('measured traffic', () => {
		it('explains the access gap when no Google account is connected', () => {
			const view = trafficCtaView(
				run({
					'traffic-estimated': GOOD_ESTIMATE,
					'traffic-owned': { status: 'unavailable', reason: 'No Google account is connected.' }
				})
			);
			expect(view?.findings[0]).toMatch(/only the site's owner can grant access/);
			expect(view?.offer.join(' ')).toMatch(/about ten minutes to connect/);
			expect(view?.offer.join(' ')).toMatch(/read-only/);
		});

		it('treats both sources answering "unavailable" as not connected', () => {
			const view = trafficCtaView(
				run({
					'traffic-estimated': GOOD_ESTIMATE,
					'traffic-owned': {
						status: 'ok',
						data: {
							searchConsole: { status: 'unavailable', reason: 'not connected' },
							ga4: { status: 'unavailable', reason: 'not connected' },
							range: { start: '2026-01-01', end: '2026-03-31' }
						}
					}
				})
			);
			expect(view?.findings[0]).toMatch(/only the site's owner can grant access/);
		});

		it('stays quiet when only one of the two Google sources answered', () => {
			const view = trafficCtaView(
				run({
					'traffic-estimated': GOOD_ESTIMATE,
					'traffic-owned': {
						status: 'ok',
						data: {
							searchConsole: { status: 'unavailable', reason: 'not connected' },
							ga4: { status: 'ok', data: { sessions: 50, users: 40, engagementRate: 0.5 } },
							range: { start: '2026-01-01', end: '2026-03-31' }
						}
					}
				})
			);
			expect(view).toBeNull();
		});
	});

	describe('both sections blank', () => {
		const view = trafficCtaView(
			run({
				'traffic-estimated': { status: 'ok', data: { nothingFound: true } },
				'traffic-owned': { status: 'unavailable', reason: 'No Google account is connected.' }
			})
		);

		it('leads with the finding about the site, then the access note', () => {
			expect(view?.findings[0]).toMatch(/Semrush has no organic estimate/);
			expect(view?.findings[1]).toMatch(/Google Search Console and Analytics/);
		});

		it('carries both offers in one block', () => {
			expect(view?.offer.join(' ')).toMatch(/about ten minutes to connect/);
			expect(view?.offer.join(' ')).toMatch(/that is work I do/);
		});
	});

	it('always states that nothing is being withheld', () => {
		const cases: Array<Partial<Record<AnalyzerId, AnalyzerResult>>> = [
			{ 'traffic-estimated': { status: 'ok', data: { nothingFound: true } } },
			{ 'traffic-owned': { status: 'unavailable', reason: 'x' } },
			{}
		];
		for (const analyzers of cases) {
			const view = trafficCtaView(run(analyzers));
			expect(view?.findings.at(-1)).toMatch(/not because it was left out/);
		}
	});

	it('never promises a figure in exchange for contact', () => {
		const view = trafficCtaView(run({}));
		const prose = `${view?.findings.join(' ')} ${view?.offer.join(' ')}`;
		expect(prose).not.toMatch(/contact .* for (the )?(rest|full|traffic)/i);
		expect(prose).not.toMatch(/unlock|upgrade|paywall|purchase/i);
	});
});
