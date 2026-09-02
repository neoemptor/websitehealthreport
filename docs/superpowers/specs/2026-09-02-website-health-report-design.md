# Website Health Report — Design

**Date:** 2026-09-02
**Status:** Approved for planning
**Supersedes:** the SvelteKit + Tauri skeleton on `main`

## Goal

A standalone desktop application, run on Windows, Linux and Mac (Apple
Silicon), where the operator enters a client's domain plus a list of
competitor domains, and gets back a health report — on screen and as a PDF —
covering seven categories of analysis.

The application is a personal tool for one operator across three machines. It
is not distributed to clients or colleagues, so external dependencies may be
installed manually per machine. It must not require those dependencies to be
bundled.

## Current state

The repository holds a SvelteKit 1.x + Tauri 1.5 skeleton. The analyzers in
`src/lib/server/` work but run only as a module side-effect in
`src/hooks.server.ts` when the Vite dev server boots. Because `svelte.config.js`
uses `adapter-static` and `src/routes/+layout.ts` sets `ssr = false`, a
production build contains no server and therefore runs none of this code.

`Keyword` and `WBMData` are functional. `LHData`/`FileHandler` shell out to a
Lighthouse CLI that is not a declared dependency. `SEOQData` works but scrapes
undocumented DOM classes from a browser extension. `Competitor` is an empty
stub. There are no tests and no test framework.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Shell | Electron | Node is the runtime, so analyzers run unchanged. No Rust toolchain (installed on none of the three machines). Produces a real double-click app on all three platforms. |
| Renderer | SvelteKit + `adapter-static` | Already configured. Becomes a pure UI layer over IPC. |
| Storage | One JSON file per run | Avoids `better-sqlite3`, a native module needing `electron-rebuild` for win32, linux and darwin-arm64. Inspectable when something goes wrong. Adequate for hundreds of runs. |
| PDF | Electron `webContents.printToPDF()` | The PDF is the same Svelte report route rendered into a hidden window. One template, two outputs, no divergence. No Puppeteer, no HTML-to-PDF library. |
| Lighthouse | `lighthouse` npm package, called programmatically | Removes the undeclared CLI-on-PATH dependency, removes `execFile` and its injection surface, returns structured results directly. |
| Test framework | Vitest | Fits the existing Vite toolchain. |

`src-tauri/` is deleted. Tauri is not used.

## Architecture

Three processes with strict boundaries.

**Main (Node)** owns everything with side effects: the analyzer registry, the
run orchestrator, storage, logging, and PDF generation. All current
`src/lib/server` code moves here.

**Renderer** is the SvelteKit static build loaded into a `BrowserWindow`, with
`nodeIntegration: false` and `contextIsolation: true`. It has no filesystem,
network or process access.

**Preload** exposes one typed API over `contextBridge`: start a run, cancel a
run, resume a run, list runs, read a run, read and write settings, export a
PDF. Nothing else crosses the boundary.

### Analyzer contract

```ts
type AnalyzerId =
  | 'lighthouse' | 'keywords' | 'seoquake' | 'wayback'
  | 'security' | 'aeo' | 'content';

type AnalyzerResult =
  | { status: 'ok'; data: unknown }
  | { status: 'unavailable'; reason: string }
  | { status: 'failed'; error: string };

interface Analyzer<TSettings = unknown> {
  id: AnalyzerId;
  label: string;
  concurrency: 'parallel' | 'limited' | 'serial';
  timeoutMs: number;
  defaultSettings: TSettings;
  preflight(settings: TSettings): Promise<{ available: true } | { available: false; reason: string }>;
  analyze(domain: string, settings: TSettings, signal: AbortSignal): Promise<unknown>;
}
```

`unavailable` and `failed` are deliberately distinct. "SEO Quake is not
installed on this machine" is a different fact from "the scrape crashed", and
the report must distinguish them. This is what makes seven fragile sources
survivable.

`concurrency` is per-analyzer because the analyzers differ enormously. Cheap
HTTP checks run in parallel; Lighthouse is CPU-bound and capped; SEO Quake
opens a visible browser window and must be serialised.

Each analyzer is split into a `fetch` half performing I/O and a `parse` half
that is pure. All logic lives in `parse`, which is unit-testable against
fixtures without network or browser.

## Data model

```ts
type Run = {
  id: string;                 // 2026-09-02T081500-cjsgaragedoors
  createdAt: string;          // ISO 8601
  client: string;             // normalised https URL
  competitors: string[];
  enabledAnalyzers: AnalyzerId[];
  status: 'running' | 'complete' | 'aborted';
  domains: DomainResult[];
};

type DomainResult = {
  domain: string;
  role: 'client' | 'competitor';
  analyzers: Partial<Record<AnalyzerId, AnalyzerResult>>;
};
```

Runs are stored at `<userData>/runs/<run id>.json`, written after every
analyzer task settles rather than at the end of the run. Writes are atomic —
to a temporary file, then renamed — so an interrupted write cannot corrupt a
run.

