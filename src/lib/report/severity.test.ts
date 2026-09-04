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

	it('falls back to Measured when a finding has an unrecognised severity', () => {
		const s = ok([{ check: 'stale', severity: 'critical', page: '/', evidence: 'x' }]);
		expect(s).toEqual({ word: 'Measured', tone: 'na', finding: 'See the readings below.' });
	});
});

describe('severityOf — wayback', () => {
	const ok = (data: {
		firstSeen: string | null;
		lastSeen: string | null;
		snapshotsByYear: Array<{ year: string; count: number }>;
	}) => severityOf('wayback', { status: 'ok', data });

	it('is n/a when there is no history', () => {
		expect(ok({ firstSeen: null, lastSeen: null, snapshotsByYear: [] })).toEqual({
			word: 'Nothing archived',
			tone: 'na',
			finding: 'The Internet Archive has no record of this site.'
		});
	});

	it('is Good when the most recent snapshot is this year', () => {
		const thisYear = String(new Date().getFullYear());
		const s = ok({
			firstSeen: '2019-01-01',
			lastSeen: `${thisYear}-03-01`,
			snapshotsByYear: [
				{ year: '2019', count: 2 },
				{ year: thisYear, count: 5 }
			]
		});
		expect(s).toMatchObject({ word: 'Good', tone: 'ok' });
		expect(s.finding).toBe(`Archived since 2019, captured on 5 days in ${thisYear}.`);
	});

	it('is Good when the most recent snapshot is last year', () => {
		const lastYear = String(new Date().getFullYear() - 1);
		const s = ok({
			firstSeen: '2019-01-01',
			lastSeen: `${lastYear}-03-01`,
			snapshotsByYear: [{ year: lastYear, count: 3 }]
		});
		expect(s).toMatchObject({ word: 'Good', tone: 'ok' });
	});

	it('is Needs work when the most recent snapshot is older than last year', () => {
		const s = ok({
			firstSeen: '2015-01-01',
			lastSeen: '2018-06-01',
			snapshotsByYear: [
				{ year: '2015', count: 1 },
				{ year: '2018', count: 4 }
			]
		});
		expect(s).toMatchObject({ word: 'Needs work', tone: 'warn' });
		expect(s.finding).toBe('Last archived in 2018; the archive has nothing more recent.');
	});

	it('falls back to Measured when a row is missing a year', () => {
		const s = severityOf('wayback', {
			status: 'ok',
			data: {
				firstSeen: '2015-01-01',
				lastSeen: '2018-06-01',
				snapshotsByYear: [{ count: 4 }]
			}
		});
		expect(s).toEqual({ word: 'Measured', tone: 'na', finding: 'See the readings below.' });
	});

	it('falls back to Measured when the year is not four digits', () => {
		const s = severityOf('wayback', {
			status: 'ok',
			data: {
				firstSeen: '2015-01-01',
				lastSeen: '2018-06-01',
				snapshotsByYear: [{ year: 'abc', count: 4 }]
			}
		});
		expect(s).toEqual({ word: 'Measured', tone: 'na', finding: 'See the readings below.' });
	});

	it('uses "1 day" singular when only one day was captured', () => {
		const thisYear = String(new Date().getFullYear());
		const s = severityOf('wayback', {
			status: 'ok',
			data: {
				firstSeen: '2019-01-01',
				lastSeen: `${thisYear}-03-01`,
				snapshotsByYear: [{ year: thisYear, count: 1 }]
			}
		});
		expect(s.finding).toBe(`Archived since 2019, captured on 1 day in ${thisYear}.`);
	});
});

