import { describe, it, expect, beforeEach, vi } from 'vitest';

type FakeBrowser = { newPage: () => Promise<unknown>; close: () => Promise<void> };

const state = vi.hoisted(() => ({
	executablePath: '',
	launches: 0,
	launch: async (): Promise<unknown> => ({}),
	closes: 0,
	homepageStatus: 200
}));

vi.mock('puppeteer', () => ({
	default: {
		executablePath: () => state.executablePath,
		launch: () => state.launch()
	}
}));

vi.mock('../../http', () => ({
	fetchText: async (url: string) => {
		if (url.includes('/robots.txt') || url.includes('/llms.txt') || url.includes('/sitemap.xml')) {
			return { status: 404, headers: new Headers(), body: '', finalUrl: url };
		}
		return {
			status: state.homepageStatus,
			headers: new Headers(),
			body: '<html></html>',
			finalUrl: url
		};
	}
}));

const { aeoAnalyzer } = await import('./index');

/** A browser whose page never finishes loading, so only an abort ends the work. */
function hangingBrowser(): FakeBrowser {
	state.launches++;
	return {
		newPage: async () => ({
			goto: () => new Promise(() => {}),
			evaluate: async () => '',
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
	state.executablePath = process.execPath;
	state.launch = async () => hangingBrowser();
	state.homepageStatus = 200;
});

describe('aeo preflight', () => {
	it('reports unavailable when the Chromium binary is not on disk', () => {
		state.executablePath = 'C:definitely\notherechrome.exe';
		return aeoAnalyzer.preflight({}).then((result) => {
			expect(result.available).toBe(false);
			expect(result.available === false && result.reason).toContain('not installed');
		});
	});

	it('reports available when the binary exists', async () => {
		expect(await aeoAnalyzer.preflight({})).toEqual({ available: true });
	});
});

describe('aeo analyze', () => {
	it('closes the browser and rejects when its signal aborts', async () => {
		const controller = new AbortController();
		const promise = aeoAnalyzer.analyze('https://example.com/', {}, controller.signal);
		await vi.waitFor(() => expect(state.launches).toBe(1));

		controller.abort();

		await expect(promise).rejects.toThrow(/Aborted/);
		expect(state.closes).toBe(1);
	});

	it('rejects with the status when the homepage answers with a non-2xx status', async () => {
		state.homepageStatus = 500;

		await expect(
			aeoAnalyzer.analyze('https://example.com/', {}, new AbortController().signal)
		).rejects.toThrow(/status/);
	});
});
