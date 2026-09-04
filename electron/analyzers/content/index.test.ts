import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { GrammarState } from './grammar';

// dictionary-en-au is ESM-only and is loaded through importEsm (see
// electron/esm.ts), which vitest's module mocking cannot intercept, so the
// loader itself is mocked instead. The real dictionary files are read from
// disk so the tests exercise genuine Australian spelling data.
vi.mock('../../esm', () => ({
	importEsm: async (specifier: string) => {
		if (specifier === 'dictionary-en-au') {
			const require = createRequire(import.meta.url);
			const dir = require.resolve('dictionary-en-au').replace('index.js', '');
			return {
				default: {
					aff: readFileSync(dir + 'index.aff'),
					dic: readFileSync(dir + 'index.dic')
				}
			};
		}
		throw new Error('unexpected import ' + specifier);
	}
}));

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

const checkGrammar = vi.hoisted(() => vi.fn());
vi.mock('./grammar', async () => {
	const actual = await vi.importActual<typeof import('./grammar')>('./grammar');
	return { ...actual, checkGrammar };
});

const { contentAnalyzer } = await import('./index');

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

function readyBrowser(text: string): FakeBrowser {
	state.launches++;
	return {
		newPage: async () => ({
			goto: async () => {},
			evaluate: async () => text,
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
	checkGrammar.mockReset();
});

describe('content preflight', () => {
	it('reports unavailable when the Chromium binary is not on disk', async () => {
		state.executablePath = 'C:definitely\notherechrome.exe';

		const result = await contentAnalyzer.preflight(contentAnalyzer.defaultSettings);

		expect(result.available).toBe(false);
		expect(result.available === false && result.reason).toContain('not installed');
	});
});

describe('content analyze', () => {
	it('returns ok with spelling results and unavailable grammar when the provider is off', async () => {
		state.launch = async () => readyBrowser('This has a mispeling in it.');

		const data = await contentAnalyzer.analyze(
			'https://example.com/',
			{ ignoreWords: [], grammar: { provider: 'off' } },
			new AbortController().signal
		);

		expect(data.spelling.misspellings.some((m) => m.word === 'mispeling')).toBe(true);
		expect(data.grammar).toEqual({
			status: 'unavailable',
			reason: 'Grammar checking is switched off in settings.'
		});
		expect(checkGrammar).not.toHaveBeenCalled();
	});

	it('is still ok overall when grammar fails', async () => {
		state.launch = async () => readyBrowser('Some page text.');
		const failed: GrammarState = { status: 'failed', error: 'boom' };
		checkGrammar.mockResolvedValue(failed);

		const data = await contentAnalyzer.analyze(
			'https://example.com/',
			{ ignoreWords: [], grammar: { provider: 'languagetool-public' } },
			new AbortController().signal
		);

		expect(data.grammar).toEqual(failed);
		expect(data.spelling).toBeDefined();
	});

	it('closes the browser and rejects when its signal aborts', async () => {
		const controller = new AbortController();
		const promise = contentAnalyzer.analyze(
			'https://example.com/',
			contentAnalyzer.defaultSettings,
			controller.signal
		);
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
			contentAnalyzer.analyze(
				'https://example.com/',
				contentAnalyzer.defaultSettings,
				controller.signal
			)
		).rejects.toThrow(/Cancelled/);
		expect(launched).toBe(false);
	});
});
