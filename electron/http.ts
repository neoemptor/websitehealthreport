import { AbortedError } from './analyzers/abort';

export const USER_AGENT = 'WebsiteHealthReport/1.0 (+https://dsbaileyfreelancer.com.au)';

export type FetchTextResult = {
	status: number;
	headers: Headers;
	body: string;
	finalUrl: string;
};

export async function fetchText(
	url: string,
	opts: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<FetchTextResult> {
	if (opts.signal?.aborted) {
		throw new AbortedError();
	}

	const controller = new AbortController();
	const timeoutMs = opts.timeoutMs ?? 15_000;
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);
	const onAbort = (): void => controller.abort();
	opts.signal?.addEventListener('abort', onAbort);

	try {
		const response = await fetch(url, {
			signal: controller.signal,
			redirect: 'follow',
			headers: { 'User-Agent': USER_AGENT }
		});

		return {
			status: response.status,
			headers: response.headers,
			body: await response.text(),
			finalUrl: response.url || url
		};
	} catch (err) {
		if (timedOut) {
			throw new Error(`Timed out after ${Math.max(1, Math.round(timeoutMs / 1000))}s.`);
		}
		// The caller's own signal fired: that is a cancellation, not a network
		// fault, and the typed error is what tells the two apart downstream.
		if (opts.signal?.aborted) throw new AbortedError();
		throw err;
	} finally {
		clearTimeout(timer);
		opts.signal?.removeEventListener('abort', onAbort);
	}
}

/** The default read cap: a page bigger than this is being read for its text, not its bytes. */
export const BYTE_CAP = 1_000_000;

/**
 * Reads a response body as text, stopping once `cap` bytes have arrived and
 * cancelling the rest. Shared by every fetch that only wants a page's words:
 * without the cancel, a multi-gigabyte body keeps streaming into a socket
 * nobody is reading any more.
 */
export async function readCapped(response: Response, cap: number = BYTE_CAP): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) return (await response.text()).slice(0, cap);
	const decoder = new TextDecoder();
	let text = '';
	let received = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			text += decoder.decode(value, { stream: true });
			if (received >= cap) {
				await reader.cancel().catch(() => {});
				break;
			}
		}
	} finally {
		text += decoder.decode();
	}
	return text.slice(0, cap);
}