The run id uses `YYYY-MM-DDTHHMMSS` rather than full ISO 8601 because the run
id is also the filename, and Windows forbids colons in filenames. The
unabbreviated timestamp remains available in `createdAt`.

Settings are stored separately at `<userData>/settings.json`.

## Orchestration

A run expands into a task queue of `domain × enabledAnalyzer` pairs. A client
plus three competitors with all seven analyzers is 28 tasks.

The scheduler honours each analyzer's `concurrency`: `serial` takes a global
lock, `limited` runs behind a semaphore of 2, `parallel` runs freely under an
overall cap of 8 concurrent tasks. Each task is bounded by the analyzer's
`timeoutMs` and receives an `AbortSignal` so cancellation and timeout are the
same mechanism.

Progress is emitted per task state change over IPC. The renderer shows a live
grid of domains against analyzers rather than an indeterminate spinner,
because a full run takes minutes.

Because results persist incrementally, an aborted run reopens and re-runs only
tasks whose result is not `ok`.

### Input normalisation

Operator input is a bare domain such as `cjsgaragedoors.com.au`. Input is
normalised to `https://cjsgaragedoors.com.au/` and validated before any
analyzer receives it, using the URL guard currently in `FileHandler` promoted
to shared code. Only `http:` and `https:` are accepted.

## The seven analyzers

### Lighthouse — risk: low

Runs the `lighthouse` package programmatically against a Chrome resolved by
`chrome-launcher`. Extracts the five category scores plus LCP, CLS and TBT.

Settings: throttling profile (mobile/desktop).
Preflight: Chrome resolvable.

### Keywords — risk: low

Existing implementation, reshaped to the contract. Reads the `keywords` meta
tag, counts each term against page body text using `(?<!\w)…(?!\w)` boundaries
with the term regex-escaped.

Settings: none.
Preflight: bundled Chromium present.

### SEO Quake — risk: high

Existing implementation. Launches headed Chrome with the SEO Quake extension
loaded, waits for the toolbar, reads `.seoquake-params-request` nodes under
`#sqseobar2`.

This analyzer scrapes undocumented DOM classes belonging to a third-party
extension. It will break when the extension changes, and that is not
preventable — only detectable. Preflight failure and parse failure must both
degrade to a clear status rather than a crash.

Settings: Chrome path override, extension path override.
Preflight: Chrome and extension directory both resolvable.

### Wayback — risk: low

Wires up the existing `WBMData`. Queries the web.archive.org CDX API for
snapshots collapsed by year and returns counts per year, indicating how long
the site has existed and how often it changes.

Settings: none.
Preflight: always available (HTTP only).

### Security — risk: low

Passive checks only. No active vulnerability scanning is performed, and none
is in scope: active scanning against a live client site is a distinct activity
requiring the client's explicit authorisation.

Checks: Content-Security-Policy, Strict-Transport-Security, X-Frame-Options,
X-Content-Type-Options, Referrer-Policy, Permissions-Policy; cookie `Secure`,
`HttpOnly` and `SameSite` flags; TLS protocol version and certificate expiry;
`Server` and `X-Powered-By` version disclosure; mixed content on the rendered
page. Findings are scored against the OWASP Secure Headers Project.

Settings: none.
Preflight: always available.

### AEO (AI Agent Optimisation) — risk: medium

Checks whether the site is legible to AI agents and crawlers:

- `llms.txt` presence and validity
- robots.txt directives for GPTBot, ClaudeBot, PerplexityBot,
  Google-Extended and CCBot
- schema.org JSON-LD presence and parse validity
- heading hierarchy, canonical link, sitemap presence
- **content-without-JS ratio** — text length of a raw HTTP fetch against text
  length of the Puppeteer-rendered page

There is no standard for this category. It is a defensible heuristic
checklist, not a specification, and results are presented as findings rather
than a single score — inventing a number would imply a rigour that does not
exist. The content-without-JS ratio is the signal that matters most: content
that exists only after JavaScript runs is largely invisible to AI crawlers.

Settings: none.
Preflight: always available.

### Content (Australian spelling and grammar) — risk: high

**Spelling** uses `nspell` with the `dictionary-en-au` Hunspell dictionary.
Runs offline, bundles cleanly, no external service. It will flag brand names
and industry terms, so a per-client ignore list is part of the analyzer rather
than an afterthought.

**Grammar** uses LanguageTool through a provider setting:

```ts
type GrammarSettings = {
  provider: 'off' | 'languagetool-public' | 'languagetool-custom';
  endpoint?: string;   // required for 'languagetool-custom'
  apiKey?: string;     // optional, for public premium tiers
};
```

Default is `off`.

Spelling and grammar are two halves of one analyzer, so they cannot each carry
a top-level `AnalyzerResult` status. The `content` analyzer returns `ok`
whenever spelling succeeds, and reports the grammar half's state inside its
data:

