export type DateRange = { startDate: string; endDate: string };

const TIMEOUT_MS = 20_000;

type GoogleErrorBody = { error?: { status?: string; message?: string } };

export class GoogleApiError extends Error {
	httpStatus: number;
	googleStatus: string | null;
	constructor(httpStatus: number, googleStatus: string | null, message: string) {
		super(message);
		this.name = 'GoogleApiError';
		this.httpStatus = httpStatus;
		this.googleStatus = googleStatus;
	}
}

function scrubToken(message: string, accessToken: string): string {
	// Splitting on an empty string would explode the message into single
	// characters joined by "[token]", so an absent token leaves it untouched.
	if (accessToken === '') return message;
	return message.split(accessToken).join('[token]');
}

/**
 * POSTs JSON to a Google API with a timeout and abort support. The access
 * token is only ever placed in the Authorization header — it is never
 * included in a thrown message (any occurrence of it inside Google's own
 * error message is scrubbed before the error is thrown), and a non-JSON
 * error body never escapes as a raw SyntaxError.
 */
export async function postGoogleJson(
	url: string,
	accessToken: string,
	body: unknown,
	signal?: AbortSignal
): Promise<unknown> {
	if (signal?.aborted) {
		throw new Error('Aborted: the task timed out or the run was cancelled.');
	}

	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, TIMEOUT_MS);
	const onAbort = (): void => controller.abort();
	signal?.addEventListener('abort', onAbort);

	try {
		const response = await fetch(url, {
			method: 'POST',
			signal: controller.signal,
			headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			const parsed = (await response.json().catch(() => ({}))) as GoogleErrorBody;
			const status = parsed.error?.status ?? null;
			const message = parsed.error?.message
				? scrubToken(parsed.error.message, accessToken)
				: undefined;
			const detail = [status, message].filter(Boolean).join(': ');
			throw new GoogleApiError(
				response.status,
				status,
				`Google API request failed with HTTP ${response.status}${detail ? ` (${detail})` : ''}.`
			);
		}

		return await response.json().catch(() => ({}));
	} catch (err) {
		if (timedOut) {
			throw new Error('Aborted: the task timed out or the run was cancelled.');
		}
		throw err;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}
}
