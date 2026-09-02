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
	const gates: Record<Concurrency, { acquire(): Promise<void>; release(): void }> = {
		serial: semaphore(1),
		limited: semaphore(LIMITED_CAP),
		parallel: semaphore(opts.parallelCap)
	};

	await Promise.all(
		tasks.map(async (task) => {
			if (opts.signal?.aborted) return;
			const gate = gates[task.concurrency];
			await gate.acquire();
			try {
				// Checked again after the gate: cancellation usually lands while
				// a task is queued behind a busy semaphore.
				if (opts.signal?.aborted) return;
				const result = await settle(task, opts.signal);
				if (opts.signal?.aborted) return;
				await opts.onSettled(task, result);
			} finally {
				gate.release();
			}
		})
	);
}
