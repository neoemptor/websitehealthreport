# Traffic Analyzers Implementation Plan (Plan 4 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the final two analyzers — estimated traffic from Semrush for every domain, and owned traffic from Search Console and GA4 for the client — along with the encrypted credential store both need.

**Architecture:** Two analyzers rather than one, because owned and estimated traffic are different kinds of data with different reach. Estimated covers client and competitors alike and keeps the comparison intact; owned is accurate but exists only where the site owner has granted access. Credentials live in an encrypted store in the main process and never cross IPC.

**Tech Stack:** Semrush Analytics API v3, Google OAuth 2.0 loopback flow, Search Console API, GA4 Data API, Electron `safeStorage`.

**Spec:** `docs/superpowers/specs/2026-09-02-website-health-report-design.md`

**Depends on:** Plans 1, 2 and 3 complete.

## Global Constraints

Inherits every constraint from plans 1 to 3. Additionally:

- **Credentials never reach the renderer.** The Semrush key and Google refresh tokens are encrypted with `safeStorage` and stored outside `settings.json`. IPC exposes only whether a credential exists, never its value.
- **Owned traffic is client-only by construction.** Competitor domains report `unavailable` with a reason naming the absence of access. This is never presented as a comparison with missing data.
- **Estimates are labelled as estimates** wherever they appear beside owned traffic. The two must never be read as equivalent.
- Billing state is a first-class failure mode. An exhausted Semrush quota is `unavailable`, not `failed`.

---

## File Structure

| Path | Responsibility |
|---|---|
| `electron/credentials.ts` | `safeStorage`-encrypted secret store. |
| `electron/analyzers/traffic-estimated/{parse,index}.ts` | Semrush client and analyzer. |
| `electron/analyzers/traffic-owned/{oauth,gsc,ga4,index}.ts` | Google auth and the two data sources. |
| `src/lib/report/{TrafficEstimated,TrafficOwned}.svelte` | Report rendering. |

---

### Task 1: Encrypted credential store

**Files:**
- Create: `electron/credentials.ts`
- Test: `electron/credentials.test.ts`

**Interfaces:**
- Consumes: Electron `safeStorage`.
- Produces: `class CredentialStore` with `constructor(rootDir: string, crypto: CryptoBackend)`, `get(key: string): Promise<string | null>`, `set(key: string, value: string): Promise<void>`, `has(key: string): Promise<boolean>`, `remove(key: string): Promise<void>`. `CryptoBackend = { isEncryptionAvailable(): boolean; encryptString(s: string): Buffer; decryptString(b: Buffer): string }` — injected so tests do not need Electron.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { CredentialStore } from './credentials';

// Reversible stand-in for safeStorage, which needs a running Electron app.
const fakeCrypto = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(s, 'utf-8').reverse(),
  decryptString: (b: Buffer) => Buffer.from(b).reverse().toString('utf-8')
};