```ts
type ContentData = {
  spelling: { misspellings: Array<{ word: string; count: number }> };
  grammar:
    | { status: 'ok'; findings: Array<{ message: string; context: string }> }
    | { status: 'unavailable'; reason: string }
    | { status: 'failed'; error: string };
};
```

The analyzer as a whole is `unavailable` only when the dictionary itself
fails to load, and `failed` only when spelling throws. A grammar provider
being off, unreachable or rate-limited never costs you the spelling results.

`languagetool-public` sends client page content to a third-party service and
is rate limited to roughly 20 requests per minute, which multi-domain runs
will exceed. The settings screen must state the third-party transfer at the
point of selection, not in documentation.

Settings: ignore list (per client), grammar provider block above.
Preflight: dictionary loads; if a grammar provider is configured, its endpoint
responds.

## Screens

**Setup** — client domain, competitor list, per-analyzer enable toggles.
Starts a run.

**Run** — a live grid of domains against analyzers, one cell per task, filling
in as tasks settle. Cells distinguish `ok`, `unavailable` and `failed`,
because with seven fragile sources the most common question is why a cell is
empty. Results are readable as they land. Supports cancel and, for an aborted
run, resume.

**Runs** — history for a client, newest first, with trends across runs.

**Settings** — assembled from each analyzer's own settings block via the same
registry that runs them, plus application-level settings (log level, storage
location).

## PDF output

The PDF is the report route rendered into a hidden `BrowserWindow` and printed
with `webContents.printToPDF()`. Screen and PDF therefore cannot diverge.

A print stylesheet on that route handles page breaks between domains, repeated
table headers on long tables, and hiding interactive controls.

## Error handling

**Logging.** Every existing analyzer reports through `console.log`. A packaged
Electron application has no terminal, so this is invisible. Main writes
structured logs to `<userData>/logs/`, and errors surface in the UI. This is a
porting task, not a detail.

**Preflight.** Before a run starts, every enabled analyzer's `preflight` runs
and unavailable analyzers are marked immediately. Without this, a missing
extension is discovered twenty tasks into a six-minute run.

**Timeouts.** Every analyzer declares `timeoutMs`. Exceeding it produces
`failed`, not a hang. Today only SEO Quake has any timeout at all.

**Retries.** Transient HTTP failures (Wayback, security header fetches) retry
once with backoff. Browser-driven analyzers do not retry — the cost is high
and the failure is rarely transient.

**Browser lifecycle.** Every Puppeteer browser and page is closed in a
`finally` block. This pattern is already established in the current
`Keyword` and `SEOQData` implementations.

**Boundary validation.** Analyzer output crosses IPC as `unknown` and is
validated in the renderer before rendering, so a malformed result cannot crash
the UI.

## Testing

- **Parsers** — unit tested against fixtures, including malformed input. The
  captured `https___www_cjsgaragedoors_com_au_.json` at the repository root is
  a real Lighthouse result and becomes the Lighthouse parser fixture; it moves
  to `fixtures/`. Saved HTML provides fixtures for keywords, security, AEO and
  content.
- **Orchestrator** — tested with fake analyzers: concurrency policies hold,
  one failing analyzer does not sink a run, resume re-runs only tasks that are
  not `ok`, cancellation propagates.
- **Storage** — atomic write survives interruption; a corrupt run file is
  detected and recoverable.
- **End-to-end** — one real smoke run against a stable domain, marked slow and
  excluded from the normal test loop.

## Out of scope

- Distribution to third parties. The application is built for three machines
  belonging to one operator; external dependencies are installed manually.
- Active vulnerability scanning. Security analysis is passive only.
- Bundling Chrome, the SEO Quake extension, or a LanguageTool server.
- Scheduled or unattended runs. Runs are operator-initiated.
- Tauri. `src-tauri/` is removed.

## Migration notes

Work that changes existing code rather than adding to it:

1. Delete `src-tauri/`; remove `@tauri-apps/cli` and the `tauri` script.
2. Add Electron, `electron-builder`, and a main/preload entry point.
3. Move `src/lib/server/*` into the main process, reshaped to the analyzer
   contract, each split into `fetch` and `parse`.
4. Delete `src/hooks.server.ts`. Runs are started from the UI, never as a
   module side-effect.
5. Replace `FileHandler`'s `execFile` Lighthouse invocation with the
   `lighthouse` package; promote its URL guard to shared code.
6. Replace `console.log` reporting with structured logging.
7. Move `https___www_cjsgaragedoors_com_au_.json` to `fixtures/`.
8. Delete `Competitor.ts` — competitor handling is a role on `DomainResult`,
   not a class.
9. Add Vitest and the test suites above.

## Risks

- **SEO Quake will break.** It depends on a third-party extension's internal
  DOM. The design contains the damage; it cannot prevent it.
- **Content analysis is the least certain component.** Spelling will produce
  false positives until ignore lists mature. Grammar depends on an external
  service by construction.
- **Scope is large.** Foundation plus seven analyzers, plus an Electron
  migration touching every existing file. The implementation plan should
  sequence analyzers so the application is usable before all seven land, even
  though all seven are in scope.
