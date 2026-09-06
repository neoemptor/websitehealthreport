import type { Concurrency } from '../analyzers/types';

export type Task<T> = {
	key: string;
	concurrency: Concurrency;
	timeoutMs: number;
	run: (signal: AbortSignal) => Promise<T>;
};

export type SettledResult = { status: 'ok'; value: unknown } | { status: 'failed'; error: string };

export type RunTasksOptions<T> = {
	parallelCap: number;
	/**
	 * Cancels the whole batch. Tasks that have not started are never started,
	 * an in-flight task has its own signal aborted, and no result is recorded
	 * for either — a cancelled cell stays pending so a later resume picks it
	 * up, rather than being written down as a failure the operator has to read.
	 */
	signal?: AbortSignal;
	onSettled: (task: Task<T>, result: SettledResult) => void | Promise<void>;
};

const LIMITED_CAP = 2;

type Gate = { acquire(): Promise<void>; release(): void };

/** Minimal counting semaphore. No dependency, and the behaviour is fully covered by tests. */
function semaphore(capacity: number) {
	let available = capacity;
	const waiting: Array<() => void> = [];

	return {
		async acquire(): Promise<void> {
			if (available > 0) {
				available--;
				return;
			}
			await new Promise<void>((resolve) => waiting.push(resolve));
		},
		release(): void {
			const next = waiting.shift();
			if (next) {
				next();
			} else {
				available++;
			}
		}
	};
}

/**
 * Readers-writer lock over the whole batch. Ordinary tasks hold it shared and
 * are gated only against each other; an exclusive task holds it alone, so a
 * measurement whose result depends on how busy the machine is (Lighthouse
 * timings, above all) is not taken while seven other analyzers are competing
 * for the same CPU.
 *
 * Grants are handed out strictly in request order. A first-come pass that
 * simply admitted any reader whenever no writer held the lock would let the
 * steady stream of parallel tasks in a large run starve the exclusive one
 * indefinitely, since there is almost never a moment with zero readers.
 */
function rwLock() {
	let readers = 0;
	let writing = false;
	const queue: Array<{ exclusive: boolean; grant: () => void }> = [];

	function pump(): void {
		while (queue.length > 0) {
			const next = queue[0];
			if (next.exclusive) {
				// The writer waits at the head of the queue until the readers
				// ahead of it drain; nothing queued behind it is admitted
				// meanwhile, which is what makes the wait finite.
				if (writing || readers > 0) return;
				queue.shift();
				writing = true;
				next.grant();
				return;
			}
			if (writing) return;
			queue.shift();
			readers++;
			next.grant();
		}
	}

	return {
		acquire(exclusive: boolean): Promise<void> {
			return new Promise<void>((resolve) => {
				queue.push({ exclusive, grant: resolve });
				pump();
			});
		},
		release(exclusive: boolean): void {
			if (exclusive) {
				writing = false;
			} else {
				readers--;
			}
			pump();
		}
	};
}

async function settle<T>(task: Task<T>, external?: AbortSignal): Promise<SettledResult> {
	const controller = new AbortController();
	let reason = `Timed out after ${task.timeoutMs}ms`;
	const timer = setTimeout(() => controller.abort(), task.timeoutMs);

	// A cancelled run aborts the task's own signal, so the analyzer tears its
	// browser down instead of running on past the point anyone is listening.
	const onExternalAbort = () => {
		reason = 'Run cancelled';
		controller.abort();
	};
	external?.addEventListener('abort', onExternalAbort);

	try {
		const value = await Promise.race([
			task.run(controller.signal),
			new Promise<never>((_, reject) => {
				controller.signal.addEventListener('abort', () => reject(new Error(reason)));
			})
		]);
		return { status: 'ok', value };
	} catch (error) {
		return { status: 'failed', error: (error as Error).message };
	} finally {
		clearTimeout(timer);
		external?.removeEventListener('abort', onExternalAbort);
		// Ensures a task that finished normally still sees its signal cleaned up.
		if (!controller.signal.aborted) {
			controller.abort();
		}
	}
}

export async function runTasks<T>(tasks: Task<T>[], opts: RunTasksOptions<T>): Promise<void> {
	const gates: Record<Exclude<Concurrency, 'exclusive'>, Gate> = {
		serial: semaphore(1),
		limited: semaphore(LIMITED_CAP),
		parallel: semaphore(opts.parallelCap)
	};
	// An exclusive task needs no per-kind gate: the lock it holds already
	// excludes every other task in the batch, itself included.
	const lock = rwLock();

	await Promise.all(
		tasks.map(async (task) => {
			if (opts.signal?.aborted) return;
			const exclusive = task.concurrency === 'exclusive';
			// The lock is always taken before the per-kind gate. Taking them in
			// the other order would let a task hold a gate while it waits for a
			// running exclusive task that cannot finish until the gate holder
			// does.
			await lock.acquire(exclusive);
			try {
				const gate = task.concurrency === 'exclusive' ? undefined : gates[task.concurrency];
				await gate?.acquire();
				try {
					// Checked again after the gate: cancellation usually lands while
					// a task is queued behind a busy semaphore.
					if (opts.signal?.aborted) return;
					const result = await settle(task, opts.signal);
					if (opts.signal?.aborted) return;
					await opts.onSettled(task, result);
				} finally {
					gate?.release();
				}
			} finally {
				lock.release(exclusive);
			}
		})
	);
}