let dir: string;
let store: CredentialStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whr-cred-'));
  store = new CredentialStore(dir, fakeCrypto);
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('CredentialStore', () => {
  it('round-trips a secret', async () => {
    await store.set('semrush', 'key-123');
    expect(await store.get('semrush')).toBe('key-123');
  });

  it('never writes the plaintext to disk', async () => {
    await store.set('semrush', 'key-123');
    const raw = await fs.readFile(path.join(dir, 'credentials.enc'), 'utf-8');
    expect(raw).not.toContain('key-123');
  });

  it('reports presence without exposing the value', async () => {
    expect(await store.has('semrush')).toBe(false);
    await store.set('semrush', 'key-123');
    expect(await store.has('semrush')).toBe(true);
  });

  it('returns null for a missing key', async () => {
    expect(await store.get('nope')).toBeNull();
  });

  it('removes a secret', async () => {
    await store.set('semrush', 'key-123');
    await store.remove('semrush');
    expect(await store.get('semrush')).toBeNull();
  });

  it('throws when OS encryption is unavailable rather than storing plaintext', async () => {
    const insecure = new CredentialStore(dir, { ...fakeCrypto, isEncryptionAvailable: () => false });
    await expect(insecure.set('semrush', 'key-123')).rejects.toThrow(/encryption/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL, cannot resolve `./credentials`.

- [ ] **Step 3: Write the implementation**

```ts
import * as fs from 'fs/promises';
import * as path from 'path';

export type CryptoBackend = {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
};

type Envelope = Record<string, string>;

export class CredentialStore {
  private readonly file: string;

  constructor(
    rootDir: string,
    private readonly crypto: CryptoBackend
  ) {
    this.file = path.join(rootDir, 'credentials.enc');
  }

  private async readAll(): Promise<Envelope> {
    try {
      return JSON.parse(await fs.readFile(this.file, 'utf-8')) as Envelope;
    } catch {
      return {};
    }
  }

  private async writeAll(envelope: Envelope): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(envelope), 'utf-8');
    await fs.rename(temp, this.file);
  }

  async set(key: string, value: string): Promise<void> {
    if (!this.crypto.isEncryptionAvailable()) {
      // Storing a client's refresh token in plaintext is worse than failing.
      throw new Error('OS encryption is unavailable, so credentials cannot be stored safely.');
    }
    const envelope = await this.readAll();
    envelope[key] = this.crypto.encryptString(value).toString('base64');
    await this.writeAll(envelope);
  }

  async get(key: string): Promise<string | null> {
    const stored = (await this.readAll())[key];
    if (!stored) return null;
    return this.crypto.decryptString(Buffer.from(stored, 'base64'));
  }

  async has(key: string): Promise<boolean> {
    return Object.prototype.hasOwnProperty.call(await this.readAll(), key);
  }

  async remove(key: string): Promise<void> {
    const envelope = await this.readAll();
    delete envelope[key];
    await this.writeAll(envelope);
  }
}
```

- [ ] **Step 4: Run test to verify it passes** — 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/credentials.ts electron/credentials.test.ts
git commit -m "Add safeStorage-backed credential store"
```

---

### Task 2: Semrush parsing

**Files:**
- Create: `electron/analyzers/traffic-estimated/parse.ts`
- Test: `electron/analyzers/traffic-estimated/parse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseSemrushCsv(body: string): Record<string, string>[]`, `toEstimatedTraffic(rows): EstimatedTrafficData` where `EstimatedTrafficData = { organicKeywords: number | null; organicTraffic: number | null; organicCost: number | null; adwordsKeywords: number | null }`, and `isQuotaError(body: string): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseSemrushCsv, toEstimatedTraffic, isQuotaError } from './parse';

// Semrush returns semicolon-separated values with a header line.
const body = 'Database;Date;Organic Keywords;Organic Traffic;Organic Cost;Adwords Keywords\nau;20260901;412;3100;5200;7';

describe('parseSemrushCsv', () => {
  it('parses the header and one data row', () => {
    const rows = parseSemrushCsv(body);
    expect(rows).toHaveLength(1);
    expect(rows[0]['Organic Traffic']).toBe('3100');
  });

  it('returns an empty array for a header-only response', () => {
    expect(parseSemrushCsv('Database;Date')).toEqual([]);
  });

  it('returns an empty array for an empty body', () => {
    expect(parseSemrushCsv('')).toEqual([]);
  });
});

describe('toEstimatedTraffic', () => {
  it('maps the columns to numbers', () => {
    expect(toEstimatedTraffic(parseSemrushCsv(body))).toEqual({
      organicKeywords: 412,
      organicTraffic: 3100,
      organicCost: 5200,
      adwordsKeywords: 7
    });
  });

  it('returns nulls when the domain has no data', () => {
    expect(toEstimatedTraffic([])).toEqual({
      organicKeywords: null,
      organicTraffic: null,
      organicCost: null,
      adwordsKeywords: null
    });
  });
});

describe('isQuotaError', () => {
  it('recognises the API units message', () => {
    expect(isQuotaError('ERROR 120 :: NOT ENOUGH API UNITS')).toBe(true);
  });

  it('does not treat an ordinary response as a quota error', () => {
    expect(isQuotaError(body)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL, cannot resolve `./parse`.

- [ ] **Step 3: Write `parse.ts`**

```ts
export type EstimatedTrafficData = {
  organicKeywords: number | null;
  organicTraffic: number | null;
  organicCost: number | null;
  adwordsKeywords: number | null;
};

export function parseSemrushCsv(body: string): Record<string, string>[] {
  const lines = body.trim().split('\n').filter((line) => line.length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(';');
  return lines.slice(1).map((line) => {
    const cells = line.split(';');
    return Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? '']));
  });
}

function num(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toEstimatedTraffic(rows: Record<string, string>[]): EstimatedTrafficData {
  const row = rows[0] ?? {};
  return {
    organicKeywords: num(row['Organic Keywords']),
    organicTraffic: num(row['Organic Traffic']),
    organicCost: num(row['Organic Cost']),
    adwordsKeywords: num(row['Adwords Keywords'])
  };
}

/** Quota exhaustion is a billing state, not a crash, so it maps to unavailable. */
export function isQuotaError(body: string): boolean {
  return /NOT ENOUGH API UNITS|ERROR 12[01]/i.test(body);
}
```

- [ ] **Step 4: Run test to verify it passes** — 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/analyzers/traffic-estimated/parse.ts electron/analyzers/traffic-estimated/parse.test.ts
git commit -m "Add Semrush response parsing"
```

---

### Task 3: Estimated traffic analyzer

**Files:**
- Create: `electron/analyzers/traffic-estimated/index.ts`

**Interfaces:**
- Consumes: `parse.ts`, `CredentialStore`, `fetchText`.
- Produces: `createTrafficEstimatedAnalyzer(credentials: CredentialStore): Analyzer<TrafficEstimatedSettings>` where `TrafficEstimatedSettings = { database: string }`.

The analyzer is created by a factory rather than exported directly, because it needs the credential store, which only the main process has.

- [ ] **Step 1: Write `index.ts`**

```ts
import type { Analyzer } from '../types';
import type { CredentialStore } from '../../credentials';
import { fetchText } from '../../http';
import { isQuotaError, parseSemrushCsv, toEstimatedTraffic, type EstimatedTrafficData } from './parse';

export type TrafficEstimatedSettings = { database: string };

export const SEMRUSH_CREDENTIAL_KEY = 'semrush.apiKey';

const ENDPOINT = 'https://api.semrush.com/';

export function createTrafficEstimatedAnalyzer(
  credentials: CredentialStore
): Analyzer<TrafficEstimatedSettings> {
  return {
    id: 'traffic-estimated',
    label: 'Traffic (estimated)',
    concurrency: 'parallel',
    timeoutMs: 30_000,
    // 'au' is the Australian database; clients are Australian businesses.
    defaultSettings: { database: 'au' },

    async preflight() {
      return (await credentials.has(SEMRUSH_CREDENTIAL_KEY))
        ? { available: true }
        : { available: false, reason: 'No Semrush API key configured in Settings.' };
    },

    async analyze(domain, settings, signal): Promise<EstimatedTrafficData> {
      const key = await credentials.get(SEMRUSH_CREDENTIAL_KEY);
      if (!key) {
        throw new Error('UNAVAILABLE: No Semrush API key configured in Settings.');
      }

      const url = new URL(ENDPOINT);
      url.searchParams.set('type', 'domain_rank');
      url.searchParams.set('key', key);
      url.searchParams.set('domain', new URL(domain).hostname.replace(/^www\./, ''));
      url.searchParams.set('database', settings.database);
      url.searchParams.set(
        'export_columns',
        'Db,Dt,Or,Ot,Oc,Ad'
      );

      const { body } = await fetchText(url.toString(), { signal, timeoutMs: 25_000 });

      // Running out of API units is a billing state the operator can fix, not
      // a failure of the analyzer, so it is reported as unavailable.
      if (isQuotaError(body)) {
        throw new Error(`UNAVAILABLE: Semrush quota exhausted — ${body.trim()}`);
      }

      return toEstimatedTraffic(parseSemrushCsv(body));
    }
  };
}
```

- [ ] **Step 2: Verify the unavailable path is honoured**

The orchestrator translates a thrown message prefixed `UNAVAILABLE:` into an
`unavailable` result. Confirm by reading `toAnalyzerResult` in
`electron/run/orchestrator.ts` before moving on — if that prefix has changed,
update this analyzer to match rather than inventing a second mechanism.

- [ ] **Step 3: Commit**

```bash
git add electron/analyzers/traffic-estimated/
git commit -m "Add estimated traffic analyzer using Semrush"
```

---

### Task 4: Google OAuth

**Files:**
- Create: `electron/analyzers/traffic-owned/oauth.ts`
- Test: `electron/analyzers/traffic-owned/oauth.test.ts`

**Interfaces:**
- Consumes: `CredentialStore`, Electron `BrowserWindow`.
- Produces: `refreshTokenKey(domain: string): string`, `buildAuthUrl(opts: { clientId: string; redirectUri: string; scopes: string[] }): string`, `exchangeCode(opts): Promise<{ refreshToken: string }>`, `accessTokenFor(domain, credentials, clientId, clientSecret): Promise<string>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildAuthUrl, refreshTokenKey, SCOPES } from './oauth';

describe('refreshTokenKey', () => {
  it('scopes the token to one domain', () => {
    expect(refreshTokenKey('https://cjsgaragedoors.com.au/')).toBe('google.refresh.cjsgaragedoors.com.au');
  });

  it('ignores www so one grant covers both hosts', () => {
    expect(refreshTokenKey('https://www.example.com/')).toBe('google.refresh.example.com');
  });
});

describe('buildAuthUrl', () => {
  const url = () =>
    new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:9999', scopes: SCOPES }));

  it('requests offline access so a refresh token is issued', () => {
    expect(url().searchParams.get('access_type')).toBe('offline');
  });

  it('forces the consent screen so a refresh token is always returned', () => {
    expect(url().searchParams.get('prompt')).toBe('consent');
  });

  it('requests read-only scopes only', () => {
    for (const scope of url().searchParams.get('scope')!.split(' ')) {
      expect(scope).toMatch(/readonly$/);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL, cannot resolve `./oauth`.

- [ ] **Step 3: Write `oauth.ts`**

```ts
import type { CredentialStore } from '../../credentials';

// Read-only throughout. This application never writes to a client's Google account.
export const SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly',
  'https://www.googleapis.com/auth/analytics.readonly'
];

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function refreshTokenKey(domain: string): string {
  return `google.refresh.${new URL(domain).hostname.replace(/^www\./, '')}`;
}

export function buildAuthUrl(opts: {
  clientId: string;
  redirectUri: string;
  scopes: string[];
}): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', opts.clientId);
  url.searchParams.set('redirect_uri', opts.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', opts.scopes.join(' '));
  // offline + consent guarantees a refresh token, including on re-authorisation.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

export async function exchangeCode(opts: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<{ refreshToken: string }> {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      code: opts.code,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code'
    })
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed with ${response.status}.`);
  }

  const payload = (await response.json()) as { refresh_token?: string };
  if (!payload.refresh_token) {
    throw new Error('Google did not return a refresh token.');
  }
  return { refreshToken: payload.refresh_token };
}

export async function accessTokenFor(
  domain: string,
  credentials: CredentialStore,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const refreshToken = await credentials.get(refreshTokenKey(domain));
  if (!refreshToken) {
    throw new Error(`UNAVAILABLE: No access granted for ${new URL(domain).hostname}.`);
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token'
    })
  });

  if (!response.ok) {
    throw new Error(`UNAVAILABLE: Stored Google authorisation is no longer valid — re-authorise this client.`);
  }

  return ((await response.json()) as { access_token: string }).access_token;
}
```

- [ ] **Step 4: Run test to verify it passes** — 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/analyzers/traffic-owned/oauth.ts electron/analyzers/traffic-owned/oauth.test.ts
git commit -m "Add Google OAuth helpers with read-only scopes"
```

---

### Task 5: Search Console and GA4 clients

**Files:**
- Create: `electron/analyzers/traffic-owned/gsc.ts`, `electron/analyzers/traffic-owned/ga4.ts`
- Test: `electron/analyzers/traffic-owned/gsc.test.ts`

**Interfaces:**
- Consumes: `accessTokenFor`.
- Produces: `parseSearchAnalytics(payload: unknown): GscData` where `GscData = { clicks: number; impressions: number; ctr: number; position: number; topQueries: Array<{ query: string; clicks: number }> }`; `parseGa4(payload: unknown): Ga4Data` where `Ga4Data = { sessions: number; users: number; engagementRate: number }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseSearchAnalytics } from './gsc';
import { parseGa4 } from './ga4';

describe('parseSearchAnalytics', () => {
  it('totals clicks and impressions across rows', () => {
    const payload = {
      rows: [
        { keys: ['garage doors'], clicks: 10, impressions: 100, ctr: 0.1, position: 4 },
        { keys: ['roller doors'], clicks: 5, impressions: 50, ctr: 0.1, position: 6 }
      ]
    };
    const data = parseSearchAnalytics(payload);
    expect(data.clicks).toBe(15);
    expect(data.impressions).toBe(150);
  });

  it('ranks top queries by clicks', () => {
    const payload = {
      rows: [
        { keys: ['b'], clicks: 5, impressions: 10, ctr: 0.5, position: 2 },
        { keys: ['a'], clicks: 9, impressions: 20, ctr: 0.45, position: 1 }
      ]
    };
    expect(parseSearchAnalytics(payload).topQueries[0]).toEqual({ query: 'a', clicks: 9 });
  });

  it('returns zeroes when there are no rows', () => {
    expect(parseSearchAnalytics({}).clicks).toBe(0);
  });
});

describe('parseGa4', () => {
  it('reads the first metric row', () => {
    const payload = { rows: [{ metricValues: [{ value: '120' }, { value: '95' }, { value: '0.62' }] }] };
    expect(parseGa4(payload)).toEqual({ sessions: 120, users: 95, engagementRate: 0.62 });
  });

  it('returns zeroes when the property has no data', () => {
    expect(parseGa4({ rows: [] })).toEqual({ sessions: 0, users: 0, engagementRate: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL, cannot resolve `./gsc`.

- [ ] **Step 3: Write `gsc.ts`**

```ts
export type GscData = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  topQueries: Array<{ query: string; clicks: number }>;
};

type Row = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };

export function parseSearchAnalytics(payload: unknown): GscData {
  const rows = ((payload as { rows?: Row[] }).rows ?? []).filter(Boolean);

  const clicks = rows.reduce((sum, row) => sum + (row.clicks ?? 0), 0);
  const impressions = rows.reduce((sum, row) => sum + (row.impressions ?? 0), 0);

  return {
    clicks,
    impressions,
    ctr: impressions === 0 ? 0 : clicks / impressions,
    // Position is averaged per row by the API; weight by impressions.
    position:
      impressions === 0
        ? 0
        : rows.reduce((sum, row) => sum + (row.position ?? 0) * (row.impressions ?? 0), 0) / impressions,
    topQueries: [...rows]
      .sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0))
      .slice(0, 10)
      .map((row) => ({ query: row.keys?.[0] ?? '', clicks: row.clicks ?? 0 }))
  };
}

export async function fetchSearchAnalytics(
  siteUrl: string,
  accessToken: string,
  range: { startDate: string; endDate: string },
  signal: AbortSignal
): Promise<GscData> {
  const response = await fetch(
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...range, dimensions: ['query'], rowLimit: 100 })
    }
  );

  if (response.status === 403) {
    throw new Error(`UNAVAILABLE: The authorised Google account has no access to ${siteUrl}.`);
  }
  if (!response.ok) {
    throw new Error(`Search Console returned ${response.status}.`);
  }

  return parseSearchAnalytics(await response.json());
}
```

- [ ] **Step 4: Write `ga4.ts`**

```ts
export type Ga4Data = { sessions: number; users: number; engagementRate: number };

