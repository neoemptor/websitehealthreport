import * as fs from 'fs';
import puppeteer from 'puppeteer';
import type { Analyzer } from '../types';
import { once, rejectOnAbort } from '../abort';
import { createSpellChecker, extractWords, type Misspelling } from './spelling';
import { checkGrammar, type GrammarSettings, type GrammarState } from './grammar';

export type ContentSettings = { ignoreWords: string[]; grammar: GrammarSettings };

export type ContentData = {
	spelling: { misspellings: Misspelling[] };
	grammar: GrammarState;
};

/** LanguageTool rejects very large payloads, and a page's worth is plenty. */
const MAX_GRAMMAR_CHARS = 20_000;

export const contentAnalyzer: Analyzer<ContentSettings> = {
	id: 'content',
	label: 'Content (AU spelling and grammar)',
	concurrency: 'limited',
	timeoutMs: 120_000,
	defaultSettings: { ignoreWords: [], grammar: { provider: 'off' } },

	async preflight() {
		try {
			// The dictionary is the only hard dependency; grammar has its own state.
			await createSpellChecker();
		} catch (error) {
			return { available: false, reason: `Dictionary failed to load: ${(error as Error).message}` };
		}

		try {
			// executablePath() only computes a path; it throws for an unsupported
			// platform, not for a Chromium that was never downloaded or has been
			// cleared from the cache. Without the existence check preflight says
			// available, launch() then throws, and every content cell reports
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

	async analyze(domain, settings, signal): Promise<ContentData> {
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
			return await Promise.race([
				scrape(browser, domain, settings, signal, close),
				aborted.promise
			]);
		} finally {
			aborted.dispose();
			signal.removeEventListener('abort', onAbort);
			await close();
		}
	}
};

/**
 * Words drawn from the site's own hostname (e.g. "cjsgaragedoors" from
 * cjsgaragedoors.com.au) are business names, not misspellings, so they are
 * added to the ignore list for this run only — settings.ignoreWords is left
 * untouched. The hostname is split on both dots and hyphens, so a hyphenated
 * domain (e.g. "cjs-garage-doors.com") contributes each part on its own.
 * Parts shorter than 3 characters are dropped as TLD-shaped noise — "au"
 * goes, "com" stays.
 */
function hostnameWords(domain: string): string[] {
	let hostname: string;
	try {
		hostname = new URL(domain).hostname;
	} catch {
		return [];
	}

	return hostname
		.split(/[.-]/)
		.map((part) => part.trim())
		.filter((part) => part.length >= 3);
}

async function scrape(
	browser: Pick<Awaited<ReturnType<typeof puppeteer.launch>>, 'newPage'>,
	domain: string,
	settings: ContentSettings,
	signal: AbortSignal,
	closeBrowser: () => Promise<void>
): Promise<ContentData> {
	let text = '';
	const page = await browser.newPage();
	try {
		// networkidle2 can hang on sites with long-polling connections; the page
		// having parsed is enough to read its text.
		await page.goto(domain, { waitUntil: 'domcontentloaded', timeout: 30_000 });
		text = await page.evaluate(() => document.body.innerText);
	} finally {
		await page.close();
	}

	// The page text is all Chrome was needed for — spelling is local and
	// grammar is an HTTP call, so the browser is closed here rather than held
	// open (via the outer `finally`) for the rest of this function. `close` is
	// wrapped in `once`, so this and the outer teardown never double-close.
	await closeBrowser();

	const checker = await createSpellChecker();
	const ignoreWords = [...settings.ignoreWords, ...hostnameWords(domain)];
	const misspellings = checker.check(extractWords(text), ignoreWords);

	// A stored settings.content block saved before grammar support existed (or
	// otherwise missing the field) must behave as provider "off", not throw —
	// so both fields are read defensively rather than assuming settings.grammar
	// exists.
	const grammarSettings: GrammarSettings = {
		provider: settings.grammar?.provider ?? 'off',
		endpoint: settings.grammar?.endpoint
	};

	// Spelling never depends on the grammar provider: a provider switched off
	// is reported directly rather than going through checkGrammar, and any
	// other failure (unreachable server, bad response) never costs the
	// spelling results above.
	const grammar: GrammarState =
		grammarSettings.provider === 'off'
			? { status: 'unavailable', reason: 'Grammar checking is switched off in settings.' }
			: await checkGrammar(text.slice(0, MAX_GRAMMAR_CHARS), grammarSettings, signal);

	return { spelling: { misspellings }, grammar };
}
