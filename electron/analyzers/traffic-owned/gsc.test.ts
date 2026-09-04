import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	dateRange,
	fetchSearchAnalytics,
	parseSearchAnalytics,
	parseSearchAnalyticsTotals
} from './gsc';

describe('parseSearchAnalyticsTotals', () => {
	it('totals clicks and impressions across rows', () => {
		const payload = {
			rows: [
				{ keys: ['garage doors'], clicks: 10, impressions: 100, ctr: 0.1, position: 4 },
				{ keys: ['roller doors'], clicks: 5, impressions: 50, ctr: 0.1, position: 6 }
			]
		};
		const totals = parseSearchAnalyticsTotals(payload);
		expect(totals.clicks).toBe(15);
		expect(totals.impressions).toBe(150);
	});

	it('returns zeroes when there are no rows', () => {
		expect(parseSearchAnalyticsTotals({}).clicks).toBe(0);
	});

	it('handles a null payload without throwing', () => {
		expect(parseSearchAnalyticsTotals(null)).toEqual({
			clicks: 0,
			impressions: 0,
			ctr: 0,
			position: 0
		});
	});
});

describe('parseSearchAnalytics', () => {
	it('ranks top queries by clicks', () => {
		const payload = {
			rows: [
				{ keys: ['b'], clicks: 5, impressions: 10, ctr: 0.5, position: 2 },
				{ keys: ['a'], clicks: 9, impressions: 20, ctr: 0.45, position: 1 }
			]
		};
		expect(parseSearchAnalytics(payload).topQueries[0]).toEqual({
			query: 'a',
			clicks: 9,
			impressions: 20
		});
	});

	it('returns zeroes when there are no rows', () => {
		expect(parseSearchAnalytics({}).totals.clicks).toBe(0);
		expect(parseSearchAnalytics({}).topQueries).toEqual([]);
	});

	it('handles a null payload without throwing', () => {
		expect(parseSearchAnalytics(null)).toEqual({
			totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
			topQueries: []
		});
	});
});

describe('dateRange', () => {
	it('spans the last 28 full days ending yesterday, UTC', () => {
		const range = dateRange(new Date('2026-09-04T08:00:00Z'));
		expect(range).toEqual({ startDate: '2026-08-07', endDate: '2026-09-03' });
	});

	it('is not affected by the time of day', () => {
		const a = dateRange(new Date('2026-09-04T00:00:01Z'));
		const b = dateRange(new Date('2026-09-04T23:59:59Z'));
		expect(a).toEqual(b);
	});
});

describe('fetchSearchAnalytics', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns totals and top queries when the sc-domain property answers 200', async () => {
		const fetchMock = vi.fn(
			async () => new Response(JSON.stringify({ rows: [] }), { status: 200 })
		);
		vi.stubGlobal('fetch', fetchMock);

		const data = await fetchSearchAnalytics('example.com', 'secret-token', {
			startDate: '2026-08-07',
			endDate: '2026-09-03'
		});

		expect(data).toEqual({
			totals: { clicks: 0, impressions: 0, ctr: 0, position: 0 },
			topQueries: []
		});
		// One call for the top-queries query, one for the dimensionless totals query.
		expect(fetchMock).toHaveBeenCalledTimes(2);
		for (const call of fetchMock.mock.calls) {
			const [url] = call as [string];
			expect(url).toContain(encodeURIComponent('sc-domain:example.com'));
			expect(url).toContain('https://searchconsole.googleapis.com/webmasters/v3');
		}
	});

	it('falls back to the URL-prefix property when the domain property 404s', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ error: { status: 'NOT_FOUND' } }), { status: 404 })
			)
			.mockResolvedValueOnce(new Response(JSON.stringify({ rows: [] }), { status: 200 }))
			.mockResolvedValueOnce(new Response(JSON.stringify({ rows: [] }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		const data = await fetchSearchAnalytics('example.com', 'secret-token', {
			startDate: '2026-08-07',
			endDate: '2026-09-03'
		});

		expect(data.totals.clicks).toBe(0);
		expect(fetchMock).toHaveBeenCalledTimes(3);
		const urls = fetchMock.mock.calls.map((call) => call[0] as string);
		expect(urls[0]).toContain(encodeURIComponent('sc-domain:example.com'));
		expect(urls[1]).toContain(encodeURIComponent('https://example.com/'));
		expect(urls[2]).toContain(encodeURIComponent('https://example.com/'));
	});

	it('throws the site-access UNAVAILABLE message when both properties 403', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'nope' } }),
						{
							status: 403
						}
					)
			)
		);

		await expect(
			fetchSearchAnalytics('example.com', 'secret-token', {
				startDate: '2026-08-07',
				endDate: '2026-09-03'
			})
		).rejects.toThrow(
			'UNAVAILABLE: The connected Google account does not have access to this site in Search Console.'
		);
	});

	it('throws the quota UNAVAILABLE message on 429', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }), { status: 429 })
			)
		);

		await expect(
			fetchSearchAnalytics('example.com', 'secret-token', {
				startDate: '2026-08-07',
				endDate: '2026-09-03'
			})
		).rejects.toThrow("UNAVAILABLE: Google's quota for this account is exhausted for now.");
	});

	it('does not raise a raw SyntaxError when the error body is not JSON', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('<html>Server Error</html>', { status: 500 }))
		);

		await expect(
			fetchSearchAnalytics('example.com', 'secret-token', {
				startDate: '2026-08-07',
				endDate: '2026-09-03'
			})
		).rejects.toThrow(/HTTP 500/);
	});

	it('never includes the access token in a thrown message', async () => {
		const token = 'super-secret-access-token-xyz';
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: token } }), {
						status: 403
					})
			)
		);

		try {
			await fetchSearchAnalytics('example.com', token, {
				startDate: '2026-08-07',
				endDate: '2026-09-03'
			});
			throw new Error('expected fetchSearchAnalytics to reject');
		} catch (err) {
			expect((err as Error).message).not.toContain(token);
		}
	});

	it('scrubs the access token out of a Google error message on 500', async () => {
		const token = 'super-secret-access-token-xyz';
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: { status: 'INTERNAL', message: `something broke for token ${token}` }
						}),
						{ status: 500 }
					)
			)
		);

		try {
			await fetchSearchAnalytics('example.com', token, {
				startDate: '2026-08-07',
				endDate: '2026-09-03'
			});
			throw new Error('expected fetchSearchAnalytics to reject');
		} catch (err) {
			const message = (err as Error).message;
			expect(message).not.toContain(token);
			expect(message).toContain('[token]');
		}
	});
});