export function parseGa4(payload: unknown): Ga4Data {
  const row = ((payload as { rows?: Array<{ metricValues?: Array<{ value: string }> }> }).rows ?? [])[0];
  const values = row?.metricValues ?? [];

  const at = (i: number) => Number(values[i]?.value ?? 0) || 0;
  return { sessions: at(0), users: at(1), engagementRate: at(2) };
}

export async function fetchGa4(
  propertyId: string,
  accessToken: string,
  range: { startDate: string; endDate: string },
  signal: AbortSignal
): Promise<Ga4Data> {
  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    {
      method: 'POST',
      signal,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dateRanges: [range],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagementRate' }]
      })
    }
  );

  if (response.status === 403) {
    throw new Error(`UNAVAILABLE: The authorised Google account has no access to GA4 property ${propertyId}.`);
  }
  if (!response.ok) {
    throw new Error(`GA4 returned ${response.status}.`);
  }

  return parseGa4(await response.json());
}
```

- [ ] **Step 5: Run test to verify it passes** — 5 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/analyzers/traffic-owned/gsc.ts electron/analyzers/traffic-owned/ga4.ts electron/analyzers/traffic-owned/gsc.test.ts
git commit -m "Add Search Console and GA4 clients"
```

---

### Task 6: Owned traffic analyzer

