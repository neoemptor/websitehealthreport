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
	const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
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
	} finally {
		clearTimeout(timer);
		opts.signal?.removeEventListener('abort', onAbort);
	}
}
