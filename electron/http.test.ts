import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchText, readCapped, USER_AGENT } from './http';
import { AbortedError } from './analyzers/abort';

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

	it('reports the timeout in seconds, not the raw abort error', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_url: string, init: RequestInit) =>
					new Promise((_, reject) =>
						init.signal?.addEventListener('abort', () =>
							reject(new Error('This operation was aborted'))
						)
					)
			)
		);
		await expect(fetchText('https://example.com/', { timeoutMs: 20 })).rejects.toThrow(
			'Timed out after 1s.'
		);
	});

	it('never reports a timeout of 0s, even for a sub-second timeout', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_url: string, init: RequestInit) =>
					new Promise((_, reject) =>
						init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
					)
			)
		);
		await expect(fetchText('https://example.com/', { timeoutMs: 400 })).rejects.toThrow(
			'Timed out after 1s.'
		);
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

	it('removes the abort listener after resolving', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('ok', { status: 200 }))
		);
		const controller = new AbortController();
		const added: unknown[] = [];
		const removed: unknown[] = [];
		const add = controller.signal.addEventListener.bind(controller.signal);
		const remove = controller.signal.removeEventListener.bind(controller.signal);
		vi.spyOn(controller.signal, 'addEventListener').mockImplementation(((
			type: string,
			listener: EventListener
		) => {
			added.push(listener);
			add(type, listener);
		}) as typeof add);
		vi.spyOn(controller.signal, 'removeEventListener').mockImplementation(((
			type: string,
			listener: EventListener
		) => {
			removed.push(listener);
			remove(type, listener);
		}) as typeof remove);

		await fetchText('https://example.com/', { signal: controller.signal });

		expect(added).toHaveLength(1);
		expect(removed).toEqual(added);
	});

	it('throws the typed AbortedError when the caller signal is already aborted', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('', { status: 200 }))
		);
		const controller = new AbortController();
		controller.abort();
		await expect(
			fetchText('https://example.com/', { signal: controller.signal })
		).rejects.toBeInstanceOf(AbortedError);
	});

	it('throws the typed AbortedError when the caller aborts mid-flight', async () => {
		const controller = new AbortController();
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_url: string, init: RequestInit) =>
					new Promise((_, reject) =>
						init.signal?.addEventListener('abort', () =>
							reject(new Error('This operation was aborted'))
						)
					)
			)
		);
		const promise = fetchText('https://example.com/', { signal: controller.signal });
		controller.abort();
		await expect(promise).rejects.toBeInstanceOf(AbortedError);
	});
});

describe('readCapped', () => {
	function streamed(chunks: string[]): { response: Response; cancelled: () => boolean } {
		let cancelled = false;
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
				controller.close();
			},
			cancel() {
				cancelled = true;
			}
		});
		return { response: new Response(stream), cancelled: () => cancelled };
	}

	it('stops at the cap and cancels the rest of the body', async () => {
		const { response, cancelled } = streamed(['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)]);
		const text = await readCapped(response, 60);
		expect(text).toHaveLength(60);
		expect(text.endsWith('b')).toBe(true);
		expect(cancelled()).toBe(true);
	});

	it('returns the whole body when it fits under the cap', async () => {
		const { response, cancelled } = streamed(['hello ', 'world']);
		expect(await readCapped(response, 1_000)).toBe('hello world');
		expect(cancelled()).toBe(false);
	});
});