**Files:**
- Create: `electron/analyzers/traffic-owned/index.ts`

**Interfaces:**
- Consumes: `oauth.ts`, `gsc.ts`, `ga4.ts`, `CredentialStore`.
- Produces: `createTrafficOwnedAnalyzer(credentials, oauthConfig): Analyzer<TrafficOwnedSettings>` where `TrafficOwnedSettings = { clientDomain: string | null; ga4PropertyId: string | null; days: number }`.

- [ ] **Step 1: Write `index.ts`**

```ts
import type { Analyzer } from '../types';
import type { CredentialStore } from '../../credentials';
import { accessTokenFor, refreshTokenKey } from './oauth';
import { fetchSearchAnalytics, type GscData } from './gsc';
import { fetchGa4, type Ga4Data } from './ga4';

export type TrafficOwnedSettings = {
  /** The run's client domain. Any other domain reports unavailable. */
  clientDomain: string | null;
  ga4PropertyId: string | null;
  days: number;
};

export type OwnedTrafficData = {
  range: { startDate: string; endDate: string };
  searchConsole: GscData | { unavailable: string };
  analytics: Ga4Data | { unavailable: string };
};

export type OauthConfig = { clientId: string; clientSecret: string };

function dateRange(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { startDate: iso(start), endDate: iso(end) };
}

export function createTrafficOwnedAnalyzer(
  credentials: CredentialStore,
  oauth: OauthConfig
): Analyzer<TrafficOwnedSettings> {
  return {
    id: 'traffic-owned',
    label: 'Traffic (owned)',
    concurrency: 'parallel',
    timeoutMs: 60_000,
    defaultSettings: { clientDomain: null, ga4PropertyId: null, days: 90 },

    async preflight(settings) {
      if (!settings.clientDomain) {
        return { available: false, reason: 'No client domain set for this run.' };
      }
      return (await credentials.has(refreshTokenKey(settings.clientDomain)))
        ? { available: true }
        : { available: false, reason: 'This client has not granted Google access.' };
    },

    async analyze(domain, settings, signal): Promise<OwnedTrafficData> {
      // Competitors never grant access. This is a property of the data, not a
      // failure, and the report presents it as client-only rather than a gap.
      if (!settings.clientDomain || domain !== settings.clientDomain) {
        throw new Error(
          `UNAVAILABLE: Owned traffic is only available for the client, who has granted access. ` +
            `Competitor domains cannot provide this data.`
        );
      }

      const token = await accessTokenFor(domain, credentials, oauth.clientId, oauth.clientSecret);
      const range = dateRange(settings.days);

      // Either source may be unavailable on its own; one missing must not cost
      // the other, so each is captured independently.
      let searchConsole: GscData | { unavailable: string };
      try {
        searchConsole = await fetchSearchAnalytics(domain, token, range, signal);
      } catch (error) {
        searchConsole = { unavailable: (error as Error).message.replace(/^UNAVAILABLE:\s*/, '') };
      }

      let analytics: Ga4Data | { unavailable: string };
      if (!settings.ga4PropertyId) {
        analytics = { unavailable: 'No GA4 property id configured for this client.' };
      } else {
        try {
          analytics = await fetchGa4(settings.ga4PropertyId, token, range, signal);
        } catch (error) {
          analytics = { unavailable: (error as Error).message.replace(/^UNAVAILABLE:\s*/, '') };
        }
      }

      return { range, searchConsole, analytics };
    }
  };
}
```

