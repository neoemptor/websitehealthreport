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

	const candidates = chromeCandidates(process.platform, process.env, os.homedir());
	const found = candidates.find((candidate) => fs.existsSync(candidate));
	if (!found) {
		throw new Error(`Chrome not found. Looked in:\n  ${candidates.join('\n  ')}`);
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
		await page.setViewport({ width: 1920, height: 1080 });
		await page.goto(domain, { waitUntil: 'domcontentloaded' });

		// The toolbar is injected by the extension after its own network
		// requests settle, so waiting for the selector is the only signal.
		try {
			await page.waitForSelector('#sqseobar2 .seoquake-params-request', { timeout: 45_000 });
		} catch {
			throw new Error("SEO Quake's toolbar did not appear within 45 seconds.");
		}

		const cells = await page.$$eval('#sqseobar2 .seoquake-params-request', (nodes) =>
			nodes.map((node) => node.textContent ?? '')
		);

		if (cells.length === 0) {
			throw new Error('SEO Quake toolbar rendered but contained no parameter cells.');
		}

		return parseToolbar(cells);
	} finally {
		await page.close();
	}
}
