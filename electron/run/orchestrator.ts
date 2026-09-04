import type { AnalyzerId, AnalyzerResult, DomainResult, Run } from '../../src/lib/shared/types';
import type { Registry } from '../analyzers/registry';
import { makeRunId } from './id';
import { runTasks, type SettledResult, type Task } from './scheduler';
import type { RunStorage } from './storage';

const PARALLEL_CAP = 8;

export type StartInput = {
	client: string;
	competitors: string[];
	enabledAnalyzers: AnalyzerId[];
	settings: Record<string, unknown>;
};

type ActiveRun = { controller: AbortController; done: Promise<void> };

export class Orchestrator {
	/** In-flight executions, keyed by run id. */
	private readonly active = new Map<string, ActiveRun>();

	constructor(
		private readonly registry: Registry,
		private readonly storage: RunStorage,
		private readonly onProgress: (run: Run) => void
	) {}

	async start(input: StartInput): Promise<Run> {
		const run: Run = {
			id: makeRunId(input.client, new Date()),
			createdAt: new Date().toISOString(),
			client: input.client,
			competitors: input.competitors,
			enabledAnalyzers: input.enabledAnalyzers,
			status: 'running',
			domains: [
				{ domain: input.client, role: 'client', analyzers: {} },
				...input.competitors.map(
					(domain): DomainResult => ({ domain, role: 'competitor', analyzers: {} })
				)
			]
		};

		// The run is persisted and returned before any analyzer starts, so the
		// renderer can navigate to the run screen and subscribe to progress
		// while the work is still going. Awaiting execute() here would hold the
		// run:start IPC call open for the whole run and every progress event
		// would be emitted to a page that has not mounted yet.
		await this.storage.save(run);
		this.launch(run, input.settings);
		return structuredClone(run);
	}

	async resume(id: string, settings: Record<string, unknown>): Promise<Run> {
		// Resuming a run that is already executing would launch a second
		// execution over the same file and orphan the first one's controller.
		if (this.active.has(id)) return this.storage.load(id);

		const run = await this.storage.load(id);
		run.status = 'running';
		await this.storage.save(run);
		this.launch(run, settings);
		return structuredClone(run);
	}

	/**
	 * Stops the analyzers for `id` and leaves the run aborted. Results already
	 * recorded are kept, so the operator can resume it later; a cell whose task
	 * was cancelled mid-flight stays pending rather than being written down as
	 * a failure. Resolves once the execution has actually wound down.
	 */
	async cancel(id: string): Promise<void> {
		const active = this.active.get(id);
		if (!active) return;
		active.controller.abort();
		await active.done;
	}

	/**
	 * Resolves once the background execution for `id` has finished, or
	 * immediately when nothing is in flight for it. Callers that need the
	 * finished run read it back from storage.
	 */
	async settled(id: string): Promise<void> {
		await this.active.get(id)?.done;
	}

	private launch(run: Run, settings: Record<string, unknown>): void {
		const controller = new AbortController();
		const done = this.executeInBackground(run, settings, controller.signal);
		this.active.set(run.id, { controller, done });
		void done.then(() => {
			if (this.active.get(run.id)?.done === done) this.active.delete(run.id);
		});
	}

	/**
	 * Never rejects. An execution driven in the background has no caller to
	 * reject to, and an unhandled rejection in the main process is fatal, so a
	 * failure is logged and the run is left marked aborted (which the run
	 * screen offers to resume) rather than stuck on running forever.
	 */
	private async executeInBackground(
		run: Run,
		settings: Record<string, unknown>,
		signal: AbortSignal
	): Promise<void> {
		try {
			await this.execute(run, settings, signal);
		} catch (error) {
			console.error(`Orchestrator: run ${run.id} failed`, error);
			run.status = 'aborted';
			try {
				await this.storage.save(run);
			} catch (saveError) {
				console.error(`Orchestrator: failed to save aborted run ${run.id}`, saveError);
			}
			this.onProgress(structuredClone(run));
		}
	}

