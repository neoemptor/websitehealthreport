import * as fs from 'fs';
import puppeteer from 'puppeteer';
import type { Analyzer } from '../types';
import { once, rejectOnAbort } from '../abort';
import type { OldSeoData, Finding } from '../../../src/lib/shared/oldseo';
import type { PageSnapshot } from './snapshot';
import { cleanEvidence } from './snapshot';
import {
	fetchAsGooglebot,
	fetchRobots,
	nextToVisit,
	parseRobots,
	snapshotScript,
	toPath,
	type RawSnapshot
} from './crawl';
import { detectHidden } from './detect/hidden';
import { detectStuffing } from './detect/stuffing';
import { detectCloaking } from './detect/cloaking';
import { detectDuplicate } from './detect/duplicate';
import { detectStale } from './detect/stale';

export type OldSeoSettings = { maxPages: number };

const PAGE_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_PAGES = 10;

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export const oldSeoAnalyzer: Analyzer<OldSeoSettings> = {
	id: 'oldseo',
	label: 'Old SEO practices',
	concurrency: 'limited',
	timeoutMs: 180_000,
	defaultSettings: { maxPages: DEFAULT_MAX_PAGES },

	async preflight() {
		try {
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

	async analyze(domain, settings, signal): Promise<OldSeoData> {
		if (signal.aborted) throw new Error('Cancelled before the browser was launched.');

		const browser = await puppeteer.launch();
		const close = once(() => browser.close());
		const onAbort = () => void close();
		signal.addEventListener('abort', onAbort, { once: true });
		const aborted = rejectOnAbort(signal);

		try {
			return await Promise.race([crawl(browser, domain, settings, signal), aborted.promise]);
		} finally {
			aborted.dispose();
			signal.removeEventListener('abort', onAbort);
			await close();
		}
	}
};

type Browser = Pick<Awaited<ReturnType<typeof puppeteer.launch>>, 'newPage'>;

async function crawl(
	browser: Browser,
	domain: string,
	settings: OldSeoSettings,
	signal: AbortSignal
): Promise<OldSeoData> {
	const base = new URL(domain);
	const robots = await fetchRobots(base, signal);
	const disallow = robots === null ? [] : parseRobots(robots);
	// A NaN or Infinity here would make every comparison below false and the
	// crawl would read only the homepage; fall back to the declared default.
	const requested = Number.isFinite(settings.maxPages)
		? Math.floor(settings.maxPages)
		: DEFAULT_MAX_PAGES;
	const max = Math.max(0, Math.min(25, requested));

	const snapshots: PageSnapshot[] = [];
	const visited = new Set<string>();
	let skipped = 0;

	// The homepage is not optional: without it there is nothing to report.
	const home = await readPage(browser, base.toString(), signal);
	visited.add(base.toString());
	snapshots.push(home.snapshot);

	let queue = home.links;
	let internal = 0;
	while (internal < max && queue.length > 0) {
		const batch = nextToVisit(queue, visited, disallow, base, max - internal);
		queue = [];
		if (batch.length === 0) break;
		for (const url of batch) {
			visited.add(url);
			try {
				const page = await readPage(browser, url, signal);
				snapshots.push(page.snapshot);
				queue.push(...page.links);
				internal++;
			} catch {
				skipped++;
			}
			if (internal >= max) break;
		}
	}

	const findings: Finding[] = [
		...detectHidden(snapshots),
		...detectStuffing(snapshots),
		...detectCloaking(snapshots),
		...detectDuplicate(snapshots),
		...detectStale(snapshots)
	]
		.map((f) => ({ ...f, evidence: cleanEvidence(f.evidence) }))
		.sort(
			(a, b) =>
				SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.page.localeCompare(b.page)
		);

	return { pagesRead: snapshots.length, pagesSkipped: skipped, findings };
}

async function readPage(
	browser: Browser,
	url: string,
	signal: AbortSignal
): Promise<{ snapshot: PageSnapshot; links: string[] }> {
	const page = await browser.newPage();
	try {
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
		const raw = (await page.evaluate(snapshotScript(), url)) as RawSnapshot;
		const botText = await fetchAsGooglebot(url, signal);
		const { links, ...rest } = raw;
		return { snapshot: { ...rest, path: toPath(url), botText }, links };
	} finally {
		await page.close();
	}
}
