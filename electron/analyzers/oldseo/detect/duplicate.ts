import type { Finding } from '../../../../src/lib/shared/oldseo';
import { jaccard, shingles, words, type PageSnapshot } from '../snapshot';
import { AMBIGUOUS_PLACES, PLACES } from './places';

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

/** A token the title itself capitalises, which is how a name is written. */
function capitalised(token: string): boolean {
	const first = token.replace(/^[^A-Za-z]+/, '').charAt(0);
	return first !== '' && first === first.toUpperCase();
}

/**
 * Two titles that differ in exactly one token position, where both differing
 * tokens are places or site keywords, share a doorway pattern. Multi-word
 * places ("canning vale") are handled by also trying two-token windows.
 *
 * A name that is also an ordinary English word (Sale, Success, Orange) only
 * counts when the title capitalises every token of it — otherwise "Great
 * Roller Door sale" reads as a doorway page for the town of Sale.
 */
export function pattern(title: string, allowed: Set<string>): string | null {
	const t = tokens(title);
	for (let width = 2; width >= 1; width--) {
		for (let i = 0; i + width <= t.length; i++) {
			const group = t.slice(i, i + width);
			const window = group
				.join(' ')
				.toLowerCase()
				.replace(/[|,.:;!?-]+$/g, '');
			if (!allowed.has(window)) {
				if (!AMBIGUOUS_PLACES.has(window)) continue;
				if (!group.every(capitalised)) continue;
			}
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
	const shinglesFor = (path: string): Set<string> => sets.get(path) ?? new Set<string>();
	const used = new Set<string>();
	for (let i = 0; i < eligible.length; i++) {
		const a = eligible[i];
		if (used.has(a.path)) continue;
		let best: PageSnapshot | null = null;
		let bestSimilarity = PAIR_MIN_SIMILARITY;
		for (let j = 0; j < eligible.length; j++) {
			const b = eligible[j];
			if (j === i || used.has(b.path)) continue;
			const s = jaccard(shinglesFor(a.path), shinglesFor(b.path));
			if (s > bestSimilarity) {
				best = b;
				bestSimilarity = s;
			}
		}
		if (!best) continue;
		used.add(a.path);
		used.add(best.path);
		findings.push({
			check: 'duplicate',
			severity: 'medium',
			page: a.path,
			evidence: `${a.path} \u2248 ${best.path} (${bestSimilarity.toFixed(2)})`
		});
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