	private async execute(
		run: Run,
		settings: Record<string, unknown>,
		signal: AbortSignal
	): Promise<void> {
		const tasks: Task<unknown>[] = [];

		run.domains.forEach((domain, domainIndex) => {
			for (const id of run.enabledAnalyzers) {
				// Resume semantics: anything already ok is left alone.
				if (domain.analyzers[id]?.status === 'ok') continue;

				const analyzer = this.registry.get(id);
				// Every analyzer is told which site this run belongs to. An
				// analyzer that only reads the client's own data (measured
				// traffic) decides that from the run it is part of, rather than
				// from any process-wide notion of who the client currently is.
				const analyzerSettings = {
					...((settings[id] ?? analyzer.defaultSettings) as Record<string, unknown>),
					clientUrl: run.client
				};

				tasks.push({
					// Keyed by row index, not by domain name: two rows can hold
					// the same domain, and a name lookup would record both of
					// their results onto whichever row matched first, leaving
					// the other empty forever.
					key: `${domainIndex}::${id}`,
					concurrency: analyzer.concurrency,
					timeoutMs: analyzer.timeoutMs,
					run: async (taskSignal) => {
						const preflight = await analyzer.preflight(analyzerSettings);
						if (!preflight.available) {
							// The scheduler reports only a message string, so the prefix is
							// how "not installed" survives as a distinct fact from "crashed".
							// toAnalyzerResult below turns it back into an unavailable result.
							throw new Error(`UNAVAILABLE: ${preflight.reason}`);
						}
						return analyzer.analyze(domain.domain, analyzerSettings, taskSignal);
					}
				});
			}
		});

		// Tasks themselves still run concurrently (the scheduler's own
		// concurrency gates are untouched); only the recording of each result is
		// serialized. Concurrent tasks can settle within the same microtask
		// window (e.g. two near-instant analyzers on the same domain), and
		// without serializing this critical section a second task's mutation can
		// land before the first task's onProgress snapshot is taken, collapsing
		// "one done" into "two done" and hiding the incremental progress the
		// tests (and the UI) rely on. Chaining onSettled calls through a single
		// promise queue forces mutate -> save -> onProgress to complete for one
		// task before the next one begins recording.
		//
		// Each link is isolated with its own try/catch and the queue is advanced
		// past a rejected link via .catch(): a naive `queue = queue.then(fn)`
		// would let one rejection poison every later link permanently (a save
		// failure for task 2 would silently discard tasks 3..N forever), which
		// is strictly worse than not serializing at all. The in-memory mutation
		// happens unconditionally before the save is attempted, so a storage
		// failure loses only the durable copy for that one settle (the next
		// successful save, including the final one, catches it back up) and
		// never the result itself.
		let queue: Promise<void> = Promise.resolve();

		await runTasks(tasks, {
			parallelCap: PARALLEL_CAP,
			signal,
			onSettled: (task, result) => {
				queue = queue
					.then(async () => {
						const [index, analyzerId] = task.key.split('::') as [string, AnalyzerId];
						const domain = run.domains[Number(index)];
						if (!domain) return;

						domain.analyzers[analyzerId] = toAnalyzerResult(result);

						try {
							await this.storage.save(run);
						} catch (error) {
							// Surfaced, not swallowed: the result is still recorded in memory
							// and onProgress still fires below, but the failure to persist it
							// durably needs to be visible somewhere rather than silently
							// discarded.
							console.error(
								`Orchestrator: failed to save run ${run.id} after ${task.key} settled`,
								error
							);
						}

						this.onProgress(structuredClone(run));
					})
					.catch((error) => {
						// Belt-and-braces: even an error we didn't anticipate above must
						// not propagate into `queue` and block every task queued after it.
						console.error(`Orchestrator: unexpected error processing ${task.key}`, error);
					});
				return queue;
			}
		});

		run.status = signal.aborted ? 'aborted' : 'complete';
		await this.storage.save(run);
		this.onProgress(structuredClone(run));
	}
}

function toAnalyzerResult(result: SettledResult): AnalyzerResult {
	if (result.status === 'ok') {
		return { status: 'ok', data: result.value };
	}
	const error = result.error;
	// Preflight refusals arrive here carrying their reason; they are a different
	// fact from a crash and must not be flattened into failed.
	return error.startsWith('UNAVAILABLE:')
		? { status: 'unavailable', reason: error.slice('UNAVAILABLE:'.length).trim() }
		: { status: 'failed', error };
}
