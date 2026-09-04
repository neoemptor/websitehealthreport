import { describe, it, expect } from 'vitest';
import { parseToolbar } from './parse';

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
});
