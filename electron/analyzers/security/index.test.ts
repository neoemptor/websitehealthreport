import { describe, it, expect, vi } from 'vitest';

const fetchTextMock = vi.fn();
const inspectTlsMock = vi.fn();

vi.mock('../../http', () => ({
	fetchText: fetchTextMock
}));

vi.mock('./tls', () => ({
	inspectTls: inspectTlsMock
}));

function headersWithSetCookie(entries: Record<string, string>, cookies: string[]): Headers {
	const headers = new Headers(entries);
	(headers as unknown as { getSetCookie: () => string[] }).getSetCookie = () => cookies;
	return headers;
}

describe('securityAnalyzer', () => {
	it('reports servedOverHttps, header findings, and cookie findings for a normal response', async () => {
		const { securityAnalyzer } = await import('./index');

		fetchTextMock.mockResolvedValue({
			status: 200,
			headers: headersWithSetCookie({ 'strict-transport-security': 'max-age=63072000' }, [
				'session=abc; Secure; HttpOnly; SameSite=Strict'
			]),
			body: '',
			finalUrl: 'https://example.com/'
		});
		inspectTlsMock.mockResolvedValue({
			protocol: 'TLSv1.3',
			validTo: 'Dec 31 23:59:59 2099 GMT',
			daysRemaining: 1000,
			issuer: 'Example CA',
			authorized: true,
			authorizationError: null
		});

		const result = await securityAnalyzer.analyze('example.com', {}, undefined as never);

		expect(result.servedOverHttps).toBe(true);
		expect(Array.isArray(result.headers)).toBe(true);
		expect(result.headers.length).toBeGreaterThan(0);
		expect(result.cookies).toHaveLength(1);
		expect(result.cookies[0]).toMatchObject({ name: 'session', secure: true, httpOnly: true });
		expect(result.tls).toMatchObject({ protocol: 'TLSv1.3', authorized: true });
	});

	it('captures a TLS rejection as { error } while header findings still populate', async () => {
		const { securityAnalyzer } = await import('./index');

		fetchTextMock.mockResolvedValue({
			status: 200,
			headers: headersWithSetCookie({}, []),
			body: '',
			finalUrl: 'https://example.com/'
		});
		inspectTlsMock.mockRejectedValue(new Error('TLS connection to example.com timed out.'));

		const result = await securityAnalyzer.analyze('example.com', {}, undefined as never);

		expect(result.tls).toEqual({ error: 'TLS connection to example.com timed out.' });
		expect(Array.isArray(result.headers)).toBe(true);
		expect(result.headers.length).toBeGreaterThan(0);
	});
});