describe('severityOf — security', () => {
	const base = {
		headers: [] as Array<{
			header: string;
			present: boolean;
			value: string | null;
			severity: 'high' | 'medium' | 'low';
			note: string;
		}>,
		cookies: [] as Array<{
			name: string;
			secure: boolean;
			httpOnly: boolean;
			sameSite: string | null;
		}>,
		tls: {
			protocol: 'TLSv1.3',
			daysRemaining: 90,
			issuer: 'Let’s Encrypt',
			authorized: true,
			authorizationError: null as string | null,
			validTo: null
		} as
			| {
					protocol: string | null;
					daysRemaining: number | null;
					issuer: string | null;
					authorized: boolean;
					authorizationError: string | null;
					validTo: string | null;
			  }
			| { error: string },
		servedOverHttps: true
	};
	const ok = (overrides: Partial<typeof base> = {}) =>
		severityOf('security', { status: 'ok', data: { ...base, ...overrides } });

	it('is Good when everything is fine', () => {
		expect(ok()).toMatchObject({ word: 'Good', tone: 'ok' });
	});

	it('is Poor when not served over HTTPS', () => {
		const s = ok({ servedOverHttps: false });
		expect(s).toMatchObject({ word: 'Poor', tone: 'fail' });
		expect(s.finding).toBe('The site is not served over HTTPS.');
	});

	it('is Poor when the certificate is not authorized', () => {
		const s = ok({
			tls: { ...base.tls, authorized: false, authorizationError: 'certificate has expired' }
		});
		expect(s).toMatchObject({ word: 'Poor', tone: 'fail' });
		expect(s.finding).toBe('The certificate is invalid: certificate has expired.');
	});

	it('is Poor when the certificate has 0 or fewer days remaining', () => {
		expect(ok({ tls: { ...base.tls, daysRemaining: 0 } })).toMatchObject({
			word: 'Poor',
			tone: 'fail'
		});
		expect(ok({ tls: { ...base.tls, daysRemaining: -3 } })).toMatchObject({
			word: 'Poor',
			tone: 'fail'
		});
	});

	it('says "expired today" at exactly 0 days remaining', () => {
		const s = ok({ tls: { ...base.tls, daysRemaining: 0 } });
		expect(s.finding).toBe('The certificate expired today.');
	});

	it('says "expired N days ago" rather than a negative day count', () => {
		const s = ok({ tls: { ...base.tls, daysRemaining: -12 } });
		expect(s.finding).toBe('The certificate expired 12 days ago.');
	});

	it('does not throw on a security result whose header elements are malformed', () => {
		const s = severityOf('security', {
			status: 'ok',
			data: {
				...base,
				headers: [{ present: false }]
			}
		});
		expect(s).toMatchObject({ word: 'Measured', tone: 'na' });
	});

	it('is Poor on a missing high-severity header, naming it first', () => {
		const s = ok({
			headers: [
				{
					header: 'content-security-policy',
					present: false,
					value: null,
					severity: 'high',
					note: 'No CSP'
				},
				{
					header: 'strict-transport-security',
					present: false,
					value: null,
					severity: 'high',
					note: 'No HSTS'
				}
			]
		});
		expect(s).toMatchObject({ word: 'Poor', tone: 'fail' });
		expect(s.finding).toBe(
			'2 important security headers are missing, starting with Content-Security-Policy.'
		);
	});

	it('is Needs work on a missing medium-severity header', () => {
		const s = ok({
			headers: [
				{
					header: 'x-frame-options',
					present: false,
					value: null,
					severity: 'medium',
					note: 'No frame protection'
				}
			]
		});
		expect(s).toMatchObject({ word: 'Needs work', tone: 'warn' });
		expect(s.finding).toBe('1 security header is missing, starting with X-Frame-Options.');
	});

	it('matches is/are for a missing medium-severity header, singular and plural', () => {
		const one = ok({
			headers: [
				{ header: 'x-frame-options', present: false, value: null, severity: 'medium', note: '' }
			]
		});
		expect(one.finding).toBe('1 security header is missing, starting with X-Frame-Options.');

		const two = ok({
			headers: [
				{ header: 'x-frame-options', present: false, value: null, severity: 'medium', note: '' },
				{ header: 'referrer-policy', present: false, value: null, severity: 'medium', note: '' }
			]
		});
		expect(two.finding).toBe('2 security headers are missing, starting with X-Frame-Options.');
	});

	it('is Needs work when a cookie lacks Secure or HttpOnly', () => {
		const s = ok({
			cookies: [{ name: 'session', secure: false, httpOnly: true, sameSite: 'Lax' }]
		});
		expect(s).toMatchObject({ word: 'Needs work', tone: 'warn' });
	});

	it('is Needs work when the certificate expires in under 30 days', () => {
		expect(ok({ tls: { ...base.tls, daysRemaining: 29 } })).toMatchObject({
			word: 'Needs work',
			tone: 'warn'
		});
		expect(ok({ tls: { ...base.tls, daysRemaining: 30 } })).toMatchObject({ word: 'Good' });
	});

	it('names the days remaining when that is the worst issue', () => {
		const s = ok({ tls: { ...base.tls, daysRemaining: 12 } });
		expect(s.finding).toBe('The certificate expires in 12 days.');
	});

	it('uses "1 day" singular when the certificate expires tomorrow', () => {
		const s = ok({ tls: { ...base.tls, daysRemaining: 1 } });
		expect(s.finding).toBe('The certificate expires in 1 day.');
	});

	it('stays Good with a finding about an uninspectable certificate', () => {
		const s = ok({ tls: { error: 'connect ETIMEDOUT' } });
		expect(s).toMatchObject({ word: 'Good', tone: 'ok' });
		expect(s.finding).toMatch(/could not be inspected/);
	});

	it('names all headers present and certificate valid when clean', () => {
		const s = ok();
		expect(s.finding).toBe('All security headers are present and the certificate is valid.');
	});
});

