import { describe, it, expect, beforeEach, vi } from 'vitest';

type FakeBrowser = { newPage: () => Promise<unknown>; close: () => Promise<void> };

const state = vi.hoisted(() => ({
	executablePath: '',
	launches: 0,
	launch: async (): Promise<unknown> => ({}),
	closes: 0,
	homepageStatus: 200,
	homepageBody: '<html></html>',
	robotsStatus: 404,
	robotsBody: '',
	llmsStatus: 404,
	sitemapStatus: 404,
	renderedText: ''
}));

vi.mock('puppeteer', () => ({
	default: {
		executablePath: () => state.executablePath,
		launch: () => state.launch()
	}
}));

vi.mock('../../http', () => ({
	fetchText: async (url: string) => {
		if (url.includes('/robots.txt')) {
			return {
				status: state.robotsStatus,
				headers: new Headers(),
				body: state.robotsBody,
				finalUrl: url
			};
		}
		if (url.includes('/llms.txt')) {
			return { status: state.llmsStatus, headers: new Headers(), body: '', finalUrl: url };
		}
		if (url.includes('/sitemap.xml')) {
			return { status: state.sitemapStatus, headers: new Headers(), body: '', finalUrl: url };
		}
		return {
			status: state.homepageStatus,
			headers: new Headers(),
			body: state.homepageBody,
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

/** A browser whose page resolves normally, returning the configured rendered text. */
function resolvingBrowser(): FakeBrowser {
	state.launches++;
	return {
		newPage: async () => ({
			goto: async () => {},
			evaluate: async () => state.renderedText,
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
	state.homepageBody = '<html></html>';
	state.robotsStatus = 404;
	state.robotsBody = '';
	state.llmsStatus = 404;
	state.sitemapStatus = 404;
	state.renderedText = '';
});

describe('aeo preflight', () => {
	it('reports unavailable when the Chromium binary is not on disk', () => {
		state.executablePath = 'C:/definitely/not-here/chrome.exe';
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

	it('returns the full AeoData shape for a normal page', async () => {
		state.launch = async () => resolvingBrowser();

		const rawBody =
			'<html><head><title>A Very Long Head Title Used Only To Test Head Stripping</title></head>' +
			'<body><script>x</script>' +
			'<script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>' +
			'<h1>Welcome</h1><h2>Intro</h2><p>Hello world body text</p></body></html>';
		state.homepageBody = rawBody;
		state.homepageStatus = 200;

		state.robotsStatus = 200;
		state.robotsBody = 'User-agent: GPTBot\nDisallow: /\n';

		state.llmsStatus = 404;
		state.sitemapStatus = 200;

		state.renderedText = 'Welcome Intro Hello world body text and extra JS-only content';

		const result = await aeoAnalyzer.analyze(
			'https://example.com/',
			{},
			new AbortController().signal
		);

		expect(result.llmsTxt).toBe(false);
		expect(result.sitemap).toBe(true);

		const gptBot = result.crawlers.find((c) => c.agent === 'GPTBot');
		const otherCrawler = result.crawlers.find((c) => c.agent !== 'GPTBot');
		expect(gptBot?.allowed).toBe(false);
		expect(otherCrawler?.allowed).toBe(true);

		expect(result.structuredData.valid).toBe(1);
		expect(result.headings.h1Count).toBe(1);

		const rawText = 'Welcome Intro Hello world body text';
		const expectedRatio = rawText.length / state.renderedText.length;
		expect(result.jsDependencyRatio).toBeGreaterThan(0);
		expect(result.jsDependencyRatio).toBeLessThan(1);
		expect(result.jsDependencyRatio).toBeCloseTo(expectedRatio);

		expect(state.closes).toBe(1);
	});
});
