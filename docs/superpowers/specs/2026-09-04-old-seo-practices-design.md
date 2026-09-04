# Old SEO practices analyzer — design

Date: 4 September 2026. Extends the 2 September Website Health Report design
with a tenth analyzer, id `oldseo`, label "Old SEO practices".

## Purpose

Detect outdated and manipulative SEO techniques still present on a client's
site: hidden text and links, keyword stuffing, cloaking, doorway and
duplicate pages, and leftover old habits such as a meta keywords tag. These
are the things a search engine penalises and a prospect never notices. The
report names each one with the page and the evidence, in plain English.

The check is passive: it reads pages the way a browser and a crawler would
and never probes for anything.

## Scope

- Homepage plus up to 10 internal pages, breadth-first from the homepage's
  same-host links. Pages the site's `robots.txt` disallows for `*` are not
  read.
- Same analyzer contract as every other check: `preflight`, `analyze`,
  `unavailable` / `failed` never collapsed, abort honoured.
- Stale *targeting* against search volume is not here; it waits for Semrush
  in Plan 4. Link schemes across other domains and any Claude judgement of
  prose are out of scope.

## Files

| Path                                                   | Responsibility                                                       |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| `electron/analyzers/oldseo/index.ts`                   | The analyzer: preflight, browser lifecycle, abort, assembling data.  |
| `electron/analyzers/oldseo/crawl.ts`                   | Link selection, robots rules, the in-page snapshot script.           |
| `electron/analyzers/oldseo/snapshot.ts`                | `PageSnapshot` type and the pure text helpers (words, shingles).     |
| `electron/analyzers/oldseo/detect/hidden.ts`           | Hidden text and hidden links.                                        |
| `electron/analyzers/oldseo/detect/stuffing.ts`         | Keyword stuffing.                                                    |
| `electron/analyzers/oldseo/detect/cloaking.ts`         | Googlebot vs browser comparison.                                     |
| `electron/analyzers/oldseo/detect/duplicate.ts`        | Doorway and duplicate pages.                                         |
| `electron/analyzers/oldseo/detect/stale.ts`            | Old habits: meta keywords, robots noise, stuffed titles and H1s.     |
| `src/lib/report/OldSeo.svelte`                         | Report section.                                                      |
| `src/lib/report/severity.ts`                           | Severity word and finding sentence for `oldseo`.                     |
| `src/lib/shared/types.ts`                              | `'oldseo'` added to `AnalyzerId`.                                    |

## Data

```ts
export type OldSeoCheck =
	| 'hidden-text'
	| 'hidden-link'
	| 'stuffing'
	| 'cloaking'
	| 'duplicate'
	| 'stale';

export type Finding = {
	check: OldSeoCheck;
	severity: 'high' | 'medium' | 'low';
	/** Path only, e.g. "/services/roller-doors". The domain is the section heading. */
	page: string;
	/** One line, at most 160 characters, safe to print. */
	evidence: string;
};

export type OldSeoData = {
	pagesRead: number;
	pagesSkipped: number;
	findings: Finding[];
};
```

Evidence is always truncated to 160 characters and has control characters
and newlines collapsed before it leaves the analyzer.

## Crawl

- `concurrency: 'limited'`, `timeoutMs: 180_000`, `defaultSettings: { maxPages: 10 }`.
- Preflight identical to Keywords: Puppeteer's Chromium must exist on disk.
- One headless browser per domain. Homepage first with
  `waitUntil: 'domcontentloaded'`, 20s per page. From the homepage, collect
  anchors whose resolved URL has the same host (ignoring a leading `www.`),
  scheme http(s), no fragment; strip the query; skip URLs ending in
  `.pdf .jpg .jpeg .png .gif .svg .webp .zip .mp4 .mp3 .doc .docx .xls .xlsx`.
  Breadth-first, first come first served, until `maxPages` internal pages
  have been read or the queue is empty.