- [ ] **Step 2: Pass the client domain through the run**

In `electron/ipc.ts`, `startRun` must inject the run's client into the owned
traffic settings so the analyzer can tell client from competitor:

```ts
      const analyzerSettings = {
        ...settings.analyzers,
        'traffic-owned': {
          ...(settings.analyzers['traffic-owned'] as object ?? { ga4PropertyId: null, days: 90 }),
          clientDomain: client
        }
      };
```

Pass `analyzerSettings` to `orchestrator.start` in place of `settings.analyzers`.

- [ ] **Step 3: Commit**

```bash
git add electron/analyzers/traffic-owned/ electron/ipc.ts
git commit -m "Add owned traffic analyzer, client-only by construction"
```

---

### Task 7: Wire credentials, settings and OAuth consent

**Files:**
- Modify: `electron/ipc.ts`, `electron/preload.ts`, `src/routes/settings/+page.svelte`

**Interfaces:**
- Produces: IPC methods `setCredential(key, value)`, `hasCredential(key)`, `removeCredential(key)`, `authoriseGoogle(domain)`.

- [ ] **Step 1: Extend the preload API**

```ts
  setCredential(key: string, value: string): Promise<void>;
  hasCredential(key: string): Promise<boolean>;
  removeCredential(key: string): Promise<void>;
  authoriseGoogle(domain: string): Promise<void>;
```

