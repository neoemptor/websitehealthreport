# Website Health Report — Foundation and First Analyzers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the SvelteKit + Tauri skeleton into a working Electron desktop app that runs Lighthouse and Keyword analysis against a client domain plus competitors, shows results live, stores every run, and exports a PDF.

**Architecture:** Three processes. Electron main (Node) owns analyzers, orchestration, storage and PDF. The renderer is the existing SvelteKit `adapter-static` build loaded into a `BrowserWindow` with no Node access. A preload script exposes one typed API over `contextBridge`. Analyzers implement a shared contract and are split into an I/O half and a pure `parse` half, so all logic is unit-testable against fixtures.

**Tech Stack:** Electron 33, electron-builder, SvelteKit 1.x + `adapter-static`, TypeScript 5, Vitest, `lighthouse` npm package, `chrome-launcher`, Puppeteer 21.

**Spec:** `docs/superpowers/specs/2026-09-02-website-health-report-design.md`

## Global Constraints

- Target platforms: Windows (win32), Linux, macOS Apple Silicon (darwin-arm64).
- No native Node modules. Anything requiring `electron-rebuild` is disallowed — this is why storage is JSON files, not SQLite.
- Renderer runs with `nodeIntegration: false` and `contextIsolation: true`. It has no filesystem, network or process access. All privileged work happens in main.
- Credentials are never written to `settings.json` and never sent over IPC. Not exercised in this plan — no analyzer here needs credentials — but the boundary must not be violated by any code added here.
- Analyzer results are one of exactly three shapes: `ok`, `unavailable` (dependency missing), `failed` (ran and threw). `unavailable` and `failed` must never be collapsed.
- Every Puppeteer browser and page is closed in a `finally` block.
- Run ids use `YYYY-MM-DDTHHMMSS`, never full ISO 8601 — the id is a filename and Windows forbids colons.
- Only `http:` and `https:` URLs are accepted, validated before any analyzer receives a domain.
- Security analysis is passive only. No task in any plan performs active scanning.
- All new code is TypeScript under `strict: true`, matching the existing `tsconfig.json`.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `src/lib/shared/types.ts` | `Run`, `DomainResult`, `AnalyzerResult`, `AnalyzerId`. Imported by main *and* renderer. |
| `src/lib/shared/url.ts` | `normaliseDomain`, `isSafeUrl`. Pure. |
| `electron/main.ts` | App lifecycle, window creation. |
| `electron/preload.ts` | `contextBridge` API surface. |
| `electron/ipc.ts` | IPC handler registration. |
| `electron/logger.ts` | Structured logging to `<userData>/logs/`. |
| `electron/analyzers/types.ts` | The `Analyzer` interface. |
| `electron/analyzers/registry.ts` | Analyzer lookup by id. |
| `electron/analyzers/lighthouse/{index,parse}.ts` | Lighthouse analyzer. |
| `electron/analyzers/keywords/{index,parse}.ts` | Keywords analyzer. |
| `electron/run/storage.ts` | Atomic run persistence. |
| `electron/run/scheduler.ts` | Concurrency-aware task queue. |
| `electron/run/orchestrator.ts` | Expands a run into tasks, drives the scheduler, persists. |
| `electron/settings/store.ts` | Settings read/write. |
| `src/routes/run/[id]/+page.svelte` | Live run grid. |
| `src/routes/runs/+page.svelte` | Run history. |
| `src/routes/report/[id]/+page.svelte` | Printable report (screen and PDF). |
| `src/routes/settings/+page.svelte` | Settings screen. |
| `fixtures/lighthouse-cjsgaragedoors.json` | Real captured LHR, moved from repo root. |

**Deleted:** `src-tauri/`, `src/hooks.server.ts`, `src/lib/server/Competitor.ts`, `src/lib/index.ts`.

**Moved into analyzers:** `src/lib/server/{Keyword,LHData,FileHandler,SEOQData,WBMData}.ts`. `SEOQData` and `WBMData` are carried forward untouched in this plan and reshaped in plans 2 and 3.

---

### Task 1: Test infrastructure

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/shared/url.ts`
- Test: `src/lib/shared/url.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `normaliseDomain(input: string): string` — throws `Error` on invalid input. `isSafeUrl(value: string): boolean`.

- [ ] **Step 1: Add Vitest**

```bash
npm install --save-dev vitest@^2
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'electron/**/*.test.ts'],
    environment: 'node'
  }
});
```

- [ ] **Step 3: Add the test script to `package.json`**

Add to `"scripts"`: `"test": "vitest run"` and `"test:watch": "vitest"`.

- [ ] **Step 4: Write the failing test**

Create `src/lib/shared/url.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normaliseDomain, isSafeUrl } from './url';

describe('normaliseDomain', () => {
  it('adds https and a trailing slash to a bare domain', () => {
    expect(normaliseDomain('cjsgaragedoors.com.au')).toBe('https://cjsgaragedoors.com.au/');
  });

  it('preserves an existing https URL', () => {
    expect(normaliseDomain('https://www.cjsgaragedoors.com.au/')).toBe('https://www.cjsgaragedoors.com.au/');
  });

  it('preserves http rather than upgrading it', () => {
    expect(normaliseDomain('http://example.com/')).toBe('http://example.com/');
  });

  it('trims surrounding whitespace', () => {
    expect(normaliseDomain('  example.com  ')).toBe('https://example.com/');
  });

  it('rejects a non-http scheme', () => {
    expect(() => normaliseDomain('ftp://example.com')).toThrow(/http/);
  });

  it('rejects an empty string', () => {
    expect(() => normaliseDomain('   ')).toThrow();
  });

  it('rejects a value that would be read as a CLI flag', () => {
    expect(() => normaliseDomain('--output=/etc/passwd')).toThrow();
  });
});

describe('isSafeUrl', () => {
  it('accepts https', () => {
    expect(isSafeUrl('https://example.com/')).toBe(true);
  });

  it('rejects file urls', () => {
    expect(isSafeUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects unparseable input', () => {
    expect(isSafeUrl('not a url')).toBe(false);
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `npx vitest run src/lib/shared/url.test.ts`
Expected: FAIL — cannot resolve `./url`.

- [ ] **Step 6: Write the implementation**

Create `src/lib/shared/url.ts`:

```ts
export function isSafeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function normaliseDomain(input: string): string {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error('Domain is empty.');
  }

  // An explicit guard is required: new URL('https://--output=/etc/passwd')
  // parses successfully, with hostname "--output=". Relying on isSafeUrl alone
  // would let a CLI-flag-shaped value through. No real DNS label starts with
  // a hyphen, so nothing legitimate is rejected here.
  if (trimmed.startsWith('-')) {
    throw new Error(`${input} is not a valid http or https URL.`);
  }

  // A bare domain gets https. Anything already carrying a scheme keeps it,
  // so an explicit http:// is not silently upgraded.
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

  if (!isSafeUrl(candidate)) {
    throw new Error(`${input} is not a valid http or https URL.`);
  }

  return new URL(candidate).toString();
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/lib/shared/url.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/shared/
git commit -m "Add Vitest and shared URL normalisation"
```

---

### Task 2: Shared result and run types

**Files:**
- Create: `src/lib/shared/types.ts`
- Test: `src/lib/shared/types.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AnalyzerId`, `AnalyzerResult`, `DomainResult`, `Run`, and the type guards `isOk`, `isUnavailable`, `isFailed`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/shared/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isOk, isUnavailable, isFailed, type AnalyzerResult } from './types';

const ok: AnalyzerResult = { status: 'ok', data: { score: 1 } };
const unavailable: AnalyzerResult = { status: 'unavailable', reason: 'not installed' };
const failed: AnalyzerResult = { status: 'failed', error: 'boom' };

describe('result guards', () => {
  it('distinguishes ok', () => {
    expect(isOk(ok)).toBe(true);
    expect(isOk(unavailable)).toBe(false);
    expect(isOk(failed)).toBe(false);
  });

  it('distinguishes unavailable from failed', () => {
    expect(isUnavailable(unavailable)).toBe(true);
    expect(isUnavailable(failed)).toBe(false);
    expect(isFailed(failed)).toBe(true);
    expect(isFailed(unavailable)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/shared/types.test.ts`
