import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
	accessToken: vi.fn(async () => 'access-token'),
	fetchSearchAnalytics: vi.fn(async () => ({
		totals: { clicks: 10, impressions: 100, ctr: 0.1, position: 4 },
		topQueries: [{ query: 'garage doors', clicks: 10, impressions: 100 }]
	})),
	fetchGa4: vi.fn(async () => ({ sessions: 50, users: 40, engagementRate: 0.6 }))
}));

vi.mock('./oauth', () => ({
	accessTokenFor: (...args: unknown[]) => state.accessToken(...args)
}));
vi.mock('./gsc', () => ({
	fetchSearchAnalytics: (...args: unknown[]) => state.fetchSearchAnalytics(...args)
}));
vi.mock('./ga4', () => ({
	fetchGa4: (...args: unknown[]) => state.fetchGa4(...args)
}));

const { createTrafficOwnedAnalyzer } = await import('./index');

beforeEach(() => {
	state.accessToken.mockReset().mockImplementation(async () => 'access-token');
	state.fetchSearchAnalytics.mockReset().mockImplementation(async () => ({
		totals: { clicks: 10, impressions: 100, ctr: 0.1, position: 4 },
		topQueries: [{ query: 'garage doors', clicks: 10, impressions: 100 }]
	}));
	state.fetchGa4.mockReset().mockImplementation(async () => ({
		sessions: 50,
		users: 40,
		engagementRate: 0.6
	}));
});

const CLIENT_ID_KEY = 'google.clientId';
const CLIENT_SECRET_KEY = 'google.clientSecret';

type FakeStore = {
	has: (key: string) => Promise<boolean>;
	get: (key: string) => Promise<string | null>;
};

function fakeStore(overrides: Record<string, string> = {}): FakeStore {
	const store: Record<string, string> = {
		[CLIENT_ID_KEY]: 'client-id',
		[CLIENT_SECRET_KEY]: 'client-secret',
		...overrides
	};
	return {
		has: async (key: string) => Object.prototype.hasOwnProperty.call(store, key),
		get: async (key: string) => store[key] ?? null
	};
}

function noCredentialsStore(): FakeStore {
	return { has: async () => false, get: async () => null };
}

const settings = { ga4PropertyId: 'properties/123', days: 90 };
const CLIENT_DOMAIN = 'https://client.example.com/';
const COMPETITOR_DOMAIN = 'https://competitor.example.com/';

function isClient(domain: string): boolean {
	return domain === CLIENT_DOMAIN;
}

describe('traffic-owned preflight', () => {
	it('reports unavailable when Google client credentials are not stored', async () => {
		const analyzer = createTrafficOwnedAnalyzer(
			noCredentialsStore() as never,
			{ clientId: 'id', clientSecret: 'secret' },
			isClient
		);
		expect(await analyzer.preflight(settings)).toEqual({
			available: false,
			reason: 'Google has not been set up in Settings.'
		});
	});

	it('reports available when Google client credentials are stored', async () => {
		const analyzer = createTrafficOwnedAnalyzer(
			fakeStore() as never,
			{ clientId: 'id', clientSecret: 'secret' },
			isClient
		);
		expect(await analyzer.preflight(settings)).toEqual({ available: true });
	});
});

