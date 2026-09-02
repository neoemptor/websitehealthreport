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

export class Orchestrator {
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

    await this.storage.save(run);
    return this.execute(run, input.settings);
  }

  async resume(id: string, settings: Record<string, unknown>): Promise<Run> {
    const run = await this.storage.load(id);
    run.status = 'running';
    return this.execute(run, settings);
  }

  private async execute(run: Run, settings: Record<string, unknown>): Promise<Run> {
    const tasks: Task<unknown>[] = [];

    for (const domain of run.domains) {
      for (const id of run.enabledAnalyzers) {
        // Resume semantics: anything already ok is left alone.
        if (domain.analyzers[id]?.status === 'ok') continue;

        const analyzer = this.registry.get(id);
        const analyzerSettings = settings[id] ?? analyzer.defaultSettings;

        tasks.push({
          key: `${domain.domain}::${id}`,
          concurrency: analyzer.concurrency,
          timeoutMs: analyzer.timeoutMs,
          run: async (signal) => {
            const preflight = await analyzer.preflight(analyzerSettings);
            if (!preflight.available) {
              // The scheduler reports only a message string, so the prefix is
              // how "not installed" survives as a distinct fact from "crashed".
              // toAnalyzerResult below turns it back into an unavailable result.
              throw new Error(`UNAVAILABLE: ${preflight.reason}`);
            }
            return analyzer.analyze(domain.domain, analyzerSettings, signal);
          }
        });
      }
    }

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
      onSettled: (task, result) => {
        queue = queue.then(async () => {
          const [domainName, analyzerId] = task.key.split('::') as [string, AnalyzerId];
          const domain = run.domains.find((d) => d.domain === domainName);
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
        }).catch((error) => {
          // Belt-and-braces: even an error we didn't anticipate above must
          // not propagate into `queue` and block every task queued after it.
          console.error(`Orchestrator: unexpected error processing ${task.key}`, error);
        });
        return queue;
      }
    });

    run.status = 'complete';
    await this.storage.save(run);
    this.onProgress(structuredClone(run));
    return run;
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
