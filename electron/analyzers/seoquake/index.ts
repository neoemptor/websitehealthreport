import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import puppeteer from 'puppeteer';
import type { Analyzer } from '../types';
import { once, rejectOnAbort } from '../abort';
import { chromeCandidates, extensionRoot, pickLatestVersion } from './paths';
import { parseToolbar, type SeoQuakeData } from './parse';

export type SeoQuakeSettings = { chromePath: string | null; extensionPath: string | null };

function resolveChrome(settings: SeoQuakeSettings): string {
	if (settings.chromePath) {
		if (!fs.existsSync(settings.chromePath)) {
			throw new Error(`Configured Chrome path does not exist: ${settings.chromePath}`);
		}
		return settings.chromePath;
	}

	// Chrome 137+ ignores --load-extension entirely, so prefer Puppeteer's
	// bundled Chrome for Testing build, which still honors it. Fall back to a
	// system Chrome install only if that bundled binary isn't present.
	const bundled = puppeteer.executablePath();
	if (bundled && fs.existsSync(bundled)) {
		return bundled;
	}

	const candidates = chromeCandidates(process.platform, process.env, os.homedir());
	const found = candidates.find((candidate) => fs.existsSync(candidate));
	if (!found) {
		throw new Error(
			`Chrome not found. Looked for Puppeteer's bundled Chrome for Testing (${bundled}) and:\n  ${candidates.join(
				'\n  '
			)}`
		);
	}
	return found;
}

function resolveExtension(settings: SeoQuakeSettings): string {
	if (settings.extensionPath) {
		if (!fs.existsSync(settings.extensionPath)) {
			throw new Error(`Configured extension path does not exist: ${settings.extensionPath}`);
		}
		return settings.extensionPath;
	}

	const root = extensionRoot(process.platform, process.env, os.homedir());
	if (!fs.existsSync(root)) {
		throw new Error(`SEO Quake is not installed for the default Chrome profile (${root}).`);
	}

	const versions = fs
		.readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => entry.name);

	return path.join(root, pickLatestVersion(versions));
}

export const seoQuakeAnalyzer: Analyzer<SeoQuakeSettings> = {
	id: 'seoquake',
	label: 'SEO Quake',
	// Opens a visible window: two at once would fight for the operator's screen.
	concurrency: 'serial',
	timeoutMs: 90_000,
	defaultSettings: { chromePath: null, extensionPath: null },

	async preflight(settings) {
		try {
			resolveChrome(settings);
			resolveExtension(settings);
			return { available: true };
		} catch (error) {
			return { available: false, reason: (error as Error).message };
		}
	},

	async analyze(domain, settings, signal): Promise<SeoQuakeData> {
		if (signal.aborted) throw new Error('Cancelled before the browser was launched.');

		const extensionPath = resolveExtension(settings);

		const browser = await puppeteer.launch({
			headless: false,
			executablePath: resolveChrome(settings),
			args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
		});
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
): Promise<SeoQuakeData> {
	const page = await browser.newPage();
	try {
		await page.setViewport({ width: 1600, height: 1000 });
		await page.goto(domain, { waitUntil: 'domcontentloaded', timeout: 30_000 });

		// SEO Quake 4 renders a custom element with a shadow root and streams its
		// metrics in one at a time as they resolve, re-rendering the panel each
		// time - so waiting for merely one populated span is a race and can fire
		// on an unrelated control (e.g. a "More data" expand icon) before the
		// labelled Rank/L/LD/PIN row exists. Wait until the same label/value
		// extraction used below actually finds a labelled pair instead. Both
		// callbacks below must be fully self-contained: Puppeteer serializes
		// them by source text to run in the page, so they cannot close over
		// anything defined in this Node.js scope.
		try {
			await page.waitForFunction(
				() => {
					function extractPairs(): Array<{ label: string; value: string }> {
						const host = document.querySelector('seoquake-seobar');
						const root = (host as Element | null)?.shadowRoot;
						if (!root) return [];

						const results: Array<{ label: string; value: string }> = [];
						const values = root.querySelectorAll('span.font-semibold');
						values.forEach((valueEl) => {
							const value = (valueEl.textContent ?? '').trim();
							const parent = valueEl.parentElement;
							if (!parent) return;

							let label = '';
							const previous = valueEl.previousElementSibling;
							if (
								previous &&
								previous.tagName === 'SPAN' &&
								!previous.classList.contains('font-semibold')
							) {
								label = (previous.textContent ?? '').trim();
							} else {
								const siblingSpans = Array.from(parent.querySelectorAll(':scope > span'));
								const labelSpan = siblingSpans.find(
									(span) => span !== valueEl && !span.classList.contains('font-semibold')
								);
								label = (labelSpan?.textContent ?? '').trim();
							}

							if (label) results.push({ label, value });
						});
						return results;
					}

					return extractPairs().length > 0;
				},
				{ timeout: 45_000 }
			);
		} catch {
			throw new Error("SEO Quake's toolbar did not appear within 45 seconds.");
		}

		const pairs = await page.evaluate(() => {
			const host = document.querySelector('seoquake-seobar');
			const root = (host as Element | null)?.shadowRoot;
			if (!root) return [];

			const results: Array<{ label: string; value: string }> = [];
			const values = root.querySelectorAll('span.font-semibold');
			values.forEach((valueEl) => {
				const value = (valueEl.textContent ?? '').trim();
				const parent = valueEl.parentElement;
				if (!parent) return;

				let label = '';
				const previous = valueEl.previousElementSibling;
				if (
					previous &&
					previous.tagName === 'SPAN' &&
					!previous.classList.contains('font-semibold')
				) {
					label = (previous.textContent ?? '').trim();
				} else {
					const siblingSpans = Array.from(parent.querySelectorAll(':scope > span'));
					const labelSpan = siblingSpans.find(
						(span) => span !== valueEl && !span.classList.contains('font-semibold')
					);
					label = (labelSpan?.textContent ?? '').trim();
				}

				if (label) results.push({ label, value });
			});
			return results;
		});

		if (pairs.length === 0) {
			throw new Error('SEO Quake toolbar rendered but contained no parameter cells.');
		}

		return parseToolbar(pairs);
	} finally {
		await page.close();
	}
}
