import puppeteer from 'puppeteer';
import type { Analyzer } from '../types';
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
			// Throws if Puppeteer's bundled Chromium was never downloaded.
			puppeteer.executablePath();
			return { available: true };
		} catch (error) {
			return { available: false, reason: (error as Error).message };
		}
	},

	async analyze(domain): Promise<KeywordsData> {
		const browser = await puppeteer.launch();
		try {
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
		} finally {
			await browser.close();
		}
	}
};
