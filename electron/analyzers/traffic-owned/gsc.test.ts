import { afterEach, describe, expect, it, vi } from 'vitest';
import { dateRange, fetchSearchAnalytics, parseSearchAnalytics } from './gsc';
import { parseGa4 } from './ga4';

describe('parseSearchAnalytics', () => {
	it('totals clicks and impressions across rows', () => {
		const payload = {
			rows: [
				{ keys: ['garage doors'], clicks: 10, impressions: 100, ctr: 0.1, position: 4 },
				{ keys: ['roller doors'], clicks: 5, impressions: 50, ctr: 0.1, position: 6 }
			]
		};
		const data = parseSearchAnalytics(payload);
		expect(data.clicks).toBe(15);
		expect(data.impressions).toBe(150);
	});

	it('ranks top queries by clicks', () => {
		const payload = {
			rows: [
				{ keys: ['b'], clicks: 5, impressions: 10, ctr: 0.5, position: 2 },
				{ keys: ['a'], clicks: 9, impressions: 20, ctr: 0.45, position: 1 }
			]
		};
		expect(parseSearchAnalytics(payload).topQueries[0]).toEqual({ query: 'a', clicks: 9 });
	});

	it('returns zeroes when there are no rows', () => {
		expect(parseSearchAnalytics({}).clicks).toBe(0);
	});
});

describe('parseGa4', () => {
	it('reads the first metric row', () => {
		const payload = {
			rows: [{ metricValues: [{ value: '120' }, { value: '95' }, { value: '0.62' }] }]
		};
		expect(parseGa4(payload)).toEqual({ sessions: 120, users: 95, engagementRate: 0.62 });
	});

	it('returns zeroes when the property has no data', () => {
		expect(parseGa4({ rows: [] })).toEqual({ sessions: 0, users: 0, engagementRate: 0 });
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

	it('returns parsed data when the sc-domain property answers 200', async () => {
		const fetchMock = vi.fn(
			async () => new Response(JSON.stringify({ rows: [] }), { status: 200 })
		);
		vi.stubGlobal('fetch', fetchMock);

		const data = await fetchSearchAnalytics('example.com', 'secret-token', {
			startDate: '2026-08-07',
			endDate: '2026-09-03'
		});

		expect(data.clicks).toBe(0);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url] = fetchMock.mock.calls[0] as [string];
		expect(url).toContain(encodeURIComponent('sc-domain:example.com'));
	});

	it('falls back to the URL-prefix property when the domain property 404s', async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ error: { status: 'NOT_FOUND' } }), { status: 404 })
			)
			.mockResolvedValueOnce(new Response(JSON.stringify({ rows: [] }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		const data = await fetchSearchAnalytics('example.com', 'secret-token', {
			startDate: '2026-08-07',
			endDate: '2026-09-03'
		});

		expect(data.clicks).toBe(0);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const [, secondUrl] = fetchMock.mock.calls.map((call) => call[0] as string);
		expect(secondUrl).toContain(encodeURIComponent('https://example.com/'));
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
});
