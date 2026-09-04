import { describe, it, expect } from 'vitest';
import {
	sameSite,
	parseRobots,
	isDisallowed,
	nextToVisit,
	fetchAsGooglebot,
	toPath,
	GOOGLEBOT_UA
} from './crawl';

const base = new URL('https://www.example.com.au/');

describe('sameSite', () => {
	it('keeps same-host http(s) links, strips query and hash, ignores www', () => {
		expect(sameSite('https://example.com.au/services?x=1#top', base)).toBe(
			'https://example.com.au/services'
		);
		expect(sameSite('/about', base)).toBe('https://www.example.com.au/about');
	});
	it('rejects other hosts, other schemes, and binary extensions', () => {
		expect(sameSite('https://other.com/', base)).toBeNull();
		expect(sameSite('mailto:x@example.com.au', base)).toBeNull();
		expect(sameSite('tel:123', base)).toBeNull();
		expect(sameSite('/brochure.pdf', base)).toBeNull();
		expect(sameSite('/img/logo.PNG', base)).toBeNull();
	});
});

describe('robots', () => {
	it('reads Disallow prefixes for the * group only', () => {
		const text = `User-agent: Googlebot\nDisallow: /g\n\nUser-agent: *\nDisallow: /admin\nAllow: /admin/public\nDisallow: /tmp/\n`;
		expect(parseRobots(text)).toEqual(['/admin', '/tmp/']);
		expect(isDisallowed('/admin/x', ['/admin'])).toBe(true);
		expect(isDisallowed('/administer', ['/admin'])).toBe(true);
		expect(isDisallowed('/about', ['/admin'])).toBe(false);
		expect(isDisallowed('/x', [])).toBe(false);
	});
});

describe('nextToVisit', () => {
	it('dedupes, filters disallowed, keeps order and caps', () => {
		const out = nextToVisit(
			['/a', '/b', '/a', '/admin/x', '/c', '/d'],
			new Set(['https://www.example.com.au/b']),
			['/admin'],
			base,
			2
		);
		expect(out).toEqual(['https://www.example.com.au/a', 'https://www.example.com.au/c']);
	});
});

describe('fetchAsGooglebot', () => {
	it('returns stripped text with the Googlebot user agent, null on failure', async () => {
		let ua = '';
		const ok = (async (_u: unknown, init?: RequestInit) => {
			ua = (init?.headers as Record<string, string>)['User-Agent'];
			return new Response('<html><body><p>Hello <b>bot</b></p></body></html>', {
				status: 200,
				headers: { 'content-type': 'text/html' }
			});
		}) as unknown as typeof fetch;
		expect(await fetchAsGooglebot('https://example.com/', new AbortController().signal, ok)).toBe(
			'Hello bot'
		);
		expect(ua).toBe(GOOGLEBOT_UA);

		const bad = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
		expect(
			await fetchAsGooglebot('https://example.com/', new AbortController().signal, bad)
		).toBeNull();
	});
});

describe('toPath', () => {
	it('returns the path only', () => {
		expect(toPath('https://example.com.au/services/doors')).toBe('/services/doors');
		expect(toPath('https://example.com.au')).toBe('/');
	});
});
