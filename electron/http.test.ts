import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchText, USER_AGENT } from './http';

afterEach(() => vi.unstubAllGlobals());

describe('fetchText', () => {
	it('returns status, headers and body', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('hello', { status: 200, headers: { 'x-a': '1' } }))
		);
		const result = await fetchText('https://example.com/');
		expect(result.status).toBe(200);
		expect(result.body).toBe('hello');
		expect(result.headers.get('x-a')).toBe('1');
	});

	it('identifies itself with a descriptive User-Agent', async () => {
		const spy = vi.fn(async () => new Response('', { status: 200 }));
		vi.stubGlobal('fetch', spy);
		await fetchText('https://example.com/');
		const init = spy.mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
	});

	it('throws a descriptive error when the request times out', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_url: string, init: RequestInit) =>
					new Promise((_, reject) =>
						init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
					)
			)
		);
		await expect(fetchText('https://example.com/', { timeoutMs: 20 })).rejects.toThrow();
	});

	it('throws immediately if the caller signal is already aborted', async () => {
		const spy = vi.fn(async () => new Response('', { status: 200 }));
		vi.stubGlobal('fetch', spy);
		const controller = new AbortController();
		controller.abort();
		await expect(fetchText('https://example.com/', { signal: controller.signal })).rejects.toThrow(
			'Aborted: the task timed out or the run was cancelled.'
		);
		expect(spy).not.toHaveBeenCalled();
	});

	it('removes the abort listener after resolving, so a later abort is a no-op', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('ok', { status: 200 }))
		);
		const controller = new AbortController();
		await fetchText('https://example.com/', { signal: controller.signal });
		expect(() => controller.abort()).not.toThrow();
	});
});
