import { describe, it, expect } from 'vitest';
import { isOk, isUnavailable, isFailed, type AnalyzerResult } from './types';

const ok: AnalyzerResult = { status: 'ok', data: { score: 1 } };
const unavailable: AnalyzerResult = { status: 'unavailable', reason: 'not installed' };
const failed: AnalyzerResult = { status: 'failed', error: 'boom' };

describe('result guards', () => {
	it('distinguishes ok', () => {
		expect(isOk(ok)).toBe(true);
		expect(isOk(unavailable)).toBe(false);
		expect(isOk(failed)).toBe(false);
	});

	it('distinguishes unavailable from failed', () => {
		expect(isUnavailable(unavailable)).toBe(true);
		expect(isUnavailable(failed)).toBe(false);
		expect(isFailed(failed)).toBe(true);
		expect(isFailed(unavailable)).toBe(false);
	});
});