Expected: FAIL — cannot resolve `./types`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/shared/types.ts`:

```ts
export type AnalyzerId =
  | 'lighthouse'
  | 'keywords'
  | 'seoquake'
  | 'wayback'
  | 'security'
  | 'aeo'
  | 'content'
  | 'traffic-owned'
  | 'traffic-estimated';

export type AnalyzerResult =
  | { status: 'ok'; data: unknown }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; error: string };

export type DomainRole = 'client' | 'competitor';

export type DomainResult = {
  domain: string;
  role: DomainRole;
  analyzers: Partial<Record<AnalyzerId, AnalyzerResult>>;
};

export type RunStatus = 'running' | 'complete' | 'aborted';

export type Run = {
  id: string;
  createdAt: string;
  client: string;
  competitors: string[];
  enabledAnalyzers: AnalyzerId[];
  status: RunStatus;
  domains: DomainResult[];
};

export function isOk(r: AnalyzerResult): r is { status: 'ok'; data: unknown } {
  return r.status === 'ok';
}

export function isUnavailable(r: AnalyzerResult): r is { status: 'unavailable'; reason: string } {
  return r.status === 'unavailable';
}

export function isFailed(r: AnalyzerResult): r is { status: 'failed'; error: string } {
  return r.status === 'failed';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/shared/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/shared/types.ts src/lib/shared/types.test.ts
git commit -m "Add shared run and analyzer result types"
```

---

### Task 3: Run id generation

**Files:**
- Create: `electron/run/id.ts`
- Test: `electron/run/id.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `makeRunId(clientUrl: string, now: Date): string`.

- [ ] **Step 1: Write the failing test**

Create `electron/run/id.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeRunId } from './id';

describe('makeRunId', () => {
  it('formats the timestamp without colons so it is a valid Windows filename', () => {
    const id = makeRunId('https://cjsgaragedoors.com.au/', new Date('2026-09-02T08:15:00Z'));
    expect(id).toBe('2026-09-02T081500-cjsgaragedoors-com-au');
    expect(id).not.toContain(':');
  });

  it('strips www and the scheme from the host', () => {
    const id = makeRunId('https://www.example.com/path', new Date('2026-01-05T00:00:00Z'));
    expect(id).toBe('2026-01-05T000000-example-com');
  });

  it('contains no characters Windows forbids in filenames', () => {
    const id = makeRunId('https://a-b.example.com/', new Date('2026-12-31T23:59:59Z'));
    expect(id).not.toMatch(/[<>:"/\\|?*]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/run/id.test.ts`
Expected: FAIL — cannot resolve `./id`.

- [ ] **Step 3: Write the implementation**

Create `electron/run/id.ts`:

```ts
export function makeRunId(clientUrl: string, now: Date): string {
  // Colons are legal in ISO 8601 and illegal in Windows filenames, and this id
  // is used as a filename. The full timestamp is kept in Run.createdAt.
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '');

  const host = new URL(clientUrl).hostname
    .replace(/^www\./, '')
    .replace(/[^a-zA-Z0-9]+/g, '-');

  return `${stamp}-${host}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/run/id.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/run/id.ts electron/run/id.test.ts
git commit -m "Add Windows-safe run id generation"
```

---

### Task 4: Run storage

**Files:**
- Create: `electron/run/storage.ts`
- Test: `electron/run/storage.test.ts`

**Interfaces:**
- Consumes: `Run` from `src/lib/shared/types.ts`.
- Produces: `class RunStorage` with `constructor(rootDir: string)`, `save(run: Run): Promise<void>`, `load(id: string): Promise<Run>`, `list(): Promise<Run[]>` (newest first, corrupt files skipped).

- [ ] **Step 1: Write the failing test**

Create `electron/run/storage.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/run/storage.test.ts`
Expected: FAIL — cannot resolve `./storage`.

- [ ] **Step 3: Write the implementation**

Create `electron/run/storage.ts`:

```ts
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Run } from '../../src/lib/shared/types';

// The temp path must be unique per call, not per process. The orchestrator
// saves from up to 8 concurrent tasks against the same run id, so a pid-only
// suffix would let one call's write clobber another's temp file before its
// rename — defeating the whole point of writing to a temp file.
let tempCounter = 0;
const nextTempId = (): number => ++tempCounter;

export class RunStorage {
  private readonly runsDir: string;

  constructor(rootDir: string) {
    this.runsDir = path.join(rootDir, 'runs');
  }

  async save(run: Run): Promise<void> {
    await fs.mkdir(this.runsDir, { recursive: true });

    // Write to a temporary file and rename. Rename is atomic on all three
    // target platforms, so an interrupted write cannot leave a partial run.
    const target = path.join(this.runsDir, `${run.id}.json`);
    const temp = `${target}.${process.pid}.${nextTempId()}.tmp`;

    await fs.writeFile(temp, JSON.stringify(run, null, 2), 'utf-8');
    await fs.rename(temp, target);
  }

  async load(id: string): Promise<Run> {
    const target = path.join(this.runsDir, `${id}.json`);
    try {
      return JSON.parse(await fs.readFile(target, 'utf-8')) as Run;
    } catch (cause) {
      throw new Error(`Could not load run ${id}: ${(cause as Error).message}`);
    }
  }

  async list(): Promise<Run[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.runsDir);
    } catch {
      return [];
    }

    const runs: Run[] = [];
    for (const entry of entries.filter((e) => e.endsWith('.json'))) {
      try {
        runs.push(JSON.parse(await fs.readFile(path.join(this.runsDir, entry), 'utf-8')) as Run);
      } catch {
        // A corrupt file must not sink the whole listing.
      }
    }

    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/run/storage.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/run/storage.ts electron/run/storage.test.ts
git commit -m "Add atomic JSON run storage"
```

---

### Task 5: Analyzer contract and registry

**Files:**
- Create: `electron/analyzers/types.ts`
- Create: `electron/analyzers/registry.ts`
- Test: `electron/analyzers/registry.test.ts`

**Interfaces:**
- Consumes: `AnalyzerId` from shared types.
- Produces: `interface Analyzer<TSettings>`, `type Concurrency = 'parallel' | 'limited' | 'serial'`, `type Preflight`, and `createRegistry(analyzers: Analyzer[]): Registry` with `get(id)`, `all()`, `ids()`.

- [ ] **Step 1: Write the failing test**

Create `electron/analyzers/registry.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createRegistry } from './registry';
import type { Analyzer } from './types';

const fake = (id: string): Analyzer => ({
  id: id as Analyzer['id'],
  label: id,
  concurrency: 'parallel',
  timeoutMs: 1000,
  defaultSettings: {},
  preflight: async () => ({ available: true }),
  analyze: async () => ({})
});

