import { describe, it, expect } from 'vitest';
import { pairLabels, parseToolbar } from './parse';

describe('parseToolbar', () => {
	it('maps toolbar pairs to named metrics by label, case-insensitively', () => {
		const data = parseToolbar([
			{ label: 'Rank', value: '38.5M' },
			{ label: 'L', value: '213' },
			{ label: 'LD', value: '435' },
			{ label: 'PIN', value: '12' },
			{ label: 'whois', value: 'example.com' },
			{ label: 'source', value: '' }
		]);
		expect(data.semrushRank).toBe(38_500_000);
		expect(data.backlinks).toBe(213);
		expect(data.linkingDomains).toBe(435);
		expect(data.pinterest).toBe(12);
	});

	it('matches labels case-insensitively', () => {
		const data = parseToolbar([{ label: 'rank', value: '1,234,567' }]);
		expect(data.semrushRank).toBe(1234567);
	});

	it('returns null rather than zero for a missing label', () => {
		// Zero and "no data" are different facts and must not be conflated.
		expect(parseToolbar([]).semrushRank).toBeNull();
		expect(parseToolbar([]).backlinks).toBeNull();
		expect(parseToolbar([]).linkingDomains).toBeNull();
		expect(parseToolbar([]).pinterest).toBeNull();
	});

	it('returns null rather than zero for a value with no number', () => {
		expect(parseToolbar([{ label: 'rank', value: 'n/a' }]).semrushRank).toBeNull();
	});

	it('keeps the raw label -> value map so a layout change can be diagnosed', () => {
		expect(parseToolbar([{ label: 'a', value: 'b' }]).raw).toEqual({ a: 'b' });
	});

	it('parses a plain integer', () => {
		expect(parseToolbar([{ label: 'rank', value: '12' }]).semrushRank).toBe(12);
	});

	it('parses a space-separated integer', () => {
		expect(parseToolbar([{ label: 'rank', value: '1 234' }]).semrushRank).toBe(1234);
	});

	it('treats a dot as a thousands separator only when followed by exactly three digits', () => {
		expect(parseToolbar([{ label: 'rank', value: '1.234' }]).semrushRank).toBe(1234);
	});

	it('parses a K-abbreviated decimal', () => {
		expect(parseToolbar([{ label: 'rank', value: '1.2K' }]).semrushRank).toBe(1200);
	});

	it('parses an M-abbreviated decimal', () => {
		expect(parseToolbar([{ label: 'rank', value: '3.4M' }]).semrushRank).toBe(3400000);
	});

	it('parses a B-abbreviated whole number', () => {
		expect(parseToolbar([{ label: 'rank', value: '2B' }]).semrushRank).toBe(2000000000);
	});

	it('parses abbreviated suffixes case-insensitively', () => {
		expect(parseToolbar([{ label: 'rank', value: '1.2k' }]).semrushRank).toBe(1200);
	});

	it('returns null for empty, dash-like, and unknown-suffix values', () => {
		expect(parseToolbar([{ label: 'rank', value: '' }]).semrushRank).toBeNull();
		expect(parseToolbar([{ label: 'rank', value: '-' }]).semrushRank).toBeNull();
		expect(parseToolbar([{ label: 'rank', value: '—' }]).semrushRank).toBeNull();
		expect(parseToolbar([{ label: 'rank', value: '1.2X' }]).semrushRank).toBeNull();
		expect(parseToolbar([{ label: 'rank', value: '5pts' }]).semrushRank).toBeNull();
	});

	it('keeps every group of an abbreviated value with a thousands separator', () => {
		expect(parseToolbar([{ label: 'rank', value: '1,234.5K' }]).semrushRank).toBe(1234500);
	});

	it('returns null for a plain decimal, which is not a toolbar count', () => {
		expect(parseToolbar([{ label: 'rank', value: '1.5' }]).semrushRank).toBeNull();
		expect(parseToolbar([{ label: 'rank', value: '12.34' }]).semrushRank).toBeNull();
	});
});

describe('pairLabels', () => {
	it('pairs each value with the label before it', () => {
		expect(
			pairLabels([
				{ kind: 'label', text: 'Rank', parent: 0 },
				{ kind: 'value', text: '38.5M', parent: 0 },
				{ kind: 'label', text: 'L', parent: 1 },
				{ kind: 'value', text: '213', parent: 1 }
			])
		).toEqual([
			{ label: 'Rank', value: '38.5M' },
			{ label: 'L', value: '213' }
		]);
	});

	it('shares one label between two values that follow it in the same parent', () => {
		expect(
			pairLabels([
				{ kind: 'label', text: 'LD', parent: 0 },
				{ kind: 'value', text: '435', parent: 0 },
				{ kind: 'value', text: '436', parent: 0 }
			])
		).toEqual([
			{ label: 'LD', value: '435' },
			{ label: 'LD', value: '436' }
		]);
	});

	it('gives a value with no preceding label in its parent an empty label', () => {
		expect(
			pairLabels([
				{ kind: 'label', text: 'Rank', parent: 0 },
				{ kind: 'value', text: '12', parent: 1 }
			])
		).toEqual([{ label: '', value: '12' }]);
	});
});