describe('severityOf — aeo', () => {
	const base = {
		llmsTxt: false,
		sitemap: true,
		crawlers: [{ agent: 'GPTBot', allowed: true }],
		structuredData: { blocks: 1, valid: 1, types: ['Organization'] },
		headings: { h1Count: 1, hierarchyOk: true },
		jsDependencyRatio: 0.95
	};
	const ok = (overrides: Partial<typeof base> = {}) =>
		severityOf('aeo', { status: 'ok', data: { ...base, ...overrides } });

	it('is Good when everything checks out', () => {
		const s = ok();
		expect(s).toMatchObject({ word: 'Good', tone: 'ok' });
		expect(s.finding).toBe('95% of the page text is available without JavaScript.');
	});

	it('is Poor when the JS dependency ratio is under 0.5', () => {
		expect(ok({ jsDependencyRatio: 0.49 })).toMatchObject({ word: 'Poor', tone: 'fail' });
		expect(ok({ jsDependencyRatio: 0.5 })).not.toMatchObject({ word: 'Poor' });
	});

	it('is Needs work when the JS dependency ratio is under 0.8', () => {
		expect(ok({ jsDependencyRatio: 0.79 })).toMatchObject({ word: 'Needs work', tone: 'warn' });
		expect(ok({ jsDependencyRatio: 0.8 })).toMatchObject({ word: 'Good' });
	});

	it('is Needs work with no sitemap', () => {
		const s = ok({ sitemap: false });
		expect(s).toMatchObject({ word: 'Needs work', tone: 'warn' });
		expect(s.finding).toBe(
			'95% of the page text is available without JavaScript; no sitemap was found.'
		);
	});

	it('is Needs work with no valid structured data blocks', () => {
		const s = ok({ structuredData: { blocks: 2, valid: 0, types: [] } });
		expect(s).toMatchObject({ word: 'Needs work', tone: 'warn' });
	});

	it('is Needs work when there is not exactly one H1', () => {
		expect(ok({ headings: { h1Count: 0, hierarchyOk: true } })).toMatchObject({
			word: 'Needs work'
		});
		expect(ok({ headings: { h1Count: 2, hierarchyOk: true } })).toMatchObject({
			word: 'Needs work'
		});
	});

	it('is Needs work when the heading hierarchy skips levels', () => {
		expect(ok({ headings: { h1Count: 1, hierarchyOk: false } })).toMatchObject({
			word: 'Needs work'
		});
	});

	it('is Needs work when any AI crawler is blocked', () => {
		const s = ok({ crawlers: [{ agent: 'GPTBot', allowed: false }] });
		expect(s).toMatchObject({ word: 'Needs work', tone: 'warn' });
	});

	it('never uses a score word', () => {
		const s = ok({ jsDependencyRatio: 0.1 });
		expect(s.finding).not.toMatch(/score/i);
	});

	it('never rounds a ratio under 1 up to 100%', () => {
		const s = ok({ jsDependencyRatio: 0.996 });
		expect(s.finding).toBe('99% of the page text is available without JavaScript.');
	});

	it('falls back to Measured when structuredData is empty', () => {
		const s = severityOf('aeo', { status: 'ok', data: { ...base, structuredData: {} } });
		expect(s).toEqual({ word: 'Measured', tone: 'na', finding: 'See the readings below.' });
	});
});

