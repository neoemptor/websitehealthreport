import { describe, it, expect } from 'vitest';
import { fetchHomepage, stripHtml } from './homepage';

const page = `<!doctype html><html><head>
<title>CJ's Garage Doors</title>
<meta name="description" content="Repairs and installs in Mandurah">
<style>body{color:red}</style>
<script>alert('x')</script>
</head><body>
<nav>Home  About</nav>
<h1>Garage   door repairs</h1>
<svg><path d="M0 0"/></svg>
<noscript>Enable JS</noscript>
<p>We service Rockingham &amp; Mandurah.</p>
</body></html>`;

describe('stripHtml', () => {
	it('keeps title, description and visible text; drops script, style, svg, noscript', () => {
		const out = stripHtml(page);
		expect(out.title).toBe("CJ's Garage Doors");
		expect(out.description).toBe('Repairs and installs in Mandurah');
		expect(out.text).toBe('Home About Garage door repairs We service Rockingham & Mandurah.');
	});

	it('caps text at 6000 characters', () => {
		const long = `<html><body>${'word '.repeat(3000)}</body></html>`;
		expect(stripHtml(long).text.length).toBe(6000);
	});

	it('tolerates a page with no head', () => {
		expect(stripHtml('<p>hi</p>')).toEqual({ title: '', description: '', text: 'hi' });
	});
});

function fakeFetch(status: number, type: string, body: string): typeof fetch {
	return (async () =>
		new Response(body, { status, headers: { 'content-type': type } })) as unknown as typeof fetch;
}

describe('fetchHomepage', () => {
	it('returns the stripped page', async () => {
		const out = await fetchHomepage(
			'https://example.com/',
			new AbortController().signal,
			fakeFetch(200, 'text/html; charset=utf-8', page)
		);
		expect(out.title).toBe("CJ's Garage Doors");
	});

	it('rejects a non-HTML response', async () => {
		await expect(
			fetchHomepage(
				'https://example.com/',
				new AbortController().signal,
				fakeFetch(200, 'application/json', '{}')
			)
		).rejects.toThrow(/not an HTML page/);
	});

	it('rejects a non-2xx response', async () => {
		await expect(
			fetchHomepage(
				'https://example.com/',
				new AbortController().signal,
				fakeFetch(503, 'text/html', '')
			)
		).rejects.toThrow(/503/);
	});

	it('follows up to three redirects', async () => {
		let n = 0;
		const spy = (async () => {
			n++;
			if (n <= 3)
				return new Response('', { status: 302, headers: { location: 'https://example.com/next' } });
			return new Response('<p>done</p>', {
				status: 200,
				headers: { 'content-type': 'text/html' }
			});
		}) as unknown as typeof fetch;
		const out = await fetchHomepage('https://example.com/', new AbortController().signal, spy);
		expect(out.text).toBe('done');
		expect(n).toBe(4);
	});

	it('rejects a fourth redirect', async () => {
		const spy = (async () =>
			new Response('', {
				status: 302,
				headers: { location: 'https://example.com/next' }
			})) as unknown as typeof fetch;
		await expect(
			fetchHomepage('https://example.com/', new AbortController().signal, spy)
		).rejects.toThrow(/redirected too many times/);
	});

	it('caps the response body at roughly 1 MB', async () => {
		const big = 'a'.repeat(1_500_000);
		const spy = (async () =>
			new Response(big, {
				status: 200,
				headers: { 'content-type': 'text/html' }
			})) as unknown as typeof fetch;
		const out = await fetchHomepage('https://example.com/', new AbortController().signal, spy);
		expect(out.text.length).toBeLessThanOrEqual(6_000);
	});

	it('sends an HTML accept header and a descriptive user agent', async () => {
		let init: RequestInit | undefined;
		const spy = (async (_url: unknown, i?: RequestInit) => {
			init = i;
			return new Response('<p>x</p>', { status: 200, headers: { 'content-type': 'text/html' } });
		}) as unknown as typeof fetch;
		await fetchHomepage('https://example.com/', new AbortController().signal, spy);
		const headers = init?.headers as Record<string, string>;
		expect(headers.Accept).toMatch(/text\/html/);
		expect(headers['User-Agent']).toMatch(/WebsiteHealthReport/);
	});
});
