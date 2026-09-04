import { stripHtml } from '../../discovery/homepage';
import type { HiddenReason, PageSnapshot, TextNode } from './snapshot';

/**
 * The parts of the crawl that need no browser: which links count, what
 * robots.txt forbids, the Googlebot fetch, and the function that runs inside
 * each page to take its snapshot.
 */
export const SKIP_EXTENSIONS = [
	'.pdf',
	'.jpg',
	'.jpeg',
	'.png',
	'.gif',
	'.svg',
	'.webp',
	'.zip',
	'.mp4',
	'.mp3',
	'.doc',
	'.docx',
	'.xls',
	'.xlsx'
];

const host = (h: string) => h.toLowerCase().replace(/^www\./, '');

export function sameSite(link: string, base: URL): string | null {
	let url: URL;
	try {
		url = new URL(link, base);
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	if (host(url.hostname) !== host(base.hostname)) return null;
	const lower = url.pathname.toLowerCase();
	if (SKIP_EXTENSIONS.some((ext) => lower.endsWith(ext))) return null;
	url.hash = '';
	url.search = '';
	if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
		url.pathname = url.pathname.slice(0, -1);
	}
	return url.toString();
}

export function parseRobots(text: string): string[] {
	const disallow: string[] = [];
	let inStar = false;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(/#.*$/, '').trim();
		if (!line) continue;
		const [key, ...rest] = line.split(':');
		const value = rest.join(':').trim();
		const k = key.trim().toLowerCase();
		if (k === 'user-agent') inStar = value === '*';
		else if (inStar && k === 'disallow' && value) disallow.push(value);
	}
	return disallow;
}

export function isDisallowed(pathname: string, disallow: string[]): boolean {
	return disallow.some((prefix) => pathname.startsWith(prefix));
}

export function toPath(url: string): string {
	return new URL(url).pathname || '/';
}

export function nextToVisit(
	queue: string[],
	visited: Set<string>,
	disallow: string[],
	base: URL,
	max: number
): string[] {
	const out: string[] = [];
	const seen = new Set(visited);
	for (const link of queue) {
		const url = sameSite(link, base);
		if (!url || seen.has(url)) continue;
		if (isDisallowed(new URL(url).pathname, disallow)) continue;
		seen.add(url);
		out.push(url);
		if (out.length === max) break;
	}
	return out;
}

export const GOOGLEBOT_UA =
	'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const BOT_TIMEOUT_MS = 15_000;
const BOT_BYTE_CAP = 1_000_000;

export async function fetchAsGooglebot(
	url: string,
	signal: AbortSignal,
	fetchImpl: typeof fetch = fetch
): Promise<string | null> {
	if (signal.aborted) return null;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), BOT_TIMEOUT_MS);
	const onAbort = () => controller.abort();
	signal.addEventListener('abort', onAbort, { once: true });
	try {
		const response = await fetchImpl(url, {
			signal: controller.signal,
			redirect: 'follow',
			headers: { Accept: 'text/html', 'User-Agent': GOOGLEBOT_UA }
		});
		if (!response.ok) return null;
		if (!/text\/html|application\/xhtml/i.test(response.headers.get('content-type') ?? ''))
			return null;
		const html = (await response.text()).slice(0, BOT_BYTE_CAP);
		return stripHtml(html).text;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
		signal.removeEventListener('abort', onAbort);
	}
}

export type RawSnapshot = Omit<PageSnapshot, 'botText' | 'path'> & { links: string[] };

/**
 * Runs inside the page via page.evaluate, so it must be self-contained: no
 * imports, no closures over module scope. Returned as a function so the
 * analyzer can pass it straight through.
 *
 * `visibleText` is `visible.join('\n')`, not `visible.join(' ')`: each
 * visible text node becomes its own line, with whitespace collapsed within
 * the node. The stuffing detector's comma-list rule depends on this.
 */
