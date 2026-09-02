import { describe, it, expect, beforeEach, vi } from 'vitest';

type FakeBrowser = { newPage: () => Promise<unknown>; close: () => Promise<void> };

const state = vi.hoisted(() => ({
	executablePath: '',
	launches: 0,
	launch: async (): Promise<unknown> => ({}),
	closes: 0
}));

vi.mock('puppeteer', () => ({
	default: {
		executablePath: () => state.executablePath,
		launch: () => state.launch()
	}
}));

const { keywordsAnalyzer } = await import('./index');

/** A browser whose page never finishes loading, so only an abort ends the work. */
function hangingBrowser(): FakeBrowser {
	state.launches++;
	return {
		newPage: async () => ({
			goto: () => new Promise(() => {}),
			evaluate: async () => ({ keywords: [], bodyText: '' }),
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
});

describe('keywords preflight', () => {
	it('reports unavailable when the Chromium binary is not on disk', async () => {
		// executablePath() only computes a path; the download may never have
		// happened or the cache may have been cleared.
		state.executablePath = 'C:definitely\notherechrome.exe';

		const result = await keywordsAnalyzer.preflight({});

		expect(result.available).toBe(false);
		expect(result.available === false && result.reason).toContain('not installed');
	});

	it('reports available when the binary exists', async () => {
		expect(await keywordsAnalyzer.preflight({})).toEqual({ available: true });
	});
});

describe('keywords analyze', () => {
	it('closes the browser and rejects when its signal aborts', async () => {
		const controller = new AbortController();
		const promise = keywordsAnalyzer.analyze('https://example.com/', {}, controller.signal);
		// Waiting on the launch rather than a fixed sleep: a sleep that loses a
		// race under load aborts before the browser exists and tests nothing.
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
			keywordsAnalyzer.analyze('https://example.com/', {}, controller.signal)
		).rejects.toThrow(/Cancelled/);
		expect(launched).toBe(false);
	});
});
