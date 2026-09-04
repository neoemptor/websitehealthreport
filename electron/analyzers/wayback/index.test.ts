import { describe, it, expect, vi } from 'vitest';
import { waybackAnalyzer } from './index';

const fetchText = vi.fn();

vi.mock('../../http', () => ({
	fetchText: (...args: unknown[]) => fetchText(...args)
}));

describe('waybackAnalyzer.analyze', () => {
	it('rejects when the archive answers with a non-200 status', async () => {
		fetchText.mockResolvedValueOnce({
			status: 503,
			headers: new Headers(),
			body: '',
			finalUrl: ''
		});

		await expect(
			waybackAnalyzer.analyze('https://x.com.au', {}, undefined as never)
		).rejects.toThrow(/503/);
	});

	it('resolves with the parsed data when the archive answers with 200', async () => {
		const rows = [
			['urlkey', 'timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length'],
			['au,com,x)/', '20180412000000', 'https://x.com.au/', 'text/html', '200', 'A', '1'],
			['au,com,x)/', '20180915000000', 'https://x.com.au/', 'text/html', '200', 'B', '1'],
			['au,com,x)/', '20210103000000', 'https://x.com.au/', 'text/html', '200', 'C', '1']
		];
		fetchText.mockResolvedValueOnce({
			status: 200,
			headers: new Headers(),
			body: JSON.stringify(rows),
			finalUrl: ''
		});

		await expect(
			waybackAnalyzer.analyze('https://x.com.au', {}, undefined as never)
		).resolves.toEqual({
			firstSeen: '2018-04-12',
			lastSeen: '2021-01-03',
			snapshotsByYear: [
				{ year: '2018', count: 2 },
				{ year: '2021', count: 1 }
			]
		});
	});
});
