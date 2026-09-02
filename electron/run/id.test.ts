import { describe, it, expect } from 'vitest';
import { assertRunId, isRunId, makeRunId } from './id';

describe('makeRunId', () => {
	it('formats the timestamp without colons so it is a valid Windows filename', () => {
		const id = makeRunId('https://cjsgaragedoors.com.au/', new Date('2026-09-02T08:15:00Z'));
		expect(id).toBe('2026-09-02T081500-cjsgaragedoors-com-au');
		expect(id).not.toContain(':');
	});

	it('strips www and the scheme from the host', () => {
		const id = makeRunId('https://www.example.com/path', new Date('2026-01-05T00:00:00Z'));
		expect(id).toBe('2026-01-05T000000-example-com');
	});

	it('contains no characters Windows forbids in filenames', () => {
		const id = makeRunId('https://a-b.example.com/', new Date('2026-12-31T23:59:59Z'));
		expect(id).not.toMatch(/[<>:"/\\|?*]/);
	});
});

describe('isRunId', () => {
	it('accepts what makeRunId produces', () => {
		for (const url of ['https://cjsgaragedoors.com.au/', 'https://www.a-b.example.com/x']) {
			expect(isRunId(makeRunId(url, new Date('2026-09-02T08:15:00Z')))).toBe(true);
		}
	});

	it('rejects anything that could escape the runs directory', () => {
		for (const value of [
			'../../etc/passwd',
			'2026-09-02T081500-example-com/../../secret',
			'2026-09-02T081500-example-com..secret',
			'C:Windowswin.ini',
			'run.json',
			'',
			'2026-09-02T081500-example com',
			42,
			null,
			undefined
		]) {
			expect(isRunId(value)).toBe(false);
		}
	});

	it('assertRunId returns the id or throws', () => {
		const id = makeRunId('https://example.com/', new Date('2026-09-02T08:15:00Z'));
		expect(assertRunId(id)).toBe(id);
		expect(() => assertRunId('../secret')).toThrow(/Invalid run id/);
	});
});
