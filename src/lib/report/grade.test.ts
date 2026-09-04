import { describe, it, expect } from 'vitest';
import { gradeOf, letterFor, GRADE_LEGEND } from './grade';
import type { DomainResult, AnalyzerResult } from '$lib/shared/types';

const lh = (p: number): AnalyzerResult => ({
	status: 'ok',
	data: {
		scores: { performance: p, accessibility: 95, bestPractices: 95, seo: 95 },
		metrics: { lcpMs: 1000, cls: 0.01, tbtMs: 50 }
	}
});
const kw = (unused: number): AnalyzerResult => ({
	status: 'ok',
	data: {
		keywords: [
			{ keyword: 'a', count: unused > 0 ? 0 : 1 },
			{ keyword: 'b', count: unused > 1 ? 0 : 1 }
		]
	}
});
const oldseo = (severity: 'high' | 'medium' | 'low' | 'none'): AnalyzerResult => ({
	status: 'ok',
	data: {
		pagesRead: 3,
		pagesSkipped: 0,
		findings: severity === 'none' ? [] : [{ check: 'stale', severity, page: '/', evidence: 'x' }]
	}
});

const domain = (analyzers: DomainResult['analyzers']): DomainResult => ({
	domain: 'https://example.com/',
	role: 'client',
	analyzers
});

describe('letterFor', () => {
	it('maps the ratio to a letter at the documented boundaries', () => {
		expect(letterFor(1, false)).toBe('A');
		expect(letterFor(0.95, false)).toBe('A');
		expect(letterFor(0.94, false)).toBe('B');
		expect(letterFor(0.75, false)).toBe('B');
		expect(letterFor(0.74, false)).toBe('C');
		expect(letterFor(0.5, false)).toBe('C');
		expect(letterFor(0.49, false)).toBe('D');
		expect(letterFor(0.25, false)).toBe('D');
		expect(letterFor(0.24, false)).toBe('E');
	});

	it('caps at D when any check is poor', () => {
		expect(letterFor(1, true)).toBe('D');
		expect(letterFor(0.1, true)).toBe('E');
	});
});

describe('gradeOf', () => {
	it('is A when every measured check is good', () => {
		const g = gradeOf(domain({ lighthouse: lh(95), keywords: kw(0), oldseo: oldseo('none') }), [
			'lighthouse',
			'keywords',
			'oldseo'
		]);
		expect(g).toEqual({ letter: 'A', measured: 3, total: 3, ratio: 1 });
	});

	it('is B with one needs-work among three good', () => {
		const g = gradeOf(domain({ lighthouse: lh(95), keywords: kw(1), oldseo: oldseo('none') }), [
			'lighthouse',
			'keywords',
			'oldseo'
		]);
		// 2 + 1 + 2 = 5 of 6 → 0.83
		expect(g.letter).toBe('B');
		expect(g.ratio).toBeCloseTo(5 / 6);
	});

	it('caps at D when a check is poor even if the rest are good', () => {
		const g = gradeOf(domain({ lighthouse: lh(95), oldseo: oldseo('high') }), [
			'lighthouse',
			'oldseo'
		]);
		expect(g.letter).toBe('D');
	});

	it('excludes unavailable, failed and unrun checks from the ratio', () => {
		const g = gradeOf(
			domain({
				lighthouse: lh(95),
				keywords: { status: 'unavailable', reason: 'no chromium' },
				oldseo: { status: 'failed', error: 'boom' }
			}),
			['lighthouse', 'keywords', 'oldseo']
		);
		expect(g).toEqual({ letter: 'A', measured: 1, total: 3, ratio: 1 });
	});

	it('is a dash when nothing was measured', () => {
		const g = gradeOf(domain({}), ['lighthouse']);
		expect(g).toEqual({ letter: '—', measured: 0, total: 1, ratio: 0 });
	});

	it('excludes a result with an unrecognised data shape from the ratio', () => {
		const g = gradeOf(
			domain({
				lighthouse: { status: 'ok', data: { nope: true } } as unknown as AnalyzerResult
			}),
			['lighthouse']
		);
		expect(g).toEqual({ letter: '—', measured: 0, total: 1, ratio: 0 });
	});

	it('does not let the client-only measured-traffic check lift the grade', () => {
		const trafficOwned: AnalyzerResult = {
			status: 'ok',
			data: {
				searchConsole: {
					status: 'ok',
					data: {
						totals: { clicks: 100, impressions: 1000, ctr: 0.1, position: 5 },
						topQueries: []
					}
				},
				ga4: { status: 'ok', data: { sessions: 500, users: 400, engagementRate: 0.6 } },
				range: { start: '2026-06-01', end: '2026-08-30' }
			}
		};
		// Only the client can ever have this reading, so it must stay out of the
		// ratio entirely: a client with a Poor Lighthouse is still D, and its
		// score is exactly what it would be with no measured-traffic cell at all.
		const g = gradeOf(
			domain({ lighthouse: lh(10), keywords: kw(0), 'traffic-owned': trafficOwned }),
			['lighthouse', 'keywords', 'traffic-owned']
		);
		expect(g).toMatchObject({ letter: 'D', measured: 2, ratio: 0.5 });

		const withoutTraffic = gradeOf(domain({ lighthouse: lh(10), keywords: kw(0) }), [
			'lighthouse',
			'keywords'
		]);
		expect(g.ratio).toBe(withoutTraffic.ratio);
	});

	it('treats a keywords "nothing declared" as neutral, not a fault', () => {
		const g = gradeOf(
			domain({ lighthouse: lh(95), keywords: { status: 'ok', data: { keywords: [] } } }),
			['lighthouse', 'keywords']
		);
		expect(g).toEqual({ letter: 'A', measured: 1, total: 2, ratio: 1 });
	});
});

describe('GRADE_LEGEND', () => {
	it('names every letter once', () => {
		expect(GRADE_LEGEND.map((l) => l.letter)).toEqual(['A', 'B', 'C', 'D', 'E']);
	});
});
