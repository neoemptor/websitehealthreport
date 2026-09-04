export type Severity = 'high' | 'medium' | 'low';

export type HeaderFinding = {
	header: string;
	present: boolean;
	value: string | null;
	severity: Severity;
	note: string;
};

export type CookieFinding = {
	name: string;
	secure: boolean;
	httpOnly: boolean;
	sameSite: string | null;
};

type HeaderCheck = {
	header: string;
	severity: Severity;
	/** Note used when the header is absent, or — for disclosure headers — when present. */
	note: string;
	/** Disclosure headers are a finding when present rather than when missing. */
	badWhenPresent?: boolean;
};

// Drawn from the OWASP Secure Headers Project. Passive: reading response
// headers only, no probing.
const CHECKS: HeaderCheck[] = [
	{
		header: 'content-security-policy',
		severity: 'high',
		note: 'No CSP: the page has no defence against injected scripts.'
	},
	{
		header: 'strict-transport-security',
		severity: 'high',
		note: 'No HSTS: browsers may fall back to plain HTTP.'
	},
	{
		header: 'x-frame-options',
		severity: 'medium',
		note: 'No frame protection: the site can be embedded for clickjacking.'
	},
	{
		header: 'x-content-type-options',
		severity: 'medium',
		note: 'Missing nosniff: browsers may guess content types.'
	},
	{
		header: 'referrer-policy',
		severity: 'low',
		note: 'No referrer policy: full URLs leak to third parties.'
	},
	{
		header: 'permissions-policy',
		severity: 'low',
		note: 'No permissions policy: browser features are unrestricted.'
	},
	{
		header: 'x-powered-by',
		severity: 'low',
		note: 'Version disclosure: reveals the server stack to attackers.',
		badWhenPresent: true
	}
];

export function parseSecurityHeaders(headers: Headers): HeaderFinding[] {
	return CHECKS.map((check) => {
		const value = headers.get(check.header);
		const present = value !== null;

		return {
			header: check.header,
			present,
			value,
			severity: check.severity,
			note: check.badWhenPresent
				? present
					? check.note
					: 'Not disclosed.'
				: present
				? 'Present.'
				: check.note
		};
	});
}

export function parseCookieFlags(setCookie: string[]): CookieFinding[] {
	return setCookie.map((cookie) => {
		const attributes = cookie.split(';').map((part) => part.trim());
		const sameSite = attributes.find((a) => /^SameSite=/i.test(a));

		return {
			name: attributes[0]?.split('=')[0] ?? '',
			secure: attributes.some((a) => /^Secure$/i.test(a)),
			httpOnly: attributes.some((a) => /^HttpOnly$/i.test(a)),
			sameSite: sameSite ? sameSite.split('=')[1] : null
		};
	});
}