describe('traffic-owned analyze', () => {
	it('throws UNAVAILABLE for a competitor domain', async () => {
		const analyzer = createTrafficOwnedAnalyzer(
			fakeStore() as never,
			{ clientId: 'id', clientSecret: 'secret' },
			isClient
		);
		const controller = new AbortController();
		await expect(analyzer.analyze(COMPETITOR_DOMAIN, settings, controller.signal)).rejects.toThrow(
			/^UNAVAILABLE: Owned traffic is only available for the client's own site/
		);
		expect(state.accessToken).not.toHaveBeenCalled();
	});

	it('assembles data when both sources are ok', async () => {
		const analyzer = createTrafficOwnedAnalyzer(
			fakeStore() as never,
			{ clientId: 'id', clientSecret: 'secret' },
			isClient
		);
		const controller = new AbortController();
		const result = await analyzer.analyze(CLIENT_DOMAIN, settings, controller.signal);

		expect(result.searchConsole).toEqual({
			status: 'ok',
			data: {
				totals: { clicks: 10, impressions: 100, ctr: 0.1, position: 4 },
				topQueries: [{ query: 'garage doors', clicks: 10, impressions: 100 }]
			}
		});
		expect(result.ga4).toEqual({
			status: 'ok',
			data: { sessions: 50, users: 40, engagementRate: 0.6 }
		});
		expect(result.range.start < result.range.end).toBe(true);
	});

	it('reports GA4 as unavailable with no property id, while GSC still runs', async () => {
		const analyzer = createTrafficOwnedAnalyzer(
			fakeStore() as never,
			{ clientId: 'id', clientSecret: 'secret' },
			isClient
		);
		const controller = new AbortController();
		const result = await analyzer.analyze(
			CLIENT_DOMAIN,
			{ ga4PropertyId: null, days: 90 },
			controller.signal
		);

		expect(result.searchConsole.status).toBe('ok');
		expect(result.ga4).toEqual({
			status: 'unavailable',
			reason: 'No GA4 property id is set for this site in Settings.'
		});
		expect(state.fetchGa4).not.toHaveBeenCalled();
	});

	it('nests a Search Console 403/UNAVAILABLE as its own source result', async () => {
		state.fetchSearchAnalytics.mockRejectedValueOnce(
			new Error(
				'UNAVAILABLE: The connected Google account does not have access to this site in Search Console.'
			)
		);
		const analyzer = createTrafficOwnedAnalyzer(
			fakeStore() as never,
			{ clientId: 'id', clientSecret: 'secret' },
			isClient
		);
		const controller = new AbortController();
		const result = await analyzer.analyze(CLIENT_DOMAIN, settings, controller.signal);

		expect(result.searchConsole).toEqual({
			status: 'unavailable',
			reason: 'The connected Google account does not have access to this site in Search Console.'
		});
		expect(result.ga4.status).toBe('ok');
	});

	it('throws the connection UNAVAILABLE (not a nested unavailable) when not connected', async () => {
		state.accessToken.mockRejectedValueOnce(
			new Error("UNAVAILABLE: This site's Google account has not been connected in Settings.")
		);
		const analyzer = createTrafficOwnedAnalyzer(
			fakeStore() as never,
			{ clientId: 'id', clientSecret: 'secret' },
			isClient
		);
		const controller = new AbortController();
		await expect(analyzer.analyze(CLIENT_DOMAIN, settings, controller.signal)).rejects.toThrow(
			/^UNAVAILABLE: This site's Google account has not been connected/
		);
		expect(state.fetchSearchAnalytics).not.toHaveBeenCalled();
		expect(state.fetchGa4).not.toHaveBeenCalled();
	});

	it('passes the abort signal through to both Google clients', async () => {
		const analyzer = createTrafficOwnedAnalyzer(
			fakeStore() as never,
			{ clientId: 'id', clientSecret: 'secret' },
			isClient
		);
		const controller = new AbortController();
		await analyzer.analyze(CLIENT_DOMAIN, settings, controller.signal);

		expect(state.accessToken).toHaveBeenCalledWith(
			CLIENT_DOMAIN,
			expect.anything(),
			'client-id',
			'client-secret',
			controller.signal
		);
		expect(state.fetchSearchAnalytics).toHaveBeenCalledWith(
			CLIENT_DOMAIN,
			'access-token',
			expect.anything(),
			controller.signal
		);
		expect(state.fetchGa4).toHaveBeenCalledWith(
			'properties/123',
			'access-token',
			expect.anything(),
			controller.signal
		);
	});
});
