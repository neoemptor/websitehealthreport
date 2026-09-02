import * as fs from 'fs';
import puppeteer from 'puppeteer';
import type { Analyzer } from '../types';
import { once, rejectOnAbort } from '../abort';
import { countKeywords, type KeywordCount } from './parse';

export type KeywordsData = { keywords: KeywordCount[] };

export const keywordsAnalyzer: Analyzer<Record<string, never>> = {
	id: 'keywords',
	label: 'Keywords',
	concurrency: 'limited',
	timeoutMs: 60_000,
	defaultSettings: {},

	async preflight() {
		try {
			// executablePath() only computes a path; it throws for an unsupported
			// platform, not for a Chromium that was never downloaded or has been
			// cleared from the cache. Without the existence check preflight says
			// available, launch() then throws, and every keywords cell reports
			// failed — "not installed here" flattened into "crashed", which are
			// different facts to the operator.
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

	async analyze(domain, _settings, signal): Promise<KeywordsData> {
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
			return await Promise.race([scrape(browser, domain), aborted.promise]);
		} finally {
			aborted.dispose();
			signal.removeEventListener('abort', onAbort);
			await close();
		}
	}
};

async function scrape(
	browser: Pick<Awaited<ReturnType<typeof puppeteer.launch>>, 'newPage'>,
	domain: string
): Promise<KeywordsData> {
	const page = await browser.newPage();
	try {
		await page.goto(domain, { waitUntil: 'domcontentloaded' });

		const { keywords, bodyText } = await page.evaluate(() => {
			const meta = document.querySelector('meta[name="keywords"]');
			const content = meta?.getAttribute('content')?.toLowerCase() ?? '';
			return { keywords: content.split(','), bodyText: document.body.innerText };
		});

		return { keywords: countKeywords(keywords, bodyText) };
	} finally {
		await page.close();
	}
}
