import { describe, it, expect } from 'vitest';
import { parseCdx } from './parse';

// The CDX API returns a header row followed by data rows.
const rows = [
	['urlkey', 'timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length'],
	['au,com,x)/', '20180412000000', 'https://x.com.au/', 'text/html', '200', 'A', '1'],
	['au,com,x)/', '20180915000000', 'https://x.com.au/', 'text/html', '200', 'B', '1'],
	['au,com,x)/', '20210103000000', 'https://x.com.au/', 'text/html', '200', 'C', '1']
];

describe('parseCdx', () => {
	it('counts snapshots per year', () => {
		expect(parseCdx(rows).snapshotsByYear).toEqual([
			{ year: '2018', count: 2 },
			{ year: '2021', count: 1 }
		]);
	});

	it('reports first and last seen dates', () => {
		const data = parseCdx(rows);
		expect(data.firstSeen).toBe('2018-04-12');
		expect(data.lastSeen).toBe('2021-01-03');
	});

	it('handles a domain with no snapshots', () => {
		expect(parseCdx([])).toEqual({ firstSeen: null, lastSeen: null, snapshotsByYear: [] });
	});

	it('handles a header-only response', () => {
		expect(parseCdx([rows[0]]).snapshotsByYear).toEqual([]);
	});

	it('throws on a non-array response', () => {
		expect(() => parseCdx({ error: true })).toThrow(/array/i);
	});
});