- `robots.txt` is fetched once. Only `User-agent: *` groups are honoured,
  `Disallow` prefixes only, `Allow` ignored. Missing or unreadable robots is
  treated as allow-all.
- A page that fails to load or times out is counted in `pagesSkipped` and
  the crawl continues. If the homepage itself fails, `analyze` throws with
  the load error so the result is `failed`.
- Each page yields one `PageSnapshot` from a single `page.evaluate`:

```ts
export type HiddenReason =
	| 'display-none'
	| 'visibility-hidden'
	| 'opacity-zero'
	| 'tiny-font'
	| 'same-colour'
	| 'off-canvas'
	| 'zero-box';

export type TextNode = { text: string; hidden: HiddenReason | null; inLink: string | null };

export type PageSnapshot = {
	url: string;
	path: string;
	title: string;
	metaKeywords: string | null;
	metaRobots: string | null;
	h1s: string[];
	/** Visible text only, whitespace collapsed. */
	visibleText: string;
	/** All alt attributes joined by a space. */
	altText: string;
	nodes: TextNode[];
	/** Visible text of the page as fetched with the Googlebot user agent, or null if that fetch failed. */
	botText: string | null;
};
```

The in-page script walks text nodes under `body`, skipping `script`,
`style`, `noscript`, `template` and `svg`. For each node with 3+ words it
finds the nearest element and classifies hidden reasons in this order,
first match wins: `display: none` on any ancestor; `visibility: hidden`;
`opacity: 0` on any ancestor; font-size under 2px; text colour within a
distance of 24 (sum of RGB channel differences) of the effective background
colour walking up to the first non-transparent ancestor; bounding box
entirely outside the viewport by more than 1000px, or `text-indent` under
−999px; bounding box width or height 0 while the node has text. `inLink` is
the `href` of the nearest ancestor anchor, else null.

- Cloaking data: after the browser snapshot, a plain `fetch` of the same URL
  with `User-Agent: Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`,
  15s timeout, 1 MB cap, stripped with the same rules the discovery homepage
  fetcher uses. Its text becomes `botText`; on any failure `botText` is
  null and cloaking is simply not assessed for that page.

## Detectors

All pure `(snapshots: PageSnapshot[]) => Finding[]`. Thresholds are named
constants at the top of each file.

### hidden.ts

- `hidden-text`, **high**: a hidden node (any reason) whose text has 30+
  words, or 8+ words where at least 3 of the page's top-5 phrases occur.
  Evidence: `<reason>: "<first 100 chars>"`.
- `hidden-text`, **low**: a hidden node with 8–29 words and no keyword
  hits (likely accessibility text or a collapsed menu). Reported once per
  page as a count, not per node.
- `hidden-link`, **high**: a hidden node with `inLink` set, or an anchor
  whose visible box is zero-sized. Evidence: `<reason>: <href>`.

`display-none` nodes inside `nav`, `[role=navigation]`, `[aria-hidden]`,
`dialog`, `[hidden]` and elements whose id or class contains `menu`,
`modal`, `cookie`, `sr-only`, `visually-hidden`, `screen-reader` are
ignored: those are legitimate UI, not concealment. The in-page script
records this as `hidden: null`.

### stuffing.ts

Phrases are 1–3 word n-grams over `visibleText`, lower-cased, with a stop
word list (English, ~120 words) removed from single-word phrases.

- `stuffing`, **high**: a phrase of 2–3 words appearing 8+ times with
  density (occurrences × words in phrase ÷ words on page) over 5%.
- `stuffing`, **medium**: a single word appearing 12+ times with density
  over 8%; or a block of text that is 4+ comma-separated phrases of 1–3
  words with no verb-like token (detected as the same phrase-shaped chunks
  separated by commas, 40+ characters, on one line).
- `stuffing`, **medium**: `altText` containing any 2–3 word phrase 10+ times.
- Evidence: `"<phrase>" ×<count>, <density>% of <words> words`.

### cloaking.ts

