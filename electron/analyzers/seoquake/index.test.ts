import { describe, it, expect, beforeEach, vi } from 'vitest';

type FakePage = {
	setViewport: (opts: unknown) => Promise<void>;
	goto: (url: string, opts?: unknown) => Promise<void>;
	waitForSelector: (selector: string, opts?: unknown) => Promise<unknown>;
	$$eval: (selector: string, fn: (nodes: unknown[]) => unknown) => Promise<string[]>;
	close: () => Promise<void>;
};

type FakeBrowser = { newPage: () => Promise<FakePage>; close: () => Promise<void> };

const state = vi.hoisted(() => ({
	launches: 0,
	launch: async (): Promise<unknown> => ({}),
	closes: 0,
	existsSync: (p: string) => {
		void p;
		return true;
	},
	readdirSync: (p: string, opts?: unknown): { name: string; isDirectory: () => boolean }[] => {
		void p;
		void opts;
		return [{ name: '4.1.0_0', isDirectory: () => true }];
	}
}));

vi.mock('puppeteer', () => ({
	default: {
		launch: (opts: unknown) => state.launch(opts)
	}
}));

vi.mock('fs', () => ({
	existsSync: (p: string) => state.existsSync(p),
	readdirSync: (p: string, opts?: unknown) => state.readdirSync(p, opts)
}));

const { seoQuakeAnalyzer } = await import('./index');

const CHROME_PATH = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';

/** A browser whose page never resolves waitForSelector, so only an abort ends the work. */
function hangingBrowser(): FakeBrowser {
	state.launches++;
	return {
		newPage: async () => ({
			setViewport: async () => {},
			goto: async () => {},
			waitForSelector: () => new Promise(() => {}),
			$$eval: async () => [],
			close: async () => {}
		}),
		close: async () => {
			state.closes++;
		}
	};
}

beforeEach(() => {
	state.closes = 0;
	state.launches = 0;
	state.existsSync = () => true;
	state.readdirSync = () => [{ name: '4.1.0_0', isDirectory: () => true }];
	state.launch = async () => hangingBrowser();
});

const settings = { chromePath: CHROME_PATH, extensionPath: null };

describe('seoquake preflight', () => {
	it('reports unavailable when Chrome is missing', async () => {
		state.existsSync = (p: string) => !p.includes('chrome.exe');

		const result = await seoQuakeAnalyzer.preflight(settings);

		expect(result.available).toBe(false);
		expect(result.available === false && result.reason).toContain('Chrome');
	});

	it('reports unavailable when the SEO Quake extension root is missing', async () => {
		state.existsSync = (p: string) => !p.includes('Extensions');

		const result = await seoQuakeAnalyzer.preflight(settings);

		expect(result.available).toBe(false);
		expect(result.available === false && result.reason).toContain('SEO Quake');
	});

	it('reports available when Chrome and the extension are both present', async () => {
		expect(await seoQuakeAnalyzer.preflight(settings)).toEqual({ available: true });
	});
});

describe('seoquake analyze', () => {
	it('closes the browser and rejects when its signal aborts', async () => {
		const controller = new AbortController();
		const promise = seoQuakeAnalyzer.analyze('https://example.com/', settings, controller.signal);
		await vi.waitFor(() => expect(state.launches).toBe(1));

		controller.abort();

		await expect(promise).rejects.toThrow(/Aborted/);
		expect(state.closes).toBe(1);
	});

	it('does not launch a browser at all when the signal is already aborted', async () => {
		let launched = false;
		state.launch = async () => {
			launched = true;
			return hangingBrowser();
		};

		const controller = new AbortController();
		controller.abort();

		await expect(
			seoQuakeAnalyzer.analyze('https://example.com/', settings, controller.signal)
		).rejects.toThrow(/Cancelled/);
		expect(launched).toBe(false);
	});

	it('throws a readable error when the toolbar never appears', async () => {
		state.launch = async () => {
			state.launches++;
			return {
				newPage: async () => ({
					setViewport: async () => {},
					goto: async () => {},
					waitForSelector: async () => {
						throw new Error('waiting for selector failed: timeout 45000ms exceeded');
					},
					$$eval: async () => [],
					close: async () => {}
				}),
				close: async () => {
					state.closes++;
				}
			};
		};

		const controller = new AbortController();

		await expect(
			seoQuakeAnalyzer.analyze('https://example.com/', settings, controller.signal)
		).rejects.toThrow(/toolbar/);
		expect(state.closes).toBe(1);
	});

	it('resolves with parsed toolbar data and closes the browser once', async () => {
		const cells = ['1,234', '56', '7', '890', 'n/a', 'source', '1.2K'];
		state.launch = async () => {
			state.launches++;
			return {
				newPage: async () => ({
					setViewport: async () => {},
					goto: async () => {},
					waitForSelector: async () => {},
					$$eval: async () => cells,
					close: async () => {}
				}),
				close: async () => {
					state.closes++;
				}
			};
		};

		const controller = new AbortController();
		const result = await seoQuakeAnalyzer.analyze(
			'https://example.com/',
			settings,
			controller.signal
		);

		expect(result).toEqual({
			googleIndex: 1234,
			backlinks: 56,
			subdomainBacklinks: 7,
			bingIndex: 890,
			semrushRank: 1200,
			raw: cells
		});
		expect(state.closes).toBe(1);
	});
});