describe('severityOf — seoquake', () => {
	const ok = (data: {
		semrushRank?: number | null;
		backlinks?: number | null;
		linkingDomains?: number | null;
		pinterest?: number | null;
	}) => ({
		status: 'ok' as const,
		data: {
			semrushRank: null,
			backlinks: null,
			linkingDomains: null,
			pinterest: null,
			raw: {},
			...data
		}
	});

	it('is No data when all four values are null', () => {
		expect(severityOf('seoquake', ok({}))).toMatchObject({ word: 'No data', tone: 'na' });
	});

	it('is Measured when any value is present, using AU thousands separators', () => {
		const s = severityOf(
			'seoquake',
			ok({ semrushRank: 12345, backlinks: 6789, linkingDomains: 42 })
		);
		expect(s).toMatchObject({ word: 'Measured', tone: 'ok' });
		expect(s.finding).toBe('Semrush rank 12,345; 6,789 backlinks from 42 domains.');
	});

	it('names missing parts as "no data" rather than omitting them', () => {
		const s = severityOf('seoquake', ok({ semrushRank: 100 }));
		expect(s.finding).toBe('Semrush rank 100; no data backlinks from no data domains.');
	});
});

describe('severityOf — content', () => {
	const misspelling = (word: string, count = 1) => ({ word, count, suggestions: [] });
	const grammarOk = (findings: Array<{ message: string; context: string }>) => ({
		status: 'ok' as const,
		findings: findings.map((f) => ({ ...f, ruleId: 'X' }))
	});
	const ok = (misspellings: ReturnType<typeof misspelling>[], grammar: unknown) => ({
		status: 'ok' as const,
		data: { spelling: { misspellings }, grammar }
	});

	it('is Good with no misspellings and no grammar findings', () => {
		const s = severityOf('content', ok([], grammarOk([])));
		expect(s).toMatchObject({ word: 'Good', tone: 'ok' });
	});

	it('is Needs work with any misspelling', () => {
		const s = severityOf('content', ok([misspelling('teh')], grammarOk([])));
		expect(s).toMatchObject({ word: 'Needs work', tone: 'warn' });
		expect(s.finding).toMatch(/1 misspelling/);
	});

	it('is Needs work with any grammar finding', () => {
		const s = severityOf(
			'content',
			ok([], grammarOk([{ message: 'Fix this', context: 'a phrase' }]))
		);
		expect(s).toMatchObject({ word: 'Needs work', tone: 'warn' });
		expect(s.finding).toMatch(/1 grammar issue/);
	});

	it('stays Needs work at 9 distinct misspellings', () => {
		const misspellings = Array.from({ length: 9 }, (_, i) => misspelling(`word${i}`));
		expect(severityOf('content', ok(misspellings, grammarOk([])))).toMatchObject({
			word: 'Needs work',
			tone: 'warn'
		});
	});

	it('becomes Poor at 10 distinct misspellings', () => {
		const misspellings = Array.from({ length: 10 }, (_, i) => misspelling(`word${i}`));
		expect(severityOf('content', ok(misspellings, grammarOk([])))).toMatchObject({
			word: 'Poor',
			tone: 'fail'
		});
	});

	it('stays Needs work at 9 grammar findings', () => {
		const findings = Array.from({ length: 9 }, (_, i) => ({
			message: `Issue ${i}`,
			context: 'context'
		}));
		expect(severityOf('content', ok([], grammarOk(findings)))).toMatchObject({
			word: 'Needs work',
			tone: 'warn'
		});
	});

	it('becomes Poor at 10 grammar findings', () => {
		const findings = Array.from({ length: 10 }, (_, i) => ({
			message: `Issue ${i}`,
			context: 'context'
		}));
		expect(severityOf('content', ok([], grammarOk(findings)))).toMatchObject({
			word: 'Poor',
			tone: 'fail'
		});
	});

	it('mentions both counts with plural wording', () => {
		const s = severityOf(
			'content',
			ok([misspelling('teh'), misspelling('recieve')], grammarOk([{ message: 'x', context: 'y' }]))
		);
		expect(s.finding).toBe('2 misspellings and 1 grammar issue found.');
	});

	it('notes grammar was not checked when unavailable', () => {
		const s = severityOf('content', ok([], { status: 'unavailable', reason: 'Turned off.' }));
		expect(s.finding).toMatch(/Grammar was not checked\.$/);
	});

	it('a failed grammar check does not stop misspellings being reported', () => {
		const s = severityOf(
			'content',
			ok([misspelling('teh')], { status: 'failed', error: 'net down' })
		);
		expect(s).toMatchObject({ word: 'Needs work', tone: 'warn' });
		expect(s.finding).toMatch(/1 misspelling/);
	});
});
