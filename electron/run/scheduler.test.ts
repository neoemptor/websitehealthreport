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
    expect(seen.sort()).toEqual([['a', 'ok'], ['b', 'ok']]);
  });

  it('does not let one failing task stop the others', async () => {
    const seen = await settle([
      task('bad', 'parallel', async () => {
        throw new Error('boom');
      }),
      task('good', 'parallel', async () => 1)
    ]);
    expect(seen.sort()).toEqual([['bad', 'failed'], ['good', 'ok']]);
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

  it('times out a hanging task as failed rather than hanging the run', async () => {
    const seen = await settle([
      task('hang', 'parallel', () => new Promise(() => {}), 20),
      task('quick', 'parallel', async () => 1)
    ]);
    expect(seen.sort()).toEqual([['hang', 'failed'], ['quick', 'ok']]);
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
