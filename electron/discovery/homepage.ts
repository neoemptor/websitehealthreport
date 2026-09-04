/**
 * The client's own homepage, reduced to what tells Claude the trade and the
 * service area. Everything here is data that will be quoted into a prompt
 * inside a fenced block; nothing in it is executed or trusted.
 */
import { readCapped } from '../http';

export type Homepage = { title: string; description: string; text: string };
export type FetchFn = typeof fetch;

const TEXT_CAP = 6_000;
const BYTE_CAP = 1_000_000;
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function decodeEntities(s: string): string {
	return s
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&nbsp;/g, ' ');
}

const squash = (s: string) => decodeEntities(s).replace(/\s+/g, ' ').trim();

/**
 * The attribute run inside a tag: anything but a quote or `>`, with quoted
 * runs allowed to contain `>` (`<a title="a > b">` is one tag, not two).
 */
const ATTRS = `(?:"[^"]*"|'[^']*'|[^'">])*`;
/** A tag, its closing `>` optional so a tag truncated by the cap is still eaten. */
const TAG = new RegExp(`<[!/]?[a-zA-Z][^\\s>'"/]*${ATTRS}(?:["'][^"']*$)?>?`, 'g');
const RAW_ELEMENT = new RegExp(
	`<(script|style|noscript|svg|template)${ATTRS}>[\\s\\S]*?<\\/\\1\\s*>`,
	'gi'
);

/**
 * Removes markup, leaving the words. Regex tag matching can never be a
 * parser, but it must not be fooled by the two things real pages do: a `>`
 * inside a quoted attribute value, and a tag left unclosed at the end of a
 * truncated body.
 */
export function stripTags(html: string): string {
	return html
		.replace(RAW_ELEMENT, ' ')
		.replace(/<!--[\s\S]*?-->/g, ' ')
		.replace(TAG, ' ');
}

/**
 * The three extractors below open their tag with `ATTRS` for the same reason
 * `TAG` does: a `>` inside a quoted attribute value (`<body data-x="a>b">`)
 * must not be mistaken for the end of the tag.
 */
const TITLE = new RegExp(`<title${ATTRS}>([\\s\\S]*?)<\\/title\\s*>`, 'i');
const BODY = new RegExp(`<body${ATTRS}>([\\s\\S]*)<\\/body\\s*>`, 'i');
const DESCRIPTION = new RegExp(
	`<meta${ATTRS}name=["']description["']${ATTRS}content=["']([^"']*)["']`,
	'i'
);
/** The same, for the attributes written the other way round. */
const DESCRIPTION_REVERSED = new RegExp(
	`<meta${ATTRS}content=["']([^"']*)["']${ATTRS}name=["']description["']`,
	'i'
);

export function stripHtml(html: string): Homepage {
	const title = squash(TITLE.exec(html)?.[1] ?? '');
	const description = squash(
		DESCRIPTION.exec(html)?.[1] ?? DESCRIPTION_REVERSED.exec(html)?.[1] ?? ''
	);
	const body = BODY.exec(html)?.[1] ?? html;
	const text = squash(stripTags(body)).slice(0, TEXT_CAP);
	return { title, description, text };
}

async function fetchWithRedirects(
	url: string,
	init: RequestInit,
	fetchImpl: FetchFn
): Promise<Response> {
	let current = url;
	for (let hop = 0; ; hop++) {
		const response = await fetchImpl(current, { ...init, redirect: 'manual' });
		if (!REDIRECT_STATUSES.has(response.status)) return response;
		if (hop >= MAX_REDIRECTS) throw new Error('The site redirected too many times.');
		const location = response.headers.get('location');
		if (!location) throw new Error('The site redirected too many times.');
		const next = new URL(location, current);
		if (next.protocol !== 'http:' && next.protocol !== 'https:')
			throw new Error('The site redirected too many times.');
		current = next.toString();
	}
}

export async function fetchHomepage(
	url: string,
	signal: AbortSignal,
	fetchImpl: FetchFn = fetch
): Promise<Homepage> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	const onAbort = () => controller.abort();
	signal.addEventListener('abort', onAbort, { once: true });
	try {
		const response = await fetchWithRedirects(
			url,
			{
				signal: controller.signal,
				headers: {
					Accept: 'text/html,application/xhtml+xml',
					'User-Agent': 'WebsiteHealthReport/1.0 (+https://dsbaileyfreelancer.com.au)'
				}
			},
			fetchImpl
		);
		if (!response.ok) throw new Error(`The site answered with status ${response.status}.`);
		const type = response.headers.get('content-type') ?? '';
		if (!/text\/html|application\/xhtml/i.test(type))
			throw new Error('The address is not an HTML page.');
		const html = await readCapped(response, BYTE_CAP);
		return stripHtml(html);
	} finally {
		clearTimeout(timer);
		signal.removeEventListener('abort', onAbort);
	}
}
