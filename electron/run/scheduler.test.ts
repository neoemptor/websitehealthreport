import { describe, it, expect } from 'vitest';
import { runTasks, type Task } from './scheduler';

const settle = async (tasks: Task<unknown>[], parallelCap = 8) => {
	const seen: Array<[string, string]> = [];
	await runTasks(tasks, {
		parallelCap,
		onSettled: (t, r) => {
			seen.push([t.key, r.status]);
		}
	});
	return seen;
};

const task = (
	key: string,
	concurrency: Task<unknown>['concurrency'],
	run: Task<unknown>['run'],
	timeoutMs = 1000
): Task<unknown> => ({ key, concurrency, timeoutMs, run });

describe('runTasks', () => {
	it('runs every task and reports each one', async () => {
		const seen = await settle([
			task('a', 'parallel', async () => 1),
			task('b', 'parallel', async () => 2)
		]);
		expect(seen.sort()).toEqual([
			['a', 'ok'],
			['b', 'ok']
		]);
	});

	it('does not let one failing task stop the others', async () => {
		const seen = await settle([
			task('bad', 'parallel', async () => {
				throw new Error('boom');
			}),
			task('good', 'parallel', async () => 1)
		]);
		expect(seen.sort()).toEqual([
			['bad', 'failed'],
			['good', 'ok']
		]);
	});

	it('never runs two serial tasks at once', async () => {
		let active = 0;
		let maxActive = 0;
		const serial = (key: string) =>
			task(key, 'serial', async () => {
				active++;
				maxActive = Math.max(maxActive, active);
				await new Promise((r) => setTimeout(r, 10));
				active--;
				return null;
			});

		await settle([serial('s1'), serial('s2'), serial('s3')]);
		expect(maxActive).toBe(1);
	});

	it('runs at most two limited tasks at once', async () => {
		let active = 0;
		let maxActive = 0;
		const limited = (key: string) =>
			task(key, 'limited', async () => {
				active++;
				maxActive = Math.max(maxActive, active);
				await new Promise((r) => setTimeout(r, 10));
				active--;
				return null;
			});

		await settle([limited('l1'), limited('l2'), limited('l3'), limited('l4')]);
		expect(maxActive).toBe(2);
	});

	it('runs nothing else while an exclusive task runs', async () => {
		// The point of the mode: an analyzer whose result is a timing
		// measurement must not share the CPU with the rest of the run.
		let active = 0;
		let seenDuringExclusive = 0;
		const track = (exclusive: boolean) => async (): Promise<null> => {
			active++;
			if (exclusive) seenDuringExclusive = Math.max(seenDuringExclusive, active);
			await new Promise((r) => setTimeout(r, 10));
			active--;
			return null;
		};

		const seen = await settle([
			task('p1', 'parallel', track(false)),
			task('p2', 'parallel', track(false)),
			task('x', 'exclusive', track(true)),
			task('s1', 'serial', track(false)),
			task('l1', 'limited', track(false))
		]);

		expect(seenDuringExclusive).toBe(1);
		expect(seen).toHaveLength(5);
		expect(seen.every(([, status]) => status === 'ok')).toBe(true);
	});

	it('never runs two exclusive tasks at once', async () => {
		let active = 0;
		let maxActive = 0;
		const exclusive = (key: string) =>
			task(key, 'exclusive', async () => {
				active++;
				maxActive = Math.max(maxActive, active);
				await new Promise((r) => setTimeout(r, 10));
				active--;
				return null;
			});

		await settle([exclusive('x1'), exclusive('x2'), exclusive('x3')]);
		expect(maxActive).toBe(1);
	});

	it('does not let a stream of parallel tasks starve an exclusive one', async () => {
		// Admitting readers whenever no writer holds the lock would leave the
		// exclusive task waiting for a gap that a busy run never has.
		const order: string[] = [];
		const slow = (key: string, concurrency: Task<unknown>['concurrency']) =>
			task(key, concurrency, async () => {
				await new Promise((r) => setTimeout(r, 5));
				order.push(key);
				return null;
			});

		const tasks = [
			slow('p1', 'parallel'),
			slow('p2', 'parallel'),
			slow('x', 'exclusive'),
			...Array.from({ length: 20 }, (_, i) => slow(`later${i}`, 'parallel'))
		];

		await settle(tasks);

		// Queued before the twenty that came after it, not behind them.
		expect(order.indexOf('x')).toBeLessThan(order.indexOf('later0'));
	});

	it('times out a hanging task as failed rather than hanging the run', async () => {
		const seen = await settle([
			task('hang', 'parallel', () => new Promise(() => {}), 20),
			task('quick', 'parallel', async () => 1)
		]);
		expect(seen.sort()).toEqual([
			['hang', 'failed'],
			['quick', 'ok']
		]);
	});

	it('aborts the signal it handed to a timed-out task', async () => {
		let aborted = false;
		await settle([
			task(
				'hang',
				'parallel',
				(signal) =>
					new Promise((_, reject) => {
						signal.addEventListener('abort', () => {
							aborted = true;
							reject(new Error('aborted'));
						});
					}),
				20
			)
		]);
		expect(aborted).toBe(true);
	});
});
