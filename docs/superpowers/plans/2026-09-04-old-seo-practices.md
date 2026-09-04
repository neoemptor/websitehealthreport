# Old SEO Practices Analyzer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tenth analyzer, `oldseo` "Old SEO practices", that crawls the homepage plus up to 10 internal pages and reports hidden text and links, keyword stuffing, cloaking, duplicate or doorway pages, and leftover old habits, each with page and evidence.

**Architecture:** One headless Puppeteer browser per domain takes a `PageSnapshot` of each page with a single in-page script; a plain Googlebot-UA fetch per page supplies the cloaking comparison. Five detectors are pure functions over the snapshot list. The analyzer composes them under the existing `Analyzer` contract with the same abort and teardown discipline as Keywords.

**Tech Stack:** Puppeteer (already a dependency), Node 18 global `fetch`, Vitest, Svelte 4 report component. No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-04-old-seo-practices-design.md`

## Global Constraints

- **Passive only.** GET requests, one user-agent variation (Googlebot) for cloaking, no path guessing, no form submission, no injected scripts beyond our own snapshot function.
- **`robots.txt` `Disallow` for `User-agent: *` is honoured.** Missing or unreadable robots means allow-all.
- **Bounded load:** at most 11 browser page loads and 11 Googlebot fetches per domain; 20s per page; `timeoutMs: 180_000`; `concurrency: 'limited'`.
- **States never collapsed:** Chromium missing → `unavailable`; homepage fails to load → `failed`; an internal page failing → counted in `pagesSkipped`, crawl continues.
- **Evidence is safe to print:** at most 160 characters, control characters and newlines collapsed to single spaces, before it leaves the analyzer.
- **Copy:** the check is titled "Old SEO practices". Never "black hat" or "penalty" on the client document. Plain Australian English.
- **Thresholds are named constants** at the top of each detector file.
- **Same lifecycle discipline as Keywords:** the browser is closed on abort and on timeout, exactly once, and the abort listener is removed.
- **Every commit passes** `npm run check`, `npm run lint`, `npx vitest run`. Run `npx prettier --write` on touched files first. Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File Structure

| Path                                                          | Responsibility                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/lib/shared/types.ts`                                     | `'oldseo'` added to `AnalyzerId`.                                                   |
| `src/lib/shared/oldseo.ts`                                    | `OldSeoCheck`, `Finding`, `OldSeoData` — shared with the renderer.                 |
| `electron/analyzers/oldseo/snapshot.ts` (+ test)              | `PageSnapshot`, `TextNode`, `HiddenReason`; `words`, `ngrams`, `shingles`, `jaccard`, `topPhrases`, `cleanEvidence`. |
| `electron/analyzers/oldseo/detect/hidden.ts` (+ test)         | Hidden text and hidden links.                                                       |
| `electron/analyzers/oldseo/detect/stuffing.ts` (+ test)       | Keyword stuffing.                                                                   |
| `electron/analyzers/oldseo/detect/cloaking.ts` (+ test)       | Googlebot vs browser comparison.                                                    |
| `electron/analyzers/oldseo/detect/duplicate.ts` (+ test)      | Duplicate pairs and doorway title patterns; ships the place-name list.              |
| `electron/analyzers/oldseo/detect/stale.ts` (+ test)          | Old habits.                                                                         |
| `electron/analyzers/oldseo/crawl.ts` (+ test)                 | Link selection, robots parsing, the in-page snapshot function, Googlebot fetch.    |
| `electron/analyzers/oldseo/index.ts` (+ test)                 | The analyzer.                                                                       |
| `electron/handlers.ts`                                        | Registration.                                                                       |
| `src/routes/+page.svelte`                                     | Check listed on the New report screen.                                              |
| `src/lib/report/severity.ts` (+ test)                         | Severity word and finding for `oldseo`.                                             |
| `src/lib/report/OldSeo.svelte`, `src/routes/report/[id]/+page.svelte` | Report section and its registration; the analyzer's display name.          |

The spec places `Finding`/`OldSeoData` under the analyzer; they live in `src/lib/shared/oldseo.ts` instead because the report component imports them, and the renderer cannot import from `electron/`. Same reason `discovery.ts` lives there.

---

### Task 1: Types and text helpers

**Files:**

- Modify: `src/lib/shared/types.ts:1-10`
- Create: `src/lib/shared/oldseo.ts`
- Create: `electron/analyzers/oldseo/snapshot.ts`
- Test: `electron/analyzers/oldseo/snapshot.test.ts`

**Interfaces:**

- Produces:

  ```ts
  // src/lib/shared/oldseo.ts
  export type OldSeoCheck = 'hidden-text' | 'hidden-link' | 'stuffing' | 'cloaking' | 'duplicate' | 'stale';
  export type Finding = { check: OldSeoCheck; severity: 'high' | 'medium' | 'low'; page: string; evidence: string };
  export type OldSeoData = { pagesRead: number; pagesSkipped: number; findings: Finding[] };

  // electron/analyzers/oldseo/snapshot.ts
  export type HiddenReason = 'display-none' | 'visibility-hidden' | 'opacity-zero' | 'tiny-font' | 'same-colour' | 'off-canvas' | 'zero-box';
  export type TextNode = { text: string; hidden: HiddenReason | null; inLink: string | null };
  export type PageSnapshot = { url: string; path: string; title: string; metaKeywords: string | null; metaRobots: string | null; h1s: string[]; visibleText: string; altText: string; nodes: TextNode[]; botText: string | null };
  export function words(text: string): string[];              // lower-case, letters/digits/apostrophes/hyphens, no stop-word removal
  export function ngrams(tokens: string[], n: number): string[];
  export function shingles(text: string): Set<string>;        // 3-word shingles of words(text)
  export function jaccard(a: Set<string>, b: Set<string>): number; // 0 when both empty
  export function topPhrases(text: string, count: number): Array<{ phrase: string; n: number; occurrences: number }>; // 1–3-grams, stop words removed from 1-grams, sorted by occurrences desc, then longer phrase first
  export function cleanEvidence(s: string): string;           // control chars and whitespace runs → single space, trimmed, ≤160 chars
  export const STOP_WORDS: Set<string>;
  export function makeSnapshot(partial: Partial<PageSnapshot> & { path: string }): PageSnapshot; // test fixture helper, fills blanks
  ```

- [ ] **Step 1: Write the failing tests**

Create `electron/analyzers/oldseo/snapshot.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { words, ngrams, shingles, jaccard, topPhrases, cleanEvidence, makeSnapshot } from './snapshot';

describe('words', () => {
	it('lower-cases and keeps apostrophes and hyphens inside words', () => {
		expect(words("Roller Doors, Perth's best-priced doors!")).toEqual([
			'roller', 'doors', "perth's", 'best-priced', 'doors'
		]);
	});
});

describe('ngrams', () => {
	it('slides a window of n', () => {
		expect(ngrams(['a', 'b', 'c'], 2)).toEqual(['a b', 'b c']);
		expect(ngrams(['a'], 2)).toEqual([]);
	});
});

describe('shingles and jaccard', () => {
	it('is 1 for identical text and 0 for disjoint text', () => {
		const a = shingles('garage door repairs in mandurah every day');
		expect(jaccard(a, shingles('garage door repairs in mandurah every day'))).toBe(1);
		expect(jaccard(a, shingles('completely different words here now'))).toBe(0);
		expect(jaccard(new Set(), new Set())).toBe(0);
	});
});

describe('topPhrases', () => {
	it('ranks phrases by occurrence, drops stop words from single words', () => {
		const text = 'the roller doors and the roller doors and the roller doors are the best';
		const top = topPhrases(text, 3);
		expect(top[0]).toEqual({ phrase: 'roller doors', n: 2, occurrences: 3 });
		expect(top.map((t) => t.phrase)).not.toContain('the');
	});
});

describe('cleanEvidence', () => {
	it('collapses control characters and caps at 160', () => {
		expect(cleanEvidence('a\n\tb  c')).toBe('a b c');
		expect(cleanEvidence('x'.repeat(200)).length).toBe(160);
	});
});

describe('makeSnapshot', () => {
	it('fills every field so detectors can rely on the shape', () => {
		const s = makeSnapshot({ path: '/' });
		expect(s).toEqual({
			url: 'https://example.com/',
			path: '/',
			title: '',
			metaKeywords: null,
			metaRobots: null,
			h1s: [],
			visibleText: '',
			altText: '',
			nodes: [],
			botText: null
		});
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run electron/analyzers/oldseo/snapshot.test.ts`
Expected: FAIL — cannot resolve `./snapshot`.

- [ ] **Step 3: Add the id and shared types**

In `src/lib/shared/types.ts` add `| 'oldseo'` after `| 'keywords'` in `AnalyzerId`.

Create `src/lib/shared/oldseo.ts`:

```ts
/**
 * Old SEO practices: what the analyzer reports and the report renders.
 * Shared here because the renderer cannot import from electron/.
 */
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

- [ ] **Step 4: Implement snapshot.ts**

```ts
/**
 * The shape one page is reduced to, and the pure text helpers every detector
 * shares. Nothing here touches a browser.
 */
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
	/** Visible text as fetched with the Googlebot user agent, or null if that fetch failed. */
	botText: string | null;
};

export const STOP_WORDS = new Set(
	`a about above after again against all am an and any are as at be because been before being below between both but by can did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves`.split(
		/\s+/
	)
);

