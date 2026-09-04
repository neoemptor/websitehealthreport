# Browser and Content Analyzers Implementation Plan (Plan 3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two fragile analyzers — SEO Quake, which scrapes a browser extension, and Content, which checks Australian spelling and grammar — plus the remaining report components.

**Architecture:** Both analyzers implement the plan 1 contract. SEO Quake is `serial` because it opens a visible browser window. Content is unusual: it holds two independent checks, so the grammar half carries its own nested status rather than a top-level one.

**Tech Stack:** Puppeteer 21, `nspell`, `dictionary-en-au`, LanguageTool HTTP API.

**Spec:** `docs/superpowers/specs/2026-09-02-website-health-report-design.md`

**Depends on:** Plans 1 and 2 complete.

## Global Constraints

Inherits every constraint from plans 1 and 2. Additionally:

- **SEO Quake will break.** It reads undocumented DOM classes belonging to a third-party extension. Every failure path must degrade to `unavailable` or `failed` with a readable reason — never a crash, never a silent zero.
- **Grammar defaults to `off`.** No client content leaves the machine unless the operator explicitly selects a provider. Selecting `languagetool-public` must display, at the point of selection, that page content is sent to a third party.
- Spelling always runs offline and never depends on the grammar provider.
- The `content` analyzer returns `ok` whenever spelling succeeds. Grammar's state lives inside its data.

---

## File Structure

| Path | Responsibility |
|---|---|
| `electron/analyzers/seoquake/{paths,parse,index}.ts` | Chrome/extension resolution, toolbar parsing, analyzer. |
| `electron/analyzers/content/{spelling,grammar,index}.ts` | Offline spelling, LanguageTool client, analyzer assembly. |
| `src/lib/report/{SeoQuake,Content,Lighthouse,Keywords}.svelte` | Report rendering. |
| `src/routes/settings/+page.svelte` | Settings screen, including the grammar provider warning. |

---

### Task 1: Chrome and extension path resolution

