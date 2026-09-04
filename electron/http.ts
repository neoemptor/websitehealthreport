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
		throw new Error('Aborted: the task timed out or the run was cancelled.');
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
		throw err;
	} finally {
		clearTimeout(timer);
		opts.signal?.removeEventListener('abort', onAbort);
	}
}
