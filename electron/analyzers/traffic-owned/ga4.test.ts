import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGa4, parseGa4 } from './ga4';

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

	it('handles a 403 response body shape without throwing during parse', () => {
		expect(parseGa4({})).toEqual({ sessions: 0, users: 0, engagementRate: 0 });
	});

	it('handles a null payload without throwing', () => {
		expect(parseGa4(null)).toEqual({ sessions: 0, users: 0, engagementRate: 0 });
	});
});

describe('fetchGa4', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns parsed data on a 200 response', async () => {
		const fetchMock = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						rows: [{ metricValues: [{ value: '10' }, { value: '8' }, { value: '0.5' }] }]
					}),
					{ status: 200 }
				)
		);
		vi.stubGlobal('fetch', fetchMock);

		const data = await fetchGa4('properties/12345', 'secret-token', {
			startDate: '2026-08-07',
			endDate: '2026-09-03'
		});

		expect(data).toEqual({ sessions: 10, users: 8, engagementRate: 0.5 });
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://analyticsdata.googleapis.com/v1beta/properties/12345:runReport');
		expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
	});

	it('normalises a bare property id the same way', async () => {
		const fetchMock = vi.fn(
			async () => new Response(JSON.stringify({ rows: [] }), { status: 200 })
		);
		vi.stubGlobal('fetch', fetchMock);

		await fetchGa4('12345', 'secret-token', {
			startDate: '2026-08-07',
			endDate: '2026-09-03'
		});

		const [url] = fetchMock.mock.calls[0] as [string];
		expect(url).toBe('https://analyticsdata.googleapis.com/v1beta/properties/12345:runReport');
	});

	it('throws a GA4-specific UNAVAILABLE message on 403', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({
							error: {
								status: 'PERMISSION_DENIED',
								message: 'User does not have sufficient permissions for site'
							}
						}),
						{ status: 403 }
					)
			)
		);

		await expect(
			fetchGa4('999', 'secret-token', { startDate: '2026-08-07', endDate: '2026-09-03' })
		).rejects.toThrow(
			'UNAVAILABLE: The connected Google account does not have access to the GA4 property 999.'
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
			fetchGa4('999', 'secret-token', { startDate: '2026-08-07', endDate: '2026-09-03' })
		).rejects.toThrow("UNAVAILABLE: Google's quota for this account is exhausted for now.");
	});

	it('does not raise a raw SyntaxError when the error body is not JSON', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('not json', { status: 500 }))
		);

		await expect(
			fetchGa4('999', 'secret-token', { startDate: '2026-08-07', endDate: '2026-09-03' })
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
			await fetchGa4('999', token, { startDate: '2026-08-07', endDate: '2026-09-03' });
			throw new Error('expected fetchGa4 to reject');
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
			await fetchGa4('999', token, { startDate: '2026-08-07', endDate: '2026-09-03' });
			throw new Error('expected fetchGa4 to reject');
		} catch (err) {
			const message = (err as Error).message;
			expect(message).not.toContain(token);
			expect(message).toContain('[token]');
		}
	});
});
