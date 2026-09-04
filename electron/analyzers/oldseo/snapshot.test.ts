import { describe, it, expect } from 'vitest';
import {
	words,
	ngrams,
	shingles,
	jaccard,
	topPhrases,
	cleanEvidence,
	makeSnapshot
} from './snapshot';

describe('words', () => {
	it('lower-cases and keeps apostrophes and hyphens inside words', () => {
		expect(words("Roller Doors, Perth's best-priced doors!")).toEqual([
			'roller',
			'doors',
			"perth's",
			'best-priced',
			'doors'
		]);
	});

	it('normalises a curly apostrophe to a straight one', () => {
		expect(words('Perth\u2019s doors')).toEqual(["perth's", 'doors']);
	});
});

describe('ngrams', () => {
	it('slides a window of n', () => {
		expect(ngrams(['a', 'b', 'c'], 2)).toEqual(['a b', 'b c']);
		expect(ngrams(['a'], 2)).toEqual([]);
	});
});

describe('shingles and jaccard', () => {
	it('is 1 for identical text and 0 for disjoint text', () => {
		const a = shingles('garage door repairs in mandurah every day');
		expect(jaccard(a, shingles('garage door repairs in mandurah every day'))).toBe(1);
		expect(jaccard(a, shingles('completely different words here now'))).toBe(0);
		expect(jaccard(new Set(), new Set())).toBe(0);
	});
});

describe('topPhrases', () => {
	it('ranks phrases by occurrence, drops stop words from single words', () => {
		const text = 'the roller doors and the roller doors and the roller doors are the best';
		const top = topPhrases(text, 3);
		expect(top[0]).toEqual({ phrase: 'roller doors', n: 2, occurrences: 3 });
		expect(top.map((t) => t.phrase)).not.toContain('the');
	});
});

describe('cleanEvidence', () => {
	it('collapses control characters and caps at 160', () => {
		expect(cleanEvidence('a\n\tb  c')).toBe('a b c');
		expect(cleanEvidence('x'.repeat(200)).length).toBe(160);
	});

	it('replaces raw control characters with a space but leaves hyphens alone', () => {
		expect(cleanEvidence('a\u0000b\u001fc')).toBe('a b c');
		expect(cleanEvidence('co-operative')).toBe('co-operative');
	});
});

describe('makeSnapshot', () => {
	it('fills every field so detectors can rely on the shape', () => {
		const s = makeSnapshot({ path: '/' });
		expect(s).toEqual({
			url: 'https://example.com/',
			path: '/',
			title: '',
			metaKeywords: null,
			metaRobots: null,
			h1s: [],
			visibleText: '',
			altText: '',
			nodes: [],
			botText: null
		});
	});
});
