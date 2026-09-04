import { describe, it, expect } from 'vitest';
import { parseToolbar } from './parse';

describe('parseToolbar', () => {
	it('maps toolbar cells to named metrics', () => {
		const data = parseToolbar(['1,240', '58', '12', '890', 'whois', 'source', '4,500,000']);
		expect(data.googleIndex).toBe(1240);
		expect(data.backlinks).toBe(58);
		expect(data.subdomainBacklinks).toBe(12);
		expect(data.bingIndex).toBe(890);
	});

	it('strips thousands separators and surrounding text', () => {
		expect(parseToolbar(['Google Index: 1,234,567']).googleIndex).toBe(1234567);
	});

	it('returns null rather than zero for a cell with no number', () => {
		// Zero and "no data" are different facts and must not be conflated.
		expect(parseToolbar(['n/a']).googleIndex).toBeNull();
	});

	it('returns nulls when the toolbar is empty rather than throwing', () => {
		const data = parseToolbar([]);
		expect(data.googleIndex).toBeNull();
		expect(data.raw).toEqual([]);
	});

	it('keeps the raw cells so a layout change can be diagnosed', () => {
		expect(parseToolbar(['a', 'b']).raw).toEqual(['a', 'b']);
	});

	it('parses a plain integer', () => {
		expect(parseToolbar(['12']).googleIndex).toBe(12);
	});

	it('parses a space-separated integer', () => {
		expect(parseToolbar(['1 234']).googleIndex).toBe(1234);
	});

	it('treats a dot as a thousands separator only when followed by exactly three digits', () => {
		expect(parseToolbar(['1.234']).googleIndex).toBe(1234);
	});

	it('parses a K-abbreviated decimal', () => {
		expect(parseToolbar(['1.2K']).googleIndex).toBe(1200);
	});

	it('parses an M-abbreviated decimal', () => {
		expect(parseToolbar(['3.4M']).googleIndex).toBe(3400000);
	});

	it('parses a B-abbreviated whole number', () => {
		expect(parseToolbar(['2B']).googleIndex).toBe(2000000000);
	});

	it('parses abbreviated suffixes case-insensitively', () => {
		expect(parseToolbar(['1.2k']).googleIndex).toBe(1200);
	});

	it('returns null for empty, dash-like, and unknown-suffix values', () => {
		expect(parseToolbar(['']).googleIndex).toBeNull();
		expect(parseToolbar(['-']).googleIndex).toBeNull();
		expect(parseToolbar(['—']).googleIndex).toBeNull();
		expect(parseToolbar(['1.2X']).googleIndex).toBeNull();
		expect(parseToolbar(['5pts']).googleIndex).toBeNull();
	});
});
