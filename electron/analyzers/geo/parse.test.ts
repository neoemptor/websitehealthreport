import { describe, it, expect } from 'vitest';
import { parseGeoResponse } from './parse';
import { FACTOR_IDS } from './prompt';

const DOMAIN = 'https://www.example.com/';

const factor = (id: string, rating = 'good', evidence = `Evidence for ${id}.`) => ({
	id,
	rating,
	evidence
});

/** A valid response, factors deliberately out of order. */
const valid = () => ({
	pages: ['https://www.example.com/', 'https://www.example.com/services'],
	factors: [...FACTOR_IDS].reverse().map((id) => factor(id)),
	fixes: ['Add prices to the services page.', 'Quote the owner on the about page.']
});

describe('parseGeoResponse', () => {
	it('returns the factors in the fixed order however Claude ordered them', () => {
		const data = parseGeoResponse(valid(), DOMAIN);
		expect(data.factors.map((f) => f.id)).toEqual(FACTOR_IDS);
		expect(data.pages).toHaveLength(2);
		expect(data.fixes).toHaveLength(2);
	});

	it('throws when a factor is missing', () => {
		const r = valid();
		r.factors = r.factors.filter((f) => f.id !== 'clarity');
		expect(() => parseGeoResponse(r, DOMAIN)).toThrow(/rated 6 of the 7 GEO factors/);
	});

	it('throws when a factor is repeated', () => {
		const r = valid();
		r.factors[0] = factor('citations');
		r.factors[1] = factor('citations');
		expect(() => parseGeoResponse(r, DOMAIN)).toThrow(/twice/);
	});

	it('rejects a repeated GEO factor outright', () => {
		const r = valid();
		r.factors.push(factor('citations', 'poor', 'Second opinion.'));
		expect(() => parseGeoResponse(r, DOMAIN)).toThrow(/repeated|twice/i);
	});

	it('throws naming an unknown id or rating', () => {
		const bad = valid();
		bad.factors[0] = factor('vibes');
		expect(() => parseGeoResponse(bad, DOMAIN)).toThrow(/vibes/);
		const badRating = valid();
		badRating.factors[0] = factor(badRating.factors[0].id, 'excellent');
		expect(() => parseGeoResponse(badRating, DOMAIN)).toThrow(/excellent/);
	});

	it('drops pages that are not on the audited site', () => {
		const r = valid();
		r.pages = [
			'https://www.example.com/about',
			'https://blog.example.com/post',
			'https://other.com/',
			'not a url',
			'ftp://www.example.com/x'
		];
		expect(parseGeoResponse(r, DOMAIN).pages).toEqual([
			'https://www.example.com/about',
			'https://blog.example.com/post'
		]);
	});

	it('drops a page entry with an annotation appended instead of repairing it', () => {
		const r = valid();
		r.pages = ['https://www.example.com/ (home)', 'https://www.example.com/services'];
		expect(parseGeoResponse(r, DOMAIN).pages).toEqual(['https://www.example.com/services']);
	});

	it('throws when no page read was on the site', () => {
		const r = valid();
		r.pages = ['https://other.com/'];
		expect(() => parseGeoResponse(r, DOMAIN)).toThrow(/no page/i);
	});

	it('caps pages at six after filtering, even if the schema is not trusted', () => {
		const r = valid();
		r.pages = Array.from({ length: 8 }, (_, i) => `https://www.example.com/page-${i}`);
		expect(parseGeoResponse(r, DOMAIN).pages).toHaveLength(6);
	});

	it('trims, caps and truncates evidence and fixes', () => {
		const r = valid();
		r.factors[0].evidence = '  ' + 'x'.repeat(400) + '  ';
		r.fixes = ['  one ', '', 'two', 'three', 'four'];
		const data = parseGeoResponse(r, DOMAIN);
		expect(data.factors.find((f) => f.id === r.factors[0].id)?.evidence).toHaveLength(300);
		expect(data.fixes).toEqual(['one', 'two', 'three']);
	});

	it('throws a clear error on something that is not a response at all', () => {
		expect(() => parseGeoResponse(null, DOMAIN)).toThrow(/GEO/);
		expect(() => parseGeoResponse({ nope: true }, DOMAIN)).toThrow(/GEO/);
	});
});
