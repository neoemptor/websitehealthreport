import { describe, it, expect, beforeEach, vi } from 'vitest';

type Page = {
	goto: (url: string) => Promise<unknown>;
	evaluate: (fn: unknown, ...args: unknown[]) => Promise<unknown>;
	close: () => Promise<void>;
};

const state = vi.hoisted(() => ({
	executablePath: '',
	launches: 0,
	closes: 0,
	pages: {} as Record<string, { links: string[]; fail?: boolean; hang?: boolean }>,
	robots: '' as string | null,
	visits: [] as string[]
}));

vi.mock('puppeteer', () => ({
	default: {
		executablePath: () => state.executablePath,
		launch: async () => {
			state.launches++;
			return {
				newPage: async (): Promise<Page> => {
					let current = '';
					return {
						goto: async (url) => {
							current = url;
							state.visits.push(url);
							const p = state.pages[url];
							if (!p) throw new Error('net::ERR_NAME_NOT_RESOLVED');
							if (p.fail) throw new Error('net::ERR_CONNECTION_RESET');
							if (p.hang) return new Promise(() => {});
						},
						evaluate: async () => ({
							url: current,
							title: 'T',
							metaKeywords: null,
							metaRobots: null,
							h1s: [],
							visibleText: 'plain page text here for testing purposes only',
							altText: '',
							nodes: [],
							links: state.pages[current]?.links ?? []
						}),
						close: async () => {}
					};
				},
				close: async () => {
					state.closes++;
				}
			};
		}
	}
}));

vi.mock('./crawl', async (importOriginal) => {
	const real = await importOriginal<typeof import('./crawl')>();
	return {
		...real,
		fetchAsGooglebot: async () => null,
		fetchRobots: async () => (state.robots === null ? null : state.robots)
	};
});

const { oldSeoAnalyzer } = await import('./index');
const settings = { maxPages: 10 };

beforeEach(() => {
	state.executablePath = process.execPath;
	state.launches = 0;
	state.closes = 0;
	state.robots = '';
	state.visits = [];
	state.pages = {
		'https://example.com/': { links: ['/a', '/b', '/admin/secret', 'https://other.com/'] },
		'https://example.com/a': { links: ['/c'] },
		'https://example.com/b': { links: [] },
		'https://example.com/c': { links: [] },
		'https://example.com/admin/secret': { links: [] }
	};
});

describe('oldseo preflight', () => {
	it('is unavailable without Chromium', async () => {
		state.executablePath = 'C:definitely\notherechrome.exe';
		const r = await oldSeoAnalyzer.preflight(settings);
		expect(r.available).toBe(false);
	});
});

describe('oldseo analyze', () => {
	it('crawls breadth-first within the cap, honouring robots, and counts pages', async () => {
		state.robots = 'User-agent: *\nDisallow: /admin';
		const data = await oldSeoAnalyzer.analyze(
			'https://example.com/',
			{ maxPages: 2 },
			new AbortController().signal
		);
		expect(data.pagesRead).toBe(3); // home + a + b
		expect(data.pagesSkipped).toBe(0);
		expect(state.closes).toBe(1);
	});

	it('never reads a page robots.txt disallows, even with budget to spare', async () => {
		state.robots = 'User-agent: *\nDisallow: /admin';
		const data = await oldSeoAnalyzer.analyze(
			'https://example.com/',
			{ maxPages: 3 },
			new AbortController().signal
		);
		expect(state.visits).not.toContain('https://example.com/admin/secret');
		expect(state.visits).toContain('https://example.com/a');
		expect(data.pagesRead).toBe(4); // home + a + b + c, the disallowed page skipped
	});

	it('falls back to the default page cap when maxPages is not a finite number', async () => {
		state.robots = 'User-agent: *\nDisallow: /admin';
		const data = await oldSeoAnalyzer.analyze(
			'https://example.com/',
			{ maxPages: Number.NaN },
			new AbortController().signal
		);
		// Not 1: a NaN cap must not silently reduce the crawl to the homepage.
		expect(data.pagesRead).toBe(4);
	});

	it('counts a failing internal page as skipped and continues', async () => {
		state.robots = 'User-agent: *\nDisallow: /admin';
		state.pages['https://example.com/a'].fail = true;
		state.pages['https://example.com/b'].links = ['/c'];
		const data = await oldSeoAnalyzer.analyze(
			'https://example.com/',
			{ maxPages: 2 },
			new AbortController().signal
		);
		expect(data.pagesSkipped).toBe(1);
		// home + b + c: the failed /a does not consume the maxPages budget, so
		// the crawl still reaches two more successful pages (b, then c via b).
		expect(data.pagesRead).toBe(3);
	});

	it('fails when the homepage cannot load', async () => {
		state.pages['https://example.com/'].fail = true;
		await expect(
			oldSeoAnalyzer.analyze('https://example.com/', settings, new AbortController().signal)
		).rejects.toThrow(/ERR_CONNECTION_RESET/);
		expect(state.closes).toBe(1);
	});

	it('closes the browser and rejects when aborted', async () => {
		state.pages['https://example.com/'].hang = true;
		const controller = new AbortController();
		const promise = oldSeoAnalyzer.analyze('https://example.com/', settings, controller.signal);
		await vi.waitFor(() => expect(state.launches).toBe(1));
		controller.abort();
		await expect(promise).rejects.toThrow(/Aborted/);
		expect(state.closes).toBe(1);
	});
});
