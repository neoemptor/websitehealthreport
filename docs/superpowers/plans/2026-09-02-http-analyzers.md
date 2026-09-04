# HTTP Analyzers Implementation Plan (Plan 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the three analyzers that need nothing but HTTP — Wayback history, passive security checks, and AI Agent Optimisation — plus per-analyzer report rendering to replace plan 1's raw JSON dump.

**Architecture:** Each analyzer implements the `Analyzer` contract from plan 1, split into an I/O half and a pure `parse` half. All three are `concurrency: 'parallel'` and always available, so they need no preflight beyond a trivially true one.

**Tech Stack:** Node 18+ global `fetch`, Node `tls` module, Puppeteer (already present, used only for the AEO rendered-text comparison).

**Spec:** `docs/superpowers/specs/2026-09-02-website-health-report-design.md`

**Depends on:** Plan 1 (`docs/superpowers/plans/2026-09-02-foundation-and-first-analyzers.md`) must be complete. This plan consumes `Analyzer`, `createRegistry`, and the report route it created.

## Global Constraints

Inherits every constraint from plan 1. Additionally:

- **Security analysis is passive only.** Fetch, read headers, inspect the TLS handshake. No request is made to probe for a vulnerability, no payload is sent, no path is guessed. Active scanning is out of scope for the entire project.
- AEO results are presented as findings, never as a single score. There is no standard for this category and a number would imply a rigour that does not exist.
- Every fetch carries a timeout and a descriptive `User-Agent`. An analyzer must never hang a run.

---

## File Structure

| Path | Responsibility |
|---|---|
| `electron/analyzers/wayback/{index,parse}.ts` | Wayback CDX snapshot counts. |
| `electron/analyzers/security/{index,parse,tls}.ts` | Header checks, cookie flags, TLS inspection. |
| `electron/analyzers/aeo/{index,parse}.ts` | Crawler rules, structured data, JS-dependency ratio. |
| `electron/http.ts` | Shared `fetchText` with timeout and User-Agent. |
| `src/lib/report/{Wayback,Security,Aeo}.svelte` | Per-analyzer report rendering. |
| `src/lib/report/Unknown.svelte` | JSON fallback for analyzers without a component yet. |

---

### Task 1: Shared HTTP helper

**Files:**
- Create: `electron/http.ts`
- Test: `electron/http.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `fetchText(url: string, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<{ status: number; headers: Headers; body: string; finalUrl: string }>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchText, USER_AGENT } from './http';

afterEach(() => vi.unstubAllGlobals());

describe('fetchText', () => {
  it('returns status, headers and body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('hello', { status: 200, headers: { 'x-a': '1' } }))
    );
    const result = await fetchText('https://example.com/');
    expect(result.status).toBe(200);
    expect(result.body).toBe('hello');
    expect(result.headers.get('x-a')).toBe('1');
  });

  it('identifies itself with a descriptive User-Agent', async () => {
    const spy = vi.fn(async () => new Response('', { status: 200 }));
    vi.stubGlobal('fetch', spy);
    await fetchText('https://example.com/');
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)['User-Agent']).toBe(USER_AGENT);
  });

  it('throws a descriptive error when the request times out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) =>
        new Promise((_, reject) =>
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        )
      )
    );
    await expect(fetchText('https://example.com/', { timeoutMs: 20 })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run electron/http.test.ts` — FAIL, cannot resolve `./http`.

- [ ] **Step 3: Write the implementation**

```ts
export const USER_AGENT = 'WebsiteHealthReport/1.0 (+desktop analysis tool)';

export type FetchTextResult = {
  status: number;
  headers: Headers;
  body: string;
  finalUrl: string;
};

export async function fetchText(
  url: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<FetchTextResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
  opts.signal?.addEventListener('abort', () => controller.abort());

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT }
    });

    return {
      status: response.status,
      headers: response.headers,
      body: await response.text(),
      finalUrl: response.url || url
    };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes** — `npx vitest run electron/http.test.ts`, 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/http.ts electron/http.test.ts