**Files:**
- Create: `electron/analyzers/seoquake/paths.ts`
- Test: `electron/analyzers/seoquake/paths.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `chromeCandidates(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string[]`, `extensionRoot(platform, env, home): string`, `pickLatestVersion(dirs: string[]): string`.

These are pure so they can be tested for every platform from one machine.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { chromeCandidates, extensionRoot, pickLatestVersion } from './paths';

describe('chromeCandidates', () => {
  it('checks both Program Files locations on Windows', () => {
    const paths = chromeCandidates(
      'win32',
      { ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
      'C:\\Users\\x'
    );
    expect(paths).toHaveLength(2);
    expect(paths[0]).toContain('Program Files\\Google');
    expect(paths[1]).toContain('Program Files (x86)');
  });

  it('always produces absolute Windows paths with a drive letter', () => {
    for (const p of chromeCandidates('win32', {}, 'C:\\Users\\x')) {
      expect(p).toMatch(/^[A-Z]:\\/);
    }
  });

  it('returns the app bundle path on macOS', () => {
    expect(chromeCandidates('darwin', {}, '/Users/x')[0]).toContain('/Applications/Google Chrome.app');
  });

  it('returns several binary names on Linux', () => {
    expect(chromeCandidates('linux', {}, '/home/x').length).toBeGreaterThan(1);
  });
});

describe('extensionRoot', () => {
  it('uses LOCALAPPDATA on Windows', () => {
    const root = extensionRoot('win32', { LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local' }, 'C:\\Users\\x');
    expect(root).toContain('User Data');
    expect(root).toContain('akdgnmcogleenhbclghghlkkdndkjdjc');
  });

  it('uses Application Support on macOS', () => {
    expect(extensionRoot('darwin', {}, '/Users/x')).toContain('Application Support');
  });
});

describe('pickLatestVersion', () => {
  it('picks the highest version, not the lexically largest', () => {
    expect(pickLatestVersion(['3.9.1_0', '3.13.5_0', '3.10.3_0'])).toBe('3.13.5_0');
  });

  it('throws when there are no versions', () => {
    expect(() => pickLatestVersion([])).toThrow(/version/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL, cannot resolve `./paths`.

- [ ] **Step 3: Write the implementation**

```ts
import * as path from 'path';

export const SEOQUAKE_EXTENSION_ID = 'akdgnmcogleenhbclghghlkkdndkjdjc';

export function chromeCandidates(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string
): string[] {
  switch (platform) {
    case 'win32': {
      // Chrome installs to either location depending on installer and age,
      // and the original code omitted the drive letter entirely.
      const programFiles = env['ProgramFiles'] ?? 'C:\\Program Files';
      const programFilesX86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
      return [
        path.win32.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.win32.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe')
      ];
    }
    case 'darwin':
      return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
    default:
      return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'];
  }
}

function userDataDir(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): string {
  switch (platform) {
    case 'win32':
      return path.win32.join(
        env['LOCALAPPDATA'] ?? path.win32.join(home, 'AppData', 'Local'),
        'Google', 'Chrome', 'User Data'
      );
    case 'darwin':
      return path.posix.join(home, 'Library', 'Application Support', 'Google', 'Chrome');
    default:
      return path.posix.join(home, '.config', 'google-chrome');
  }
}

export function extensionRoot(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  home: string
): string {
  const join = platform === 'win32' ? path.win32.join : path.posix.join;
  return join(userDataDir(platform, env, home), 'Default', 'Extensions', SEOQUAKE_EXTENSION_ID);
}

/** Chrome unpacks each extension into a per-version directory, so the version cannot be hardcoded. */
export function pickLatestVersion(dirs: string[]): string {
  if (dirs.length === 0) {
    throw new Error('No extension version directories found.');
  }

  const rank = (name: string) =>
    name.split(/[._]/).map((part) => Number(part) || 0);

  return [...dirs].sort((a, b) => {
    const [x, y] = [rank(a), rank(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
    }
    return 0;
  })[dirs.length - 1];
}
```

- [ ] **Step 4: Run test to verify it passes** — 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/analyzers/seoquake/paths.ts electron/analyzers/seoquake/paths.test.ts
git commit -m "Add cross-platform Chrome and extension path resolution"
```

---

### Task 2: SEO Quake toolbar parsing

**Files:**
- Create: `electron/analyzers/seoquake/parse.ts`
- Test: `electron/analyzers/seoquake/parse.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `parseToolbar(cells: string[]): SeoQuakeData` where `SeoQuakeData = { googleIndex: number | null; backlinks: number | null; subdomainBacklinks: number | null; bingIndex: number | null; semrushRank: number | null; raw: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseToolbar } from './parse';

describe('parseToolbar', () => {
  it('maps toolbar cells to named metrics', () => {
    const data = parseToolbar(['1,240', '58', '12', '890', 'whois', 'source', '4,500,000']);
    expect(data.googleIndex).toBe(1240);
    expect(data.backlinks).toBe(58);
    expect(data.subdomainBacklinks).toBe(12);
    expect(data.bingIndex).toBe(890);
  });

  it('strips thousands separators and surrounding text', () => {
    expect(parseToolbar(['Google Index: 1,234,567']).googleIndex).toBe(1234567);
  });

  it('returns null rather than zero for a cell with no number', () => {
    // Zero and "no data" are different facts and must not be conflated.
    expect(parseToolbar(['n/a']).googleIndex).toBeNull();
  });

  it('returns nulls when the toolbar is empty rather than throwing', () => {
    const data = parseToolbar([]);
    expect(data.googleIndex).toBeNull();
    expect(data.raw).toEqual([]);
  });

  it('keeps the raw cells so a layout change can be diagnosed', () => {
    expect(parseToolbar(['a', 'b']).raw).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL, cannot resolve `./parse`.

- [ ] **Step 3: Write `parse.ts`**

```ts
export type SeoQuakeData = {
  googleIndex: number | null;
  backlinks: number | null;
  subdomainBacklinks: number | null;
  bingIndex: number | null;
  semrushRank: number | null;
  raw: string[];
};

function toNumber(cell: string | undefined): number | null {
  if (cell === undefined) return null;
  const digits = cell.replace(/[^\d]/g, '');
  return digits.length > 0 ? Number(digits) : null;
}

/**
 * The toolbar is positional: Google index, backlinks, subdomain backlinks,
 * Bing index, WhoIs, source, SEMrush rank. This ordering belongs to a
 * third-party extension and is the most likely thing to change, which is why
 * the raw cells are retained alongside the mapped values.
 */
export function parseToolbar(cells: string[]): SeoQuakeData {
  return {
    googleIndex: toNumber(cells[0]),
    backlinks: toNumber(cells[1]),
    subdomainBacklinks: toNumber(cells[2]),
    bingIndex: toNumber(cells[3]),
    semrushRank: toNumber(cells[6]),
    raw: cells
  };
}
```

- [ ] **Step 4: Run test to verify it passes** — 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/analyzers/seoquake/parse.ts electron/analyzers/seoquake/parse.test.ts
git commit -m "Add SEO Quake toolbar parsing"
```

---

### Task 3: SEO Quake analyzer

**Files:**
- Create: `electron/analyzers/seoquake/index.ts`
- Delete: `src/lib/server/SEOQData.ts`

**Interfaces:**
- Consumes: `paths.ts`, `parse.ts`, `Analyzer`.
- Produces: `seoQuakeAnalyzer: Analyzer<SeoQuakeSettings>` where `SeoQuakeSettings = { chromePath: string | null; extensionPath: string | null }`.

- [ ] **Step 1: Write `index.ts`**

```ts
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import puppeteer from 'puppeteer';
import type { Analyzer } from '../types';
import { chromeCandidates, extensionRoot, pickLatestVersion } from './paths';
import { parseToolbar, type SeoQuakeData } from './parse';

export type SeoQuakeSettings = { chromePath: string | null; extensionPath: string | null };

function resolveChrome(settings: SeoQuakeSettings): string {
  if (settings.chromePath) {
    if (!fs.existsSync(settings.chromePath)) {
      throw new Error(`Configured Chrome path does not exist: ${settings.chromePath}`);
    }
    return settings.chromePath;
  }

  const candidates = chromeCandidates(process.platform, process.env, os.homedir());
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`Chrome not found. Looked in:\n  ${candidates.join('\n  ')}`);
  }
  return found;
}

function resolveExtension(settings: SeoQuakeSettings): string {
  if (settings.extensionPath) {
    if (!fs.existsSync(settings.extensionPath)) {
      throw new Error(`Configured extension path does not exist: ${settings.extensionPath}`);
    }
    return settings.extensionPath;
  }

  const root = extensionRoot(process.platform, process.env, os.homedir());
  if (!fs.existsSync(root)) {
    throw new Error(`SEO Quake is not installed for the default Chrome profile (${root}).`);
  }

  const versions = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  return path.join(root, pickLatestVersion(versions));
}

export const seoQuakeAnalyzer: Analyzer<SeoQuakeSettings> = {
  id: 'seoquake',
  label: 'SEO Quake',
  // Opens a visible window: two at once would fight for the operator's screen.
  concurrency: 'serial',
  timeoutMs: 90_000,
  defaultSettings: { chromePath: null, extensionPath: null },

  async preflight(settings) {
    try {
      resolveChrome(settings);
      resolveExtension(settings);
      return { available: true };
    } catch (error) {
      return { available: false, reason: (error as Error).message };
    }
  },

  async analyze(domain, settings): Promise<SeoQuakeData> {
    const extensionPath = resolveExtension(settings);

    const browser = await puppeteer.launch({
      headless: false,
      executablePath: resolveChrome(settings),
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`]
    });

    try {
      const page = await browser.newPage();
      try {
        await page.setViewport({ width: 1920, height: 1080 });
        await page.goto(domain, { waitUntil: 'domcontentloaded' });

        // The toolbar is injected by the extension after its own network
        // requests settle, so waiting for the selector is the only signal.
        await page.waitForSelector('#sqseobar2 .seoquake-params-request', { timeout: 45_000 });

        const cells = await page.$$eval('#sqseobar2 .seoquake-params-request', (nodes) =>
          nodes.map((node) => node.textContent ?? '')
        );

        if (cells.length === 0) {
          throw new Error('SEO Quake toolbar rendered but contained no parameter cells.');
        }

        return parseToolbar(cells);
      } finally {
        await page.close();
      }
    } finally {
      await browser.close();
    }
  }
};
```

- [ ] **Step 2: Delete the old implementation**

```bash
git rm src/lib/server/SEOQData.ts src/lib/server/LHData.ts src/lib/server/FileHandler.ts src/lib/server/GeneralLib.ts
```

These are the last of the original `src/lib/server` code; every analyzer now lives under `electron/analyzers/`.

- [ ] **Step 3: Verify against a real site**

Register it temporarily in `electron/ipc.ts`, run `npm run electron:dev`, and run SEO Quake against a real domain.
Expected: a visible Chrome window opens, the toolbar loads, and numbers appear. On a machine without the extension, preflight reports `unavailable` and no window opens.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Port SEO Quake to the analyzer contract"
```

---

### Task 4: Australian spelling

**Files:**
- Create: `electron/analyzers/content/spelling.ts`
- Test: `electron/analyzers/content/spelling.test.ts`

**Interfaces:**
- Consumes: `nspell`, `dictionary-en-au`.
- Produces: `extractWords(text: string): string[]`, `createSpellChecker(): Promise<SpellChecker>` where `SpellChecker = { check(words: string[], ignore: string[]): Misspelling[] }` and `Misspelling = { word: string; count: number; suggestions: string[] }`.

- [ ] **Step 1: Install the dictionary**

```bash
npm install nspell@^2 dictionary-en-au@^3
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { extractWords, createSpellChecker } from './spelling';

describe('extractWords', () => {
  it('splits on whitespace and punctuation', () => {
    expect(extractWords('Hello, world! Fine.')).toEqual(['Hello', 'world', 'Fine']);
  });

  it('keeps internal apostrophes', () => {
    expect(extractWords("don't stop")).toEqual(["don't", 'stop']);
  });

  it('drops numbers and standalone symbols', () => {
    expect(extractWords('call 1300 555 now $$$')).toEqual(['call', 'now']);
  });

  it('drops words shorter than three characters, which are noise', () => {
    expect(extractWords('a an the go')).toEqual(['the']);
  });
});

describe('spell checker', () => {
  it('accepts Australian spellings that American dictionaries reject', async () => {
    const checker = await createSpellChecker();
    expect(checker.check(['colour', 'organisation', 'centre'], [])).toEqual([]);
  });

  it('flags a genuine misspelling with suggestions', async () => {
    const checker = await createSpellChecker();
    const [finding] = checker.check(['recieve'], []);
    expect(finding.word).toBe('recieve');
    expect(finding.suggestions.length).toBeGreaterThan(0);
  });

  it('counts repeated misspellings once with a count', async () => {
    const checker = await createSpellChecker();
    const [finding] = checker.check(['recieve', 'recieve'], []);
    expect(finding.count).toBe(2);
  });

  it('honours the ignore list case insensitively', async () => {
    const checker = await createSpellChecker();
    expect(checker.check(['Cjsgaragedoors'], ['cjsgaragedoors'])).toEqual([]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails** — FAIL, cannot resolve `./spelling`.

- [ ] **Step 4: Write `spelling.ts`**

```ts
export type Misspelling = { word: string; count: number; suggestions: string[] };
export type SpellChecker = { check(words: string[], ignore: string[]): Misspelling[] };

export function extractWords(text: string): string[] {
  return (text.match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) ?? []).filter((word) => word.length >= 3);
}

export async function createSpellChecker(): Promise<SpellChecker> {
  const nspell = (await import('nspell')).default;
  const dictionary = await import('dictionary-en-au');

  const spell = await new Promise<ReturnType<typeof nspell>>((resolve, reject) => {
    // dictionary-en-au uses a callback API.
    (dictionary.default as unknown as (cb: (err: Error | null, d: unknown) => void) => void)(
      (err, d) => (err ? reject(err) : resolve(nspell(d as never)))
    );
  });

  return {
    check(words, ignore) {
      const ignored = new Set(ignore.map((word) => word.toLowerCase()));
      const counts = new Map<string, number>();

      for (const word of words) {
        const lower = word.toLowerCase();
        if (ignored.has(lower) || spell.correct(word)) continue;
        counts.set(lower, (counts.get(lower) ?? 0) + 1);
      }

      return [...counts.entries()]
        .map(([word, count]) => ({ word, count, suggestions: spell.suggest(word).slice(0, 3) }))
        .sort((a, b) => b.count - a.count);
    }
  };
}
```

- [ ] **Step 5: Run test to verify it passes** — 8 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add electron/analyzers/content/spelling.ts electron/analyzers/content/spelling.test.ts package.json package-lock.json
git commit -m "Add offline Australian spelling"
```

---

### Task 5: Grammar provider

**Files:**
- Create: `electron/analyzers/content/grammar.ts`
- Test: `electron/analyzers/content/grammar.test.ts`

**Interfaces:**
- Consumes: `fetchText` is not used here — LanguageTool needs a POST, so `fetch` is called directly.
- Produces: `GrammarSettings = { provider: 'off' | 'languagetool-public' | 'languagetool-custom'; endpoint?: string; apiKey?: string }`, `resolveEndpoint(settings): string | null`, `parseLanguageTool(payload: unknown): GrammarFinding[]`, `checkGrammar(text, settings, signal): Promise<GrammarState>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveEndpoint, parseLanguageTool, checkGrammar } from './grammar';

afterEach(() => vi.unstubAllGlobals());

describe('resolveEndpoint', () => {
  it('returns null when the provider is off', () => {
    expect(resolveEndpoint({ provider: 'off' })).toBeNull();
  });

  it('returns the public endpoint', () => {
    expect(resolveEndpoint({ provider: 'languagetool-public' })).toContain('languagetool.org');
  });

  it('returns the configured endpoint for a custom server', () => {
    expect(resolveEndpoint({ provider: 'languagetool-custom', endpoint: 'http://localhost:8081/v2/check' }))
      .toBe('http://localhost:8081/v2/check');
  });

  it('throws when custom is selected without an endpoint', () => {
    expect(() => resolveEndpoint({ provider: 'languagetool-custom' })).toThrow(/endpoint/i);
  });
});

describe('parseLanguageTool', () => {
  it('maps matches to findings', () => {
    const payload = {
      matches: [
        { message: 'Possible typo', context: { text: 'a teh b', offset: 2, length: 3 }, rule: { id: 'TYPO' } }
      ]
    };
    expect(parseLanguageTool(payload)).toEqual([
      { message: 'Possible typo', context: 'teh', ruleId: 'TYPO' }
    ]);
  });

  it('returns an empty array when there are no matches', () => {
    expect(parseLanguageTool({ matches: [] })).toEqual([]);
  });

  it('throws on a malformed payload', () => {
    expect(() => parseLanguageTool({ nope: 1 })).toThrow(/matches/i);
  });
});

describe('checkGrammar', () => {
  it('reports unavailable when the provider is off, without calling out', async () => {
    const spy = vi.fn();
    vi.stubGlobal('fetch', spy);
    const state = await checkGrammar('text', { provider: 'off' }, new AbortController().signal);
    expect(state).toEqual({ status: 'unavailable', reason: 'Grammar checking is turned off.' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('reports failed rather than throwing when the service errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    const state = await checkGrammar(
      'text',
      { provider: 'languagetool-custom', endpoint: 'http://localhost:8081/v2/check' },
      new AbortController().signal
    );
    expect(state.status).toBe('failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL, cannot resolve `./grammar`.

- [ ] **Step 3: Write `grammar.ts`**

```ts
export type GrammarSettings = {
  provider: 'off' | 'languagetool-public' | 'languagetool-custom';
  endpoint?: string;
  apiKey?: string;
};

export type GrammarFinding = { message: string; context: string; ruleId: string };

export type GrammarState =
  | { status: 'ok'; findings: GrammarFinding[] }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; error: string };

const PUBLIC_ENDPOINT = 'https://api.languagetool.org/v2/check';

export function resolveEndpoint(settings: GrammarSettings): string | null {
  switch (settings.provider) {
    case 'off':
      return null;
    case 'languagetool-public':
      return PUBLIC_ENDPOINT;
    case 'languagetool-custom':
      if (!settings.endpoint) {
        throw new Error('A custom LanguageTool server was selected but no endpoint is configured.');
      }
      return settings.endpoint;
  }
}

type LanguageToolMatch = {
  message: string;
  context: { text: string; offset: number; length: number };
  rule: { id: string };
};

export function parseLanguageTool(payload: unknown): GrammarFinding[] {
  const matches = (payload as { matches?: unknown }).matches;
  if (!Array.isArray(matches)) {
    throw new Error('LanguageTool response contained no matches array.');
  }

  return (matches as LanguageToolMatch[]).map((match) => ({
    message: match.message,
    // The API reports the offending span as an offset into a context window.
    context: match.context.text.slice(
      match.context.offset,
      match.context.offset + match.context.length
    ),
    ruleId: match.rule.id
  }));
}

export async function checkGrammar(
  text: string,
  settings: GrammarSettings,
  signal: AbortSignal
): Promise<GrammarState> {
  let endpoint: string | null;
  try {
    endpoint = resolveEndpoint(settings);
  } catch (error) {
    return { status: 'unavailable', reason: (error as Error).message };
  }

  if (endpoint === null) {
    return { status: 'unavailable', reason: 'Grammar checking is turned off.' };
  }

  try {
    const body = new URLSearchParams({ text, language: 'en-AU' });
    if (settings.apiKey) body.set('apiKey', settings.apiKey);

    const response = await fetch(endpoint, { method: 'POST', body, signal });
    if (!response.ok) {
      throw new Error(`LanguageTool returned ${response.status}.`);
    }

    return { status: 'ok', findings: parseLanguageTool(await response.json()) };
  } catch (error) {
    // A grammar service failure must never cost the operator their spelling
    // results, so it is returned rather than thrown.
    return { status: 'failed', error: (error as Error).message };
  }
}
```

- [ ] **Step 4: Run test to verify it passes** — 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/analyzers/content/grammar.ts electron/analyzers/content/grammar.test.ts
git commit -m "Add LanguageTool grammar provider, off by default"
```

---

### Task 6: Content analyzer assembly

**Files:**
- Create: `electron/analyzers/content/index.ts`

**Interfaces:**
- Consumes: `spelling.ts`, `grammar.ts`, Puppeteer.
- Produces: `contentAnalyzer: Analyzer<ContentSettings>` where `ContentSettings = { ignoreWords: string[]; grammar: GrammarSettings }`, returning `ContentData = { spelling: { misspellings: Misspelling[] }; grammar: GrammarState }`.

- [ ] **Step 1: Write `index.ts`**

```ts
import puppeteer from 'puppeteer';
import type { Analyzer } from '../types';
import { createSpellChecker, extractWords, type Misspelling } from './spelling';
import { checkGrammar, type GrammarSettings, type GrammarState } from './grammar';

export type ContentSettings = { ignoreWords: string[]; grammar: GrammarSettings };

export type ContentData = {
  spelling: { misspellings: Misspelling[] };
  grammar: GrammarState;
};

/** LanguageTool rejects very large payloads, and a page's worth is plenty. */
const MAX_GRAMMAR_CHARS = 20_000;

export const contentAnalyzer: Analyzer<ContentSettings> = {
  id: 'content',
  label: 'Content (AU spelling and grammar)',
  concurrency: 'limited',
  timeoutMs: 120_000,
  defaultSettings: { ignoreWords: [], grammar: { provider: 'off' } },

  async preflight() {
    try {
      // The dictionary is the only hard dependency; grammar has its own state.
      await createSpellChecker();
      return { available: true };
    } catch (error) {
      return { available: false, reason: `Dictionary failed to load: ${(error as Error).message}` };
    }
  },

  async analyze(domain, settings, signal): Promise<ContentData> {
    const browser = await puppeteer.launch();
    let text = '';
    try {
      const page = await browser.newPage();
      try {
        await page.goto(domain, { waitUntil: 'networkidle2' });
        text = await page.evaluate(() => document.body.innerText);
      } finally {
        await page.close();
      }
    } finally {
      await browser.close();
    }

    const checker = await createSpellChecker();
    const misspellings = checker.check(extractWords(text), settings.ignoreWords);

    // Grammar returns its own state rather than throwing, so a provider being
    // off, unreachable or rate limited never costs the spelling results.
    const grammar = await checkGrammar(text.slice(0, MAX_GRAMMAR_CHARS), settings.grammar, signal);

    return { spelling: { misspellings }, grammar };
  }
};
```

- [ ] **Step 2: Register both analyzers**

In `electron/ipc.ts`:

```ts
import { seoQuakeAnalyzer } from './analyzers/seoquake';
import { contentAnalyzer } from './analyzers/content';

  const registry = createRegistry([
    lighthouseAnalyzer,
    keywordsAnalyzer,
    waybackAnalyzer,
    securityAnalyzer,
    aeoAnalyzer,
    seoQuakeAnalyzer,
    contentAnalyzer
  ]);
```

Add both to `available` in `src/routes/+page.svelte`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add content analyzer with nested grammar state"
```

---

### Task 7: Settings screen and remaining report components

**Files:**
- Create: `src/routes/settings/+page.svelte`, `src/routes/settings/+page.ts`
- Create: `src/lib/report/{SeoQuake,Content,Lighthouse,Keywords}.svelte`
- Modify: `src/routes/report/[id]/+page.svelte`

**Interfaces:**
- Consumes: `api().readSettings()`, `api().writeSettings()`.
- Produces: the settings UI; no later plan depends on its internals.

- [ ] **Step 1: Create the loader**

`src/routes/settings/+page.ts`:

```ts
export const prerender = false;
export const ssr = false;
```

- [ ] **Step 2: Write the settings screen**

```svelte
<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import type { Settings } from '../../../electron/settings/store';

  let settings: Settings | null = null;
  let saved = false;

  onMount(async () => {
    settings = await api().readSettings();
  });

  function grammar() {
    const content = (settings!.analyzers.content ?? {}) as {
      grammar?: { provider: string; endpoint?: string; apiKey?: string };
    };
    return content.grammar ?? { provider: 'off' };
  }

  function setGrammar(next: Record<string, unknown>) {
    const content = (settings!.analyzers.content ?? {}) as Record<string, unknown>;
    settings!.analyzers = { ...settings!.analyzers, content: { ...content, grammar: next } };
    settings = settings;
  }

  async function save() {
    await api().writeSettings(settings!);
    saved = true;
  }
</script>

{#if settings}
  <h1>Settings</h1>

  <fieldset>
    <legend>Grammar checking</legend>

    <label>
      Provider
      <select
        value={grammar().provider}
        on:change={(e) => setGrammar({ ...grammar(), provider: e.currentTarget.value })}
      >
        <option value="off">Off</option>
        <option value="languagetool-public">LanguageTool public API</option>
        <option value="languagetool-custom">LanguageTool server</option>
      </select>
    </label>

    {#if grammar().provider === 'languagetool-public'}
      <!-- Stated at the point of selection, not buried in documentation. -->
      <p role="note">
        This sends your client's page content to languagetool.org, a third-party
        service, and is rate limited to roughly 20 requests per minute.
      </p>
    {/if}

    {#if grammar().provider === 'languagetool-custom'}
      <label>
        Endpoint
        <input
          value={grammar().endpoint ?? ''}
          placeholder="http://localhost:8081/v2/check"
          on:input={(e) => setGrammar({ ...grammar(), endpoint: e.currentTarget.value })}
        />
      </label>
    {/if}
  </fieldset>

  <button on:click={save}>Save</button>
  {#if saved}<span>Saved.</span>{/if}
  <a href="/">Back</a>
{:else}
  <p>Loading…</p>
{/if}
```

- [ ] **Step 3: Write `src/lib/report/Content.svelte`**

```svelte
<script lang="ts">
  export let data: {
    spelling: { misspellings: Array<{ word: string; count: number; suggestions: string[] }> };
    grammar:
      | { status: 'ok'; findings: Array<{ message: string; context: string }> }
      | { status: 'unavailable'; reason: string }
      | { status: 'failed'; error: string };
  };
</script>

<h4>Spelling (Australian English)</h4>
{#if data.spelling.misspellings.length === 0}
  <p>No misspellings found.</p>
{:else}
  <table>
    <thead><tr><th>Word</th><th>Occurrences</th><th>Suggestions</th></tr></thead>
    <tbody>
      {#each data.spelling.misspellings as finding}
        <tr>
          <td>{finding.word}</td>
          <td>{finding.count}</td>
          <td>{finding.suggestions.join(', ')}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<h4>Grammar</h4>
{#if data.grammar.status === 'unavailable'}
  <p>Not checked — {data.grammar.reason}</p>
{:else if data.grammar.status === 'failed'}
  <p>Check failed — {data.grammar.error}</p>
{:else if data.grammar.findings.length === 0}
  <p>No grammar issues found.</p>
{:else}
  <ul>
    {#each data.grammar.findings as finding}
      <li>{finding.message} — “{finding.context}”</li>
    {/each}
  </ul>
{/if}
```

- [ ] **Step 4: Write `src/lib/report/SeoQuake.svelte`**

```svelte
<script lang="ts">
  export let data: {
    googleIndex: number | null;
    backlinks: number | null;
    subdomainBacklinks: number | null;
    bingIndex: number | null;
    semrushRank: number | null;
  };

  const rows: Array<[string, number | null]> = [
    ['Google index', data.googleIndex],
    ['Backlinks', data.backlinks],
    ['Subdomain backlinks', data.subdomainBacklinks],
    ['Bing index', data.bingIndex],
    ['SEMrush rank', data.semrushRank]
  ];
</script>

<table>
  <tbody>
    {#each rows as [label, value]}
      <!-- null means the extension gave no value, which is not the same as zero. -->
      <tr><td>{label}</td><td>{value === null ? 'no data' : value.toLocaleString()}</td></tr>
    {/each}
  </tbody>
</table>
```

- [x] **Step 5: Write `src/lib/report/Lighthouse.svelte`** — ALREADY DONE. Pulled forward with the UI styling work: scores are banded per Google thresholds and Core Web Vitals carry plain-English descriptions and pass/fail against stated targets. Skip this step.

```svelte
<script lang="ts">
  export let data: {
    scores: { performance: number; accessibility: number; bestPractices: number; seo: number };
    metrics: { lcpMs: number; cls: number; tbtMs: number };
  };
</script>

<table>
  <thead><tr><th>Performance</th><th>Accessibility</th><th>Best practices</th><th>SEO</th></tr></thead>
  <tbody>
    <tr>
      <td>{data.scores.performance}</td>
      <td>{data.scores.accessibility}</td>
      <td>{data.scores.bestPractices}</td>
      <td>{data.scores.seo}</td>
    </tr>
  </tbody>
</table>

<p>
  LCP {(data.metrics.lcpMs / 1000).toFixed(1)}s ·
  CLS {data.metrics.cls.toFixed(3)} ·
  TBT {Math.round(data.metrics.tbtMs)}ms
</p>
```

- [x] **Step 6: Write `src/lib/report/Keywords.svelte`** — ALREADY DONE. Pulled forward with the UI styling work, including surfacing keywords declared in the meta tag but absent from the page text. Skip this step.

```svelte
<script lang="ts">
  export let data: { keywords: Array<{ keyword: string; count: number }> };
</script>

{#if data.keywords.length === 0}
  <p>No meta keywords declared.</p>
{:else}
  <table>
    <thead><tr><th>Keyword</th><th>Occurrences in page text</th></tr></thead>
    <tbody>
      {#each data.keywords as row}
        <tr><td>{row.keyword}</td><td>{row.count}</td></tr>
      {/each}
    </tbody>
  </table>
{/if}
```

- [ ] **Step 7: Register the components**

In `src/routes/report/[id]/+page.svelte`, extend the map:

```ts
  // ComponentType, not `typeof Unknown` — see plan 2 Task 7.
  const components: Partial<Record<AnalyzerId, ComponentType>> = {
    lighthouse: Lighthouse,
    keywords: Keywords,
    wayback: Wayback,
    security: Security,
    aeo: Aeo,
    seoquake: SeoQuake,
    content: Content
  };
```

Add a link to `/settings` in `src/routes/+page.svelte`.

- [ ] **Step 8: Verify end to end**

Run: `npm run electron:dev`. Run all seven analyzers against a real domain. Set grammar to a custom endpoint that does not exist and confirm spelling results still appear with grammar showing `Check failed`.

- [ ] **Step 9: Run the full suite and commit**

```bash
npm run test && npm run check && npm run electron:compile && npm run lint
git add -A
git commit -m "Add settings screen and remaining report components"
```

---

## Deferred to plan 4

Traffic estimated (Semrush), traffic owned (GSC and GA4 OAuth), and the `safeStorage` credential store.
