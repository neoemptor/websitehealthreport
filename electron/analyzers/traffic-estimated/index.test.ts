import { describe, it, expect, vi } from 'vitest';

const state = vi.hoisted(() => ({
	fetchTextResult: async (): Promise<{
		status: number;
		headers: Headers;
		body: string;
		finalUrl: string;
	}> => ({
		status: 200,
		headers: new Headers(),
		body: '',
		finalUrl: ''
	}),
	calls: [] as string[]
}));

vi.mock('../../http', () => ({
	fetchText: (url: string) => {
		state.calls.push(url);
		return state.fetchTextResult();
	}
}));

const { createTrafficEstimatedAnalyzer, SEMRUSH_CREDENTIAL_KEY } = await import('./index');

type FakeStore = {
	has: (key: string) => Promise<boolean>;
	get: (key: string) => Promise<string | null>;
};

function fakeStore(key: string | null): FakeStore {
	return {
		has: async (k: string) => k === SEMRUSH_CREDENTIAL_KEY && key !== null,
		get: async (k: string) => (k === SEMRUSH_CREDENTIAL_KEY ? key : null)
	};
}

function withBody(body: string, status = 200): void {
	state.fetchTextResult = async () => ({ status, headers: new Headers(), body, finalUrl: '' });
}

const csvBody =
	'Database;Date;Organic Keywords;Organic Traffic;Organic Cost;Adwords Keywords\nau;20260901;412;3100;5200;7';

describe('traffic-estimated preflight', () => {
	it('reports unavailable when no key is stored', async () => {
		const analyzer = createTrafficEstimatedAnalyzer(fakeStore(null) as never);
		const result = await analyzer.preflight({ database: 'au' });
		expect(result).toEqual({
			available: false,
			reason: 'No Semrush API key is saved in Settings.'
		});
	});

	it('reports available when a key is stored', async () => {
		const analyzer = createTrafficEstimatedAnalyzer(fakeStore('secret-key') as never);
		expect(await analyzer.preflight({ database: 'au' })).toEqual({ available: true });
	});
});

describe('traffic-estimated analyze', () => {
	it('throws UNAVAILABLE when the store loses the key between preflight and analyze', async () => {
		const analyzer = createTrafficEstimatedAnalyzer(fakeStore(null) as never);
		const controller = new AbortController();
		await expect(
			analyzer.analyze('https://example.com/', { database: 'au' }, controller.signal)
		).rejects.toThrow(/^UNAVAILABLE:/);
	});

	it('throws UNAVAILABLE on a quota error, never including the API key', async () => {
		withBody('ERROR 120 :: NOT ENOUGH API UNITS');
		const analyzer = createTrafficEstimatedAnalyzer(fakeStore('super-secret-key') as never);
		const controller = new AbortController();

		await expect(
			analyzer.analyze('https://example.com/', { database: 'au' }, controller.signal)
		).rejects.toThrow(/^UNAVAILABLE:/);

		const lastCallError = await analyzer
			.analyze('https://example.com/', { database: 'au' }, controller.signal)
			.catch((e: Error) => e.message);
		expect(lastCallError).not.toContain('super-secret-key');
	});

	it('returns ok with null figures and nothingFound when Semrush has no data', async () => {
		withBody('ERROR 50 :: NOTHING FOUND');
		const analyzer = createTrafficEstimatedAnalyzer(fakeStore('a-key') as never);
		const controller = new AbortController();

		const result = await analyzer.analyze(
			'https://example.com/',
			{ database: 'au' },
			controller.signal
		);

		expect(result).toEqual({
			organicKeywords: null,
			organicTraffic: null,
			organicCost: null,
			adwordsKeywords: null,
			nothingFound: true
		});
	});

	it('parses a data row into figures', async () => {
		withBody(csvBody);
		const analyzer = createTrafficEstimatedAnalyzer(fakeStore('a-key') as never);
		const controller = new AbortController();

		const result = await analyzer.analyze(
			'https://example.com/',
			{ database: 'au' },
			controller.signal
		);

		expect(result).toEqual({
			organicKeywords: 412,
			organicTraffic: 3100,
			organicCost: 5200,
			adwordsKeywords: 7,
			nothingFound: false
		});
	});

	it('throws (failed) on a non-2xx status, naming only the status', async () => {
		withBody('', 503);
		const analyzer = createTrafficEstimatedAnalyzer(fakeStore('a-key') as never);
		const controller = new AbortController();

		await expect(
			analyzer.analyze('https://example.com/', { database: 'au' }, controller.signal)
		).rejects.toThrow('Semrush responded with status 503.');
	});

	it('never surfaces the raw fetchText rejection message, which may carry the request URL and key', async () => {
		state.fetchTextResult = async () => {
			throw new Error('fetch failed: https://api.semrush.com/?key=SECRET123');
		};
		const analyzer = createTrafficEstimatedAnalyzer(fakeStore('a-key') as never);
		const controller = new AbortController();

		const message = await analyzer
			.analyze('https://example.com/', { database: 'au' }, controller.signal)
			.catch((e: Error) => e.message);

		expect(message).not.toContain('SECRET123');
		expect(message).toBe('The Semrush request could not be completed.');
	});

	it('rethrows an Aborted rejection unchanged so the scheduler can rely on it', async () => {
		state.fetchTextResult = async () => {
			throw new Error('Aborted: user cancelled');
		};
		const analyzer = createTrafficEstimatedAnalyzer(fakeStore('a-key') as never);
		const controller = new AbortController();

		await expect(
			analyzer.analyze('https://example.com/', { database: 'au' }, controller.signal)
		).rejects.toThrow('Aborted: user cancelled');
	});

	it('never puts the API key in the request URL query value name, only as the key param value', async () => {
		withBody(csvBody);
		const analyzer = createTrafficEstimatedAnalyzer(fakeStore('a-key') as never);
		const controller = new AbortController();
		await analyzer.analyze('https://example.com/', { database: 'au' }, controller.signal);

		expect(state.calls[state.calls.length - 1]).toContain('key=a-key');
	});
});