with the matching `ipcRenderer.invoke` bodies for channels `cred:set`, `cred:has`, `cred:remove`, `google:authorise`.

- [ ] **Step 2: Register the handlers**

In `registerIpc`, construct the store with Electron's real crypto and register:

```ts
  const credentials = new CredentialStore(deps.userDataDir, safeStorage);

  ipcMain.handle('cred:set', wrap('cred:set', (key: string, value: string) => credentials.set(key, value)));
  // Deliberately no cred:get. The renderer learns only that a credential exists.
  ipcMain.handle('cred:has', wrap('cred:has', (key: string) => credentials.has(key)));
  ipcMain.handle('cred:remove', wrap('cred:remove', (key: string) => credentials.remove(key)));
```

Import `safeStorage` from `electron` and `CredentialStore` from `./credentials`. Pass `credentials` into the two analyzer factories when building the registry.

- [ ] **Step 3: Implement the consent flow**

```ts
  ipcMain.handle(
    'google:authorise',
    wrap('google:authorise', async (domain: string) => {
      const { buildAuthUrl, exchangeCode, refreshTokenKey, SCOPES } = await import(
        './analyzers/traffic-owned/oauth'
      );

      const redirectUri = 'http://127.0.0.1:8412';
      const authWindow = new BrowserWindow({
        width: 600,
        height: 800,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      });

      try {
        const code = await new Promise<string>((resolve, reject) => {
          authWindow.webContents.on('will-redirect', (_event, url) => {
            if (!url.startsWith(redirectUri)) return;
            const params = new URL(url).searchParams;
            const returned = params.get('code');
            returned ? resolve(returned) : reject(new Error(params.get('error') ?? 'Consent denied.'));
          });
          authWindow.on('closed', () => reject(new Error('Consent window closed before completing.')));

          authWindow.loadURL(
            buildAuthUrl({ clientId: OAUTH.clientId, redirectUri, scopes: SCOPES })
          );
        });

        const { refreshToken } = await exchangeCode({
          code,
          clientId: OAUTH.clientId,
          clientSecret: OAUTH.clientSecret,
          redirectUri
        });

        await credentials.set(refreshTokenKey(domain), refreshToken);
      } finally {
        if (!authWindow.isDestroyed()) authWindow.destroy();
      }
    })
  );
```

