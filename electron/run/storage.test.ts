import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { RunStorage } from './storage';
import type { Run } from '../../src/lib/shared/types';

let dir: string;
let storage: RunStorage;

const run: Run = {
  id: '2026-09-02T081500-example-com',
  createdAt: '2026-09-02T08:15:00.000Z',
  client: 'https://example.com/',
  competitors: [],
  enabledAnalyzers: ['keywords'],
  status: 'running',
  domains: [{ domain: 'https://example.com/', role: 'client', analyzers: {} }]
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whr-'));
  storage = new RunStorage(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('RunStorage', () => {
  it('round-trips a run', async () => {
    await storage.save(run);
    expect(await storage.load(run.id)).toEqual(run);
  });

  it('overwrites on repeated save, so incremental writes converge', async () => {
    await storage.save(run);
    await storage.save({ ...run, status: 'complete' });
    expect((await storage.load(run.id)).status).toBe('complete');
  });

  it('leaves no temporary files behind', async () => {
    await storage.save(run);
    const entries = await fs.readdir(path.join(dir, 'runs'));
    expect(entries).toEqual([`${run.id}.json`]);
  });

  it('lists runs newest first', async () => {
    await storage.save({ ...run, id: 'a', createdAt: '2026-01-01T00:00:00.000Z' });
    await storage.save({ ...run, id: 'b', createdAt: '2026-06-01T00:00:00.000Z' });
    expect((await storage.list()).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('skips a corrupt run file rather than failing the whole listing', async () => {
    await storage.save(run);
    await fs.writeFile(path.join(dir, 'runs', 'broken.json'), '{ not json', 'utf-8');
    const listed = await storage.list();
    expect(listed.map((r) => r.id)).toEqual([run.id]);
  });

  it('throws a clear error when loading a missing run', async () => {
    await expect(storage.load('nope')).rejects.toThrow(/nope/);
  });

  it('handles concurrent saves of the same run without colliding', async () => {
    const statuses: Array<'running' | 'complete' | 'failed'> = ['running', 'complete', 'failed'];
    const saves = statuses.map((status) =>
      storage.save({ ...run, status })
    );
    await Promise.all(saves);

    // Load the run and verify it is a valid, complete object with one of the expected statuses
    const loaded = await storage.load(run.id);
    expect(loaded).toBeDefined();
    expect(typeof loaded === 'object').toBe(true);
    expect(loaded.id).toBe(run.id);
    expect(statuses).toContain(loaded.status);

    // Verify no temporary files are left behind
    const entries = await fs.readdir(path.join(dir, 'runs'));
    expect(entries).toEqual([`${run.id}.json`]);
  });
});
