import { describe, it, expect } from 'vitest';
import { severityOf } from './severity';

const lh = (scores: number[], metrics = { lcpMs: 1000, cls: 0.01, tbtMs: 50 }) => ({
	status: 'ok' as const,
	data: {
		scores: {
			performance: scores[0],
			accessibility: scores[1],
			bestPractices: scores[2],
			seo: scores[3]
		},
		metrics
	}
});

describe('severityOf — states', () => {
	it('names an unrun check', () => {
		expect(severityOf('lighthouse', undefined)).toMatchObject({ word: 'Not run', tone: 'na' });
	});

	it('keeps unavailable distinct from failed, in plain language', () => {
		// The operator's reason is for the run screen; a client's document
		// never prints a module path or an install hint.
		const s = severityOf('keywords', {
			status: 'unavailable',
			reason: 'require() of ES Module chrome-launcher not supported'
		});
		expect(s).toMatchObject({ word: 'Not measured', tone: 'na' });
		expect(s.finding).not.toContain('require');
		expect(s.finding).toMatch(/could not run/);
	});

	it('names a failed check without printing its error code', () => {
		const s = severityOf('lighthouse', { status: 'failed', error: 'net::ERR_NAME_NOT_RESOLVED' });
		expect(s).toMatchObject({ word: 'Check failed', tone: 'fail' });
		expect(s.finding).not.toContain('ERR_');
		expect(s.finding).toMatch(/could not complete/);
	});
});

describe('severityOf — lighthouse', () => {
	it('bands on the worst category, not the average', () => {
		// Three good scores and one poor one must read as Poor.
		expect(severityOf('lighthouse', lh([95, 95, 95, 40]))).toMatchObject({
			word: 'Poor',
			tone: 'fail'
		});
	});

	it('is Good only when every category is 90 or above', () => {
		expect(severityOf('lighthouse', lh([90, 92, 95, 100]))).toMatchObject({
			word: 'Good',
			tone: 'ok'
		});
		expect(severityOf('lighthouse', lh([89, 92, 95, 100]))).toMatchObject({
			word: 'Needs work',
			tone: 'warn'
		});
	});

	it('names the worst category and the vital most over target in the finding', () => {
		const s = severityOf(
			'lighthouse',
			lh([62, 88, 74, 91], { lcpMs: 4120, cls: 0.03, tbtMs: 610 })
		);
		expect(s.finding).toMatch(/^Performance scores 62 of 100/);
		expect(s.finding).toMatch(/4\.1s to appear/);
	});

	it('falls back to Measured when the data is not lighthouse-shaped', () => {
		expect(severityOf('lighthouse', { status: 'ok', data: { nope: true } })).toMatchObject({
			word: 'Measured'
		});
	});
});

describe('severityOf — keywords', () => {
	it('is Good when every declared keyword appears', () => {
		const s = severityOf('keywords', {
			status: 'ok',
			data: {
				keywords: [
					{ keyword: 'a', count: 3 },
					{ keyword: 'b', count: 1 }
				]
			}
		});
		expect(s).toMatchObject({ word: 'Good', tone: 'ok' });
	});

	it('counts unused keywords in the finding', () => {
		const s = severityOf('keywords', {
			status: 'ok',
			data: {
				keywords: [
					{ keyword: 'a', count: 0 },
					{ keyword: 'b', count: 1 },
					{ keyword: 'c', count: 0 }
				]
			}
		});
		expect(s).toMatchObject({ word: 'Needs work', tone: 'warn' });
		expect(s.finding).toMatch(/^2 of 3 declared keywords never appear/);
	});

	it('says so when nothing is declared, as n/a rather than Good', () => {
		expect(severityOf('keywords', { status: 'ok', data: { keywords: [] } })).toMatchObject({
			word: 'Nothing declared',
			tone: 'na'
		});
	});
});

describe('severityOf — oldseo', () => {
	const ok = (
		findings: Array<{ check: string; severity: string; page: string; evidence: string }>,
		pagesRead = 6
	) => severityOf('oldseo', { status: 'ok', data: { pagesRead, pagesSkipped: 0, findings } });

	it('is Good with a page count when nothing was found', () => {
		expect(ok([])).toEqual({
			word: 'Good',
			tone: 'ok',
			finding: 'No old or manipulative SEO practices found across 6 pages.'
		});
	});

	it('is Poor on any high finding and names the worst', () => {
		const s = ok([
			{ check: 'stale', severity: 'low', page: '/', evidence: 'x' },
			{ check: 'hidden-text', severity: 'high', page: '/about', evidence: 'y' }
		]);
		expect(s).toMatchObject({ word: 'Poor', tone: 'fail' });
		expect(s.finding).toBe('2 findings across 6 pages; the worst is hidden text on /about.');
	});

	it('is Needs work on a medium finding and singular for one', () => {
		const s = ok([{ check: 'duplicate', severity: 'medium', page: '/a', evidence: 'x' }]);
		expect(s).toMatchObject({ word: 'Needs work', tone: 'warn' });
		expect(s.finding).toBe('1 finding across 6 pages; the worst is duplicate pages on /a.');
	});

	it('is Good on low-only findings but still names them', () => {
		const s = ok([{ check: 'stale', severity: 'low', page: '/', evidence: 'x' }]);
		expect(s).toMatchObject({ word: 'Good', tone: 'ok' });
		expect(s.finding).toBe('1 finding across 6 pages; the worst is old habits on /.');
	});
});