git commit -m "Add shared HTTP helper with timeout and User-Agent"
```

---

### Task 2: Wayback analyzer

**Files:**
- Create: `electron/analyzers/wayback/parse.ts`, `electron/analyzers/wayback/index.ts`
- Test: `electron/analyzers/wayback/parse.test.ts`
- Delete: `src/lib/server/WBMData.ts`

**Interfaces:**
- Consumes: `Analyzer`, `fetchText`.
- Produces: `parseCdx(rows: unknown): WaybackData` where `WaybackData = { firstSeen: string | null; lastSeen: string | null; snapshotsByYear: Array<{ year: string; count: number }> }`, and `waybackAnalyzer: Analyzer<Record<string, never>>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseCdx } from './parse';

// The CDX API returns a header row followed by data rows.
const rows = [
  ['urlkey', 'timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length'],
  ['au,com,x)/', '20180412000000', 'https://x.com.au/', 'text/html', '200', 'A', '1'],
  ['au,com,x)/', '20180915000000', 'https://x.com.au/', 'text/html', '200', 'B', '1'],
  ['au,com,x)/', '20210103000000', 'https://x.com.au/', 'text/html', '200', 'C', '1']
];

describe('parseCdx', () => {
  it('counts snapshots per year', () => {
    expect(parseCdx(rows).snapshotsByYear).toEqual([
      { year: '2018', count: 2 },
      { year: '2021', count: 1 }
    ]);
  });

  it('reports first and last seen dates', () => {
    const data = parseCdx(rows);
    expect(data.firstSeen).toBe('2018-04-12');
    expect(data.lastSeen).toBe('2021-01-03');
  });

  it('handles a domain with no snapshots', () => {
    expect(parseCdx([])).toEqual({ firstSeen: null, lastSeen: null, snapshotsByYear: [] });
  });

  it('handles a header-only response', () => {
    expect(parseCdx([rows[0]]).snapshotsByYear).toEqual([]);
  });

  it('throws on a non-array response', () => {
    expect(() => parseCdx({ error: true })).toThrow(/array/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL, cannot resolve `./parse`.

- [ ] **Step 3: Write `parse.ts`**

```ts
export type WaybackData = {
  firstSeen: string | null;
  lastSeen: string | null;
  snapshotsByYear: Array<{ year: string; count: number }>;
};

/** CDX timestamps are YYYYMMDDhhmmss. */
function toIsoDate(timestamp: string): string {
  return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
}

export function parseCdx(input: unknown): WaybackData {
  if (!Array.isArray(input)) {
    throw new Error('Wayback CDX response was not an array.');
  }

  // First row is the column header when any rows are present.
  const dataRows = (input as string[][]).slice(1).filter((row) => Array.isArray(row) && row[1]);
  if (dataRows.length === 0) {
    return { firstSeen: null, lastSeen: null, snapshotsByYear: [] };
  }

  const timestamps = dataRows.map((row) => row[1]).sort();
  const counts = new Map<string, number>();
  for (const timestamp of timestamps) {
    const year = timestamp.slice(0, 4);
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }

  return {
    firstSeen: toIsoDate(timestamps[0]),
    lastSeen: toIsoDate(timestamps[timestamps.length - 1]),
    snapshotsByYear: [...counts.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year.localeCompare(b.year))
  };
}
```

- [ ] **Step 4: Run test to verify it passes** — 5 tests PASS.

- [ ] **Step 5: Write `index.ts`**

```ts
import type { Analyzer } from '../types';
import { fetchText } from '../../http';
import { parseCdx, type WaybackData } from './parse';

const BASE_URL = 'http://web.archive.org/cdx/search/cdx';

export const waybackAnalyzer: Analyzer<Record<string, never>> = {
  id: 'wayback',
  label: 'Wayback History',
  concurrency: 'parallel',
  timeoutMs: 30_000,
  defaultSettings: {},

  // Nothing to install and nothing to configure.
  async preflight() {
    return { available: true };
  },

  async analyze(domain, _settings, signal): Promise<WaybackData> {
    const url = new URL(BASE_URL);
    url.searchParams.set('url', new URL(domain).hostname);
    url.searchParams.set('output', 'json');
    url.searchParams.set('collapse', 'timestamp:8');
    url.searchParams.set('filter', 'statuscode:200');

    const { body } = await fetchText(url.toString(), { signal, timeoutMs: 25_000 });
    return parseCdx(body.trim().length === 0 ? [] : JSON.parse(body));
  }
};
```

- [ ] **Step 6: Delete the old implementation**

```bash
git rm src/lib/server/WBMData.ts
```

- [ ] **Step 7: Commit**

```bash
git add electron/analyzers/wayback/
git commit -m "Add Wayback analyzer"
```

---

### Task 3: Security header analysis

**Files:**
- Create: `electron/analyzers/security/parse.ts`
- Test: `electron/analyzers/security/parse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseSecurityHeaders(headers: Headers): HeaderFinding[]` where `HeaderFinding = { header: string; present: boolean; value: string | null; severity: 'high' | 'medium' | 'low'; note: string }`, and `parseCookieFlags(setCookie: string[]): CookieFinding[]`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseSecurityHeaders, parseCookieFlags } from './parse';

describe('parseSecurityHeaders', () => {
  it('flags a missing Content-Security-Policy as high severity', () => {
    const findings = parseSecurityHeaders(new Headers());
    const csp = findings.find((f) => f.header === 'content-security-policy');
    expect(csp).toMatchObject({ present: false, severity: 'high' });
  });

  it('records the value when a header is present', () => {
    const headers = new Headers({ 'strict-transport-security': 'max-age=31536000' });
    const hsts = parseSecurityHeaders(headers).find(
      (f) => f.header === 'strict-transport-security'
    );
    expect(hsts).toMatchObject({ present: true, value: 'max-age=31536000' });
  });

  it('reports version disclosure as a finding', () => {
    const headers = new Headers({ 'x-powered-by': 'PHP/7.2.1' });
    const finding = parseSecurityHeaders(headers).find((f) => f.header === 'x-powered-by');
    expect(finding?.present).toBe(true);
    expect(finding?.note).toMatch(/disclos/i);
  });

  it('checks every header in the OWASP set', () => {
    expect(parseSecurityHeaders(new Headers())).toHaveLength(7);
  });
});

describe('parseCookieFlags', () => {
  it('flags a cookie missing Secure and HttpOnly', () => {
    const [finding] = parseCookieFlags(['session=abc; Path=/']);
    expect(finding).toMatchObject({ name: 'session', secure: false, httpOnly: false });
  });

  it('recognises all three flags when present', () => {
    const [finding] = parseCookieFlags(['session=abc; Secure; HttpOnly; SameSite=Lax']);
    expect(finding).toMatchObject({ secure: true, httpOnly: true, sameSite: 'Lax' });
  });

  it('returns an empty array when no cookies are set', () => {
    expect(parseCookieFlags([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL, cannot resolve `./parse`.

- [ ] **Step 3: Write `parse.ts`**

```ts
export type Severity = 'high' | 'medium' | 'low';

export type HeaderFinding = {
  header: string;
  present: boolean;
  value: string | null;
  severity: Severity;
  note: string;
};

export type CookieFinding = {
  name: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | null;
};

type HeaderCheck = {
  header: string;
  severity: Severity;
  /** Note used when the header is absent, or — for disclosure headers — when present. */
  note: string;
  /** Disclosure headers are a finding when present rather than when missing. */
  badWhenPresent?: boolean;
};

// Drawn from the OWASP Secure Headers Project. Passive: reading response
// headers only, no probing.
const CHECKS: HeaderCheck[] = [
  { header: 'content-security-policy', severity: 'high', note: 'No CSP: the page has no defence against injected scripts.' },
  { header: 'strict-transport-security', severity: 'high', note: 'No HSTS: browsers may fall back to plain HTTP.' },
  { header: 'x-frame-options', severity: 'medium', note: 'No frame protection: the site can be embedded for clickjacking.' },
  { header: 'x-content-type-options', severity: 'medium', note: 'Missing nosniff: browsers may guess content types.' },
  { header: 'referrer-policy', severity: 'low', note: 'No referrer policy: full URLs leak to third parties.' },
  { header: 'permissions-policy', severity: 'low', note: 'No permissions policy: browser features are unrestricted.' },
  { header: 'x-powered-by', severity: 'low', note: 'Version disclosure: reveals the server stack to attackers.', badWhenPresent: true }
];

export function parseSecurityHeaders(headers: Headers): HeaderFinding[] {
  return CHECKS.map((check) => {
    const value = headers.get(check.header);
    const present = value !== null;

    return {
      header: check.header,
      present,
      value,
      severity: check.severity,
      note: check.badWhenPresent
        ? present
          ? check.note
          : 'Not disclosed.'
        : present
          ? 'Present.'
          : check.note
    };
  });
}

export function parseCookieFlags(setCookie: string[]): CookieFinding[] {
  return setCookie.map((cookie) => {
    const attributes = cookie.split(';').map((part) => part.trim());
    const sameSite = attributes.find((a) => /^SameSite=/i.test(a));

    return {
      name: attributes[0]?.split('=')[0] ?? '',
      secure: attributes.some((a) => /^Secure$/i.test(a)),
      httpOnly: attributes.some((a) => /^HttpOnly$/i.test(a)),
      sameSite: sameSite ? sameSite.split('=')[1] : null
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes** — 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/analyzers/security/parse.ts electron/analyzers/security/parse.test.ts
git commit -m "Add OWASP security header parsing"
```

---

### Task 4: TLS inspection and security analyzer assembly

**Files:**
- Create: `electron/analyzers/security/tls.ts`, `electron/analyzers/security/index.ts`
- Test: `electron/analyzers/security/tls.test.ts`

**Interfaces:**
- Consumes: `parseSecurityHeaders`, `parseCookieFlags`, `fetchText`.
- Produces: `daysUntil(expiry: string, now: Date): number`, `inspectTls(hostname: string): Promise<TlsInfo>` where `TlsInfo = { protocol: string | null; validTo: string | null; daysRemaining: number | null; issuer: string | null }`, and `securityAnalyzer: Analyzer<Record<string, never>>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { daysUntil } from './tls';

describe('daysUntil', () => {
  it('counts whole days to expiry', () => {
    expect(daysUntil('Dec 31 23:59:59 2026 GMT', new Date('2026-12-01T00:00:00Z'))).toBe(30);
  });

  it('returns a negative number for an expired certificate', () => {
    expect(daysUntil('Jan 1 00:00:00 2026 GMT', new Date('2026-02-01T00:00:00Z'))).toBeLessThan(0);
  });

  it('throws on an unparseable date rather than returning NaN', () => {
    expect(() => daysUntil('not a date', new Date())).toThrow(/date/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL, cannot resolve `./tls`.

- [ ] **Step 3: Write `tls.ts`**

```ts
import * as tls from 'tls';

export type TlsInfo = {
  protocol: string | null;
  validTo: string | null;
  daysRemaining: number | null;
  issuer: string | null;
};

export function daysUntil(expiry: string, now: Date): number {
  const parsed = Date.parse(expiry);
  if (Number.isNaN(parsed)) {
    throw new Error(`Could not parse certificate date: ${expiry}`);
  }
  return Math.floor((parsed - now.getTime()) / 86_400_000);
}

/** Opens a TLS connection and reads the presented certificate. Passive. */
export function inspectTls(hostname: string): Promise<TlsInfo> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: hostname, port: 443, servername: hostname }, () => {
      const cert = socket.getPeerCertificate();
      const info: TlsInfo = {
        protocol: socket.getProtocol(),
        validTo: cert?.valid_to ?? null,
        daysRemaining: cert?.valid_to ? daysUntil(cert.valid_to, new Date()) : null,
        issuer: cert?.issuer?.O ?? null
      };
      socket.end();
      resolve(info);
    });

    socket.setTimeout(10_000, () => {
      socket.destroy();
      reject(new Error(`TLS connection to ${hostname} timed out.`));
    });
    socket.on('error', reject);
  });
}
```

- [ ] **Step 4: Run test to verify it passes** — 3 tests PASS.

- [ ] **Step 5: Write `index.ts`**

```ts
import type { Analyzer } from '../types';
import { fetchText } from '../../http';
import { parseCookieFlags, parseSecurityHeaders, type CookieFinding, type HeaderFinding } from './parse';
import { inspectTls, type TlsInfo } from './tls';

export type SecurityData = {
  headers: HeaderFinding[];
  cookies: CookieFinding[];
  tls: TlsInfo | { error: string };
  servedOverHttps: boolean;
};

export const securityAnalyzer: Analyzer<Record<string, never>> = {
  id: 'security',
  label: 'Security',
  concurrency: 'parallel',
  timeoutMs: 45_000,
  defaultSettings: {},

  async preflight() {
    return { available: true };
  },

  async analyze(domain, _settings, signal): Promise<SecurityData> {
    const response = await fetchText(domain, { signal, timeoutMs: 20_000 });
    const hostname = new URL(response.finalUrl).hostname;

    // A TLS failure is a finding about the site, not a failure of the run,
    // so it is captured rather than thrown.
    let tlsResult: TlsInfo | { error: string };
    try {
      tlsResult = await inspectTls(hostname);
    } catch (error) {
      tlsResult = { error: (error as Error).message };
    }

    return {
      headers: parseSecurityHeaders(response.headers),
      cookies: parseCookieFlags(response.headers.getSetCookie?.() ?? []),
      tls: tlsResult,
      servedOverHttps: new URL(response.finalUrl).protocol === 'https:'
    };
  }
};
```

- [ ] **Step 6: Commit**

```bash
git add electron/analyzers/security/
git commit -m "Add passive security analyzer with TLS inspection"
```

---

### Task 5: AEO parsing

**Files:**
- Create: `electron/analyzers/aeo/parse.ts`
- Test: `electron/analyzers/aeo/parse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseRobotsForAiCrawlers(robotsTxt: string): CrawlerRule[]` where `CrawlerRule = { agent: string; allowed: boolean }`; `parseStructuredData(html: string): { blocks: number; valid: number; types: string[] }`; `parseHeadings(html: string): { h1Count: number; hierarchyOk: boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseRobotsForAiCrawlers, parseStructuredData, parseHeadings, AI_CRAWLERS } from './parse';

describe('parseRobotsForAiCrawlers', () => {
  it('treats an absent rule as allowed', () => {
    const rules = parseRobotsForAiCrawlers('User-agent: *\nAllow: /');
    expect(rules.every((r) => r.allowed)).toBe(true);
  });

  it('detects a blanket disallow for a named crawler', () => {
    const rules = parseRobotsForAiCrawlers('User-agent: GPTBot\nDisallow: /');
    expect(rules.find((r) => r.agent === 'GPTBot')?.allowed).toBe(false);
  });

  it('is case insensitive about the agent name', () => {
    const rules = parseRobotsForAiCrawlers('user-agent: gptbot\ndisallow: /');
    expect(rules.find((r) => r.agent === 'GPTBot')?.allowed).toBe(false);
  });

  it('reports one rule per known AI crawler', () => {
    expect(parseRobotsForAiCrawlers('')).toHaveLength(AI_CRAWLERS.length);
  });
});

describe('parseStructuredData', () => {
  it('counts and validates JSON-LD blocks', () => {
    const html = `<script type="application/ld+json">{"@type":"LocalBusiness"}</script>`;
    expect(parseStructuredData(html)).toEqual({ blocks: 1, valid: 1, types: ['LocalBusiness'] });
  });

  it('counts an invalid block without throwing', () => {
    const html = `<script type="application/ld+json">{ broken</script>`;
    expect(parseStructuredData(html)).toEqual({ blocks: 1, valid: 0, types: [] });
  });

  it('returns zeroes when there is no structured data', () => {
    expect(parseStructuredData('<p>hi</p>')).toEqual({ blocks: 0, valid: 0, types: [] });
  });
});

describe('parseHeadings', () => {
  it('accepts a single h1 followed by h2', () => {
    expect(parseHeadings('<h1>a</h1><h2>b</h2>')).toEqual({ h1Count: 1, hierarchyOk: true });
  });

  it('flags a skipped level', () => {
    expect(parseHeadings('<h1>a</h1><h3>b</h3>').hierarchyOk).toBe(false);
  });

  it('flags multiple h1 elements', () => {
    expect(parseHeadings('<h1>a</h1><h1>b</h1>').h1Count).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL, cannot resolve `./parse`.

- [ ] **Step 3: Write `parse.ts`**

```ts
export const AI_CRAWLERS = ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended', 'CCBot'];

export type CrawlerRule = { agent: string; allowed: boolean };

export function parseRobotsForAiCrawlers(robotsTxt: string): CrawlerRule[] {
  const lines = robotsTxt.split('\n').map((line) => line.trim());

  return AI_CRAWLERS.map((agent) => {
    let inBlock = false;
    let disallowed = false;

    for (const line of lines) {
      const userAgent = /^user-agent:\s*(.+)$/i.exec(line);
      if (userAgent) {
        inBlock = userAgent[1].trim().toLowerCase() === agent.toLowerCase();
        continue;
      }
      if (inBlock && /^disallow:\s*\/\s*$/i.test(line)) {
        disallowed = true;
      }
    }

    // No rule naming the crawler means it is not blocked.
    return { agent, allowed: !disallowed };
  });
}

export function parseStructuredData(html: string): { blocks: number; valid: number; types: string[] } {
  const matches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const types: string[] = [];
  let valid = 0;

  for (const match of matches) {
    try {
      const parsed = JSON.parse(match[1]);
      valid++;
      for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
        if (typeof node?.['@type'] === 'string') types.push(node['@type']);
      }
    } catch {
      // An unparseable block still counts toward blocks, not valid.
    }
  }

  return { blocks: matches.length, valid, types };
}

export function parseHeadings(html: string): { h1Count: number; hierarchyOk: boolean } {
  const levels = [...html.matchAll(/<h([1-6])[^>]*>/gi)].map((m) => Number(m[1]));
  const h1Count = levels.filter((level) => level === 1).length;

  let hierarchyOk = h1Count === 1;
  for (let i = 1; i < levels.length; i++) {
    // Descending more than one level at a time skips a heading rank.
    if (levels[i] - levels[i - 1] > 1) hierarchyOk = false;
  }

  return { h1Count, hierarchyOk };
}
```

- [ ] **Step 4: Run test to verify it passes** — 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/analyzers/aeo/parse.ts electron/analyzers/aeo/parse.test.ts
git commit -m "Add AEO parsing for crawler rules, structured data and headings"
```

---

### Task 6: AEO analyzer with JS-dependency ratio

**Files:**
- Create: `electron/analyzers/aeo/index.ts`
- Test: `electron/analyzers/aeo/ratio.test.ts`

**Interfaces:**
- Consumes: the parsers from Task 5, `fetchText`, Puppeteer.
- Produces: `jsDependencyRatio(rawText: string, renderedText: string): number` and `aeoAnalyzer: Analyzer<Record<string, never>>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { jsDependencyRatio } from './index';

describe('jsDependencyRatio', () => {
  it('returns 1 when all content is present without JavaScript', () => {
    expect(jsDependencyRatio('hello world', 'hello world')).toBe(1);
  });

  it('returns near zero when content only appears after JavaScript runs', () => {
    expect(jsDependencyRatio('', 'a lot of rendered content here')).toBe(0);
  });

  it('returns a fraction for partial server rendering', () => {
    expect(jsDependencyRatio('12345', '1234567890')).toBeCloseTo(0.5);
  });

  it('returns 1 when the rendered page is empty, to avoid dividing by zero', () => {
    expect(jsDependencyRatio('', '')).toBe(1);
  });

  it('never exceeds 1 when raw text is longer than rendered', () => {
    expect(jsDependencyRatio('longer raw text', 'short')).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL, `jsDependencyRatio` not exported.

- [ ] **Step 3: Write `index.ts`**

```ts
import puppeteer from 'puppeteer';
import type { Analyzer } from '../types';
import { fetchText } from '../../http';
import {
  parseHeadings,
  parseRobotsForAiCrawlers,
  parseStructuredData,
  type CrawlerRule
} from './parse';

export type AeoData = {
  llmsTxt: boolean;
  crawlers: CrawlerRule[];
  structuredData: { blocks: number; valid: number; types: string[] };
  headings: { h1Count: number; hierarchyOk: boolean };
  jsDependencyRatio: number;
  sitemap: boolean;
};

/**
 * Proportion of the rendered text that is already present without JavaScript.
 * 1 means fully server-rendered; near 0 means AI crawlers see almost nothing.
 */
export function jsDependencyRatio(rawText: string, renderedText: string): number {
  const rendered = renderedText.trim().length;
  if (rendered === 0) return 1;
  return Math.min(1, rawText.trim().length / rendered);
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

async function exists(url: string, signal: AbortSignal): Promise<boolean> {
  try {
    return (await fetchText(url, { signal, timeoutMs: 10_000 })).status === 200;
  } catch {
    return false;
  }
}

export const aeoAnalyzer: Analyzer<Record<string, never>> = {
  id: 'aeo',
  label: 'AI Agent Optimisation',
  concurrency: 'limited',
  timeoutMs: 90_000,
  defaultSettings: {},

  async preflight() {
    return { available: true };
  },

  async analyze(domain, _settings, signal): Promise<AeoData> {
    const origin = new URL(domain).origin;

    const [page, robots, llmsTxt, sitemap] = await Promise.all([
      fetchText(domain, { signal, timeoutMs: 20_000 }),
      fetchText(`${origin}/robots.txt`, { signal, timeoutMs: 10_000 }).catch(() => ({ body: '' })),
      exists(`${origin}/llms.txt`, signal),
      exists(`${origin}/sitemap.xml`, signal)
    ]);

    const browser = await puppeteer.launch();
    let renderedText = '';
    try {
      const tab = await browser.newPage();
      try {
        await tab.goto(domain, { waitUntil: 'networkidle2' });
        renderedText = await tab.evaluate(() => document.body.innerText);
      } finally {
        await tab.close();
      }
    } finally {
      await browser.close();
    }

    return {
      llmsTxt,
      sitemap,
      crawlers: parseRobotsForAiCrawlers(robots.body),
      structuredData: parseStructuredData(page.body),
      headings: parseHeadings(page.body),
      jsDependencyRatio: jsDependencyRatio(stripTags(page.body), renderedText)
    };
  }
};
```

- [ ] **Step 4: Run test to verify it passes** — 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/analyzers/aeo/
git commit -m "Add AEO analyzer with JS dependency ratio"
```

---

### Task 7: Register the analyzers and render them

**Files:**
- Modify: `electron/ipc.ts`, `src/routes/+page.svelte`, `src/routes/report/[id]/+page.svelte`
- Create: `src/lib/report/{Wayback,Security,Aeo,Unknown}.svelte`

**Interfaces:**
- Consumes: `waybackAnalyzer`, `securityAnalyzer`, `aeoAnalyzer`.
- Produces: report components keyed by `AnalyzerId`, extended by plans 3 and 4.

- [ ] **Step 1: Register the analyzers**

In `electron/ipc.ts`, extend the registry:

```ts
import { waybackAnalyzer } from './analyzers/wayback';
import { securityAnalyzer } from './analyzers/security';
import { aeoAnalyzer } from './analyzers/aeo';

  const registry = createRegistry([
    lighthouseAnalyzer,
    keywordsAnalyzer,
    waybackAnalyzer,
    securityAnalyzer,
    aeoAnalyzer
  ]);
```

- [ ] **Step 2: Offer them on the setup screen**

In `src/routes/+page.svelte`, extend `available`:

```ts
  const available: Array<{ id: AnalyzerId; label: string }> = [
    { id: 'lighthouse', label: 'Lighthouse' },
    { id: 'keywords', label: 'Keywords' },
    { id: 'wayback', label: 'Wayback History' },
    { id: 'security', label: 'Security' },
    { id: 'aeo', label: 'AI Agent Optimisation' }
  ];
```

- [x] **Step 3: Create `src/lib/report/Unknown.svelte`** — ALREADY DONE. Pulled forward with the UI styling work; it exists and is styled for the report document. Skip this step.

```svelte
<script lang="ts">
  export let data: unknown;
</script>

<pre>{JSON.stringify(data, null, 2)}</pre>
```

- [ ] **Step 4: Create `src/lib/report/Wayback.svelte`**

```svelte
<script lang="ts">
  export let data: {
    firstSeen: string | null;
    lastSeen: string | null;
    snapshotsByYear: Array<{ year: string; count: number }>;
  };
</script>

{#if data.firstSeen}
  <p>Archived from {data.firstSeen} to {data.lastSeen}.</p>
  <table>
    <thead><tr><th>Year</th><th>Snapshots</th></tr></thead>
    <tbody>
      {#each data.snapshotsByYear as row}
        <tr><td>{row.year}</td><td>{row.count}</td></tr>
      {/each}
    </tbody>
  </table>
{:else}
  <p>No archived snapshots found.</p>
{/if}
```

- [ ] **Step 5: Create `src/lib/report/Security.svelte`**

```svelte
<script lang="ts">
  export let data: {
    headers: Array<{ header: string; present: boolean; severity: string; note: string }>;
    cookies: Array<{ name: string; secure: boolean; httpOnly: boolean; sameSite: string | null }>;
    tls: { protocol?: string | null; daysRemaining?: number | null; error?: string };
    servedOverHttps: boolean;
  };
</script>

<p>Served over HTTPS: {data.servedOverHttps ? 'yes' : 'no'}</p>

{#if data.tls.error}
  <p>TLS could not be inspected — {data.tls.error}</p>
{:else}
  <p>TLS {data.tls.protocol}, certificate expires in {data.tls.daysRemaining} days.</p>
{/if}

<table>
  <thead><tr><th>Header</th><th>Status</th><th>Severity</th><th>Note</th></tr></thead>
  <tbody>
    {#each data.headers as finding}
      <tr>
        <td>{finding.header}</td>
        <td>{finding.present ? 'present' : 'missing'}</td>
        <td>{finding.severity}</td>
        <td>{finding.note}</td>
      </tr>
    {/each}
  </tbody>
</table>

{#if data.cookies.length > 0}
  <table>
    <thead><tr><th>Cookie</th><th>Secure</th><th>HttpOnly</th><th>SameSite</th></tr></thead>
    <tbody>
      {#each data.cookies as cookie}
        <tr>
          <td>{cookie.name}</td>
          <td>{cookie.secure ? 'yes' : 'no'}</td>
          <td>{cookie.httpOnly ? 'yes' : 'no'}</td>
          <td>{cookie.sameSite ?? 'not set'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
```

- [ ] **Step 6: Create `src/lib/report/Aeo.svelte`**

```svelte
<script lang="ts">
  export let data: {
    llmsTxt: boolean;
    sitemap: boolean;
    crawlers: Array<{ agent: string; allowed: boolean }>;
    structuredData: { blocks: number; valid: number; types: string[] };
    headings: { h1Count: number; hierarchyOk: boolean };
    jsDependencyRatio: number;
  };

  $: percentWithoutJs = Math.round(data.jsDependencyRatio * 100);
</script>

<!-- Findings, not a score. There is no standard for this category. -->
<ul>
  <li>llms.txt: {data.llmsTxt ? 'present' : 'absent'}</li>
  <li>sitemap.xml: {data.sitemap ? 'present' : 'absent'}</li>
  <li>Structured data: {data.structuredData.valid} of {data.structuredData.blocks} blocks valid
    {#if data.structuredData.types.length}({data.structuredData.types.join(', ')}){/if}
  </li>
  <li>Headings: {data.headings.h1Count} h1, hierarchy {data.headings.hierarchyOk ? 'consistent' : 'skips levels'}</li>
  <li><strong>{percentWithoutJs}% of page text is available without JavaScript.</strong>
    {#if percentWithoutJs < 50}Most content is invisible to AI crawlers.{/if}
  </li>
</ul>

<table>
  <thead><tr><th>AI crawler</th><th>robots.txt</th></tr></thead>
  <tbody>
    {#each data.crawlers as crawler}
      <tr><td>{crawler.agent}</td><td>{crawler.allowed ? 'allowed' : 'blocked'}</td></tr>
    {/each}
  </tbody>
</table>
```

- [ ] **Step 7: Dispatch by analyzer id in the report**

In `src/routes/report/[id]/+page.svelte`, replace the `<pre>` fallback:

```svelte
<script lang="ts">
  import Wayback from '$lib/report/Wayback.svelte';
  import Security from '$lib/report/Security.svelte';
  import Aeo from '$lib/report/Aeo.svelte';
  import Unknown from '$lib/report/Unknown.svelte';
  import type { AnalyzerId } from '$lib/shared/types';

  // Analyzers without a component yet fall back to JSON, so adding an
  // analyzer never breaks the report.
  // ComponentType, not `typeof Unknown`: a component declaring a narrow data
  // shape is not assignable where one accepting `unknown` is expected, and
  // svelte-check fails on it. Import it with: import type { ComponentType } from 'svelte';
  const components: Partial<Record<AnalyzerId, ComponentType>> = {
    wayback: Wayback,
    security: Security,
    aeo: Aeo
  };
</script>
```

and replace the `{:else}` branch of the result block with:

```svelte
        {:else}
          <svelte:component this={components[id] ?? Unknown} data={result.data} />
        {/if}
```

- [ ] **Step 8: Verify end to end**

Run: `npm run electron:dev`, run all five analyzers against a real domain.
Expected: Wayback shows a year table, Security shows header findings, AEO shows the percentage without JavaScript. Lighthouse and Keywords still fall back to JSON.

- [ ] **Step 9: Run the full suite and commit**

```bash
npm run test && npm run check && npm run electron:compile && npm run lint
git add -A
git commit -m "Register HTTP analyzers and add report rendering"
```

---

## Deferred to later plans

- **Plan 3:** SEO Quake, Content (AU spelling and grammar), plus `Lighthouse.svelte` and `Keywords.svelte` report components.
- **Plan 4:** Traffic estimated (Semrush), Traffic owned (GSC/GA4 OAuth), `safeStorage` credentials.
