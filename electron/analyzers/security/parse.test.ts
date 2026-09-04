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
		expect(finding?.note).toMatch(/disclos/i);
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
