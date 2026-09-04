import { describe, it, expect } from 'vitest';
import { daysUntil } from './tls';

describe('daysUntil', () => {
	it('counts whole days to expiry', () => {
		expect(daysUntil('Dec 31 23:59:59 2026 GMT', new Date('2026-12-01T00:00:00Z'))).toBe(30);
	});

	it('returns a negative number for an expired certificate', () => {
		expect(daysUntil('Jan 1 00:00:00 2026 GMT', new Date('2026-02-01T00:00:00Z'))).toBeLessThan(0);
	});

	it('throws on an unparseable date rather than returning NaN', () => {
		expect(() => daysUntil('not a date', new Date())).toThrow(/date/i);
	});
});