describe('createRegistry', () => {
  it('returns an analyzer by id', () => {
    const registry = createRegistry([fake('keywords')]);
    expect(registry.get('keywords').label).toBe('keywords');
  });

  it('throws on an unknown id rather than returning undefined', () => {
    const registry = createRegistry([fake('keywords')]);
    expect(() => registry.get('lighthouse')).toThrow(/lighthouse/);
  });

  it('rejects duplicate registrations', () => {
    expect(() => createRegistry([fake('keywords'), fake('keywords')])).toThrow(/duplicate/i);
  });

  it('lists ids in registration order', () => {
    const registry = createRegistry([fake('lighthouse'), fake('keywords')]);
    expect(registry.ids()).toEqual(['lighthouse', 'keywords']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/analyzers/registry.test.ts`
Expected: FAIL — cannot resolve `./registry`.

- [ ] **Step 3: Write `electron/analyzers/types.ts`**

```ts
import type { AnalyzerId } from '../../src/lib/shared/types';

export type Concurrency = 'parallel' | 'limited' | 'serial';

export type Preflight = { available: true } | { available: false; reason: string };

export interface Analyzer<TSettings = unknown> {
  id: AnalyzerId;
  label: string;
  /** parallel: unbounded. limited: semaphore of 2. serial: global lock. */
  concurrency: Concurrency;
  timeoutMs: number;
  defaultSettings: TSettings;
  preflight(settings: TSettings): Promise<Preflight>;
  analyze(domain: string, settings: TSettings, signal: AbortSignal): Promise<unknown>;
}
```

- [ ] **Step 4: Write `electron/analyzers/registry.ts`**

```ts
import type { AnalyzerId } from '../../src/lib/shared/types';
import type { Analyzer } from './types';

export type Registry = {
  get(id: AnalyzerId): Analyzer;
  all(): Analyzer[];
  ids(): AnalyzerId[];
};

export function createRegistry(analyzers: Analyzer[]): Registry {
  const byId = new Map<AnalyzerId, Analyzer>();

  for (const analyzer of analyzers) {
    if (byId.has(analyzer.id)) {
      throw new Error(`Duplicate analyzer registration: ${analyzer.id}`);
    }
    byId.set(analyzer.id, analyzer);
  }

  return {
    get(id) {
      const found = byId.get(id);
      if (!found) {
        throw new Error(`No analyzer registered with id ${id}`);
      }
      return found;
    },
    all: () => [...byId.values()],
    ids: () => [...byId.keys()]
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run electron/analyzers/registry.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add electron/analyzers/
git commit -m "Add analyzer contract and registry"
```

---

### Task 6: Scheduler

**Files:**
- Create: `electron/run/scheduler.ts`
- Test: `electron/run/scheduler.test.ts`

**Interfaces:**
- Consumes: `Concurrency` from `electron/analyzers/types.ts`.
- Produces: `runTasks<T>(tasks: Task<T>[], opts: { parallelCap: number; onSettled: (t: Task<T>, r: SettledResult) => void | Promise<void> }): Promise<void>`, where `Task<T> = { key: string; concurrency: Concurrency; timeoutMs: number; run: (signal: AbortSignal) => Promise<T> }` and `SettledResult = { status: 'ok'; value: unknown } | { status: 'failed'; error: string }`.

- [ ] **Step 1: Write the failing test**

Create `electron/run/scheduler.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/run/scheduler.test.ts`
Expected: FAIL — cannot resolve `./scheduler`.

- [ ] **Step 3: Write the implementation**

Create `electron/run/scheduler.ts`:

```ts
import type { Concurrency } from '../analyzers/types';

export type Task<T> = {
  key: string;
  concurrency: Concurrency;
  timeoutMs: number;
  run: (signal: AbortSignal) => Promise<T>;
};

export type SettledResult =
  | { status: 'ok'; value: unknown }
  | { status: 'failed'; error: string };

export type RunTasksOptions<T> = {
  parallelCap: number;
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

async function settle<T>(task: Task<T>): Promise<SettledResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), task.timeoutMs);

  try {
    const value = await Promise.race([
      task.run(controller.signal),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () =>
          reject(new Error(`Timed out after ${task.timeoutMs}ms`))
        );
      })
    ]);
    return { status: 'ok', value };
  } catch (error) {
    return { status: 'failed', error: (error as Error).message };
  } finally {
    clearTimeout(timer);
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
      const gate = gates[task.concurrency];
      await gate.acquire();
      try {
        const result = await settle(task);
        await opts.onSettled(task, result);
      } finally {
        gate.release();
      }
    })
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/run/scheduler.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/run/scheduler.ts electron/run/scheduler.test.ts
git commit -m "Add concurrency-aware task scheduler"
```

---

### Task 7: Orchestrator

**Files:**
- Create: `electron/run/orchestrator.ts`
- Test: `electron/run/orchestrator.test.ts`

**Interfaces:**
- Consumes: `Registry`, `RunStorage`, `runTasks`, `makeRunId`, shared types.
- Produces: `class Orchestrator` with `constructor(registry: Registry, storage: RunStorage, onProgress: (run: Run) => void)`, `start(input: { client: string; competitors: string[]; enabledAnalyzers: AnalyzerId[]; settings: Record<string, unknown> }): Promise<Run>`, `resume(id: string, settings: Record<string, unknown>): Promise<Run>`.

- [ ] **Step 1: Write the failing test**

Create `electron/run/orchestrator.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/run/orchestrator.test.ts`
Expected: FAIL — cannot resolve `./orchestrator`.

- [ ] **Step 3: Write the implementation**

Create `electron/run/orchestrator.ts`:

```ts
import type { AnalyzerId, AnalyzerResult, DomainResult, Run } from '../../src/lib/shared/types';
import type { Registry } from '../analyzers/registry';
import { makeRunId } from './id';
import { runTasks, type Task } from './scheduler';
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

    // The record/save/notify section is serialised through a single promise
    // chain. Without this, two fast concurrent analyzers on the same domain
    // both mutate `run` before either onProgress fires, and the caller sees
    // snapshots like [2,2,2] instead of [1,2]. Only this critical section is
    // serialised — the analyzer tasks themselves still run concurrently.
    //
    // Each link catches its own errors. A bare `queue = queue.then(fn)` is
    // poisoned permanently by the first rejection: one storage failure would
    // silently drop every result that settles afterwards.
    let queue: Promise<void> = Promise.resolve();

    await runTasks(tasks, {
      parallelCap: PARALLEL_CAP,
      onSettled: (task, result) => {
        queue = queue
          .then(async () => {
            const [domainName, analyzerId] = task.key.split('::') as [string, AnalyzerId];
            const domain = run.domains.find((d) => d.domain === domainName);
            if (!domain) return;

            // Recorded in memory first: losing the durable copy is
            // survivable, losing the result is not.
            domain.analyzers[analyzerId] = toAnalyzerResult(result);

            try {
              await this.storage.save(run);
            } catch (error) {
              console.error(
                `Orchestrator: failed to save run ${run.id} after ${task.key} settled`,
                error
              );
            }

            this.onProgress(structuredClone(run));
          })
          .catch((error) => {
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

function toAnalyzerResult(result: { status: string; value?: unknown; error?: string }): AnalyzerResult {
  if (result.status === 'ok') {
    return { status: 'ok', data: result.value };
  }
  const error = result.error ?? 'Unknown error';
  // Preflight refusals arrive here carrying their reason; they are a different
  // fact from a crash and must not be flattened into failed.
  return error.startsWith('UNAVAILABLE:')
    ? { status: 'unavailable', reason: error.slice('UNAVAILABLE:'.length).trim() }
    : { status: 'failed', error };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/run/orchestrator.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/run/orchestrator.ts electron/run/orchestrator.test.ts
git commit -m "Add run orchestrator with preflight and resume"
```

---

### Task 8: Lighthouse analyzer

**Files:**
- Create: `electron/analyzers/lighthouse/parse.ts`
- Create: `electron/analyzers/lighthouse/index.ts`
- Test: `electron/analyzers/lighthouse/parse.test.ts`
- Move: `https___www_cjsgaragedoors_com_au_.json` → `fixtures/lighthouse-cjsgaragedoors.json`

**Interfaces:**
- Consumes: `Analyzer` from `electron/analyzers/types.ts`.
- Produces: `parseLighthouse(lhr: unknown): LighthouseData` where `LighthouseData = { scores: { performance: number; accessibility: number; bestPractices: number; seo: number }; metrics: { lcpMs: number; cls: number; tbtMs: number } }`, and `lighthouseAnalyzer: Analyzer<{ formFactor: 'mobile' | 'desktop' }>`.

- [ ] **Step 1: Move the fixture**

```bash
mkdir -p fixtures
git mv https___www_cjsgaragedoors_com_au_.json fixtures/lighthouse-cjsgaragedoors.json
```

- [ ] **Step 2: Write the failing test**

Create `electron/analyzers/lighthouse/parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseLighthouse } from './parse';

const lhr = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../fixtures/lighthouse-cjsgaragedoors.json'), 'utf-8')
);

describe('parseLighthouse', () => {
  it('extracts the four category scores as percentages', () => {
    const { scores } = parseLighthouse(lhr);
    for (const value of Object.values(scores)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(100);
    }
  });

  it('extracts core web vitals', () => {
    const { metrics } = parseLighthouse(lhr);
    expect(metrics.lcpMs).toBeGreaterThan(0);
    expect(metrics.cls).toBeGreaterThanOrEqual(0);
    expect(metrics.tbtMs).toBeGreaterThanOrEqual(0);
  });

  it('throws a clear error on a non-Lighthouse object', () => {
    expect(() => parseLighthouse({ nope: true })).toThrow(/lighthouse/i);
  });

  it('throws rather than returning NaN when a category is missing', () => {
    expect(() => parseLighthouse({ categories: {}, audits: {} })).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run electron/analyzers/lighthouse/parse.test.ts`
Expected: FAIL — cannot resolve `./parse`.

- [ ] **Step 4: Write `parse.ts`**

```ts
export type LighthouseData = {
  scores: { performance: number; accessibility: number; bestPractices: number; seo: number };
  metrics: { lcpMs: number; cls: number; tbtMs: number };
};

type Lhr = {
  categories?: Record<string, { score?: number | null }>;
  audits?: Record<string, { numericValue?: number }>;
};

function score(lhr: Lhr, key: string): number {
  const raw = lhr.categories?.[key]?.score;
  if (typeof raw !== 'number') {
    throw new Error(`Lighthouse result is missing the ${key} category score.`);
  }
  return Math.round(raw * 100);
}

function metric(lhr: Lhr, key: string): number {
  const raw = lhr.audits?.[key]?.numericValue;
  if (typeof raw !== 'number') {
    throw new Error(`Lighthouse result is missing the ${key} audit.`);
  }
  return raw;
}

export function parseLighthouse(input: unknown): LighthouseData {
  const lhr = input as Lhr;
  if (!lhr || typeof lhr !== 'object' || !lhr.categories) {
    throw new Error('Not a Lighthouse result: no categories present.');
  }

  return {
    scores: {
      performance: score(lhr, 'performance'),
      accessibility: score(lhr, 'accessibility'),
      bestPractices: score(lhr, 'best-practices'),
      seo: score(lhr, 'seo')
    },
    metrics: {
      lcpMs: metric(lhr, 'largest-contentful-paint'),
      cls: metric(lhr, 'cumulative-layout-shift'),
      tbtMs: metric(lhr, 'total-blocking-time')
    }
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run electron/analyzers/lighthouse/parse.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Install Lighthouse as a library**

```bash
npm install lighthouse@^11 chrome-launcher@^1
```

- [ ] **Step 7: Write `index.ts`**

```ts
import type { Analyzer } from '../types';
import { parseLighthouse } from './parse';

export type LighthouseSettings = { formFactor: 'mobile' | 'desktop' };

export const lighthouseAnalyzer: Analyzer<LighthouseSettings> = {
  id: 'lighthouse',
  label: 'Lighthouse',
  // CPU-bound: two at a time keeps the machine usable during a run.
  concurrency: 'limited',
  timeoutMs: 120_000,
  defaultSettings: { formFactor: 'mobile' },

  async preflight() {
    try {
      const { Launcher } = await import('chrome-launcher');
      const installs = Launcher.getInstallations();
      return installs.length > 0
        ? { available: true }
        : { available: false, reason: 'No Chrome installation found.' };
    } catch (error) {
      return { available: false, reason: (error as Error).message };
    }
  },

  async analyze(domain, settings) {
    const { launch } = await import('chrome-launcher');
    const lighthouse = (await import('lighthouse')).default;

    const chrome = await launch({ chromeFlags: ['--headless'] });
    try {
      const result = await lighthouse(domain, {
        port: chrome.port,
        output: 'json',
        formFactor: settings.formFactor,
        screenEmulation: { disabled: settings.formFactor === 'desktop' }
      });

      if (!result?.lhr) {
        throw new Error('Lighthouse returned no result.');
      }
      return parseLighthouse(result.lhr);
    } finally {
      await chrome.kill();
    }
  }
};
```

- [ ] **Step 8: Commit**

```bash
git add fixtures/ electron/analyzers/lighthouse/ package.json package-lock.json
git commit -m "Add Lighthouse analyzer using the npm package"
```

---

### Task 9: Keywords analyzer

**Files:**
- Create: `electron/analyzers/keywords/parse.ts`
- Create: `electron/analyzers/keywords/index.ts`
- Test: `electron/analyzers/keywords/parse.test.ts`
- Delete: `src/lib/server/Keyword.ts`

**Interfaces:**
- Consumes: `Analyzer` from `electron/analyzers/types.ts`.
- Produces: `countKeywords(keywords: string[], bodyText: string): KeywordCount[]` where `KeywordCount = { keyword: string; count: number }`, and `keywordsAnalyzer: Analyzer<Record<string, never>>`.

- [ ] **Step 1: Write the failing test**

Create `electron/analyzers/keywords/parse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { countKeywords } from './parse';

const body = 'We sell C++ books. Best c++ around. Garage doors and garage doors again. Prices from $99.';

describe('countKeywords', () => {
  it('counts a plain keyword, case insensitively', () => {
    expect(countKeywords(['garage doors'], body)).toEqual([{ keyword: 'garage doors', count: 2 }]);
  });

  it('counts a keyword ending in punctuation, which \\b cannot match', () => {
    expect(countKeywords(['c++'], body)).toEqual([{ keyword: 'c++', count: 2 }]);
  });

  it('counts a keyword starting with punctuation', () => {
    expect(countKeywords(['$99'], body)).toEqual([{ keyword: '$99', count: 1 }]);
  });

  it('does not match a keyword glued inside a longer word', () => {
    expect(countKeywords(['c++'], 'abcc++nope')).toEqual([{ keyword: 'c++', count: 0 }]);
  });

  it('does not throw on regex metacharacters', () => {
    expect(() => countKeywords(['a[b', '(unclosed'], body)).not.toThrow();
  });

  it('drops empty keywords produced by trailing commas', () => {
    expect(countKeywords(['', '   ', 'c++'], body)).toEqual([{ keyword: 'c++', count: 2 }]);
  });

  it('returns an empty array when there are no keywords', () => {
    expect(countKeywords([], body)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/analyzers/keywords/parse.test.ts`
Expected: FAIL — cannot resolve `./parse`.

- [ ] **Step 3: Write `parse.ts`**

```ts
export type KeywordCount = { keyword: string; count: number };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function countKeywords(keywords: string[], bodyText: string): KeywordCount[] {
  return keywords
    .map((keyword) => keyword.trim())
    .filter((keyword) => keyword.length > 0)
    .map((keyword) => {
      // Lookarounds rather than \b: \b only sits between a word and a non-word
      // character, so a keyword ending in punctuation such as "c++" could never
      // match. These assert the match is not glued to a surrounding word.
      const regex = new RegExp(`(?<!\\w)${escapeRegExp(keyword)}(?!\\w)`, 'gi');
      return { keyword, count: bodyText.match(regex)?.length ?? 0 };
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/analyzers/keywords/parse.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write `index.ts`**

```ts
import puppeteer from 'puppeteer';
import type { Analyzer } from '../types';
import { countKeywords, type KeywordCount } from './parse';

export type KeywordsData = { keywords: KeywordCount[] };

export const keywordsAnalyzer: Analyzer<Record<string, never>> = {
  id: 'keywords',
  label: 'Keywords',
  concurrency: 'limited',
  timeoutMs: 60_000,
  defaultSettings: {},

  async preflight() {
    try {
      // Throws if Puppeteer's bundled Chromium was never downloaded.
      puppeteer.executablePath();
      return { available: true };
    } catch (error) {
      return { available: false, reason: (error as Error).message };
    }
  },

  async analyze(domain): Promise<KeywordsData> {
    const browser = await puppeteer.launch();
    try {
      const page = await browser.newPage();
      try {
        await page.goto(domain, { waitUntil: 'domcontentloaded' });

        const { keywords, bodyText } = await page.evaluate(() => {
          const meta = document.querySelector('meta[name="keywords"]');
          const content = meta?.getAttribute('content')?.toLowerCase() ?? '';
          return { keywords: content.split(','), bodyText: document.body.innerText };
        });

        return { keywords: countKeywords(keywords, bodyText) };
      } finally {
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
};
```

- [ ] **Step 6: Delete the old implementation**

```bash
git rm src/lib/server/Keyword.ts
```

- [ ] **Step 7: Commit**

```bash
git add electron/analyzers/keywords/
git commit -m "Port keyword analysis to the analyzer contract"
```

---

### Task 10: Settings store

**Files:**
- Create: `electron/settings/store.ts`
- Test: `electron/settings/store.test.ts`

**Interfaces:**
- Consumes: `AnalyzerId`.
- Produces: `class SettingsStore` with `constructor(rootDir: string)`, `read(): Promise<Settings>`, `write(settings: Settings): Promise<void>`, where `Settings = { analyzers: Partial<Record<AnalyzerId, unknown>>; enabledAnalyzers: AnalyzerId[] }`.

- [ ] **Step 1: Write the failing test**

Create `electron/settings/store.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { SettingsStore, DEFAULT_SETTINGS } from './store';

let dir: string;
let store: SettingsStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whr-settings-'));
  store = new SettingsStore(dir);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('SettingsStore', () => {
  it('returns defaults when no file exists', async () => {
    expect(await store.read()).toEqual(DEFAULT_SETTINGS);
  });

  it('round-trips written settings', async () => {
    const settings = { ...DEFAULT_SETTINGS, enabledAnalyzers: ['keywords' as const] };
    await store.write(settings);
    expect(await store.read()).toEqual(settings);
  });

  it('falls back to defaults when the file is corrupt', async () => {
    await fs.writeFile(path.join(dir, 'settings.json'), '{ broken', 'utf-8');
    expect(await store.read()).toEqual(DEFAULT_SETTINGS);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/settings/store.test.ts`
Expected: FAIL — cannot resolve `./store`.

- [ ] **Step 3: Write the implementation**

Create `electron/settings/store.ts`:

```ts
import * as fs from 'fs/promises';
import * as path from 'path';
import type { AnalyzerId } from '../../src/lib/shared/types';

export type Settings = {
  enabledAnalyzers: AnalyzerId[];
  analyzers: Partial<Record<AnalyzerId, unknown>>;
};

export const DEFAULT_SETTINGS: Settings = {
  enabledAnalyzers: ['lighthouse', 'keywords'],
  analyzers: {}
};

export class SettingsStore {
  private readonly file: string;

  constructor(rootDir: string) {
    this.file = path.join(rootDir, 'settings.json');
  }

  async read(): Promise<Settings> {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(await fs.readFile(this.file, 'utf-8')) };
    } catch {
      // Missing or corrupt settings must never block startup.
      return DEFAULT_SETTINGS;
    }
  }

  async write(settings: Settings): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(settings, null, 2), 'utf-8');
    await fs.rename(temp, this.file);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/settings/store.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/settings/
git commit -m "Add settings store with safe defaults"
```

---

### Task 11: Electron shell and build wiring

**Files:**
- Create: `electron/main.ts`, `electron/preload.ts`, `electron/logger.ts`
- Create: `tsconfig.electron.json`
- Modify: `package.json`, `svelte.config.js`
- Delete: `src-tauri/`, `src/hooks.server.ts`, `src/lib/index.ts`, `src/lib/server/Competitor.ts`

**Interfaces:**
- Consumes: everything from Tasks 4–10.
- Produces: a launchable app. `window.api` in the renderer, typed as `WhrApi` exported from `electron/preload.ts`.

- [ ] **Step 1: Install Electron**

```bash
npm install --save-dev electron@^33 electron-builder@^25
npm uninstall @tauri-apps/cli
```

- [ ] **Step 2: Remove Tauri and dead entry points**

```bash
git rm -r src-tauri
git rm src/hooks.server.ts src/lib/index.ts src/lib/server/Competitor.ts
```

Remove the `"tauri"` script from `package.json`.

- [ ] **Step 3: Point adapter-static at a fallback**

In `svelte.config.js`, change the adapter call so client-side routing works from `file://`:

```js
		adapter: adapter({ fallback: 'index.html' })
```

- [ ] **Step 4: Write `electron/logger.ts`**

```ts
import * as fs from 'fs';
import * as path from 'path';

/**
 * A packaged Electron app has no terminal, so console output is invisible.
 * Everything of interest goes to a file under userData.
 */
export function createLogger(rootDir: string) {
  const dir = path.join(rootDir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const stream = fs.createWriteStream(path.join(dir, 'app.log'), { flags: 'a' });

  const write = (level: string, message: string, detail?: unknown) => {
    const line = JSON.stringify({
      at: new Date().toISOString(),
      level,
      message,
      detail: detail instanceof Error ? detail.message : detail
    });
    stream.write(`${line}\n`);
  };

  return {
    info: (message: string, detail?: unknown) => write('info', message, detail),
    error: (message: string, detail?: unknown) => write('error', message, detail)
  };
}
```

- [ ] **Step 5: Write `electron/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from 'electron';
import type { Run, AnalyzerId } from '../src/lib/shared/types';
import type { Settings } from './settings/store';

export type WhrApi = {
  startRun(input: { client: string; competitors: string[]; enabledAnalyzers: AnalyzerId[] }): Promise<Run>;
  resumeRun(id: string): Promise<Run>;
  listRuns(): Promise<Run[]>;
  loadRun(id: string): Promise<Run>;
  readSettings(): Promise<Settings>;
  writeSettings(settings: Settings): Promise<void>;
  exportPdf(runId: string): Promise<string>;
  onRunProgress(listener: (run: Run) => void): () => void;
};

const api: WhrApi = {
  startRun: (input) => ipcRenderer.invoke('run:start', input),
  resumeRun: (id) => ipcRenderer.invoke('run:resume', id),
  listRuns: () => ipcRenderer.invoke('run:list'),
  loadRun: (id) => ipcRenderer.invoke('run:load', id),
  readSettings: () => ipcRenderer.invoke('settings:read'),
  writeSettings: (settings) => ipcRenderer.invoke('settings:write', settings),
  exportPdf: (runId) => ipcRenderer.invoke('pdf:export', runId),
  onRunProgress: (listener) => {
    const handler = (_: unknown, run: Run) => listener(run);
    ipcRenderer.on('run:progress', handler);
    return () => ipcRenderer.removeListener('run:progress', handler);
  }
};

contextBridge.exposeInMainWorld('api', api);
```

- [ ] **Step 6: Write `electron/main.ts`**

```ts
import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { createLogger } from './logger';
import { registerIpc } from './ipc';

const isDev = !app.isPackaged;

async function createWindow(): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  if (isDev) {
    await window.loadURL('http://localhost:5173');
  } else {
    // tsconfig.electron.json has rootDir ".", so this file compiles to
    // dist-electron/electron/main.js — two levels below the project root,
    // where SvelteKit's adapter-static output lives in build/.
    await window.loadFile(path.join(__dirname, '../../build/index.html'));
  }

  return window;
}

app.whenReady().then(async () => {
  const logger = createLogger(app.getPath('userData'));
  const window = await createWindow();
  registerIpc({ userDataDir: app.getPath('userData'), window, logger });

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) await createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 7: Create `tsconfig.electron.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist-electron",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["electron/**/*.ts", "src/lib/shared/**/*.ts"],
  "exclude": ["**/*.test.ts"]
}
```

- [ ] **Step 8: Add scripts and electron-builder config to `package.json`**

Create `electron/postbuild.cjs`:

```js
const fs = require('fs');
const path = require('path');

// tsconfig.electron.json emits CommonJS, but the root package.json declares
// "type": "module" for Vite and SvelteKit. Without this, Node loads the
// compiled main.js as ESM and dies with "ReferenceError: exports is not
// defined in ES module scope". Scoping the declaration to the output subtree
// fixes it without touching the root package.json, which would break Vite.
const dir = path.join(__dirname, '..', 'dist-electron');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type: 'commonjs' }), 'utf-8');
```

Add `/dist-electron` to `.gitignore` alongside the existing `/build` entry.

Add to `"scripts"`:

```json
    "electron:compile": "tsc -p tsconfig.electron.json && node electron/postbuild.cjs",
    "electron:dev": "npm run electron:compile && concurrently \"vite dev\" \"electron dist-electron/electron/main.js\"",
    "app:build": "vite build && npm run electron:compile && electron-builder"
```

Install `concurrently`:

```bash
npm install --save-dev concurrently@^9
```

Add a top-level `"build"` key:

```json
  "build": {
    "appId": "au.com.dsbailey.websitehealthreport",
    "productName": "Website Health Report",
    "files": ["dist-electron/**/*", "build/**/*", "package.json"],
    "win": { "target": "nsis" },
    "linux": { "target": "AppImage" },
    "mac": { "target": "dmg", "arch": ["arm64"] }
  }
```

- [ ] **Step 9: Verify the app launches**

Run: `npm run electron:dev`
Expected: an Electron window showing the existing "Website Health Report" heading. Close it.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Replace Tauri with an Electron shell"
```

---

### Task 12: IPC layer

**Files:**
- Create: `electron/ipc.ts`
- Test: `electron/ipc.test.ts`

**Interfaces:**
- Consumes: `Orchestrator`, `RunStorage`, `SettingsStore`, `createRegistry`, `lighthouseAnalyzer`, `keywordsAnalyzer`, `normaliseDomain`.
- Produces: `registerIpc(deps: { userDataDir: string; window: BrowserWindow; logger: Logger }): void`, and `buildHandlers(deps)` — the same logic without Electron, so it is testable.

- [ ] **Step 1: Write the failing test**

Create `electron/ipc.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { buildHandlers } from './ipc';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whr-ipc-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('buildHandlers', () => {
  it('normalises bare domains before starting a run', async () => {
    const handlers = buildHandlers({
      userDataDir: dir,
      emitProgress: () => {},
      logger: { info: () => {}, error: () => {} }
    });

    const run = await handlers.startRun({
      client: 'example.com',
      competitors: ['rival.com'],
      enabledAnalyzers: []
    });

    expect(run.client).toBe('https://example.com/');
    expect(run.competitors).toEqual(['https://rival.com/']);
  });

  it('rejects an invalid domain with a clear message', async () => {
    const handlers = buildHandlers({
      userDataDir: dir,
      emitProgress: () => {},
      logger: { info: () => {}, error: () => {} }
    });

    await expect(
      handlers.startRun({ client: 'ftp://example.com', competitors: [], enabledAnalyzers: [] })
    ).rejects.toThrow(/http/);
  });

  it('lists a run after it has been started', async () => {
    const handlers = buildHandlers({
      userDataDir: dir,
      emitProgress: () => {},
      logger: { info: () => {}, error: () => {} }
    });

    await handlers.startRun({ client: 'example.com', competitors: [], enabledAnalyzers: [] });
    expect(await handlers.listRuns()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/ipc.test.ts`
Expected: FAIL — cannot resolve `./ipc`.

- [ ] **Step 3: Write the implementation**

Create `electron/ipc.ts`:

```ts
import { ipcMain, type BrowserWindow } from 'electron';
import type { AnalyzerId, Run } from '../src/lib/shared/types';
import { normaliseDomain } from '../src/lib/shared/url';
import { createRegistry } from './analyzers/registry';
import { lighthouseAnalyzer } from './analyzers/lighthouse';
import { keywordsAnalyzer } from './analyzers/keywords';
import { Orchestrator } from './run/orchestrator';
import { RunStorage } from './run/storage';
import { SettingsStore, type Settings } from './settings/store';

export type Logger = { info(m: string, d?: unknown): void; error(m: string, d?: unknown): void };

export type HandlerDeps = {
  userDataDir: string;
  emitProgress: (run: Run) => void;
  logger: Logger;
};

export type StartRunInput = {
  client: string;
  competitors: string[];
  enabledAnalyzers: AnalyzerId[];
};

export function buildHandlers(deps: HandlerDeps) {
  const registry = createRegistry([lighthouseAnalyzer, keywordsAnalyzer]);
  const storage = new RunStorage(deps.userDataDir);
  const settingsStore = new SettingsStore(deps.userDataDir);
  const orchestrator = new Orchestrator(registry, storage, deps.emitProgress);

  return {
    async startRun(input: StartRunInput): Promise<Run> {
      // Normalisation happens once, here, so no analyzer ever sees raw input.
      const client = normaliseDomain(input.client);
      const competitors = input.competitors.map(normaliseDomain);
      const settings = await settingsStore.read();

      deps.logger.info('run:start', { client, competitors });
      return orchestrator.start({
        client,
        competitors,
        enabledAnalyzers: input.enabledAnalyzers,
        settings: settings.analyzers
      });
    },

    async resumeRun(id: string): Promise<Run> {
      const settings = await settingsStore.read();
      return orchestrator.resume(id, settings.analyzers);
    },

    listRuns: () => storage.list(),
    loadRun: (id: string) => storage.load(id),
    readSettings: () => settingsStore.read(),
    writeSettings: (settings: Settings) => settingsStore.write(settings)
  };
}

export function registerIpc(deps: {
  userDataDir: string;
  window: BrowserWindow;
  logger: Logger;
}): void {
  const handlers = buildHandlers({
    userDataDir: deps.userDataDir,
    logger: deps.logger,
    emitProgress: (run) => deps.window.webContents.send('run:progress', run)
  });

  const wrap =
    <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
    async (_event: unknown, ...args: A): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error) {
        // Surfaces in the renderer as a rejected invoke, and in the log file.
        deps.logger.error(name, error);
        throw error;
      }
    };

  ipcMain.handle('run:start', wrap('run:start', handlers.startRun));
  ipcMain.handle('run:resume', wrap('run:resume', handlers.resumeRun));
  ipcMain.handle('run:list', wrap('run:list', handlers.listRuns));
  ipcMain.handle('run:load', wrap('run:load', handlers.loadRun));
  ipcMain.handle('settings:read', wrap('settings:read', handlers.readSettings));
  ipcMain.handle('settings:write', wrap('settings:write', handlers.writeSettings));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run electron/ipc.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add electron/ipc.ts electron/ipc.test.ts
git commit -m "Add IPC layer with domain normalisation at the boundary"
```

---

### Task 13: Setup screen

**Files:**
- Modify: `src/routes/+page.svelte`
- Create: `src/app.d.ts` type augmentation for `window.api`
- Create: `src/lib/api.ts`

**Interfaces:**
- Consumes: `WhrApi` from `electron/preload.ts`.
- Produces: `api` — a typed accessor exported from `src/lib/api.ts`.

- [ ] **Step 1: Declare `window.api`**

Replace the contents of `src/app.d.ts`:

```ts
import type { WhrApi } from '../electron/preload';

declare global {
  interface Window {
    api: WhrApi;
  }
}

export {};
```

- [ ] **Step 2: Create `src/lib/api.ts`**

```ts
import type { WhrApi } from '../../electron/preload';

/**
 * Single accessor so components never touch window directly, and so a missing
 * preload fails with a clear message rather than "cannot read property of undefined".
 */
export function api(): WhrApi {
  if (typeof window === 'undefined' || !window.api) {
    throw new Error('Preload API unavailable — the renderer is not running inside Electron.');
  }
  return window.api;
}
```

- [ ] **Step 3: Write the Setup screen**

Replace `src/routes/+page.svelte`:

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { api } from '$lib/api';
  import type { AnalyzerId } from '$lib/shared/types';

  let client = '';
  let competitorText = '';
  let enabled: AnalyzerId[] = ['lighthouse', 'keywords'];
  let error = '';
  let starting = false;

  const available: Array<{ id: AnalyzerId; label: string }> = [
    { id: 'lighthouse', label: 'Lighthouse' },
    { id: 'keywords', label: 'Keywords' }
  ];

  function toggle(id: AnalyzerId) {
    enabled = enabled.includes(id) ? enabled.filter((e) => e !== id) : [...enabled, id];
  }

  async function start() {
    error = '';
    starting = true;
    try {
      const competitors = competitorText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

      const run = await api().startRun({ client, competitors, enabledAnalyzers: enabled });
      await goto(`/run/${run.id}`);
    } catch (e) {
      error = (e as Error).message;
    } finally {
      starting = false;
    }
  }
</script>

<h1>New report</h1>

<label>
  Client domain
  <input bind:value={client} placeholder="cjsgaragedoors.com.au" />
</label>

<label>
  Competitors, one per line
  <textarea bind:value={competitorText} rows="4"></textarea>
</label>

<fieldset>
  <legend>Analyzers</legend>
  {#each available as analyzer}
    <label>
      <input
        type="checkbox"
        checked={enabled.includes(analyzer.id)}
        on:change={() => toggle(analyzer.id)}
      />
      {analyzer.label}
    </label>
  {/each}
</fieldset>

{#if error}
  <p role="alert">{error}</p>
{/if}

<button on:click={start} disabled={starting || client.trim().length === 0}>
  {starting ? 'Starting…' : 'Start run'}
</button>

<a href="/runs">Previous runs</a>
```

- [ ] **Step 4: Verify it renders**

Run: `npm run electron:dev`
Expected: the form appears. Entering `ftp://x` and starting shows the validation error rather than crashing.

- [ ] **Step 5: Commit**

```bash
git add src/
git commit -m "Add setup screen"
```

---

### Task 14: Run screen with live grid

**Files:**
- Create: `src/routes/run/[id]/+page.svelte`
- Create: `src/routes/run/[id]/+page.ts`

**Interfaces:**
- Consumes: `api()`, `Run`, `isOk`/`isUnavailable`/`isFailed`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Create the loader**

Create `src/routes/run/[id]/+page.ts`:

```ts
export const prerender = false;
export const ssr = false;
```

- [ ] **Step 2: Write the screen**

Create `src/routes/run/[id]/+page.svelte`:

```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  import type { Run, AnalyzerResult } from '$lib/shared/types';

  let run: Run | null = null;
  let error = '';
  let unsubscribe: (() => void) | null = null;

  onMount(async () => {
    try {
      run = await api().loadRun($page.params.id);
    } catch (e) {
      error = (e as Error).message;
    }
    // Progress events carry the whole run, so the grid is always consistent.
    unsubscribe = api().onRunProgress((incoming) => {
      if (incoming.id === $page.params.id) run = incoming;
    });
  });

  onDestroy(() => unsubscribe?.());

  function cell(result: AnalyzerResult | undefined): { text: string; title: string } {
    if (!result) return { text: '…', title: 'Waiting' };
    if (result.status === 'ok') return { text: 'OK', title: 'Completed' };
    if (result.status === 'unavailable') return { text: 'n/a', title: result.reason };
    return { text: 'fail', title: result.error };
  }

  async function resume() {
    if (run) run = await api().resumeRun(run.id);
  }
</script>

{#if error}
  <p role="alert">{error}</p>
{:else if run}
  <h1>{run.client}</h1>
  <p>Status: {run.status}</p>

  <table>
    <thead>
      <tr>
        <th>Domain</th>
        {#each run.enabledAnalyzers as id}<th>{id}</th>{/each}
      </tr>
    </thead>
    <tbody>
      {#each run.domains as domain}
        <tr>
          <td>{domain.domain} ({domain.role})</td>
          {#each run.enabledAnalyzers as id}
            {@const c = cell(domain.analyzers[id])}
            <td title={c.title}>{c.text}</td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>

  {#if run.status !== 'running'}
    <button on:click={resume}>Re-run failed</button>
    <a href={`/report/${run.id}`}>View report</a>
  {/if}
{:else}
  <p>Loading…</p>
{/if}
```

- [ ] **Step 3: Verify live updates**

Run: `npm run electron:dev`, start a run against a real domain with both analyzers.
Expected: cells fill in progressively; a dead domain shows `fail` with the error on hover, and other cells still complete.

- [ ] **Step 4: Commit**

```bash
git add src/routes/run/
git commit -m "Add live run grid"
```

---

### Task 15: Report route and run history

**Files:**
- Create: `src/routes/report/[id]/+page.svelte`, `src/routes/report/[id]/+page.ts`
- Create: `src/routes/runs/+page.svelte`, `src/routes/runs/+page.ts`

**Interfaces:**
- Consumes: `api()`, `Run`, `LighthouseData`, `KeywordsData`.
- Produces: the `/report/:id` route, which Task 16 renders to PDF.

- [ ] **Step 1: Create both loaders**

Both `src/routes/report/[id]/+page.ts` and `src/routes/runs/+page.ts`:

```ts
export const prerender = false;
export const ssr = false;
```

- [ ] **Step 2: Write the run history screen**

Create `src/routes/runs/+page.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import type { Run } from '$lib/shared/types';

  let runs: Run[] = [];

  onMount(async () => {
    runs = await api().listRuns();
  });
</script>

<h1>Previous runs</h1>
<a href="/">New report</a>

<ul>
  {#each runs as run}
    <li>
      <a href={`/run/${run.id}`}>{run.client}</a>
      — {new Date(run.createdAt).toLocaleString()} ({run.status})
    </li>
  {:else}
    <li>No runs yet.</li>
  {/each}
</ul>
```

- [ ] **Step 3: Write the report route**

Create `src/routes/report/[id]/+page.svelte`:

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { api } from '$lib/api';
  import type { Run } from '$lib/shared/types';

  let run: Run | null = null;
  let exporting = false;

  onMount(async () => {
    run = await api().loadRun($page.params.id);
  });

  async function exportPdf() {
    if (!run) return;
    exporting = true;
    try {
      const saved = await api().exportPdf(run.id);
      alert(`Saved to ${saved}`);
    } finally {
      exporting = false;
    }
  }
</script>

{#if run}
  <header class="no-print">
    <button on:click={exportPdf} disabled={exporting}>
      {exporting ? 'Exporting…' : 'Export PDF'}
    </button>
  </header>

  <h1>Website Health Report</h1>
  <p>{run.client} — {new Date(run.createdAt).toLocaleDateString()}</p>

  {#each run.domains as domain}
    <section class="domain">
      <h2>{domain.domain} <small>({domain.role})</small></h2>

      {#each run.enabledAnalyzers as id}
        {@const result = domain.analyzers[id]}
        <h3>{id}</h3>
        {#if !result}
          <p>Not run.</p>
        {:else if result.status === 'unavailable'}
          <p>Unavailable — {result.reason}</p>
        {:else if result.status === 'failed'}
          <p>Failed — {result.error}</p>
        {:else}
          <pre>{JSON.stringify(result.data, null, 2)}</pre>
        {/if}
      {/each}
    </section>
  {/each}
{:else}
  <p>Loading…</p>
{/if}

<style>
  .domain {
    break-inside: avoid;
  }

  @media print {
    .no-print {
      display: none;
    }
    .domain {
      break-after: page;
    }
  }
</style>
```

- [ ] **Step 4: Verify both routes**

Run: `npm run electron:dev`, complete a run, click through to the report.
Expected: results render per domain; unavailable and failed read differently.

- [ ] **Step 5: Commit**

```bash
git add src/routes/
git commit -m "Add report route and run history"
```

---

### Task 16: PDF export

**Files:**
- Modify: `electron/ipc.ts`
- Create: `electron/pdf.ts`

**Interfaces:**
- Consumes: `BrowserWindow`, the `/report/:id` route.
- Produces: `exportRunPdf(opts: { runId: string; rendererBase: string; outPath: string }): Promise<string>`.

- [ ] **Step 1: Write `electron/pdf.ts`**

```ts
import { BrowserWindow } from 'electron';
import * as fs from 'fs/promises';
import * as path from 'path';

export type ExportOptions = {
  runId: string;
  /** Dev: http://localhost:5173. Packaged: file:// URL of build/index.html. */
  rendererBase: string;
  outPath: string;
};

/**
 * Renders the same /report/:id route the operator reviews on screen into a
 * hidden window and prints it, so screen output and PDF cannot diverge.
 */
export async function exportRunPdf(opts: ExportOptions): Promise<string> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true }
  });

  try {
    await window.loadURL(`${opts.rendererBase}/report/${opts.runId}`);
    // The route loads its run asynchronously; wait for the DOM to settle.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
    });

    await fs.mkdir(path.dirname(opts.outPath), { recursive: true });
    await fs.writeFile(opts.outPath, pdf);
    return opts.outPath;
  } finally {
    window.destroy();
  }
}
```

- [ ] **Step 2: Wire it into `registerIpc`**

In `electron/ipc.ts`, add to `registerIpc` (which has `BrowserWindow` access, unlike `buildHandlers`):

```ts
  ipcMain.handle(
    'pdf:export',
    wrap('pdf:export', async (runId: string) => {
      const { exportRunPdf } = await import('./pdf');

      // app.isPackaged, matching main.ts. NODE_ENV is not set reliably in a
      // packaged Electron app, so it must not be the dev/prod signal.
      // The route is a client-side path, so the packaged base is the
      // directory URL of index.html, not the file itself.
      const base = app.isPackaged
        ? `file://${path.join(__dirname, '../../build/index.html')}#`
        : 'http://localhost:5173';

      return exportRunPdf({
        runId,
        rendererBase: base,
        outPath: path.join(deps.userDataDir, 'reports', `${runId}.pdf`)
      });
    })
  );
```

Add `import * as path from 'path';` to the top of `electron/ipc.ts`, and add `app` to the existing `electron` import.

Note: the `#` suffix on the packaged base relies on SvelteKit resolving the
route from the hash. If `adapter-static` with `fallback: 'index.html'` does not
resolve `/report/:id` from `file://` in your build, switch the app to
`@sveltejs/adapter-static` with `hashRouting` or serve the renderer from a
local `file://` directory index — verify this in Step 3 before moving on.

- [ ] **Step 3: Verify the export**

Run: `npm run electron:dev`, complete a run, open the report, click Export PDF.
Expected: an alert with the saved path; the PDF opens and shows one domain per page with the export button absent.

- [ ] **Step 4: Commit**

```bash
git add electron/pdf.ts electron/ipc.ts
git commit -m "Add PDF export via printToPDF"
```

---

### Task 17: Full check and packaged build

**Files:**
- Modify: `package.json`, `.eslintignore`, `.prettierignore`

- [ ] **Step 1: Add electron to the lint and check paths**

Add `dist-electron` to both `.eslintignore` and `.prettierignore`.

- [ ] **Step 2: Run the full suite**

```bash
npm run test && npm run check && npm run electron:compile && npm run lint
```

`electron:compile` is included deliberately: `npm run check` runs `svelte-check`
against `tsconfig.json`, which covers `src/` only. Nothing under `electron/` is
type-checked without a `tsc -p tsconfig.electron.json` pass, so leaving it out
would let main-process type errors reach a packaged build.

Expected: all pass. Fix anything that does not.

- [ ] **Step 3: Produce a packaged build**

```bash
npm run app:build
```

Expected: an installer under `dist/`. Install and launch it.

- [ ] **Step 4: Verify the packaged app**

Run a report against a real domain from the installed app.
Expected: the run completes, the report renders, PDF export works. Confirm `<userData>/logs/app.log` contains entries — this is the check that logging replaced `console.log` correctly, since the packaged app has no terminal.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Wire lint and packaging for the Electron build"
```

---

## Deferred to later plans

- **Plan 2:** Wayback, Security, AEO analyzers.
- **Plan 3:** SEO Quake (port `src/lib/server/SEOQData.ts`), Content (AU spelling and grammar).
- **Plan 4:** Traffic estimated (Semrush), Traffic owned (GSC/GA4 OAuth), and the `safeStorage` credential store.

`src/lib/server/SEOQData.ts` and `src/lib/server/WBMData.ts` are left in place by this plan and reshaped by plans 2 and 3. They are unreferenced after Task 11 deletes `hooks.server.ts`, and the report renders analyzer data as JSON until those plans add per-analyzer presentation.