`OAUTH` is read from the credential store at startup under keys
`google.clientId` and `google.clientSecret`, which the operator enters in
Settings. They are not compiled into the application.

- [ ] **Step 4: Extend the settings screen**

Add a Semrush section with a password-type input that writes via
`setCredential('semrush.apiKey', value)` and shows only whether a key is
stored, never the value. Add a Google section with the client id and secret
inputs plus an "Authorise this client" button calling `authoriseGoogle(domain)`,
and a GA4 property id field per client.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Wire credential storage and Google consent flow"
```

---

### Task 8: Traffic report rendering

**Files:**
- Create: `src/lib/report/TrafficEstimated.svelte`, `src/lib/report/TrafficOwned.svelte`
- Modify: `src/routes/report/[id]/+page.svelte`

- [ ] **Step 1: Write `TrafficEstimated.svelte`**

```svelte
<script lang="ts">
  export let data: {
    organicKeywords: number | null;
    organicTraffic: number | null;
    organicCost: number | null;
    adwordsKeywords: number | null;
  };

  const fmt = (n: number | null) => (n === null ? 'no data' : n.toLocaleString());
</script>

<!-- Labelled at the point of display: these are models, not measurements. -->
<p><strong>Estimated</strong> — modelled by Semrush, comparable across domains but not measured.</p>

