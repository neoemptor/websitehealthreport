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
});
