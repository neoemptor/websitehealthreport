export type Severity = 'high' | 'medium' | 'low';

export type HeaderFinding = {
	header: string;
	present: boolean;
	value: string | null;
	severity: Severity;
	note: string;
	/** Present, but with a value that does not actually do the header's job. */
	weak?: boolean;
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
		note: 'Reveals what software runs the site, which makes it easier to target.',
		badWhenPresent: true
	}
];

/** Six months, the value the major preload lists ask for. */
const HSTS_MIN_MAX_AGE = 15_552_000;

/**
 * A present header can still be useless: X-Frame-Options with anything but
 * DENY or SAMEORIGIN (ALLOW-FROM was dropped by every current browser) allows
 * framing, and a short HSTS max-age leaves most visits unprotected. These are
 * reported as present-but-weak rather than as a pass.
 */
function weakness(header: string, value: string): string | null {
	const v = value.trim();
	if (header === 'x-frame-options') {
		return /^(deny|sameorigin)$/i.test(v) ? null : 'Present but allows framing.';
	}
	if (header === 'strict-transport-security') {
		const maxAge = /max-age\s*=\s*"?(\d+)"?/i.exec(v);
		const seconds = maxAge ? Number(maxAge[1]) : 0;
		return seconds < HSTS_MIN_MAX_AGE ? 'Present but max-age is under 180 days.' : null;
	}
	return null;
}

export function parseSecurityHeaders(headers: Headers): HeaderFinding[] {
	return CHECKS.map((check) => {
		const value = headers.get(check.header);
		const present = value !== null;
		const weak = present && !check.badWhenPresent ? weakness(check.header, value) : null;

		return {
			header: check.header,
			present,
			value,
			severity: check.severity,
			weak: weak !== null,
			note: check.badWhenPresent
				? present
					? check.note
					: 'Not disclosed.'
				: present
				? weak ?? 'Present.'
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
