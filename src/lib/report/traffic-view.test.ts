import { describe, expect, it } from 'vitest';
import { estimatedView, ownedView } from './traffic-view';

describe('ownedView', () => {
	it('marks Search Console unavailable on a malformed ok payload', () => {
		const view = ownedView({ searchConsole: { status: 'ok', data: {} }, ga4: {}, range: {} });
		expect(view.searchConsole).toEqual({
			kind: 'unavailable',
			reason: 'This reading could not be shown.'
		});
	});

	it('marks GA4 unavailable on a malformed ok payload', () => {
		const view = ownedView({ searchConsole: {}, ga4: { status: 'ok', data: {} }, range: {} });
		expect(view.ga4).toEqual({
			kind: 'unavailable',
			reason: 'This reading could not be shown.'
		});
	});

	it('does not throw on a bare {status: "ok", data: {}} for either source', () => {
		expect(() =>
			ownedView({
				searchConsole: { status: 'ok', data: {} },
				ga4: { status: 'ok', data: {} },
				range: { start: '2026-01-01', end: '2026-01-31' }
			})
		).not.toThrow();
	});

	it('produces formatted fields for a good payload', () => {
		const view = ownedView({
			searchConsole: {
				status: 'ok',
				data: {
					totals: { clicks: 123, impressions: 4567, ctr: 0.026934, position: 5.234 },
					topQueries: [{ query: 'hello world', clicks: 10, impressions: 100 }]
				}
			},
			ga4: {
				status: 'ok',
				data: { sessions: 890, users: 456, engagementRate: 0.6123 }
			},
			range: { start: '2026-01-01', end: '2026-01-31' }
		});

		expect(view.range).toEqual({ start: '2026-01-01', end: '2026-01-31', days: 30 });
		expect(view.searchConsole).toEqual({
			kind: 'ok',
			totals: { clicks: 123, impressions: 4567, ctrPct: '2.69%', position: '5.2' },
			topQueries: [{ query: 'hello world', clicks: 10, impressions: 100 }]
		});
		expect(view.ga4).toEqual({
			kind: 'ok',
			sessions: 890,
			users: 456,
			engagementPct: '61.2%'
		});
	});

	it('caps top queries at 10', () => {
		const topQueries = Array.from({ length: 15 }, (_, i) => ({
			query: `q${i}`,
			clicks: i,
			impressions: i * 10
		}));
		const view = ownedView({
			searchConsole: {
				status: 'ok',
				data: {
					totals: { clicks: 1, impressions: 1, ctr: 0.1, position: 1 },
					topQueries
				}
			},
			ga4: { status: 'unavailable', reason: 'not connected' },
			range: { start: '2026-01-01', end: '2026-01-31' }
		});
		expect(view.searchConsole.kind).toBe('ok');
		if (view.searchConsole.kind === 'ok') {
			expect(view.searchConsole.topQueries).toHaveLength(10);
		}
	});

	it('keeps the queries and nulls the totals when Search Console refused them', () => {
		const view = ownedView({
			searchConsole: {
				status: 'ok',
				data: {
					totals: null,
					topQueries: [{ query: 'hello world', clicks: 10, impressions: 100 }]
				}
			},
			ga4: { status: 'unavailable', reason: 'not connected' },
			range: { start: '2026-01-01', end: '2026-01-31' }
		});

		expect(view.searchConsole).toEqual({
			kind: 'ok',
			totals: null,
			topQueries: [{ query: 'hello world', clicks: 10, impressions: 100 }]
		});
	});

	it('preserves a genuine unavailable reason', () => {
		const view = ownedView({
			searchConsole: { status: 'unavailable', reason: 'Search Console is not connected.' },
			ga4: { status: 'unavailable', reason: 'GA4 is not connected.' },
			range: { start: '2026-01-01', end: '2026-01-31' }
		});
		expect(view.searchConsole).toEqual({
			kind: 'unavailable',
			reason: 'Search Console is not connected.'
		});
		expect(view.ga4).toEqual({ kind: 'unavailable', reason: 'GA4 is not connected.' });
	});

	it('handles a non-object payload safely', () => {
		expect(() => ownedView(null)).not.toThrow();
		expect(() => ownedView(undefined)).not.toThrow();
		expect(() => ownedView('nope')).not.toThrow();
		expect(() => ownedView(42)).not.toThrow();

		const view = ownedView(null);
		expect(view.range).toBeNull();
		expect(view.searchConsole.kind).toBe('unavailable');
		expect(view.ga4.kind).toBe('unavailable');
	});
});

describe('estimatedView', () => {
	it('is nothing:true for all-null figures', () => {
		const view = estimatedView({
			organicKeywords: null,
			organicTraffic: null,
			organicCost: null,
			adwordsKeywords: null,
			nothingFound: false
		});
		expect(view).toEqual({ rows: [], nothing: true });
	});

	it('is nothing:true when nothingFound is true', () => {
		const view = estimatedView({ nothingFound: true });
		expect(view).toEqual({ rows: [], nothing: true });
	});

	it('produces formatted rows for a good payload', () => {
		const view = estimatedView({
			organicKeywords: 678,
			organicTraffic: 12345,
			organicCost: 99,
			adwordsKeywords: 12
		});
		expect(view.nothing).toBe(false);
		expect(view.rows).toEqual([
			{ label: 'Monthly visits (estimate)', value: '12,345' },
			{ label: 'Organic keywords (estimate)', value: '678' },
			{ label: 'Advertised keywords (estimate)', value: '12' },
			{ label: 'Value of that traffic if bought as ads (estimate)', value: 'US$99' }
		]);
	});

	it('handles a non-object payload safely', () => {
		expect(() => estimatedView(null)).not.toThrow();
		expect(() => estimatedView(undefined)).not.toThrow();
		expect(() => estimatedView('nope')).not.toThrow();
		expect(estimatedView(null)).toEqual({ rows: [], nothing: true });
	});
});