export function words(text: string): string[] {
	return (text.toLowerCase().match(/[a-z0-9]+(?:['’-][a-z0-9]+)*/g) ?? []).map((w) =>
		w.replace(/’/g, "'")
	);
}

export function ngrams(tokens: string[], n: number): string[] {
	const out: string[] = [];
	for (let i = 0; i + n <= tokens.length; i++) out.push(tokens.slice(i, i + n).join(' '));
	return out;
}

export function shingles(text: string): Set<string> {
	return new Set(ngrams(words(text), 3));
}

export function jaccard(a: Set<string>, b: Set<string>): number {
	if (a.size === 0 && b.size === 0) return 0;
	let both = 0;
	for (const s of a) if (b.has(s)) both++;
	return both / (a.size + b.size - both);
}

export function topPhrases(
	text: string,
	count: number
): Array<{ phrase: string; n: number; occurrences: number }> {
	const tokens = words(text);
	const counts = new Map<string, { n: number; occurrences: number }>();
	for (const n of [1, 2, 3]) {
		for (const phrase of ngrams(tokens, n)) {
			if (n === 1 && STOP_WORDS.has(phrase)) continue;
			// A multi-word phrase made only of stop words ("of the") is noise.
			if (n > 1 && phrase.split(' ').every((w) => STOP_WORDS.has(w))) continue;
			const entry = counts.get(phrase) ?? { n, occurrences: 0 };
			entry.occurrences++;
			counts.set(phrase, entry);
		}
	}
	return [...counts.entries()]
		.map(([phrase, v]) => ({ phrase, n: v.n, occurrences: v.occurrences }))
		.sort((a, b) => b.occurrences - a.occurrences || b.n - a.n || a.phrase.localeCompare(b.phrase))
		.slice(0, count);
}

export function cleanEvidence(s: string): string {
	return s
		.replace(/[ -]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 160);
}

/** Test fixture helper: a complete snapshot from the fields a test cares about. */
export function makeSnapshot(partial: Partial<PageSnapshot> & { path: string }): PageSnapshot {
	return {
		url: `https://example.com${partial.path}`,
		title: '',
		metaKeywords: null,
		metaRobots: null,
		h1s: [],
		visibleText: '',
		altText: '',
		nodes: [],
		botText: null,
		...partial
	};
}
```

- [ ] **Step 5: Run the tests and checks**

Run: `npx vitest run electron/analyzers/oldseo/snapshot.test.ts && npm run check`
Expected: 7 tests PASS; check 0 errors (adding an `AnalyzerId` member breaks nothing: every map over ids is `Partial`).

- [ ] **Step 6: Commit**

```bash
npx prettier --write src/lib/shared/types.ts src/lib/shared/oldseo.ts electron/analyzers/oldseo/snapshot.ts electron/analyzers/oldseo/snapshot.test.ts
git add src/lib/shared/types.ts src/lib/shared/oldseo.ts electron/analyzers/oldseo/snapshot.ts electron/analyzers/oldseo/snapshot.test.ts
git commit -m "Add the Old SEO practices types and text helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Hidden text and links detector

**Files:**

- Create: `electron/analyzers/oldseo/detect/hidden.ts`
- Test: `electron/analyzers/oldseo/detect/hidden.test.ts`

**Interfaces:**

- Consumes: `PageSnapshot`, `TextNode`, `words`, `topPhrases`, `cleanEvidence`, `makeSnapshot` (Task 1); `Finding` (Task 1).
- Produces: `export function detectHidden(pages: PageSnapshot[]): Finding[]`.

Rules (from the spec): `hidden-text` **high** for a hidden node with 30+ words, or 8+ words where at least 3 of the page's top-5 phrases occur; `hidden-text` **low** once per page as a count for hidden nodes with 8–29 words and under 3 phrase hits; `hidden-link` **high** for a hidden node with `inLink`, or reason `zero-box` with `inLink`. Legitimate UI exclusion is done in the browser (the snapshot script records `hidden: null` for those), so this detector trusts `hidden`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { detectHidden } from './hidden';
import { makeSnapshot } from '../snapshot';

const w = (n: number, word = 'garage') => Array.from({ length: n }, () => word).join(' ');

describe('detectHidden', () => {
	it('flags a long hidden block as high with its reason and a text excerpt', () => {
		const page = makeSnapshot({
			path: '/',
			visibleText: 'Garage doors Perth',
			nodes: [{ text: 'cheap ' + w(30, 'doors'), hidden: 'same-colour', inLink: null }]
		});
		const [f] = detectHidden([page]);
		expect(f).toMatchObject({ check: 'hidden-text', severity: 'high', page: '/' });
		expect(f.evidence).toMatch(/^same-colour: "cheap doors/);
	});

	it('flags a short hidden block as high when it repeats the page keywords', () => {
		const page = makeSnapshot({
			path: '/p',
			visibleText: 'roller doors roller doors roller doors sectional doors sectional doors perth perth',
			nodes: [{ text: 'roller doors sectional doors perth roller doors perth cheap', hidden: 'off-canvas', inLink: null }]
		});
		expect(detectHidden([page])[0]).toMatchObject({ check: 'hidden-text', severity: 'high' });
	});

	it('reports short keyword-free hidden blocks once per page as low', () => {
		const page = makeSnapshot({
			path: '/about',
			visibleText: 'Our story',
			nodes: [
				{ text: 'this is some ordinary collapsed paragraph text here', hidden: 'display-none', inLink: null },
				{ text: 'another ordinary paragraph that is simply not shown', hidden: 'display-none', inLink: null }
			]
		});
		const out = detectHidden([page]);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ check: 'hidden-text', severity: 'low', page: '/about' });
		expect(out[0].evidence).toMatch(/2 hidden blocks/);
	});

	it('flags hidden links as high with the target', () => {
		const page = makeSnapshot({
			path: '/',
			nodes: [{ text: 'best doors', hidden: 'tiny-font', inLink: 'https://other.example/' }]
		});
		expect(detectHidden([page])[0]).toEqual({
			check: 'hidden-link',
			severity: 'high',
			page: '/',
			evidence: 'tiny-font: https://other.example/'
		});
	});

	it('ignores visible nodes and hidden nodes under 8 words', () => {
		const page = makeSnapshot({
			path: '/',
			nodes: [
				{ text: w(40), hidden: null, inLink: null },
				{ text: 'skip to content', hidden: 'off-canvas', inLink: null }
			]
		});
		expect(detectHidden([page])).toEqual([]);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run electron/analyzers/oldseo/detect/hidden.test.ts`
Expected: FAIL — cannot resolve `./hidden`.

- [ ] **Step 3: Implement**

```ts
import type { Finding } from '../../../../src/lib/shared/oldseo';
import { cleanEvidence, topPhrases, words, type PageSnapshot } from '../snapshot';

/** Hidden text this long is concealment, whatever it says. */
const LONG_HIDDEN_WORDS = 30;
/** Shorter hidden text counts when it leans on the page's own keywords. */
const SHORT_HIDDEN_WORDS = 8;
const KEYWORD_HITS = 3;
const TOP_PHRASES = 5;

export function detectHidden(pages: PageSnapshot[]): Finding[] {
	const findings: Finding[] = [];
	for (const page of pages) {
		const top = topPhrases(page.visibleText, TOP_PHRASES).map((t) => t.phrase);
		let quiet = 0;
		for (const node of page.nodes) {
			if (!node.hidden) continue;
			if (node.inLink) {
				findings.push({
					check: 'hidden-link',
					severity: 'high',
					page: page.path,
					evidence: cleanEvidence(`${node.hidden}: ${node.inLink}`)
				});
				continue;
			}
			const count = words(node.text).length;
			if (count < SHORT_HIDDEN_WORDS) continue;
			const lower = node.text.toLowerCase();
			const hits = top.filter((p) => lower.includes(p)).length;
			if (count >= LONG_HIDDEN_WORDS || hits >= KEYWORD_HITS) {
				findings.push({
					check: 'hidden-text',
					severity: 'high',
					page: page.path,
					evidence: cleanEvidence(`${node.hidden}: "${node.text.slice(0, 100)}"`)
				});
			} else {
				quiet++;
			}
		}
		if (quiet > 0) {
			findings.push({
				check: 'hidden-text',
				severity: 'low',
				page: page.path,
				evidence: `${quiet} hidden block${quiet === 1 ? '' : 's'} of ordinary text`
			});
		}
	}
	return findings;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run electron/analyzers/oldseo/detect/hidden.test.ts`
Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write electron/analyzers/oldseo/detect/hidden.ts electron/analyzers/oldseo/detect/hidden.test.ts
git add electron/analyzers/oldseo/detect/hidden.ts electron/analyzers/oldseo/detect/hidden.test.ts
git commit -m "Detect hidden text and hidden links

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Keyword stuffing detector

**Files:**

- Create: `electron/analyzers/oldseo/detect/stuffing.ts`
- Test: `electron/analyzers/oldseo/detect/stuffing.test.ts`

**Interfaces:**

- Consumes: `words`, `ngrams`, `topPhrases`, `STOP_WORDS`, `cleanEvidence`, `makeSnapshot`, `PageSnapshot`, `Finding`.
- Produces: `export function detectStuffing(pages: PageSnapshot[]): Finding[]`.

Rules: **high** — a 2–3 word phrase 8+ times with density over 5% (density = occurrences × phrase words ÷ page words × 100). **medium** — a single word 12+ times with density over 8%; a comma list of 4+ phrase-shaped chunks (each 1–3 words, no stop-word-only chunk) on one line of 40+ characters; a 2–3 word phrase 10+ times in `altText`. One finding per page per rule at most (the worst phrase).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { detectStuffing } from './stuffing';
import { makeSnapshot } from '../snapshot';

const filler = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('detectStuffing', () => {
	it('flags a repeated multi-word phrase over 5% density as high', () => {
		// 8 × "garage doors" = 16 words of 100 → 16%.
		const text = `${'garage doors '.repeat(8)}${filler(84)}`;
		const [f] = detectStuffing([makeSnapshot({ path: '/', visibleText: text })]);
		expect(f).toMatchObject({ check: 'stuffing', severity: 'high', page: '/' });
		expect(f.evidence).toBe('"garage doors" ×8, 16.0% of 100 words');
	});

	it('does not flag the same phrase at the boundary: 7 occurrences', () => {
		const text = `${'garage doors '.repeat(7)}${filler(86)}`;
		expect(detectStuffing([makeSnapshot({ path: '/', visibleText: text })])).toEqual([]);
	});

	it('flags a single word over 8% density as medium, ignoring stop words', () => {
		const text = `${'the '.repeat(30)}${'perth '.repeat(12)}${filler(58)}`;
		const out = detectStuffing([makeSnapshot({ path: '/', visibleText: text })]);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ severity: 'medium' });
		expect(out[0].evidence).toMatch(/^"perth" ×12/);
	});

	it('flags a comma list of keyword phrases as medium', () => {
		const text = `Welcome to our site.\ngarage doors perth, roller doors perth, sectional doors, garage door repairs, door motors\nCall us today.`;
		const out = detectStuffing([makeSnapshot({ path: '/', visibleText: text })]);
		expect(out).toHaveLength(1);
		expect(out[0].evidence).toMatch(/^comma list of 5 phrases/);
	});

	it('flags alt text stuffing as medium', () => {
		const alt = 'garage doors perth '.repeat(10);
		const out = detectStuffing([makeSnapshot({ path: '/', visibleText: filler(50), altText: alt })]);
		expect(out).toHaveLength(1);
		expect(out[0].evidence).toMatch(/^alt text: "garage doors perth" ×10/);
	});

	it('is quiet on ordinary prose', () => {
		const text =
			'We repair and install garage doors across Mandurah and Rockingham. Our team has served the Peel region since 2002, and we offer same-day callouts for motors, springs and panels.';
		expect(detectStuffing([makeSnapshot({ path: '/', visibleText: text })])).toEqual([]);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run electron/analyzers/oldseo/detect/stuffing.test.ts`
Expected: FAIL — cannot resolve `./stuffing`.

- [ ] **Step 3: Implement**

```ts
import type { Finding } from '../../../../src/lib/shared/oldseo';
import { STOP_WORDS, cleanEvidence, ngrams, words, type PageSnapshot } from '../snapshot';

const PHRASE_MIN_OCCURRENCES = 8;
const PHRASE_MIN_DENSITY = 5; // percent of page words
const WORD_MIN_OCCURRENCES = 12;
const WORD_MIN_DENSITY = 8;
const LIST_MIN_CHUNKS = 4;
const LIST_MIN_CHARS = 40;
const ALT_MIN_OCCURRENCES = 10;

type Hit = { phrase: string; n: number; occurrences: number; density: number };

/** Every 1–3-gram with its occurrence count and density, stop words excluded. */
function phraseHits(text: string): Hit[] {
	const tokens = words(text);
	if (tokens.length === 0) return [];
	const counts = new Map<string, { n: number; occurrences: number }>();
	for (const n of [1, 2, 3]) {
		for (const phrase of ngrams(tokens, n)) {
			const parts = phrase.split(' ');
			if (parts.every((w) => STOP_WORDS.has(w))) continue;
			const entry = counts.get(phrase) ?? { n, occurrences: 0 };
			entry.occurrences++;
			counts.set(phrase, entry);
		}
	}
	return [...counts.entries()].map(([phrase, v]) => ({
		phrase,
		n: v.n,
		occurrences: v.occurrences,
		density: (v.occurrences * v.n * 100) / tokens.length
	}));
}

function worst(hits: Hit[], keep: (h: Hit) => boolean): Hit | null {
	const matching = hits.filter(keep).sort((a, b) => b.density - a.density || b.n - a.n);
	return matching[0] ?? null;
}

/** A line that is a comma-separated run of short keyword phrases and nothing else. */
function commaList(text: string): { chunks: number; line: string } | null {
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (trimmed.length < LIST_MIN_CHARS || !trimmed.includes(',')) continue;
		const chunks = trimmed.split(',').map((c) => c.trim()).filter(Boolean);
		if (chunks.length < LIST_MIN_CHUNKS) continue;
		const phraseShaped = chunks.every((c) => {
			const ws = words(c);
			return ws.length >= 1 && ws.length <= 3 && !ws.every((w) => STOP_WORDS.has(w));
		});
		if (phraseShaped) return { chunks: chunks.length, line: trimmed };
	}
	return null;
}

export function detectStuffing(pages: PageSnapshot[]): Finding[] {
	const findings: Finding[] = [];
	for (const page of pages) {
		const total = words(page.visibleText).length;
		const hits = phraseHits(page.visibleText);

		const phrase = worst(
			hits,
			(h) => h.n >= 2 && h.occurrences >= PHRASE_MIN_OCCURRENCES && h.density > PHRASE_MIN_DENSITY
		);
		if (phrase) {
			findings.push({
				check: 'stuffing',
				severity: 'high',
				page: page.path,
				evidence: cleanEvidence(
					`"${phrase.phrase}" ×${phrase.occurrences}, ${phrase.density.toFixed(1)}% of ${total} words`
				)
			});
		} else {
			const word = worst(
				hits,
				(h) => h.n === 1 && h.occurrences >= WORD_MIN_OCCURRENCES && h.density > WORD_MIN_DENSITY
			);
			if (word) {
				findings.push({
					check: 'stuffing',
					severity: 'medium',
					page: page.path,
					evidence: cleanEvidence(
						`"${word.phrase}" ×${word.occurrences}, ${word.density.toFixed(1)}% of ${total} words`
					)
				});
			}
		}

		const list = commaList(page.visibleText);
		if (list) {
			findings.push({
				check: 'stuffing',
				severity: 'medium',
				page: page.path,
				evidence: cleanEvidence(`comma list of ${list.chunks} phrases: "${list.line.slice(0, 100)}"`)
			});
		}

		const alt = worst(phraseHits(page.altText), (h) => h.n >= 2 && h.occurrences >= ALT_MIN_OCCURRENCES);
		if (alt) {
			findings.push({
				check: 'stuffing',
				severity: 'medium',
				page: page.path,
				evidence: cleanEvidence(`alt text: "${alt.phrase}" ×${alt.occurrences}`)
			});
		}
	}
	return findings;
}
```

Note on the third test: with 30 × "the" excluded as a stop word, "perth" is 12 of 100 words = 12% density, over the 8% floor. The 2-gram "perth perth" also appears 11 times at 22% density; it is a 2-gram with 11 ≥ 8 occurrences and would take the high rule — so the test text must not repeat the single word adjacently. Change the test's third case to interleave: `Array.from({length:12},(_,i)=>`perth word${i}`).join(' ')` plus filler to 100 words, so "perth" occurs 12 times non-adjacently. Update the test accordingly before running.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run electron/analyzers/oldseo/detect/stuffing.test.ts`
Expected: 6 PASS. If the alt-text case also trips the visible-text rules, it should not: the visible text is unique filler.

- [ ] **Step 5: Commit**

```bash
npx prettier --write electron/analyzers/oldseo/detect/stuffing.ts electron/analyzers/oldseo/detect/stuffing.test.ts
git add electron/analyzers/oldseo/detect/stuffing.ts electron/analyzers/oldseo/detect/stuffing.test.ts
git commit -m "Detect keyword stuffing in page text and alt text

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Cloaking detector

**Files:**

- Create: `electron/analyzers/oldseo/detect/cloaking.ts`
- Test: `electron/analyzers/oldseo/detect/cloaking.test.ts`

**Interfaces:**

- Consumes: `words`, `shingles`, `jaccard`, `makeSnapshot`, `PageSnapshot`, `Finding`.
- Produces: `export function detectCloaking(pages: PageSnapshot[]): Finding[]`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { detectCloaking } from './cloaking';
import { makeSnapshot } from '../snapshot';

const prose = (seed: string) =>
	Array.from({ length: 60 }, (_, i) => `${seed}${i} sentence about doors`).join(' ');

describe('detectCloaking', () => {
	it('flags a page whose Googlebot text differs from the browser text', () => {
		const page = makeSnapshot({ path: '/', visibleText: prose('a'), botText: prose('b') });
		const [f] = detectCloaking([page]);
		expect(f).toMatchObject({ check: 'cloaking', severity: 'high', page: '/' });
		expect(f.evidence).toMatch(/^browser 240 words, Googlebot 240 words, similarity 0\.\d\d$/);
	});

	it('is quiet when the texts match', () => {
		const page = makeSnapshot({ path: '/', visibleText: prose('a'), botText: prose('a') });
		expect(detectCloaking([page])).toEqual([]);
	});

	it('skips pages with no bot text or under 50 words', () => {
		expect(detectCloaking([makeSnapshot({ path: '/', visibleText: prose('a'), botText: null })])).toEqual([]);
		expect(
			detectCloaking([makeSnapshot({ path: '/', visibleText: 'short text', botText: 'other short text' })])
		).toEqual([]);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run electron/analyzers/oldseo/detect/cloaking.test.ts`
Expected: FAIL — cannot resolve `./cloaking`.

- [ ] **Step 3: Implement**

```ts
import type { Finding } from '../../../../src/lib/shared/oldseo';
import { jaccard, shingles, words, type PageSnapshot } from '../snapshot';

/** Below this the two versions are not the same page. */
const MAX_SIMILARITY = 0.6;
/** Tiny pages differ for innocent reasons (a cookie banner, a date). */
const MIN_WORDS = 50;

export function detectCloaking(pages: PageSnapshot[]): Finding[] {
	const findings: Finding[] = [];
	for (const page of pages) {
		if (page.botText === null) continue;
		const browserWords = words(page.visibleText).length;
		const botWords = words(page.botText).length;
		if (browserWords < MIN_WORDS || botWords < MIN_WORDS) continue;
		const similarity = jaccard(shingles(page.visibleText), shingles(page.botText));
		if (similarity >= MAX_SIMILARITY) continue;
		findings.push({
			check: 'cloaking',
			severity: 'high',
			page: page.path,
			evidence: `browser ${browserWords} words, Googlebot ${botWords} words, similarity ${similarity.toFixed(2)}`
		});
	}
	return findings;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run electron/analyzers/oldseo/detect/cloaking.test.ts`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
npx prettier --write electron/analyzers/oldseo/detect/cloaking.ts electron/analyzers/oldseo/detect/cloaking.test.ts
git add electron/analyzers/oldseo/detect/cloaking.ts electron/analyzers/oldseo/detect/cloaking.test.ts
git commit -m "Detect cloaking by comparing browser and Googlebot text

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Duplicate and doorway detector

**Files:**

- Create: `electron/analyzers/oldseo/detect/duplicate.ts`
- Create: `electron/analyzers/oldseo/detect/places.ts`
- Test: `electron/analyzers/oldseo/detect/duplicate.test.ts`

**Interfaces:**

- Consumes: `words`, `shingles`, `jaccard`, `makeSnapshot`, `PageSnapshot`, `Finding`.
- Produces: `export function detectDuplicate(pages: PageSnapshot[]): Finding[]`; `export const PLACES: Set<string>` (lower-case Australian states, capitals and ~200 suburbs/towns).

Rules: **medium** pair — different paths, 100+ words each, shingle similarity over 0.9; each page in at most one pair. **medium** doorway — 3+ pages whose titles are identical after removing exactly one differing token that is in `PLACES` or in the site's meta keywords (any page's `metaKeywords`, split on commas, lower-cased, multi-word entries kept whole).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { detectDuplicate } from './duplicate';
import { PLACES } from './places';
import { makeSnapshot } from '../snapshot';

const body = (seed: string) => Array.from({ length: 120 }, (_, i) => `${seed} word${i}`).join(' ');

describe('detectDuplicate', () => {
	it('flags a near-identical pair once, naming both paths', () => {
		const a = makeSnapshot({ path: '/a', visibleText: body('x') });
		const b = makeSnapshot({ path: '/b', visibleText: body('x') + ' extra' });
		const c = makeSnapshot({ path: '/c', visibleText: body('x') });
		const out = detectDuplicate([a, b, c]);
		const pairs = out.filter((f) => f.evidence.includes('≈'));
		expect(pairs).toHaveLength(1);
		expect(pairs[0]).toMatchObject({ check: 'duplicate', severity: 'medium', page: '/a' });
		expect(pairs[0].evidence).toMatch(/^\/a ≈ \/b \(0\.9\d\)$|^\/a ≈ \/c \(1\.00\)$/);
	});

	it('flags a doorway title pattern across three places', () => {
		const pages = ['Mandurah', 'Rockingham', 'Baldivis'].map((place, i) =>
			makeSnapshot({ path: `/${i}`, title: `Garage Door Repairs ${place} | CJ Doors`, visibleText: body(`p${i}`) })
		);
		const [f] = detectDuplicate(pages);
		expect(f).toMatchObject({ check: 'duplicate', severity: 'medium', page: '/0' });
		expect(f.evidence).toBe('"Garage Door Repairs {place} | CJ Doors" on 3 pages');
	});

	it('accepts a keyword from the meta keywords as the varying token', () => {
		const pages = ['roller', 'sectional', 'tilt'].map((kw, i) =>
			makeSnapshot({
				path: `/${i}`,
				title: `Cheap ${kw} doors`,
				metaKeywords: 'roller, sectional, tilt',
				visibleText: body(`q${i}`)
			})
		);
		expect(detectDuplicate(pages)).toHaveLength(1);
	});

	it('is quiet for two matching titles or for distinct pages', () => {
		const pages = ['Mandurah', 'Rockingham'].map((place, i) =>
			makeSnapshot({ path: `/${i}`, title: `Doors ${place}`, visibleText: body(`r${i}`) })
		);
		expect(detectDuplicate(pages)).toEqual([]);
	});

	it('ships the states and capitals', () => {
		for (const p of ['perth', 'wa', 'western australia', 'mandurah', 'rockingham', 'newcastle', 'nsw'])
			expect(PLACES.has(p)).toBe(true);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run electron/analyzers/oldseo/detect/duplicate.test.ts`
Expected: FAIL — cannot resolve `./duplicate`.

- [ ] **Step 3: Create places.ts**

```ts
/**
 * Australian states, territories, capitals and a spread of suburbs and towns
 * that local-service doorway pages are typically minted for. Lower-case.
 * Multi-word names are kept as one entry and matched as a whole token group.
 */
export const PLACES: Set<string> = new Set(
	[
		// states and territories
		'wa', 'western australia', 'nsw', 'new south wales', 'vic', 'victoria', 'qld', 'queensland',
		'sa', 'south australia', 'tas', 'tasmania', 'nt', 'northern territory', 'act',
		'australian capital territory',
		// capitals
		'perth', 'sydney', 'melbourne', 'brisbane', 'adelaide', 'hobart', 'darwin', 'canberra',
		// WA
		'mandurah', 'rockingham', 'baldivis', 'kwinana', 'fremantle', 'joondalup', 'wanneroo',
		'midland', 'armadale', 'canning vale', 'cockburn', 'success', 'bunbury', 'busselton',
		'geraldton', 'kalgoorlie', 'albany', 'ellenbrook', 'scarborough', 'subiaco', 'victoria park',
		'gosnells', 'thornlie', 'morley', 'bayswater', 'belmont', 'cannington', 'byford', 'pinjarra',
		'dawesville', 'halls head', 'secret harbour', 'warnbro', 'safety bay', 'port kennedy',
		'yanchep', 'two rocks', 'butler', 'clarkson', 'mindarie', 'hillarys', 'karrinyup',
		'stirling', 'osborne park', 'balcatta', 'malaga', 'ballajura', 'bassendean', 'guildford',
		'kalamunda', 'forrestfield', 'maddington', 'kelmscott', 'mount lawley', 'leederville',
		'nedlands', 'claremont', 'cottesloe', 'mosman park', 'applecross', 'booragoon', 'melville',
		'bibra lake', 'spearwood', 'hamilton hill', 'coogee', 'beeliar', 'atwell', 'harrisdale',
		'piara waters', 'southern river', 'jandakot', 'leeming', 'bull creek', 'willetton',
		'riverton', 'rossmoyne', 'shelley', 'bentley', 'como', 'south perth', 'east perth',
		'north perth', 'west perth', 'northbridge', 'highgate', 'maylands', 'inglewood', 'dianella',
		'noranda', 'beechboro', 'kiara', 'lockridge', 'eden hill', 'caversham', 'swan view',
		'greenmount', 'mundaring', 'chidlow', 'gidgegannup', 'bullsbrook', 'gingin', 'lancelin',
		'jurien bay', 'northam', 'york', 'toodyay', 'serpentine', 'jarrahdale', 'mundijong',
		'waroona', 'harvey', 'australind', 'eaton', 'collie', 'donnybrook', 'capel', 'dunsborough',
		'margaret river', 'augusta', 'manjimup', 'bridgetown', 'denmark', 'esperance', 'broome',
		'karratha', 'port hedland', 'newman', 'carnarvon', 'exmouth', 'derby', 'kununurra',
		// NSW
		'newcastle', 'wollongong', 'central coast', 'gosford', 'wyong', 'maitland', 'cessnock',
		'lake macquarie', 'port stephens', 'parramatta', 'penrith', 'blacktown', 'liverpool',
		'campbelltown', 'camden', 'hornsby', 'ryde', 'chatswood', 'manly', 'bondi', 'randwick',
		'sutherland', 'cronulla', 'hurstville', 'bankstown', 'auburn', 'strathfield', 'burwood',
		'blue mountains', 'katoomba', 'richmond', 'windsor', 'castle hill', 'baulkham hills',
		'coffs harbour', 'port macquarie', 'tamworth', 'armidale', 'dubbo', 'orange', 'bathurst',
		'wagga wagga', 'albury', 'goulburn', 'queanbeyan', 'nowra', 'kiama', 'shellharbour',
		'tweed heads', 'byron bay', 'lismore', 'ballina', 'grafton',
		// VIC
		'geelong', 'ballarat', 'bendigo', 'shepparton', 'mildura', 'warrnambool', 'frankston',
		'dandenong', 'cranbourne', 'pakenham', 'berwick', 'narre warren', 'werribee', 'sunshine',
		'footscray', 'essendon', 'moonee ponds', 'preston', 'reservoir', 'heidelberg', 'box hill',
		'ringwood', 'croydon', 'lilydale', 'mornington', 'rosebud', 'traralgon', 'morwell', 'sale',
		'wodonga', 'wangaratta', 'horsham', 'colac', 'torquay', 'ocean grove',
		// QLD
		'gold coast', 'sunshine coast', 'toowoomba', 'townsville', 'cairns', 'mackay',
		'rockhampton', 'bundaberg', 'hervey bay', 'gladstone', 'ipswich', 'logan', 'redcliffe',
		'caboolture', 'moreton bay', 'redland', 'cleveland', 'southport', 'surfers paradise',
		'robina', 'burleigh heads', 'coolangatta', 'maroochydore', 'caloundra', 'noosa', 'nambour',
		'gympie', 'maryborough', 'chermside', 'carindale', 'indooroopilly', 'mount gravatt',
		// SA
		'mount gambier', 'whyalla', 'port augusta', 'port lincoln', 'murray bridge', 'gawler',
		'elizabeth', 'salisbury', 'modbury', 'tea tree gully', 'glenelg', 'marion', 'noarlunga',
		'mount barker', 'victor harbor', 'port pirie',
		// TAS / NT / ACT
		'launceston', 'devonport', 'burnie', 'kingston', 'glenorchy', 'alice springs', 'palmerston',
		'katherine', 'belconnen', 'tuggeranong', 'woden', 'gungahlin', 'queanbeyan'
	].map((p) => p.toLowerCase())
);
```

- [ ] **Step 4: Implement duplicate.ts**

```ts
import type { Finding } from '../../../../src/lib/shared/oldseo';
import { jaccard, shingles, words, type PageSnapshot } from '../snapshot';
import { PLACES } from './places';

const PAIR_MIN_SIMILARITY = 0.9;
const PAIR_MIN_WORDS = 100;
const DOORWAY_MIN_PAGES = 3;

function siteKeywords(pages: PageSnapshot[]): Set<string> {
	const out = new Set<string>();
	for (const page of pages) {
		for (const k of (page.metaKeywords ?? '').split(',')) {
			const t = k.trim().toLowerCase();
			if (t) out.add(t);
		}
	}
	return out;
}

/** Title tokens as displayed, with a lower-case copy for comparison. */
function tokens(title: string): string[] {
	return title.split(/\s+/).filter(Boolean);
}

/**
 * Two titles that differ in exactly one token position, where both differing
 * tokens are places or site keywords, share a doorway pattern. Multi-word
 * places ("canning vale") are handled by also trying two-token windows.
 */
function pattern(title: string, allowed: Set<string>): string | null {
	const t = tokens(title);
	for (let width = 1; width <= 2; width++) {
		for (let i = 0; i + width <= t.length; i++) {
			const window = t.slice(i, i + width).join(' ').toLowerCase().replace(/[|,.:;!?-]+$/g, '');
			if (!allowed.has(window)) continue;
			const rest = [...t.slice(0, i), '{place}', ...t.slice(i + width)].join(' ');
			return rest;
		}
	}
	return null;
}

export function detectDuplicate(pages: PageSnapshot[]): Finding[] {
	const findings: Finding[] = [];

	// Near-identical pairs, each page in at most one pair.
	const eligible = pages.filter((p) => words(p.visibleText).length >= PAIR_MIN_WORDS);
	const sets = new Map(eligible.map((p) => [p.path, shingles(p.visibleText)]));
	const used = new Set<string>();
	for (let i = 0; i < eligible.length; i++) {
		const a = eligible[i];
		if (used.has(a.path)) continue;
		for (let j = i + 1; j < eligible.length; j++) {
			const b = eligible[j];
			if (used.has(b.path) || a.path === b.path) continue;
			const s = jaccard(sets.get(a.path)!, sets.get(b.path)!);
			if (s <= PAIR_MIN_SIMILARITY) continue;
			used.add(a.path);
			used.add(b.path);
			findings.push({
				check: 'duplicate',
				severity: 'medium',
				page: a.path,
				evidence: `${a.path} ≈ ${b.path} (${s.toFixed(2)})`
			});
			break;
		}
	}

	// Doorway title patterns.
	const allowed = new Set([...PLACES, ...siteKeywords(pages)]);
	const groups = new Map<string, PageSnapshot[]>();
	for (const page of pages) {
		if (!page.title) continue;
		const key = pattern(page.title, allowed);
		if (!key) continue;
		groups.set(key, [...(groups.get(key) ?? []), page]);
	}
	for (const [key, members] of groups) {
		if (members.length < DOORWAY_MIN_PAGES) continue;
		findings.push({
			check: 'duplicate',
			severity: 'medium',
			page: members[0].path,
			evidence: `"${key}" on ${members.length} pages`
		});
	}

	return findings;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run electron/analyzers/oldseo/detect/duplicate.test.ts`
Expected: 5 PASS.

- [ ] **Step 6: Commit**

```bash
npx prettier --write electron/analyzers/oldseo/detect/duplicate.ts electron/analyzers/oldseo/detect/places.ts electron/analyzers/oldseo/detect/duplicate.test.ts
git add electron/analyzers/oldseo/detect/duplicate.ts electron/analyzers/oldseo/detect/places.ts electron/analyzers/oldseo/detect/duplicate.test.ts
git commit -m "Detect duplicate pages and doorway title patterns

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Stale habits detector

**Files:**

- Create: `electron/analyzers/oldseo/detect/stale.ts`
- Test: `electron/analyzers/oldseo/detect/stale.test.ts`

**Interfaces:**

- Consumes: `topPhrases`, `cleanEvidence`, `makeSnapshot`, `PageSnapshot`, `Finding`.
- Produces: `export function detectStale(pages: PageSnapshot[]): Finding[]`. All findings **low**, one per distinct evidence string per site (first page wins).

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { detectStale } from './stale';
import { makeSnapshot } from '../snapshot';

describe('detectStale', () => {
	it('reports a meta keywords tag once per site', () => {
		const pages = [
			makeSnapshot({ path: '/', metaKeywords: 'doors, perth' }),
			makeSnapshot({ path: '/a', metaKeywords: 'doors, perth' })
		];
		const out = detectStale(pages);
		expect(out).toEqual([
			{ check: 'stale', severity: 'low', page: '/', evidence: 'meta keywords tag: "doors, perth"' }
		]);
	});

	it('reports a do-nothing robots meta', () => {
		const [f] = detectStale([makeSnapshot({ path: '/', metaRobots: 'index, follow' })]);
		expect(f.evidence).toBe('meta robots "index, follow" does nothing');
	});

	it('reports a long keyword-heavy title', () => {
		const text = 'garage doors garage doors garage doors perth perth perth repairs repairs repairs';
		const title = 'Garage Doors Perth | Garage Door Repairs Perth | Cheap Garage Doors and Repairs Perth';
		const [f] = detectStale([makeSnapshot({ path: '/', title, visibleText: text })]);
		expect(f.evidence).toBe(`title of ${title.length} characters: "${title}"`);
	});

	it('reports several H1s sharing a phrase', () => {
		const [f] = detectStale([
			makeSnapshot({ path: '/', h1s: ['Garage doors Perth', 'Best garage doors', 'Garage doors today'] })
		]);
		expect(f.evidence).toBe('3 H1s share "garage doors"');
	});

	it('is quiet on a tidy page', () => {
		expect(
			detectStale([makeSnapshot({ path: '/', title: 'CJ Doors', h1s: ['Welcome'], metaRobots: 'noindex' })])
		).toEqual([]);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run electron/analyzers/oldseo/detect/stale.test.ts`
Expected: FAIL — cannot resolve `./stale`.

- [ ] **Step 3: Implement**

```ts
import type { Finding } from '../../../../src/lib/shared/oldseo';
import { cleanEvidence, ngrams, topPhrases, words, type PageSnapshot } from '../snapshot';

const NOISE_ROBOTS = new Set(['index', 'follow', 'index,follow', 'index, follow', 'all']);
const TITLE_MAX_CHARS = 70;
const TITLE_KEYWORD_HITS = 3;
const TOP_PHRASES = 5;

/** The longest 1–3-gram present in every H1, or null. */
function sharedPhrase(h1s: string[]): string | null {
	if (h1s.length < 2) return null;
	const sets = h1s.map((h) => {
		const t = words(h);
		return new Set([...ngrams(t, 3), ...ngrams(t, 2), ...ngrams(t, 1)]);
	});
	const candidates = [...sets[0]].sort((a, b) => b.length - a.length);
	return candidates.find((c) => sets.every((s) => s.has(c))) ?? null;
}

export function detectStale(pages: PageSnapshot[]): Finding[] {
	const seen = new Set<string>();
	const findings: Finding[] = [];
	const add = (page: string, evidence: string) => {
		const clean = cleanEvidence(evidence);
		if (seen.has(clean)) return;
		seen.add(clean);
		findings.push({ check: 'stale', severity: 'low', page, evidence: clean });
	};

	for (const page of pages) {
		if (page.metaKeywords && page.metaKeywords.trim())
			add(page.path, `meta keywords tag: "${page.metaKeywords.trim().slice(0, 100)}"`);

		const robots = page.metaRobots?.trim().toLowerCase();
		if (robots && NOISE_ROBOTS.has(robots))
			add(page.path, `meta robots "${page.metaRobots!.trim()}" does nothing`);

		if (page.title.length > TITLE_MAX_CHARS) {
			const top = topPhrases(page.visibleText, TOP_PHRASES).map((t) => t.phrase);
			const lower = page.title.toLowerCase();
			if (top.filter((p) => lower.includes(p)).length >= TITLE_KEYWORD_HITS)
				add(page.path, `title of ${page.title.length} characters: "${page.title}"`);
		}

		const shared = sharedPhrase(page.h1s);
		if (shared) add(page.path, `${page.h1s.length} H1s share "${shared}"`);
	}
	return findings;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run electron/analyzers/oldseo/detect/stale.test.ts`
Expected: 5 PASS. (In the title test the top-5 phrases of the body are "garage doors", "perth", "repairs", "garage", "doors"; the title contains at least three of them.)

- [ ] **Step 5: Commit**

```bash
npx prettier --write electron/analyzers/oldseo/detect/stale.ts electron/analyzers/oldseo/detect/stale.test.ts
git add electron/analyzers/oldseo/detect/stale.ts electron/analyzers/oldseo/detect/stale.test.ts
git commit -m "Detect leftover old SEO habits

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Crawl helpers, the in-page snapshot script, and the Googlebot fetch

**Files:**

- Create: `electron/analyzers/oldseo/crawl.ts`
- Test: `electron/analyzers/oldseo/crawl.test.ts`

**Interfaces:**

- Consumes: `PageSnapshot`, `HiddenReason`, `TextNode`, `cleanEvidence` (Task 1); `stripHtml` from `electron/discovery/homepage.ts` (exists: `stripHtml(html) => { title, description, text }`).
- Produces:

  ```ts
  export const SKIP_EXTENSIONS: string[];
  export function sameSite(link: string, base: URL): string | null;        // normalised URL string (no hash, no query) or null
  export function parseRobots(text: string): string[];                     // Disallow prefixes for User-agent: *
  export function isDisallowed(pathname: string, disallow: string[]): boolean;
  export function nextToVisit(queue: string[], visited: Set<string>, disallow: string[], base: URL, max: number): string[]; // helper used by index.ts: dedupe + filter, keeps order, caps
  export const GOOGLEBOT_UA: string;
  export function fetchAsGooglebot(url: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<string | null>; // stripped text or null on any failure
  export function snapshotScript(): (url: string) => Omit<PageSnapshot, 'botText' | 'path'> & { links: string[] }; // the function passed to page.evaluate; returns the page's data plus its anchor hrefs
  export function toPath(url: string): string;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { sameSite, parseRobots, isDisallowed, nextToVisit, fetchAsGooglebot, toPath, GOOGLEBOT_UA } from './crawl';

const base = new URL('https://www.example.com.au/');

describe('sameSite', () => {
	it('keeps same-host http(s) links, strips query and hash, ignores www', () => {
		expect(sameSite('https://example.com.au/services?x=1#top', base)).toBe('https://example.com.au/services');
		expect(sameSite('/about', base)).toBe('https://www.example.com.au/about');
	});
	it('rejects other hosts, other schemes, and binary extensions', () => {
		expect(sameSite('https://other.com/', base)).toBeNull();
		expect(sameSite('mailto:x@example.com.au', base)).toBeNull();
		expect(sameSite('tel:123', base)).toBeNull();
		expect(sameSite('/brochure.pdf', base)).toBeNull();
		expect(sameSite('/img/logo.PNG', base)).toBeNull();
	});
});

describe('robots', () => {
	it('reads Disallow prefixes for the * group only', () => {
		const text = `User-agent: Googlebot\nDisallow: /g\n\nUser-agent: *\nDisallow: /admin\nAllow: /admin/public\nDisallow: /tmp/\n`;
		expect(parseRobots(text)).toEqual(['/admin', '/tmp/']);
		expect(isDisallowed('/admin/x', ['/admin'])).toBe(true);
		expect(isDisallowed('/administer', ['/admin'])).toBe(true);
		expect(isDisallowed('/about', ['/admin'])).toBe(false);
		expect(isDisallowed('/x', [])).toBe(false);
	});
});

describe('nextToVisit', () => {
	it('dedupes, filters disallowed, keeps order and caps', () => {
		const out = nextToVisit(
			['/a', '/b', '/a', '/admin/x', '/c', '/d'],
			new Set(['https://www.example.com.au/b']),
			['/admin'],
			base,
			2
		);
		expect(out).toEqual(['https://www.example.com.au/a', 'https://www.example.com.au/c']);
	});
});

describe('fetchAsGooglebot', () => {
	it('returns stripped text with the Googlebot user agent, null on failure', async () => {
		let ua = '';
		const ok = (async (_u: unknown, init?: RequestInit) => {
			ua = (init?.headers as Record<string, string>)['User-Agent'];
			return new Response('<html><body><p>Hello <b>bot</b></p></body></html>', {
				status: 200,
				headers: { 'content-type': 'text/html' }
			});
		}) as unknown as typeof fetch;
		expect(await fetchAsGooglebot('https://example.com/', new AbortController().signal, ok)).toBe('Hello bot');
		expect(ua).toBe(GOOGLEBOT_UA);

		const bad = (async () => new Response('', { status: 500 })) as unknown as typeof fetch;
		expect(await fetchAsGooglebot('https://example.com/', new AbortController().signal, bad)).toBeNull();
	});
});

describe('toPath', () => {
	it('returns the path only', () => {
		expect(toPath('https://example.com.au/services/doors')).toBe('/services/doors');
		expect(toPath('https://example.com.au')).toBe('/');
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run electron/analyzers/oldseo/crawl.test.ts`
Expected: FAIL — cannot resolve `./crawl`.

- [ ] **Step 3: Implement**

```ts
import { stripHtml } from '../../discovery/homepage';
import type { HiddenReason, PageSnapshot, TextNode } from './snapshot';

/**
 * The parts of the crawl that need no browser: which links count, what
 * robots.txt forbids, the Googlebot fetch, and the function that runs inside
 * each page to take its snapshot.
 */
export const SKIP_EXTENSIONS = [
	'.pdf', '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.zip', '.mp4', '.mp3', '.doc', '.docx', '.xls', '.xlsx'
];

const host = (h: string) => h.toLowerCase().replace(/^www\./, '');

export function sameSite(link: string, base: URL): string | null {
	let url: URL;
	try {
		url = new URL(link, base);
	} catch {
		return null;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
	if (host(url.hostname) !== host(base.hostname)) return null;
	const lower = url.pathname.toLowerCase();
	if (SKIP_EXTENSIONS.some((ext) => lower.endsWith(ext))) return null;
	url.hash = '';
	url.search = '';
	return url.toString();
}

export function parseRobots(text: string): string[] {
	const disallow: string[] = [];
	let inStar = false;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(/#.*$/, '').trim();
		if (!line) continue;
		const [key, ...rest] = line.split(':');
		const value = rest.join(':').trim();
		const k = key.trim().toLowerCase();
		if (k === 'user-agent') inStar = value === '*';
		else if (inStar && k === 'disallow' && value) disallow.push(value);
	}
	return disallow;
}

export function isDisallowed(pathname: string, disallow: string[]): boolean {
	return disallow.some((prefix) => pathname.startsWith(prefix));
}

export function toPath(url: string): string {
	return new URL(url).pathname || '/';
}

export function nextToVisit(
	queue: string[],
	visited: Set<string>,
	disallow: string[],
	base: URL,
	max: number
): string[] {
	const out: string[] = [];
	const seen = new Set(visited);
	for (const link of queue) {
		const url = sameSite(link, base);
		if (!url || seen.has(url)) continue;
		if (isDisallowed(new URL(url).pathname, disallow)) continue;
		seen.add(url);
		out.push(url);
		if (out.length === max) break;
	}
	return out;
}

export const GOOGLEBOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const BOT_TIMEOUT_MS = 15_000;
const BOT_BYTE_CAP = 1_000_000;

export async function fetchAsGooglebot(
	url: string,
	signal: AbortSignal,
	fetchImpl: typeof fetch = fetch
): Promise<string | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), BOT_TIMEOUT_MS);
	const onAbort = () => controller.abort();
	signal.addEventListener('abort', onAbort, { once: true });
	try {
		const response = await fetchImpl(url, {
			signal: controller.signal,
			redirect: 'follow',
			headers: { Accept: 'text/html', 'User-Agent': GOOGLEBOT_UA }
		});
		if (!response.ok) return null;
		if (!/text\/html|application\/xhtml/i.test(response.headers.get('content-type') ?? '')) return null;
		const html = (await response.text()).slice(0, BOT_BYTE_CAP);
		return stripHtml(html).text;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
		signal.removeEventListener('abort', onAbort);
	}
}

export type RawSnapshot = Omit<PageSnapshot, 'botText' | 'path'> & { links: string[] };

/**
 * Runs inside the page via page.evaluate, so it must be self-contained: no
 * imports, no closures over module scope. Returned as a function so the
 * analyzer can pass it straight through.
 */
export function snapshotScript(): (url: string) => RawSnapshot {
	return (url: string) => {
		const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']);
		const UI_PATTERN = /menu|modal|cookie|sr-only|visually-hidden|screen-reader/i;
		const UI_SELECTOR = 'nav,[role=navigation],[aria-hidden],dialog,[hidden]';

		const rgb = (s: string): [number, number, number, number] | null => {
			const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
			return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
		};

		const background = (el: Element): [number, number, number] => {
			let node: Element | null = el;
			while (node) {
				const c = rgb(getComputedStyle(node).backgroundColor);
				if (c && c[3] > 0) return [c[0], c[1], c[2]];
				node = node.parentElement;
			}
			return [255, 255, 255];
		};

		const isUi = (el: Element): boolean =>
			!!el.closest(UI_SELECTOR) ||
			[...(function* () {
				let n: Element | null = el;
				while (n) {
					yield n;
					n = n.parentElement;
				}
			})()].some((n) => UI_PATTERN.test(n.id + ' ' + n.className));

		const hiddenReason = (el: Element, text: string): HiddenReason | null => {
			let node: Element | null = el;
			while (node) {
				const cs = getComputedStyle(node);
				if (cs.display === 'none') return isUi(el) ? null : 'display-none';
				if (cs.opacity === '0') return 'opacity-zero';
				node = node.parentElement;
			}
			const cs = getComputedStyle(el);
			if (cs.visibility === 'hidden') return 'visibility-hidden';
			if (parseFloat(cs.fontSize) < 2) return 'tiny-font';
			const fg = rgb(cs.color);
			if (fg) {
				const bg = background(el);
				const dist = Math.abs(fg[0] - bg[0]) + Math.abs(fg[1] - bg[1]) + Math.abs(fg[2] - bg[2]);
				if (dist < 24) return 'same-colour';
			}
			const box = el.getBoundingClientRect();
			const indent = parseFloat(cs.textIndent);
			if (box.right < -1000 || box.bottom < -1000 || (!Number.isNaN(indent) && indent < -999))
				return isUi(el) ? null : 'off-canvas';
			if ((box.width === 0 || box.height === 0) && text.trim()) return isUi(el) ? null : 'zero-box';
			return null;
		};

		const nodes: TextNode[] = [];
		const visible: string[] = [];
		const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		let current: Node | null;
		while ((current = walker.nextNode())) {
			const text = (current.textContent ?? '').replace(/\s+/g, ' ').trim();
			if (!text) continue;
			const el = current.parentElement;
			if (!el || el.closest([...SKIP].join(','))) continue;
			const hidden = hiddenReason(el, text);
			if (!hidden) visible.push(text);
			if (text.split(' ').length >= 3 || el.closest('a')) {
				const a = el.closest('a');
				nodes.push({ text, hidden, inLink: a ? a.getAttribute('href') : null });
			}
		}

		const meta = (name: string) =>
			document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ?? null;

		return {
			url,
			title: document.title ?? '',
			metaKeywords: meta('keywords'),
			metaRobots: meta('robots'),
			h1s: [...document.querySelectorAll('h1')].map((h) => (h.textContent ?? '').replace(/\s+/g, ' ').trim()),
			visibleText: visible.join(' '),
			altText: [...document.querySelectorAll('img[alt]')].map((i) => i.getAttribute('alt') ?? '').join(' '),
			nodes,
			links: [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '')
		};
	};
}
```

Note the `inLink` rule: only nodes that are hidden *and* in a link produce `hidden-link` findings (Task 2); recording `inLink` for every anchor text node is what makes that possible. The `visible` join is what cloaking and stuffing read.

- [ ] **Step 4: Run the tests and checks**

Run: `npx vitest run electron/analyzers/oldseo/crawl.test.ts && npm run check && npm run electron:compile`
Expected: 6 PASS; the in-page function type-checks because `tsconfig.electron.json` includes DOM lib (if it does not, add `"lib": ["ES2022", "DOM", "DOM.Iterable"]` to its `compilerOptions` — the keywords analyzer already uses `document` inside `page.evaluate`, so this is likely already fine).

- [ ] **Step 5: Commit**

```bash
npx prettier --write electron/analyzers/oldseo/crawl.ts electron/analyzers/oldseo/crawl.test.ts
git add electron/analyzers/oldseo/crawl.ts electron/analyzers/oldseo/crawl.test.ts
git commit -m "Add crawl helpers, robots parsing and the page snapshot script

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The analyzer and its registration

**Files:**

- Create: `electron/analyzers/oldseo/index.ts`
- Test: `electron/analyzers/oldseo/index.test.ts`
- Modify: `electron/handlers.ts` (import and register)
- Modify: `src/routes/+page.svelte` (the `available` list)

**Interfaces:**

- Consumes: everything above; `once`, `rejectOnAbort` from `electron/analyzers/abort.ts`; `Analyzer` from `electron/analyzers/types.ts`; puppeteer.
- Produces: `export const oldSeoAnalyzer: Analyzer<OldSeoSettings>` with `OldSeoSettings = { maxPages: number }`, default `{ maxPages: 10 }`, id `'oldseo'`, label `'Old SEO practices'`, `concurrency: 'limited'`, `timeoutMs: 180_000`. `analyze` resolves `OldSeoData`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Page = {
	goto: (url: string) => Promise<unknown>;
	evaluate: (fn: unknown, ...args: unknown[]) => Promise<unknown>;
	close: () => Promise<void>;
};

const state = vi.hoisted(() => ({
	executablePath: '',
	launches: 0,
	closes: 0,
	pages: {} as Record<string, { links: string[]; fail?: boolean; hang?: boolean }>,
	robots: '' as string | null
}));

vi.mock('puppeteer', () => ({
	default: {
		executablePath: () => state.executablePath,
		launch: async () => {
			state.launches++;
			return {
				newPage: async (): Promise<Page> => {
					let current = '';
					return {
						goto: async (url) => {
							current = url;
							const p = state.pages[url];
							if (!p) throw new Error('net::ERR_NAME_NOT_RESOLVED');
							if (p.fail) throw new Error('net::ERR_CONNECTION_RESET');
							if (p.hang) return new Promise(() => {});
						},
						evaluate: async () => ({
							url: current,
							title: 'T',
							metaKeywords: null,
							metaRobots: null,
							h1s: [],
							visibleText: 'plain page text here for testing purposes only',
							altText: '',
							nodes: [],
							links: state.pages[current]?.links ?? []
						}),
						close: async () => {}
					};
				},
				close: async () => {
					state.closes++;
				}
			};
		}
	}
}));

vi.mock('./crawl', async (importOriginal) => {
	const real = await importOriginal<typeof import('./crawl')>();
	return {
		...real,
		fetchAsGooglebot: async () => null,
		fetchRobots: async () => (state.robots === null ? null : state.robots)
	};
});

const { oldSeoAnalyzer } = await import('./index');
const settings = { maxPages: 10 };

beforeEach(() => {
	state.executablePath = process.execPath;
	state.launches = 0;
	state.closes = 0;
	state.robots = '';
	state.pages = {
		'https://example.com/': { links: ['/a', '/b', '/admin/secret', 'https://other.com/'] },
		'https://example.com/a': { links: ['/c'] },
		'https://example.com/b': { links: [] },
		'https://example.com/c': { links: [] },
		'https://example.com/admin/secret': { links: [] }
	};
});

describe('oldseo preflight', () => {
	it('is unavailable without Chromium', async () => {
		state.executablePath = 'C:definitely\notherechrome.exe';
		const r = await oldSeoAnalyzer.preflight(settings);
		expect(r.available).toBe(false);
	});
});

describe('oldseo analyze', () => {
	it('crawls breadth-first within the cap, honouring robots, and counts pages', async () => {
		state.robots = 'User-agent: *\nDisallow: /admin';
		const data = await oldSeoAnalyzer.analyze('https://example.com/', { maxPages: 2 }, new AbortController().signal);
		expect(data.pagesRead).toBe(3); // home + a + b
		expect(data.pagesSkipped).toBe(0);
		expect(state.closes).toBe(1);
	});

	it('counts a failing internal page as skipped and continues', async () => {
		state.pages['https://example.com/a'].fail = true;
		const data = await oldSeoAnalyzer.analyze('https://example.com/', settings, new AbortController().signal);
		expect(data.pagesSkipped).toBe(1);
		expect(data.pagesRead).toBe(3); // home + b + c
	});

	it('fails when the homepage cannot load', async () => {
		state.pages['https://example.com/'].fail = true;
		await expect(
			oldSeoAnalyzer.analyze('https://example.com/', settings, new AbortController().signal)
		).rejects.toThrow(/ERR_CONNECTION_RESET/);
		expect(state.closes).toBe(1);
	});

	it('closes the browser and rejects when aborted', async () => {
		state.pages['https://example.com/'].hang = true;
		const controller = new AbortController();
		const promise = oldSeoAnalyzer.analyze('https://example.com/', settings, controller.signal);
		await vi.waitFor(() => expect(state.launches).toBe(1));
		controller.abort();
		await expect(promise).rejects.toThrow(/Aborted/);
		expect(state.closes).toBe(1);
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run electron/analyzers/oldseo/index.test.ts`
Expected: FAIL — cannot resolve `./index` (and `fetchRobots` is not yet exported from `./crawl`).

- [ ] **Step 3: Add `fetchRobots` to crawl.ts**

Append to `electron/analyzers/oldseo/crawl.ts`:

```ts
/** robots.txt text, or null when missing or unreadable (treated as allow-all). */
export async function fetchRobots(
	base: URL,
	signal: AbortSignal,
	fetchImpl: typeof fetch = fetch
): Promise<string | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 10_000);
	const onAbort = () => controller.abort();
	signal.addEventListener('abort', onAbort, { once: true });
	try {
		const response = await fetchImpl(new URL('/robots.txt', base).toString(), {
			signal: controller.signal,
			headers: { 'User-Agent': 'WebsiteHealthReport/1.0 (+https://dsbaileyfreelancer.com.au)' }
		});
		if (!response.ok) return null;
		return (await response.text()).slice(0, 100_000);
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
		signal.removeEventListener('abort', onAbort);
	}
}
```

- [ ] **Step 4: Implement index.ts**

```ts
import * as fs from 'fs';
import puppeteer from 'puppeteer';
import type { Analyzer } from '../types';
import { once, rejectOnAbort } from '../abort';
import type { OldSeoData, Finding } from '../../../src/lib/shared/oldseo';
import type { PageSnapshot } from './snapshot';
import { cleanEvidence } from './snapshot';
import {
	fetchAsGooglebot,
	fetchRobots,
	nextToVisit,
	parseRobots,
	snapshotScript,
	toPath,
	type RawSnapshot
} from './crawl';
import { detectHidden } from './detect/hidden';
import { detectStuffing } from './detect/stuffing';
import { detectCloaking } from './detect/cloaking';
import { detectDuplicate } from './detect/duplicate';
import { detectStale } from './detect/stale';

export type OldSeoSettings = { maxPages: number };

const PAGE_TIMEOUT_MS = 20_000;

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

export const oldSeoAnalyzer: Analyzer<OldSeoSettings> = {
	id: 'oldseo',
	label: 'Old SEO practices',
	concurrency: 'limited',
	timeoutMs: 180_000,
	defaultSettings: { maxPages: 10 },

	async preflight() {
		try {
			const executable = puppeteer.executablePath();
			if (!fs.existsSync(executable)) {
				return {
					available: false,
					reason: `Puppeteer's Chromium is not installed at ${executable}. Run "npx puppeteer browsers install chrome".`
				};
			}
			return { available: true };
		} catch (error) {
			return { available: false, reason: (error as Error).message };
		}
	},

	async analyze(domain, settings, signal): Promise<OldSeoData> {
		if (signal.aborted) throw new Error('Cancelled before the browser was launched.');

		const browser = await puppeteer.launch();
		const close = once(() => browser.close());
		const onAbort = () => void close();
		signal.addEventListener('abort', onAbort, { once: true });
		const aborted = rejectOnAbort(signal);

		try {
			return await Promise.race([crawl(browser, domain, settings, signal), aborted.promise]);
		} finally {
			aborted.dispose();
			signal.removeEventListener('abort', onAbort);
			await close();
		}
	}
};

type Browser = Pick<Awaited<ReturnType<typeof puppeteer.launch>>, 'newPage'>;

async function crawl(
	browser: Browser,
	domain: string,
	settings: OldSeoSettings,
	signal: AbortSignal
): Promise<OldSeoData> {
	const base = new URL(domain);
	const robots = await fetchRobots(base, signal);
	const disallow = robots === null ? [] : parseRobots(robots);
	const max = Math.max(0, Math.min(25, Math.floor(settings.maxPages)));

	const snapshots: PageSnapshot[] = [];
	const visited = new Set<string>();
	let skipped = 0;

	// The homepage is not optional: without it there is nothing to report.
	const home = await readPage(browser, base.toString(), signal);
	visited.add(base.toString());
	snapshots.push(home.snapshot);

	let queue = home.links;
	let internal = 0;
	while (internal < max && queue.length > 0) {
		const batch = nextToVisit(queue, visited, disallow, base, max - internal);
		queue = [];
		if (batch.length === 0) break;
		for (const url of batch) {
			visited.add(url);
			internal++;
			try {
				const page = await readPage(browser, url, signal);
				snapshots.push(page.snapshot);
				queue.push(...page.links);
			} catch {
				skipped++;
			}
			if (internal >= max) break;
		}
	}

	const findings: Finding[] = [
		...detectHidden(snapshots),
		...detectStuffing(snapshots),
		...detectCloaking(snapshots),
		...detectDuplicate(snapshots),
		...detectStale(snapshots)
	]
		.map((f) => ({ ...f, evidence: cleanEvidence(f.evidence) }))
		.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.page.localeCompare(b.page));

	return { pagesRead: snapshots.length, pagesSkipped: skipped, findings };
}

async function readPage(
	browser: Browser,
	url: string,
	signal: AbortSignal
): Promise<{ snapshot: PageSnapshot; links: string[] }> {
	const page = await browser.newPage();
	try {
		await page.goto(url, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
		const raw = (await page.evaluate(snapshotScript(), url)) as RawSnapshot;
		const botText = await fetchAsGooglebot(url, signal);
		const { links, ...rest } = raw;
		return { snapshot: { ...rest, path: toPath(url), botText }, links };
	} finally {
		await page.close();
	}
}
```

- [ ] **Step 5: Register the analyzer and list the check**

In `electron/handlers.ts`, add `import { oldSeoAnalyzer } from './analyzers/oldseo';` beside the other analyzer imports and change the registry line to `createRegistry([lighthouseAnalyzer, keywordsAnalyzer, oldSeoAnalyzer])`.

In `src/routes/+page.svelte`, add to the `available` array:

```ts
		{ id: 'oldseo', label: 'Old SEO practices', note: 'Hidden text, stuffing, cloaking, duplicate pages' }
```

and add `'oldseo'` to the default `enabled` list only if the operator wants it on by default — leave the default as is (`['lighthouse', 'keywords']`); the operator ticks it. Also update `DEFAULT_SETTINGS.enabledAnalyzers` in `electron/settings/store.ts`? No: leave defaults unchanged.

- [ ] **Step 6: Run the tests and checks**

Run: `npx vitest run electron/analyzers/oldseo && npm run check && npm run lint && npm run electron:compile`
Expected: all oldseo tests PASS (the index tests: 5), 0 errors.

The abort test relies on the `goto` promise never resolving; `Promise.race` with `aborted.promise` rejects, and `finally` closes the browser once.

- [ ] **Step 7: Commit**

```bash
npx prettier --write electron/analyzers/oldseo/index.ts electron/analyzers/oldseo/index.test.ts electron/analyzers/oldseo/crawl.ts electron/handlers.ts src/routes/+page.svelte
git add electron/analyzers/oldseo/index.ts electron/analyzers/oldseo/index.test.ts electron/analyzers/oldseo/crawl.ts electron/handlers.ts src/routes/+page.svelte
git commit -m "Add the Old SEO practices analyzer and register it

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Severity and the report section

**Files:**

- Modify: `src/lib/report/severity.ts`
- Test: `src/lib/report/severity.test.ts`
- Create: `src/lib/report/OldSeo.svelte`
- Modify: `src/routes/report/[id]/+page.svelte` (component map and `NAMED`)

**Interfaces:**

- Consumes: `OldSeoData`, `Finding`, `OldSeoCheck` from `src/lib/shared/oldseo.ts`; existing `severityOf` shape `{ word; tone; finding }`.
- Produces: `severityOf('oldseo', result)` per the spec; `OldSeo.svelte` with `export let data: OldSeoData`.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/report/severity.test.ts`:

```ts
describe('severityOf — oldseo', () => {
	const ok = (findings: Array<{ check: string; severity: string; page: string; evidence: string }>, pagesRead = 6) =>
		severityOf('oldseo', { status: 'ok', data: { pagesRead, pagesSkipped: 0, findings } });

	it('is Good with a page count when nothing was found', () => {
		expect(ok([])).toEqual({
			word: 'Good',
			tone: 'ok',
			finding: 'No old or manipulative SEO practices found across 6 pages.'
		});
	});

	it('is Poor on any high finding and names the worst', () => {
		const s = ok([
			{ check: 'stale', severity: 'low', page: '/', evidence: 'x' },
			{ check: 'hidden-text', severity: 'high', page: '/about', evidence: 'y' }
		]);
		expect(s).toMatchObject({ word: 'Poor', tone: 'fail' });
		expect(s.finding).toBe('2 findings across 6 pages; the worst is hidden text on /about.');
	});

	it('is Needs work on a medium finding and singular for one', () => {
		const s = ok([{ check: 'duplicate', severity: 'medium', page: '/a', evidence: 'x' }]);
		expect(s).toMatchObject({ word: 'Needs work', tone: 'warn' });
		expect(s.finding).toBe('1 finding across 6 pages; the worst is duplicate pages on /a.');
	});

	it('is Good on low-only findings but still names them', () => {
		const s = ok([{ check: 'stale', severity: 'low', page: '/', evidence: 'x' }]);
		expect(s).toMatchObject({ word: 'Good', tone: 'ok' });
		expect(s.finding).toBe('1 finding across 6 pages; the worst is old habits on /.');
	});
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/report/severity.test.ts`
Expected: FAIL — `oldseo` falls through to "Measured".

- [ ] **Step 3: Extend severity.ts**

Add near the other type guards:

```ts
import type { OldSeoData, OldSeoCheck } from '$lib/shared/oldseo';

const CHECK_NAMES: Record<OldSeoCheck, string> = {
	'hidden-text': 'hidden text',
	'hidden-link': 'hidden links',
	stuffing: 'keyword stuffing',
	cloaking: 'cloaking',
	duplicate: 'duplicate pages',
	stale: 'old habits'
};

function isOldSeo(d: unknown): d is OldSeoData {
	const o = d as OldSeoData | null;
	return (
		!!o &&
		isNumber(o.pagesRead) &&
		isNumber(o.pagesSkipped) &&
		Array.isArray(o.findings) &&
		o.findings.every((f) => typeof f?.check === 'string' && typeof f?.severity === 'string' && typeof f?.page === 'string')
	);
}

const RANK = { high: 0, medium: 1, low: 2 } as const;

function oldSeoSeverity(d: OldSeoData): Severity {
	const pages = `${d.pagesRead} page${d.pagesRead === 1 ? '' : 's'}`;
	if (d.findings.length === 0) {
		return {
			word: 'Good',
			tone: 'ok',
			finding: `No old or manipulative SEO practices found across ${pages}.`
		};
	}
	const worst = [...d.findings].sort((a, b) => RANK[a.severity] - RANK[b.severity])[0];
	const word = worst.severity === 'high' ? 'Poor' : worst.severity === 'medium' ? 'Needs work' : 'Good';
	const tone = worst.severity === 'high' ? 'fail' : worst.severity === 'medium' ? 'warn' : 'ok';
	const count = `${d.findings.length} finding${d.findings.length === 1 ? '' : 's'}`;
	return {
		word,
		tone,
		finding: `${count} across ${pages}; the worst is ${CHECK_NAMES[worst.check] ?? worst.check} on ${worst.page}.`
	};
}
```

and in `severityOf`, before the fallback: `if (id === 'oldseo' && isOldSeo(result.data)) return oldSeoSeverity(result.data);`

- [ ] **Step 4: Create OldSeo.svelte**

```svelte
<script lang="ts">
	import type { OldSeoData, OldSeoCheck } from '$lib/shared/oldseo';

	export let data: OldSeoData;

	const NAMES: Record<OldSeoCheck, string> = {
		'hidden-text': 'Hidden text',
		'hidden-link': 'Hidden links',
		stuffing: 'Keyword stuffing',
		cloaking: 'Cloaking',
		duplicate: 'Duplicate pages',
		stale: 'Old habits'
	};
	const WORD = { high: 'Poor', medium: 'Needs work', low: 'Note' } as const;
	const TONE = { high: 'text-fail', medium: 'text-dark-700', low: 'text-dark-500' } as const;
	const ORDER: OldSeoCheck[] = ['hidden-text', 'hidden-link', 'cloaking', 'stuffing', 'duplicate', 'stale'];

	// Grouped by check, in a fixed order that puts concealment first; the
	// analyzer already sorted findings by severity within the list.
	$: groups = ORDER.map((check) => ({
		check,
		rows: data.findings.filter((f) => f.check === check)
	})).filter((g) => g.rows.length > 0);
</script>

{#if data.findings.length === 0}
	<p class="mt-2 text-[12px] text-dark-500">
		{data.pagesRead} page{data.pagesRead === 1 ? '' : 's'} read, nothing found.
	</p>
{:else}
	<table class="mt-3 w-full border-collapse text-left">
		<tbody>
			{#each groups as group}
				<tr class="break-inside-avoid break-after-avoid border-b border-dark-200">
					<th
						colspan="3"
						class="pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-dark-500"
					>
						{NAMES[group.check]}
					</th>
				</tr>
				{#each group.rows as row}
					<tr class="break-inside-avoid border-b border-dark-200/70">
						<td class="w-24 py-1.5 pr-3 align-top text-[10px] font-semibold uppercase tracking-wide {TONE[row.severity]}">
							{WORD[row.severity]}
						</td>
						<td class="w-44 py-1.5 pr-3 align-top font-mono text-[11px] text-dark-700">{row.page}</td>
						<td class="py-1.5 align-top font-mono text-[11px] leading-snug text-dark-600 [overflow-wrap:anywhere]">
							{row.evidence}
						</td>
					</tr>
				{/each}
			{/each}
		</tbody>
	</table>
{/if}
{#if data.pagesSkipped > 0}
	<p class="mt-2 text-[11px] text-dark-500">
		{data.pagesSkipped} page{data.pagesSkipped === 1 ? '' : 's'} could not be read.
	</p>
{/if}
```

- [ ] **Step 5: Register the component and the display name**

In `src/routes/report/[id]/+page.svelte`: `import OldSeo from '$lib/report/OldSeo.svelte';`, add `oldseo: OldSeo` to `components`, and add `oldseo: 'Old SEO practices'` to `NAMED`.

- [ ] **Step 6: Run the tests and checks**

Run: `npx vitest run src/lib/report && npm run check && npm run lint && npm run build`
Expected: severity tests PASS (4 new), 0 errors, build clean.

- [ ] **Step 7: Commit**

```bash
npx prettier --write src/lib/report/severity.ts src/lib/report/severity.test.ts src/lib/report/OldSeo.svelte "src/routes/report/[id]/+page.svelte"
git add src/lib/report/severity.ts src/lib/report/severity.test.ts src/lib/report/OldSeo.svelte "src/routes/report/[id]/+page.svelte"
git commit -m "Report Old SEO practices with a severity word and evidence table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Fixture site and end-to-end verification

**Files:**

- Create: `electron/analyzers/oldseo/fixtures/index.html`, `services-mandurah.html`, `services-rockingham.html`, `services-baldivis.html`, `robots.txt`
- Create: `electron/analyzers/oldseo/fixture.test.ts` (runs only when Chromium is installed; skips otherwise)

**Interfaces:**

- Consumes: `startStaticServer` from `electron/server.ts` (`startStaticServer(rootDir) => Promise<{ base, close }>`), `oldSeoAnalyzer`.

- [ ] **Step 1: Write the fixture pages**

`fixtures/index.html`:

```html
<!doctype html>
<html><head>
<title>Garage Doors Perth | Garage Door Repairs Perth | Cheap Garage Doors and Repairs Perth</title>
<meta name="keywords" content="garage doors, roller doors, perth">
<meta name="robots" content="index, follow">
</head><body>
<nav><ul><li><a href="/services-mandurah.html">Mandurah</a></li><li><a href="/services-rockingham.html">Rockingham</a></li><li><a href="/services-baldivis.html">Baldivis</a></li><li><a href="/private/secret.html">Secret</a></li></ul></nav>
<h1>Garage doors Perth</h1><h1>Best garage doors</h1>
<p>We repair and install garage doors across Perth. Call us for a quote on roller doors, sectional doors and motors.</p>
<p style="color:#ffffff;background:#ffffff">cheap garage doors perth cheap roller doors perth cheap sectional doors perth garage door repairs perth garage door motors perth garage door springs perth garage door service perth best garage doors perth</p>
<p style="position:absolute;left:-5000px">garage doors perth garage doors perth garage doors perth garage doors perth garage doors perth garage doors perth garage doors perth garage doors perth garage doors perth garage doors perth</p>
<a href="https://link-farm.example/" style="font-size:0px">garage doors</a>
<p>garage doors perth, roller doors perth, sectional doors perth, garage door repairs, door motors perth</p>
<img src="x.png" alt="garage doors perth garage doors perth garage doors perth garage doors perth garage doors perth garage doors perth garage doors perth garage doors perth garage doors perth garage doors perth">
<div id="menu" style="display:none">Home About Services Contact Blog Careers Terms Privacy Sitemap</div>
</body></html>
```

`fixtures/services-mandurah.html`, `services-rockingham.html`, `services-baldivis.html` — identical bodies with the place swapped in the title only:

```html
<!doctype html>
<html><head><title>Garage Door Repairs Mandurah | CJ Doors</title></head><body>
<h1>Garage door repairs</h1>
<p>Our technicians repair roller doors, sectional doors and tilt doors. We replace springs, cables, rollers and motors, and we service every brand. Same-day appointments are available across the region, and every job comes with a written quote before work begins. Call to book a time that suits you, or send a photo of the fault and we will advise over the phone. We have served the Peel region since 2002 and carry common parts on the van so most repairs are completed on the first visit. Ask about our annual service plan.</p>
</body></html>
```

`fixtures/robots.txt`:

```
User-agent: *
Disallow: /private
```

- [ ] **Step 2: Write the fixture test**

```ts
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import puppeteer from 'puppeteer';
import { startStaticServer } from '../../server';
import { oldSeoAnalyzer } from './index';

const chromium = (() => {
	try {
		return fs.existsSync(puppeteer.executablePath());
	} catch {
		return false;
	}
})();

describe.skipIf(!chromium)('oldseo against the fixture site', () => {
	it('finds one of each trick and honours robots', async () => {
		const server = await startStaticServer(path.join(__dirname, 'fixtures'));
		try {
			const data = await oldSeoAnalyzer.analyze(server.base + '/', { maxPages: 10 }, new AbortController().signal);
			expect(data.pagesRead).toBe(4);
			expect(data.pagesSkipped).toBe(0);
			const checks = new Set(data.findings.map((f) => f.check));
			expect(checks.has('hidden-text')).toBe(true);
			expect(checks.has('hidden-link')).toBe(true);
			expect(checks.has('stuffing')).toBe(true);
			expect(checks.has('duplicate')).toBe(true);
			expect(checks.has('stale')).toBe(true);
			expect(data.findings.some((f) => f.evidence.includes('/private'))).toBe(false);
			expect(data.findings.some((f) => f.evidence.includes('Home About Services'))).toBe(false);
		} finally {
			await server.close();
		}
	}, 120_000);
});
```

Cloaking cannot be exercised by a static fixture (both fetches get the same file); it is covered by its unit test.

- [ ] **Step 3: Run it**

Run: `npx vitest run electron/analyzers/oldseo/fixture.test.ts`
Expected: PASS on this machine (Chromium present). If a detector misses its trick, fix the fixture or the threshold at the named constant, not by loosening the assertion.

- [ ] **Step 4: Real site, by hand**

```bash
npm run electron:start
```

Tick "Old SEO practices" and run against `cjsgaragedoors.com.au` with no competitors. Expect the check to complete in under 3 minutes, `pagesRead` around 11, and no high findings on an ordinary site — if a legitimate menu or cookie banner shows as hidden text, add its id/class pattern to `UI_PATTERN` in `crawl.ts`. Export the PDF and confirm the section prints with its evidence table.

- [ ] **Step 5: Full suite and commit**

Run: `npm run check && npm run lint && npx vitest run`
Expected: all green.

```bash
npx prettier --write electron/analyzers/oldseo/fixture.test.ts
git add electron/analyzers/oldseo/fixtures electron/analyzers/oldseo/fixture.test.ts
git commit -m "Verify the Old SEO practices analyzer against a fixture site

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage.** Scope and crawl rules (Task 7 helpers, Task 8 loop, robots, cap, per-page timeout, skipped counting, homepage failure → failed); data shape and evidence hygiene (Task 1 `cleanEvidence`, applied once more in Task 8); hidden text/link rules incl. UI exclusions (Task 2 + the in-page `isUi`); stuffing rules (Task 3); cloaking (Task 4, fetch in Task 7); duplicate pair + doorway with places and meta keywords (Task 5); stale rules deduped per site (Task 6); severity words and finding sentence (Task 9); report section incl. skipped line and print breaks (Task 9); registration and New report listing (Task 8); settings `maxPages` default 10, clamped 0–25 (Task 8; the settings screen itself is Plan 3 Task 7, as the spec says); fixture and real-site verification (Task 10). Search-volume targeting stays out.
- **Placeholders.** None. Task 3 carries an inline correction to its own third test case; the implementer applies it before running.
- **Types.** `Finding`/`OldSeoData` in `src/lib/shared/oldseo.ts` used by Tasks 2–6, 8, 9. `PageSnapshot` fields match between Task 1, the `RawSnapshot` in Task 7, and the assembly in Task 8. Detector names `detectHidden/detectStuffing/detectCloaking/detectDuplicate/detectStale` consistent between definition and Task 8. `fetchRobots` is introduced in Task 8 Step 3 and mocked in the Task 8 test. `startStaticServer` signature matches `electron/server.ts`.
