import { describe, it, expect, beforeEach, vi } from 'vitest';

type FakePage = {
	setViewport: (opts: unknown) => Promise<void>;
	goto: (url: string, opts?: unknown) => Promise<void>;
	waitForFunction: (fn: () => unknown, opts?: unknown) => Promise<unknown>;
	evaluate: (
		fn: () => unknown
	) => Promise<Array<{ kind: 'label' | 'value'; text: string; parent: number }>>;
	close: () => Promise<void>;
};

type FakeBrowser = { newPage: () => Promise<FakePage>; close: () => Promise<void> };

const state = vi.hoisted(() => ({
	launches: 0,
	launch: async (): Promise<unknown> => ({}),
	launchOpts: undefined as unknown,
	closes: 0,
	existsSync: (p: string) => {
		void p;
		return true;
	},
	readdirSync: (p: string, opts?: unknown): { name: string; isDirectory: () => boolean }[] => {
		void p;
		void opts;
		return [{ name: '4.1.0_0', isDirectory: () => true }];
	},
	executablePath: () => 'C:/puppeteer/chrome-for-testing/chrome.exe'
}));

vi.mock('puppeteer', () => ({
	default: {
		launch: (opts: unknown) => {
			state.launchOpts = opts;
			return state.launch(opts);
		},
		executablePath: () => state.executablePath()
	}
}));

vi.mock('fs', () => ({
	existsSync: (p: string) => state.existsSync(p),
	readdirSync: (p: string, opts?: unknown) => state.readdirSync(p, opts)
}));

const { seoQuakeAnalyzer } = await import('./index');
const { pickLatestVersion } = await import('./paths');

const CHROME_PATH = 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe';

/** A browser whose page never resolves waitForFunction, so only an abort ends the work. */
function hangingBrowser(): FakeBrowser {
	state.launches++;
	return {
		newPage: async () => ({
			setViewport: async () => {},
			goto: async () => {},
			waitForFunction: () => new Promise(() => {}),
			evaluate: async () => [],
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
	state.launchOpts = undefined;
	state.existsSync = () => true;
	state.readdirSync = () => [{ name: '4.1.0_0', isDirectory: () => true }];
	state.executablePath = () => 'C:/puppeteer/chrome-for-testing/chrome.exe';
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

describe('seoquake chrome resolution', () => {
	it('prefers the configured chromePath when set', async () => {
		state.launch = async () => hangingBrowser();
		const controller = new AbortController();
		const promise = seoQuakeAnalyzer.analyze('https://example.com/', settings, controller.signal);
		await vi.waitFor(() => expect(state.launches).toBe(1));
		controller.abort();
		await expect(promise).rejects.toThrow(/Aborted/);

		expect((state.launchOpts as { executablePath: string }).executablePath).toBe(CHROME_PATH);
	});

	it('falls back to puppeteer.executablePath() when no chromePath is configured', async () => {
		state.launch = async () => hangingBrowser();
		const noChromePathSettings = { chromePath: null, extensionPath: null };
		const controller = new AbortController();
		const promise = seoQuakeAnalyzer.analyze(
			'https://example.com/',
			noChromePathSettings,
			controller.signal
		);
		await vi.waitFor(() => expect(state.launches).toBe(1));
		controller.abort();
		await expect(promise).rejects.toThrow(/Aborted/);

		const opts = state.launchOpts as { executablePath: string; args: string[] };
		expect(opts.executablePath).toBe('C:/puppeteer/chrome-for-testing/chrome.exe');
		expect(opts.args.some((arg) => arg.startsWith('--disable-extensions-except='))).toBe(true);
		expect(opts.args.some((arg) => arg.startsWith('--load-extension='))).toBe(true);
	});

	it('launches headless: false with both extension args regardless of chrome source', async () => {
		state.launch = async () => hangingBrowser();
		const controller = new AbortController();
		const promise = seoQuakeAnalyzer.analyze('https://example.com/', settings, controller.signal);
		await vi.waitFor(() => expect(state.launches).toBe(1));
		controller.abort();
		await expect(promise).rejects.toThrow(/Aborted/);

		const opts = state.launchOpts as { headless: boolean; args: string[] };
		expect(opts.headless).toBe(false);
		expect(opts.args).toHaveLength(2);
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
					waitForFunction: async () => {
						throw new Error('waiting for function failed: timeout 45000ms exceeded');
					},
					evaluate: async () => [],
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
		// The in-page extractor reports a flat node list; pairing happens in Node.
		const nodes = [
			{ kind: 'label' as const, text: 'Rank', parent: 0 },
			{ kind: 'value' as const, text: '38.5M', parent: 0 },
			{ kind: 'label' as const, text: 'L', parent: 1 },
			{ kind: 'value' as const, text: '213', parent: 1 },
			{ kind: 'label' as const, text: 'LD', parent: 2 },
			{ kind: 'value' as const, text: '435', parent: 2 },
			{ kind: 'label' as const, text: 'PIN', parent: 3 },
			{ kind: 'value' as const, text: '12', parent: 3 }
		];
		state.launch = async () => {
			state.launches++;
			return {
				newPage: async () => ({
					setViewport: async () => {},
					goto: async () => {},
					waitForFunction: async () => {},
					evaluate: async () => nodes,
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
			semrushRank: 38_500_000,
			backlinks: 213,
			linkingDomains: 435,
			pinterest: 12,
			raw: { Rank: '38.5M', L: '213', LD: '435', PIN: '12' }
		});
		expect(state.closes).toBe(1);
	});
});

describe('pickLatestVersion', () => {
	it('throws a readable error for an empty list of version directories', () => {
		expect(() => pickLatestVersion([])).toThrow(/version directories/);
	});
});
