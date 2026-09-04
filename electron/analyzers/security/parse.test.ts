import { describe, it, expect } from 'vitest';
import { parseSecurityHeaders, parseCookieFlags } from './parse';

describe('parseSecurityHeaders', () => {
	it('flags a missing Content-Security-Policy as high severity', () => {
		const findings = parseSecurityHeaders(new Headers());
		const csp = findings.find((f) => f.header === 'content-security-policy');
		expect(csp).toMatchObject({ present: false, severity: 'high' });
	});

	it('records the value when a header is present', () => {
		const headers = new Headers({ 'strict-transport-security': 'max-age=31536000' });
		const hsts = parseSecurityHeaders(headers).find(
			(f) => f.header === 'strict-transport-security'
		);
		expect(hsts).toMatchObject({ present: true, value: 'max-age=31536000' });
	});

	it('reports version disclosure as a finding', () => {
		const headers = new Headers({ 'x-powered-by': 'PHP/7.2.1' });
		const finding = parseSecurityHeaders(headers).find((f) => f.header === 'x-powered-by');
		expect(finding?.present).toBe(true);
		expect(finding?.note).toMatch(/software|target/i);
	});

	it('marks X-Frame-Options as weak when it does not deny framing', () => {
		const finding = parseSecurityHeaders(new Headers({ 'x-frame-options': 'ALLOW-FROM x' })).find(
			(f) => f.header === 'x-frame-options'
		);
		expect(finding).toMatchObject({ present: true, weak: true });
		expect(finding?.note).toBe('Present but allows framing.');
	});

	it('accepts DENY and SAMEORIGIN, in any case', () => {
		for (const value of ['DENY', 'sameorigin', ' SAMEORIGIN ']) {
			const finding = parseSecurityHeaders(new Headers({ 'x-frame-options': value })).find(
				(f) => f.header === 'x-frame-options'
			);
			expect(finding).toMatchObject({ present: true, weak: false, note: 'Present.' });
		}
	});

	it('marks HSTS as weak when max-age is under 180 days', () => {
		const finding = parseSecurityHeaders(
			new Headers({ 'strict-transport-security': 'max-age=86400' })
		).find((f) => f.header === 'strict-transport-security');
		expect(finding).toMatchObject({ present: true, weak: true });
		expect(finding?.note).toBe('Present but max-age is under 180 days.');
	});

	it('accepts an HSTS max-age of at least 180 days', () => {
		const finding = parseSecurityHeaders(
			new Headers({ 'strict-transport-security': 'max-age=31536000; includeSubDomains' })
		).find((f) => f.header === 'strict-transport-security');
		expect(finding).toMatchObject({ present: true, weak: false, note: 'Present.' });
	});

	it('treats an HSTS header with no max-age at all as weak', () => {
		const finding = parseSecurityHeaders(
			new Headers({ 'strict-transport-security': 'includeSubDomains' })
		).find((f) => f.header === 'strict-transport-security');
		expect(finding).toMatchObject({ present: true, weak: true });
	});

	it('checks every header in the OWASP set', () => {
		expect(parseSecurityHeaders(new Headers())).toHaveLength(7);
	});
});

describe('parseCookieFlags', () => {
	it('flags a cookie missing Secure and HttpOnly', () => {
		const [finding] = parseCookieFlags(['session=abc; Path=/']);
		expect(finding).toMatchObject({ name: 'session', secure: false, httpOnly: false });
	});

	it('recognises all three flags when present', () => {
		const [finding] = parseCookieFlags(['session=abc; Secure; HttpOnly; SameSite=Lax']);
		expect(finding).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax' });
	});

	it('returns an empty array when no cookies are set', () => {
		expect(parseCookieFlags([])).toEqual([]);
	});
});
