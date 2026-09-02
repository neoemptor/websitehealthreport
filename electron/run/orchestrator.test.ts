import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { Orchestrator } from './orchestrator';
import { RunStorage } from './storage';
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

describe('Orchestrator', () => {
  it('runs every analyzer against every domain', async () => {
    const orchestrator = new Orchestrator(
      createRegistry([analyzer('keywords'), analyzer('wayback')]),
      storage,
      () => {}
    );

    const run = await orchestrator.start({
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
    const orchestrator = new Orchestrator(createRegistry([analyzer('keywords')]), storage, () => {});
    const run = await orchestrator.start({
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

    const run = await orchestrator.start({
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

    const run = await orchestrator.start({
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

    const run = await orchestrator.start({
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
        snapshots.push(
          run.domains.reduce((n, d) => n + Object.keys(d.analyzers).length, 0)
        );
      }
    );

    await orchestrator.start({
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
    const first = await orchestrator.start({
      client: 'https://client.com/',
      competitors: [],
      enabledAnalyzers: ['keywords', 'wayback'],
      settings: {}
    });
    expect(first.domains[0].analyzers.keywords?.status).toBe('failed');

    const resumed = await orchestrator.resume(first.id, {});
    expect(resumed.domains[0].analyzers.keywords?.status).toBe('ok');
    expect(keywordRuns).toBe(2);
  });
});
