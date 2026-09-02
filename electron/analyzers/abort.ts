/**
 * A promise that rejects as soon as `signal` aborts, with the cleanup for its
 * listener.
 *
 * The scheduler races every task against a timeout and then releases its
 * concurrency slot, so an analyzer that ignores its signal keeps its browser
 * running after the slot has already been handed to the next task — two timed
 * out Lighthouse tasks plus two fresh ones is four Chrome instances on an
 * analyzer capped at two. Racing the real work against this is what turns the
 * signal into an actual stop.
 */
export function rejectOnAbort(signal: AbortSignal): {
	promise: Promise<never>;
	dispose: () => void;
} {
	let listener: (() => void) | null = null;

	const promise = new Promise<never>((_, reject) => {
		const fail = () => reject(new Error('Aborted: the task timed out or the run was cancelled.'));
		if (signal.aborted) {
			fail();
			return;
		}
		listener = fail;
		signal.addEventListener('abort', fail, { once: true });
	});

	return {
		promise,
		dispose: () => {
			if (listener) signal.removeEventListener('abort', listener);
		}
	};
}

/** Runs `teardown` at most once, whether the signal fired or the work returned. */
export function once(teardown: () => void | Promise<void>): () => Promise<void> {
	let done = false;
	return async () => {
		if (done) return;
		done = true;
		try {
			await teardown();
		} catch {
			// The browser is being torn down because the work is over; a failure
			// to close something that may already be gone is not the analyzer's
			// result and must not replace it.
		}
	};
}
