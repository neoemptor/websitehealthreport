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

/**
 * Every 1–3-gram with its occurrence count and density, stop words excluded.
 * N-grams overlap by design: "garage doors garage doors" also counts "doors
 * garage". Callers only report the single worst phrase per rule, so this
 * overlap does not inflate the reported figure.
 */
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
		const chunks = trimmed
			.split(',')
			.map((c) => c.trim())
			.filter(Boolean);
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
					`"${phrase.phrase}" ×${phrase.occurrences}, ${phrase.density.toFixed(
						1
					)}% of ${total} words`
				)
			});
		}

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

		const list = commaList(page.visibleText);
		if (list) {
			findings.push({
				check: 'stuffing',
				severity: 'medium',
				page: page.path,
				evidence: cleanEvidence(
					`comma list of ${list.chunks} phrases: "${list.line.slice(0, 100)}"`
				)
			});
		}

		const alt = worst(
			phraseHits(page.altText),
			(h) => h.n >= 2 && h.occurrences >= ALT_MIN_OCCURRENCES
		);
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
