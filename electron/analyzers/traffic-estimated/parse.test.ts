import { describe, it, expect } from 'vitest';
import { parseSemrushCsv, toEstimatedTraffic, isQuotaError, classifyError } from './parse';

// Semrush returns semicolon-separated values with a header line.
const body =
	'Database;Date;Organic Keywords;Organic Traffic;Organic Cost;Adwords Keywords\nau;20260901;412;3100;5200;7';

describe('parseSemrushCsv', () => {
	it('parses the header and one data row', () => {
		const rows = parseSemrushCsv(body);
		expect(rows).toHaveLength(1);
		expect(rows[0]['Organic Traffic']).toBe('3100');
	});

	it('returns an empty array for a header-only response', () => {
		expect(parseSemrushCsv('Database;Date')).toEqual([]);
	});

	it('returns an empty array for an empty body', () => {
		expect(parseSemrushCsv('')).toEqual([]);
	});
});

describe('toEstimatedTraffic', () => {
	it('maps the columns to numbers', () => {
		expect(toEstimatedTraffic(parseSemrushCsv(body))).toEqual({
			organicKeywords: 412,
			organicTraffic: 3100,
			organicCost: 5200,
			adwordsKeywords: 7
		});
	});

	it('returns nulls when the domain has no data', () => {
		expect(toEstimatedTraffic([])).toEqual({
			organicKeywords: null,
			organicTraffic: null,
			organicCost: null,
			adwordsKeywords: null
		});
	});
});

describe('isQuotaError', () => {
	it('recognises the API units message', () => {
		expect(isQuotaError('ERROR 120 :: NOT ENOUGH API UNITS')).toBe(true);
	});

	it('does not treat an ordinary response as a quota error', () => {
		expect(isQuotaError(body)).toBe(false);
	});
});

describe('classifyError', () => {
	it.each([120, 130, 131, 132, 133, 134, 135])(
		'classifies key/unit/access error %d as unavailable',
		(code) => {
			expect(classifyError(code)).toBe('unavailable');
		}
	);

	it.each([50, 100, 121, 999])('classifies unrelated error %d as failed', (code) => {
		expect(classifyError(code)).toBe('failed');
	});
});
