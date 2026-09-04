import { describe, it, expect } from 'vitest';
import { detectStale } from './stale';
import { makeSnapshot } from '../snapshot';

describe('detectStale', () => {
	it('reports a meta keywords tag once per site', () => {
		const pages = [
			makeSnapshot({ path: '/', metaKeywords: 'doors, perth' }),
			makeSnapshot({ path: '/a', metaKeywords: 'doors, perth' })
		];
		const out = detectStale(pages);
		expect(out).toEqual([
			{ check: 'stale', severity: 'low', page: '/', evidence: 'meta keywords tag: "doors, perth"' }
		]);
	});

	it('reports a do-nothing robots meta', () => {
		const [f] = detectStale([makeSnapshot({ path: '/', metaRobots: 'index, follow' })]);
		expect(f.evidence).toBe('meta robots "index, follow" does nothing');
	});

	it('reports a long keyword-heavy title', () => {
		const text = 'garage doors garage doors garage doors perth perth perth repairs repairs repairs';
		const title =
			'Garage Doors Perth | Garage Door Repairs Perth | Cheap Garage Doors and Repairs Perth';
		const [f] = detectStale([makeSnapshot({ path: '/', title, visibleText: text })]);
		expect(f.evidence).toBe(`title of ${title.length} characters: "${title}"`);
	});

	it('reports several H1s sharing a phrase', () => {
		const [f] = detectStale([
			makeSnapshot({
				path: '/',
				h1s: ['Garage doors Perth', 'Best garage doors', 'Garage doors today']
			})
		]);
		expect(f.evidence).toBe('3 H1s share "garage doors"');
	});

	it('does not count "cart" as a hit for the top phrase "art"', () => {
		const text = 'art art art art art art art art art art';
		const title =
			'Shopping Cart Cart Cart Cart Cart Cart Cart Cart Cart Cart Cart Cart Cart Cart Cart';
		expect(title.length).toBeGreaterThan(70);
		expect(detectStale([makeSnapshot({ path: '/', title, visibleText: text })])).toEqual([]);
	});

	it('is quiet when the only shared phrase is a bare stop word', () => {
		expect(detectStale([makeSnapshot({ path: '/', h1s: ['The Best', 'The Worst'] })])).toEqual([]);
	});

	it('is quiet on a tidy page', () => {
		expect(
			detectStale([
				makeSnapshot({ path: '/', title: 'CJ Doors', h1s: ['Welcome'], metaRobots: 'noindex' })
			])
		).toEqual([]);
	});
});