<table>
  <tbody>
    <tr><td>Organic traffic (monthly)</td><td>{fmt(data.organicTraffic)}</td></tr>
    <tr><td>Organic keywords</td><td>{fmt(data.organicKeywords)}</td></tr>
    <tr><td>Organic cost equivalent</td><td>{fmt(data.organicCost)}</td></tr>
    <tr><td>Paid keywords</td><td>{fmt(data.adwordsKeywords)}</td></tr>
  </tbody>
</table>
```

- [ ] **Step 2: Write `TrafficOwned.svelte`**

```svelte
<script lang="ts">
  export let data: {
    range: { startDate: string; endDate: string };
    searchConsole:
      | { clicks: number; impressions: number; ctr: number; position: number; topQueries: Array<{ query: string; clicks: number }> }
      | { unavailable: string };
    analytics: { sessions: number; users: number; engagementRate: number } | { unavailable: string };
  };
</script>

<p><strong>Measured</strong> — {data.range.startDate} to {data.range.endDate}, from this client's own Google accounts.</p>

{#if 'unavailable' in data.searchConsole}
  <p>Search Console: {data.searchConsole.unavailable}</p>
{:else}
  <table>
    <tbody>
      <tr><td>Clicks</td><td>{data.searchConsole.clicks.toLocaleString()}</td></tr>
      <tr><td>Impressions</td><td>{data.searchConsole.impressions.toLocaleString()}</td></tr>
      <tr><td>CTR</td><td>{(data.searchConsole.ctr * 100).toFixed(2)}%</td></tr>
      <tr><td>Average position</td><td>{data.searchConsole.position.toFixed(1)}</td></tr>
    </tbody>
  </table>

  <h4>Top queries</h4>
  <ul>
    {#each data.searchConsole.topQueries as row}
      <li>{row.query} — {row.clicks} clicks</li>
    {/each}
  </ul>
{/if}

{#if 'unavailable' in data.analytics}
  <p>Analytics: {data.analytics.unavailable}</p>
{:else}
  <p>
    {data.analytics.sessions.toLocaleString()} sessions,
    {data.analytics.users.toLocaleString()} users,
    {(data.analytics.engagementRate * 100).toFixed(1)}% engaged.
  </p>
{/if}
```

- [ ] **Step 3: Register both components**

Add `'traffic-estimated': TrafficEstimated` and `'traffic-owned': TrafficOwned` to the `components` map, and add both analyzers to `available` in `src/routes/+page.svelte`.

- [ ] **Step 4: Verify the presentation risk is handled**

Run a report with a client plus one competitor, both traffic analyzers enabled.
Expected: the competitor's owned-traffic cell reads as an explanation ("Owned
traffic is only available for the client…"), not as a blank or a zero, and the
estimated figures appear for both domains carrying the word "Estimated".

This is the specific failure the spec flags as easiest to get wrong in front of
a client. Confirm it reads correctly before finishing.

- [ ] **Step 5: Run the full suite and commit**

```bash
npm run test && npm run check && npm run electron:compile && npm run lint
git add -A
git commit -m "Add traffic report rendering distinguishing measured from estimated"
```

---

### Task 9: Final verification

- [ ] **Step 1: Produce a packaged build**

```bash
npm run app:build
```

- [ ] **Step 2: Run a full report from the installed app**

A client plus two competitors, all nine analyzers enabled.
Expected: the run completes; analyzers without credentials or dependencies read
`unavailable` with a reason rather than failing; the PDF exports with one domain
per page.

- [ ] **Step 3: Confirm the credential boundary**

Search `<userData>/settings.json` for any secret value.
Expected: none. Only presence flags. Secrets appear solely in
`credentials.enc`, encrypted.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Complete the nine-analyzer report"
```
