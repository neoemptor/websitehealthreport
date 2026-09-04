import * as fs from 'fs';
import puppeteer from 'puppeteer';
import type { Analyzer } from '../types';
import { once, rejectOnAbort } from '../abort';
import { fetchText } from '../../http';
import {
	parseHeadings,
	parseRobotsForAiCrawlers,
	parseStructuredData,
	type CrawlerRule
} from './parse';

export type AeoData = {
	llmsTxt: boolean;
	crawlers: CrawlerRule[];
	structuredData: { blocks: number; valid: number; types: string[] };
	headings: { h1Count: number; hierarchyOk: boolean };
	jsDependencyRatio: number;
	sitemap: boolean;
};

/**
 * Proportion of the rendered text that is already present without JavaScript.
 * 1 means fully server-rendered; near 0 means AI crawlers see almost nothing.
 */
export function jsDependencyRatio(rawText: string, renderedText: string): number {
	const rendered = renderedText.trim().length;
	if (rendered === 0) return 1;
	return Math.min(1, rawText.trim().length / rendered);
}

function stripTags(html: string): string {
	const withoutHead = /<body[^>]*>/i.test(html) ? html.slice(html.search(/<body[^>]*>/i)) : html;

	return withoutHead
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(/<script[\s\S]*?<\/script>/gi, ' ')
		.replace(/<style[\s\S]*?<\/style>/gi, ' ')
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/\s+/g, ' ');
}

async function exists(url: string, signal: AbortSignal): Promise<boolean> {
	try {
		return (await fetchText(url, { signal, timeoutMs: 10_000 })).status === 200;
	} catch (error) {
		if (signal.aborted) throw error;
		return false;
	}
}

export const aeoAnalyzer: Analyzer<Record<string, never>> = {
	id: 'aeo',
	label: 'AI Agent Optimisation',
	concurrency: 'limited',
	timeoutMs: 90_000,
	defaultSettings: {},

	async preflight() {
		try {
			// Same rationale as the keywords analyzer: executablePath() only
			// computes a path, it doesn't confirm Chromium was ever downloaded.
			const executable = puppeteer.executablePath();
			if (!fs.existsSync(executable)) {
				return {
					available: false,
					reason: `Puppeteer's Chromium is not installed at ${executable}. Run "npx puppeteer browsers install chrome".`
				};
			}
			return { available: true };
		} catch (error) {
			return { available: false, reason: (error as Error).message };
		}
	},

	async analyze(domain, _settings, signal): Promise<AeoData> {
		if (signal.aborted) throw new Error('Cancelled before the browser was launched.');

		const origin = new URL(domain).origin;

		const [page, robots, llmsTxt, sitemap] = await Promise.all([
			fetchText(domain, { signal, timeoutMs: 20_000 }),
			fetchText(`${origin}/robots.txt`, { signal, timeoutMs: 10_000 })
				.then((response) => (response.status === 200 ? response : { body: '' }))
				.catch(() => ({
					body: ''
				})),
			exists(`${origin}/llms.txt`, signal),
			exists(`${origin}/sitemap.xml`, signal)
		]);

		if (page.status < 200 || page.status >= 300) {
			throw new Error(`The site answered with status ${page.status}.`);
		}

		if (signal.aborted) throw new Error('Cancelled before the browser was launched.');

		const browser = await puppeteer.launch();
		const close = once(() => browser.close());

		// Closed on abort, not only in the finally below: on a timeout the
		// scheduler stops waiting for this promise and frees the slot, so a
		// teardown that waits for the page work to return may never happen.
		const onAbort = () => void close();
		signal.addEventListener('abort', onAbort, { once: true });
		const aborted = rejectOnAbort(signal);

		try {
			const renderedText = await Promise.race([renderPage(browser, domain), aborted.promise]);

			return {
				llmsTxt,
				sitemap,
				crawlers: parseRobotsForAiCrawlers(robots.body),
				structuredData: parseStructuredData(page.body),
				headings: parseHeadings(page.body),
				jsDependencyRatio: jsDependencyRatio(stripTags(page.body), renderedText)
			};
		} finally {
			aborted.dispose();
			signal.removeEventListener('abort', onAbort);
			await close();
		}
	}
};

async function renderPage(
	browser: Pick<Awaited<ReturnType<typeof puppeteer.launch>>, 'newPage'>,
	domain: string
): Promise<string> {
	const page = await browser.newPage();
	try {
		await page.goto(domain, { waitUntil: 'domcontentloaded', timeout: 20_000 });
		return await page.evaluate(() => document.body.innerText);
	} finally {
		await page.close();
	}
}
