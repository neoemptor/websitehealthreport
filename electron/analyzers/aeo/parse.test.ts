import { describe, it, expect } from 'vitest';
import { parseRobotsForAiCrawlers, parseStructuredData, parseHeadings, AI_CRAWLERS } from './parse';

describe('parseRobotsForAiCrawlers', () => {
	it('treats an absent rule as allowed', () => {
		const rules = parseRobotsForAiCrawlers('User-agent: *\nAllow: /');
		expect(rules.every((r) => r.allowed)).toBe(true);
	});

	it('detects a blanket disallow for a named crawler', () => {
		const rules = parseRobotsForAiCrawlers('User-agent: GPTBot\nDisallow: /');
		expect(rules.find((r) => r.agent === 'GPTBot')?.allowed).toBe(false);
	});

	it('is case insensitive about the agent name', () => {
		const rules = parseRobotsForAiCrawlers('user-agent: gptbot\ndisallow: /');
		expect(rules.find((r) => r.agent === 'GPTBot')?.allowed).toBe(false);
	});

	it('reports one rule per known AI crawler', () => {
		expect(parseRobotsForAiCrawlers('')).toHaveLength(AI_CRAWLERS.length);
	});

	it('blocks a crawler with no group of its own when the wildcard group disallows /', () => {
		const rules = parseRobotsForAiCrawlers('User-agent: *\nDisallow: /');
		expect(rules.every((r) => !r.allowed)).toBe(true);
	});

	it('lets a specific group override a disallowing wildcard group', () => {
		const rules = parseRobotsForAiCrawlers(
			'User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /'
		);
		expect(rules.find((r) => r.agent === 'GPTBot')?.allowed).toBe(true);
		expect(rules.find((r) => r.agent === 'ClaudeBot')?.allowed).toBe(false);
	});
});

describe('parseStructuredData', () => {
	it('counts and validates JSON-LD blocks', () => {
		const html = `<script type="application/ld+json">{"@type":"LocalBusiness"}</script>`;
		expect(parseStructuredData(html)).toEqual({ blocks: 1, valid: 1, types: ['LocalBusiness'] });
	});

	it('counts an invalid block without throwing', () => {
		const html = `<script type="application/ld+json">{ broken</script>`;
		expect(parseStructuredData(html)).toEqual({ blocks: 1, valid: 0, types: [] });
	});

	it('returns zeroes when there is no structured data', () => {
		expect(parseStructuredData('<p>hi</p>')).toEqual({ blocks: 0, valid: 0, types: [] });
	});

	it('descends into @graph arrays', () => {
		const html = `<script type="application/ld+json">{"@graph":[{"@type":"LocalBusiness"},{"@type":"WebSite"}]}</script>`;
		expect(parseStructuredData(html)).toEqual({
			blocks: 1,
			valid: 1,
			types: ['LocalBusiness', 'WebSite']
		});
	});

	it('accepts @type given as an array', () => {
		const html = `<script type="application/ld+json">{"@type":["LocalBusiness","Store"]}</script>`;
		expect(parseStructuredData(html)).toEqual({
			blocks: 1,
			valid: 1,
			types: ['LocalBusiness', 'Store']
		});
	});
});

describe('parseHeadings', () => {
	it('accepts a single h1 followed by h2', () => {
		expect(parseHeadings('<h1>a</h1><h2>b</h2>')).toEqual({ h1Count: 1, hierarchyOk: true });
	});

	it('flags a skipped level', () => {
		expect(parseHeadings('<h1>a</h1><h3>b</h3>').hierarchyOk).toBe(false);
	});

	it('flags multiple h1 elements', () => {
		expect(parseHeadings('<h1>a</h1><h1>b</h1>').h1Count).toBe(2);
	});
});
