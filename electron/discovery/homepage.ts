/**
 * The client's own homepage, reduced to what tells Claude the trade and the
 * service area. Everything here is data that will be quoted into a prompt
 * inside a fenced block; nothing in it is executed or trusted.
 */
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

export function stripHtml(html: string): Homepage {
	const title = squash(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
	const description = squash(
		/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(html)?.[1] ??
			/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(html)?.[1] ??
			''
	);
	const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
	const text = squash(
		body
			.replace(/<(script|style|noscript|svg|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
			.replace(/<!--[\s\S]*?-->/g, ' ')
			.replace(/<[^>]+>/g, ' ')
	).slice(0, TEXT_CAP);
	return { title, description, text };
}

async function readCapped(response: Response): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) return (await response.text()).slice(0, BYTE_CAP);
	const decoder = new TextDecoder();
	let text = '';
	let received = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		received += value.byteLength;
		text += decoder.decode(value, { stream: true });
		if (received >= BYTE_CAP) break;
	}
	text += decoder.decode();
	return text;
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
		const html = (await readCapped(response)).slice(0, BYTE_CAP);
		return stripHtml(html);
	} finally {
		clearTimeout(timer);
		signal.removeEventListener('abort', onAbort);
	}
}