- Skip pages where `botText` is null or either text has under 50 words.
- Similarity is Jaccard over 3-word shingles.
- `cloaking`, **high**: similarity under 0.6.
- Evidence: `browser <n> words, Googlebot <m> words, similarity <s>`.

### duplicate.ts

- `duplicate`, **medium**: any pair of pages with different paths and
  visible-text shingle similarity over 0.9, each with 100+ words. Evidence:
  `<pathA> ≈ <pathB> (<s>)`. Each page appears in at most one pair.
- `duplicate`, **medium** (doorway pattern): 3+ pages whose titles are
  identical after removing one differing token that is a known Australian
  place name (states, capitals and a list of ~200 suburbs and towns shipped
  in the module) or a token that appears in the site's meta keywords.
  Evidence: `<title pattern> on <n> pages`.

### stale.ts

All **low**.

- Meta keywords tag present. Evidence: first 100 chars of it.
- `meta robots` equal to any of `index`, `follow`, `index,follow`,
  `index, follow`, `all` — noise that does nothing. Evidence: the value.
- `<title>` over 70 characters where 3+ of the page's top-5 phrases occur.
  Evidence: the title.
- 2+ H1s where the same phrase occurs in each. Evidence: `<n> H1s share "<phrase>"`.

Stale findings are reported once per distinct evidence string per site,
not once per page.

## Severity and finding sentence

In `severity.ts` for `oldseo`:

- Any high → `Poor`, tone `fail`.
- Else any medium → `Needs work`, tone `warn`.
- Else → `Good`, tone `ok`.
- Finding sentence: `Good`: "No old or manipulative SEO practices found
  across <n> pages." Otherwise: "<count> finding(s) across <n> pages; the
  worst is <check name> on <path>." Check names: hidden text, hidden
  links, keyword stuffing, cloaking, duplicate pages, old habits.

## Report section

`OldSeo.svelte`: when there are no findings, one line: "<n> pages read,
nothing found." Otherwise a table grouped by check, worst severity first:
severity word (same tones as elsewhere), page path in mono, evidence in
mono at 11px, wrapped. `pagesSkipped` over 0 adds a muted line:
"<k> page(s) could not be read." Rows carry `break-inside-avoid`; the table
may run over a page.

Copy never says "black hat" or "penalty" on the client document. The
section is titled "Old SEO practices".

## Security

- Read-only: GET requests only, one user-agent variation for cloaking, no
  path guessing, no form submission, no scripts injected beyond our own
  snapshot function.
- Nothing from a page is executed outside the page. Evidence strings are
  truncated and control characters removed before they cross IPC.
- Honours `robots.txt` disallow rules.
- The page cap and per-page timeout bound the load put on a client's
  server: at most 11 browser loads and 11 Googlebot fetches per domain.

## Settings

`analyzers.oldseo: { maxPages: number }`, default 10, range 0–25, exposed
on the settings screen when that screen lands in Plan 3 Task 7. Until then
the default applies.

## Testing

- Each detector: fixture snapshots covering every listed rule, plus a
  clean page that yields nothing. Thresholds tested at the boundary
  (one under, one at).
- `crawl.ts` pure parts: link filtering (host, scheme, fragment, query,
  extension), robots parsing (`*` group only, disallow prefixes, missing
  file), breadth-first ordering with the cap.
- `snapshot.ts` helpers: words, n-grams, shingles, Jaccard on known inputs.
- `index.ts`: abort closes the browser, timeout closes the browser, homepage
  failure → thrown error, an internal page failure → counted as skipped.
  Same mocking approach as `keywords/index.test.ts`.
- Manual: a local fixture site (three HTML files served by the existing
  static server) with one of each trick, run through the real analyzer,
  then a real client domain to confirm nothing false-positives on ordinary
  navigation and cookie banners.

## Out of scope

Search-volume-based stale targeting (Plan 4), cross-domain link schemes,
Claude-based prose judgement, JavaScript-only content comparison (that is
the AEO analyzer's job), and any active probing.
