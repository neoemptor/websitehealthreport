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
	return (text.toLowerCase().match(/[a-z0-9]+(?:[''-][a-z0-9]+)*/g) ?? []).map((w) =>
		w.replace(/'/g, "'")
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
		.sort((a, b) => {
			if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
			const orderA = a.n === 2 ? 0 : a.n === 3 ? 1 : 2;
			const orderB = b.n === 2 ? 0 : b.n === 3 ? 1 : 2;
			if (orderA !== orderB) return orderA - orderB;
			return a.phrase.localeCompare(b.phrase);
		})
		.slice(0, count);
}

export function cleanEvidence(s: string): string {
	return s.replace(/[ -]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
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
