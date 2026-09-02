import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseLighthouse } from './parse';

const lhr = JSON.parse(
	fs.readFileSync(path.join(__dirname, '../../../fixtures/lighthouse-cjsgaragedoors.json'), 'utf-8')
);

describe('parseLighthouse', () => {
	it('extracts the four category scores as percentages', () => {
		const { scores } = parseLighthouse(lhr);
		for (const value of Object.values(scores)) {
			expect(value).toBeGreaterThanOrEqual(0);
			expect(value).toBeLessThanOrEqual(100);
		}
	});

	it('extracts core web vitals', () => {
		const { metrics } = parseLighthouse(lhr);
		expect(metrics.lcpMs).toBeGreaterThan(0);
		expect(metrics.cls).toBeGreaterThanOrEqual(0);
		expect(metrics.tbtMs).toBeGreaterThanOrEqual(0);
	});

	it('throws a clear error on a non-Lighthouse object', () => {
		expect(() => parseLighthouse({ nope: true })).toThrow(/lighthouse/i);
	});

	it('throws rather than returning NaN when a category is missing', () => {
		expect(() => parseLighthouse({ categories: {}, audits: {} })).toThrow();
	});
});