export function snapshotScript(): (url: string) => RawSnapshot {
	return (url: string) => {
		const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']);
		const UI_PATTERN = /menu|modal|cookie|sr-only|visually-hidden|screen-reader/i;
		const UI_SELECTOR = 'nav,[role=navigation],[aria-hidden],dialog,[hidden]';

		const rgb = (s: string): [number, number, number, number] | null => {
			const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
			return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
		};

		const background = (el: Element): [number, number, number] => {
			let node: Element | null = el;
			while (node) {
				const c = rgb(getComputedStyle(node).backgroundColor);
				if (c && c[3] > 0) return [c[0], c[1], c[2]];
				node = node.parentElement;
			}
			return [255, 255, 255];
		};

		const isUi = (el: Element): boolean =>
			!!el.closest(UI_SELECTOR) ||
			[
				...(function* () {
					let n: Element | null = el;
					while (n) {
						yield n;
						n = n.parentElement;
					}
				})()
			].some((n) => UI_PATTERN.test(n.id + ' ' + (n.getAttribute('class') ?? '')));

		const hiddenReason = (el: Element, text: string): HiddenReason | null => {
			let node: Element | null = el;
			while (node) {
				if (getComputedStyle(node).display === 'none') return isUi(el) ? null : 'display-none';
				node = node.parentElement;
			}
			node = el;
			while (node) {
				if (getComputedStyle(node).opacity === '0') return 'opacity-zero';
				node = node.parentElement;
			}
			const cs = getComputedStyle(el);
			if (cs.visibility === 'hidden') return 'visibility-hidden';
			if (parseFloat(cs.fontSize) < 2) return 'tiny-font';
			const fg = rgb(cs.color);
			if (fg) {
				const bg = background(el);
				const dist = Math.abs(fg[0] - bg[0]) + Math.abs(fg[1] - bg[1]) + Math.abs(fg[2] - bg[2]);
				if (dist < 24) return 'same-colour';
			}
			const box = el.getBoundingClientRect();
			const indent = parseFloat(cs.textIndent);
			if (box.right < -1000 || box.bottom < -1000 || (!Number.isNaN(indent) && indent < -999))
				return isUi(el) ? null : 'off-canvas';
			if ((box.width === 0 || box.height === 0) && text.trim()) return isUi(el) ? null : 'zero-box';
			return null;
		};

		const nodes: TextNode[] = [];
		const visible: string[] = [];
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		let current: Node | null;
		while ((current = walker.nextNode())) {
			const text = (current.textContent ?? '').replace(/\s+/g, ' ').trim();
			if (!text) continue;
			const el = current.parentElement;
			if (!el || el.closest([...SKIP].join(','))) continue;
			const hidden = hiddenReason(el, text);
			if (!hidden) visible.push(text);
			if (text.split(' ').length >= 3 || el.closest('a')) {
				const a = el.closest('a');
				nodes.push({ text, hidden, inLink: a ? a.getAttribute('href') : null });
			}
		}

		const meta = (name: string) =>
			document.querySelector(`meta[name="${name}" i]`)?.getAttribute('content') ?? null;

		return {
			url,
			title: document.title ?? '',
			metaKeywords: meta('keywords'),
			metaRobots: meta('robots'),
			h1s: [...document.querySelectorAll('h1')].map((h) =>
				(h.textContent ?? '').replace(/\s+/g, ' ').trim()
			),
			visibleText: visible.join('\n'),
			altText: [...document.querySelectorAll('img[alt]')]
				.map((i) => i.getAttribute('alt') ?? '')
				.join(' '),
			nodes,
			links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '')
		};
	};
}

/** robots.txt text, or null when missing or unreadable (treated as allow-all). */
export async function fetchRobots(
	base: URL,
	signal: AbortSignal,
	fetchImpl: typeof fetch = fetch
): Promise<string | null> {
	if (signal.aborted) return null;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 10_000);
	const onAbort = () => controller.abort();
	signal.addEventListener('abort', onAbort, { once: true });
	try {
		const response = await fetchImpl(new URL('/robots.txt', base).toString(), {
			signal: controller.signal,
			headers: { 'User-Agent': 'WebsiteHealthReport/1.0 (+https://dsbaileyfreelancer.com.au)' }
		});
		if (!response.ok) return null;
		return (await response.text()).slice(0, 100_000);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
		signal.removeEventListener('abort', onAbort);
	}
}
