import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Orchestrator, type StartInput } from './orchestrator';
import { RunStorage } from './storage';
import type { Run } from '../../src/lib/shared/types';
import { createRegistry } from '../analyzers/registry';
import type { Analyzer } from '../analyzers/types';

let dir: string;
let storage: RunStorage;

const analyzer = (id: string, overrides: Partial<Analyzer> = {}): Analyzer => ({
	id: id as Analyzer['id'],
	label: id,
	concurrency: 'parallel',
	timeoutMs: 1000,
	defaultSettings: {},
	preflight: async () => ({ available: true }),
	analyze: async () => ({ ran: id }),
	...overrides
});

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whr-orch-'));
	storage = new RunStorage(dir);
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

/**
 * start() now returns as soon as the run is persisted and drives the analyzers
 * in the background, so a test that cares about the finished run has to wait
 * for that background execution and read the run back.
 */
async function finish(orchestrator: Orchestrator, input: StartInput): Promise<Run> {
	const started = await orchestrator.start(input);
	await orchestrator.settled(started.id);
	return storage.load(started.id);
}

describe('Orchestrator', () => {
	it('runs every analyzer against every domain', async () => {
		const orchestrator = new Orchestrator(
			createRegistry([analyzer('keywords'), analyzer('wayback')]),
			storage,
			() => {}
		);

		const run = await finish(orchestrator, {
			client: 'https://client.com/',
			competitors: ['https://rival.com/'],
			enabledAnalyzers: ['keywords', 'wayback'],
			settings: {}
		});

		expect(run.status).toBe('complete');
		expect(run.domains).toHaveLength(2);
		for (const domain of run.domains) {
			expect(domain.analyzers.keywords?.status).toBe('ok');
			expect(domain.analyzers.wayback?.status).toBe('ok');
		}
	});

	it('marks the client and competitors with the right roles', async () => {
		const orchestrator = new Orchestrator(
			createRegistry([analyzer('keywords')]),
			storage,
			() => {}
		);
		const run = await finish(orchestrator, {
			client: 'https://client.com/',
			competitors: ['https://rival.com/'],
			enabledAnalyzers: ['keywords'],
			settings: {}
		});

		expect(run.domains.map((d) => d.role)).toEqual(['client', 'competitor']);
	});

	it('records unavailable when preflight fails, without calling analyze', async () => {
		let analyzeCalled = false;
		const orchestrator = new Orchestrator(
			createRegistry([
				analyzer('seoquake', {
					preflight: async () => ({ available: false, reason: 'extension not installed' }),
					analyze: async () => {
						analyzeCalled = true;
						return {};
					}
				})
			]),
			storage,
			() => {}
		);

		const run = await finish(orchestrator, {
			client: 'https://client.com/',
			competitors: [],
			enabledAnalyzers: ['seoquake'],
			settings: {}
		});

		expect(analyzeCalled).toBe(false);
		const result = run.domains[0].analyzers.seoquake;
		expect(result).toEqual({ status: 'unavailable', reason: 'extension not installed' });
	});

	it('keeps unavailable distinct from failed', async () => {
		const orchestrator = new Orchestrator(
			createRegistry([
				analyzer('keywords', {
					analyze: async () => {
						throw new Error('scrape blew up');
					}
				})
			]),
			storage,
			() => {}
		);

		const run = await finish(orchestrator, {
			client: 'https://client.com/',
			competitors: [],
			enabledAnalyzers: ['keywords'],
			settings: {}
		});

		expect(run.domains[0].analyzers.keywords?.status).toBe('failed');
	});

	it('one failing analyzer does not sink the others', async () => {
		const orchestrator = new Orchestrator(
			createRegistry([
				analyzer('keywords', {
					analyze: async () => {
						throw new Error('boom');
					}
				}),
				analyzer('wayback')
			]),
			storage,
			() => {}
		);

		const run = await finish(orchestrator, {
			client: 'https://client.com/',
			competitors: [],
			enabledAnalyzers: ['keywords', 'wayback'],
			settings: {}
		});

		expect(run.domains[0].analyzers.keywords?.status).toBe('failed');
		expect(run.domains[0].analyzers.wayback?.status).toBe('ok');
	});

	it('persists progress as tasks settle, not only at the end', async () => {
		const snapshots: number[] = [];
		const orchestrator = new Orchestrator(
			createRegistry([analyzer('keywords'), analyzer('wayback')]),
			storage,
			(run) => {
				snapshots.push(run.domains.reduce((n, d) => n + Object.keys(d.analyzers).length, 0));
			}
		);

		await finish(orchestrator, {
			client: 'https://client.com/',
			competitors: [],
			enabledAnalyzers: ['keywords', 'wayback'],
			settings: {}
		});

		expect(snapshots).toContain(1);
		expect(snapshots[snapshots.length - 1]).toBe(2);
	});

	it('resume re-runs only tasks that are not ok', async () => {
		let keywordRuns = 0;
		const registry = createRegistry([
			analyzer('keywords', {
				analyze: async () => {
					keywordRuns++;
					if (keywordRuns === 1) throw new Error('transient');
					return { ran: 'keywords' };
				}
			}),
			analyzer('wayback')
		]);

		const orchestrator = new Orchestrator(registry, storage, () => {});
		const first = await finish(orchestrator, {
			client: 'https://client.com/',
			competitors: [],
			enabledAnalyzers: ['keywords', 'wayback'],
			settings: {}
		});
		expect(first.domains[0].analyzers.keywords?.status).toBe('failed');

		const resumed = await orchestrator.resume(first.id, {});
		expect(resumed.status).toBe('running');

		await orchestrator.settled(first.id);
		const final = await storage.load(first.id);
		expect(final.domains[0].analyzers.keywords?.status).toBe('ok');
		expect(keywordRuns).toBe(2);
	});

	it('does not lose a result when storage.save fails partway through', async () => {
		const progressCalls: Run[] = [];
		const orchestrator = new Orchestrator(
			createRegistry([analyzer('keywords'), analyzer('wayback'), analyzer('security')]),
			storage,
			(run) => progressCalls.push(structuredClone(run))
		);

		// Make the second save call blow up, simulating a transient disk error.
		// A naive unguarded promise chain would let this rejection poison every
		// task queued after it, silently dropping their results.
		const originalSave = storage.save.bind(storage);
		let saveCalls = 0;
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		storage.save = async (run) => {
			saveCalls++;
			if (saveCalls === 2) {
				throw new Error('disk full');
			}
			return originalSave(run);
		};

		const run = await finish(orchestrator, {
			client: 'https://client.com/',
			competitors: [],
			enabledAnalyzers: ['keywords', 'wayback', 'security'],
			settings: {}
		});

		errorSpy.mockRestore();

		// The induced failure actually happened.
		expect(saveCalls).toBeGreaterThanOrEqual(2);

		// Every analyzer still has a recorded result on the in-memory run, even
		// though its corresponding save may have failed.
		expect(run.domains[0].analyzers.keywords?.status).toBe('ok');
		expect(run.domains[0].analyzers.wayback?.status).toBe('ok');
		expect(run.domains[0].analyzers.security?.status).toBe('ok');

		// onProgress kept firing for tasks that settled after the failing save:
		// a poisoned queue would have stalled and never reached a count of 3.
		const counts = progressCalls.map((r) =>
			r.domains.reduce((n, d) => n + Object.keys(d.analyzers).length, 0)
		);
		expect(Math.max(...counts)).toBe(3);
	});

	it('runs parallel analyzers concurrently, not serialized through the progress queue', async () => {
		const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
		const slow = (id: string) =>
			analyzer(id, {
				analyze: async () => {
					await sleep(50);
					return { ran: id };
				}
			});

		const orchestrator = new Orchestrator(
			createRegistry([slow('keywords'), slow('wayback'), slow('security')]),
			storage,
			() => {}
		);

		const started = Date.now();
		await finish(orchestrator, {
			client: 'https://client.com/',
			competitors: [],
			enabledAnalyzers: ['keywords', 'wayback', 'security'],
			settings: {}
		});
		const elapsed = Date.now() - started;

		// Three serialized 50ms tasks would take ~150ms. Running them
		// concurrently should finish well under that even with generous
		// scheduling overhead; this guards against the progress queue
		// accidentally serializing task execution itself.
		expect(elapsed).toBeLessThan(120);
	});

	it('returns the run before the analyzers have finished, so the grid can stream', async () => {
		let release: () => void = () => {};
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});

		const orchestrator = new Orchestrator(
			createRegistry([
				analyzer('keywords', {
					analyze: async () => {
						await blocked;
						return { ran: 'keywords' };
					}
				})
			]),
			storage,
			() => {}
		);

		const started = await orchestrator.start({
			client: 'https://client.com/',
			competitors: [],
			enabledAnalyzers: ['keywords'],
			settings: {}
		});

		// Still executing: start() must not have waited for the analyzer.
		expect(started.status).toBe('running');
		expect(started.domains[0].analyzers.keywords).toBeUndefined();

		release();
		await orchestrator.settled(started.id);
		expect((await storage.load(started.id)).status).toBe('complete');
	});

	it('emits progress events after start() has already returned', async () => {
		let release: () => void = () => {};
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});

		const afterReturn: Run[] = [];
		let returned = false;
		const orchestrator = new Orchestrator(
			createRegistry([
				analyzer('keywords', {
					analyze: async () => {
						await blocked;
						return { ran: 'keywords' };
					}
				})
			]),
			storage,
			(run) => {
				if (returned) afterReturn.push(run);
			}
		);

		const started = await orchestrator.start({
			client: 'https://client.com/',
			competitors: [],
			enabledAnalyzers: ['keywords'],
			settings: {}
		});
		returned = true;

		release();
		await orchestrator.settled(started.id);

		// Every event a subscriber that mounted after navigation would see.
		expect(afterReturn.length).toBeGreaterThan(0);
		expect(afterReturn[afterReturn.length - 1].domains[0].analyzers.keywords?.status).toBe('ok');
	});

	it('marks the run aborted instead of becoming an unhandled rejection', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const orchestrator = new Orchestrator(
			createRegistry([analyzer('keywords')]),
			storage,
			() => {}
		);

		// No analyzer is registered under this id, so execute() throws while
		// building tasks — the failure mode that has no caller to reject to.
		const started = await orchestrator.start({
			client: 'https://client.com/',
			competitors: [],
			enabledAnalyzers: ['wayback'],
			settings: {}
		});
		await orchestrator.settled(started.id);
		errorSpy.mockRestore();

		expect((await storage.load(started.id)).status).toBe('aborted');
	});

	it('cancelling a run ends it as aborted and stops tasks that have not started', async () => {
		let started = 0;
		let release: () => void = () => {};
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});

		const slow = (id: string) =>
			analyzer(id, {
				// 'limited' gates at two, so the third task is still queued when
				// the run is cancelled and must never start at all.
				concurrency: 'limited',
				analyze: async () => {
					started++;
					await blocked;
					return { ran: id };
				}
			});

		const orchestrator = new Orchestrator(
			createRegistry([slow('keywords'), slow('wayback'), slow('security')]),
			storage,
			() => {}
		);

		const run = await orchestrator.start({
			client: 'https://client.com/',
			competitors: [],
			enabledAnalyzers: ['keywords', 'wayback', 'security'],
			settings: {}
		});

		// Let the first two tasks take their slots.
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(started).toBe(2);

		const cancelled = orchestrator.cancel(run.id);
		release();
		await cancelled;

		const final = await storage.load(run.id);
		expect(final.status).toBe('aborted');
		// The queued task never ran, and no cancelled task was written down as
		// a failure — those cells stay pending so a resume picks them up.
		expect(started).toBe(2);
		for (const result of Object.values(final.domains[0].analyzers)) {
			expect(result.status).not.toBe('failed');
		}
	});

	it('aborts the analyzer signal when a run is cancelled', async () => {
		let aborted = false;
		const orchestrator = new Orchestrator(
			createRegistry([
				analyzer('keywords', {
					analyze: (_domain, _settings, signal) =>
						new Promise((resolve) => {
							signal.addEventListener('abort', () => {
								aborted = true;
								resolve({ ran: 'keywords' });
							});
						})
				})
			]),
			storage,
			() => {}
		);

		const run = await orchestrator.start({
			client: 'https://client.com/',
			competitors: [],
			enabledAnalyzers: ['keywords'],
			settings: {}
		});

		await new Promise((resolve) => setTimeout(resolve, 10));
		await orchestrator.cancel(run.id);

		expect(aborted).toBe(true);
		expect((await storage.load(run.id)).status).toBe('aborted');
	});

	it('a cancelled run can be resumed and finishes the work that was left', async () => {
		let release: () => void = () => {};
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		let calls = 0;

		const orchestrator = new Orchestrator(
			createRegistry([
				analyzer('keywords', {
					analyze: async () => {
						calls++;
						if (calls === 1) await blocked;
						return { ran: 'keywords' };
					}
				})
			]),
			storage,
			() => {}
		);

		const run = await orchestrator.start({
			client: 'https://client.com/',
			competitors: [],
			enabledAnalyzers: ['keywords'],
			settings: {}
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		const cancelled = orchestrator.cancel(run.id);
		release();
		await cancelled;

		await orchestrator.resume(run.id, {});
		await orchestrator.settled(run.id);

		const final = await storage.load(run.id);
		expect(final.status).toBe('complete');
		expect(final.domains[0].analyzers.keywords?.status).toBe('ok');
	});

	it('cancelling a run that is not in flight is a no-op', async () => {
		const orchestrator = new Orchestrator(
			createRegistry([analyzer('keywords')]),
			storage,
			() => {}
		);
		await expect(orchestrator.cancel('2026-01-01T000000-nothing')).resolves.toBeUndefined();
	});
});
