import type { Finding } from '../../../../src/lib/shared/oldseo';
import {
	STOP_WORDS,
	cleanEvidence,
	ngrams,
	topPhrases,
	words,
	type PageSnapshot
} from '../snapshot';

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
	return (
		candidates.find((c) => {
			const parts = c.split(' ');
			if (STOP_WORDS.has(parts[0]) || STOP_WORDS.has(parts[parts.length - 1])) return false;
			return sets.every((s) => s.has(c));
		}) ?? null
	);
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
			add(page.path, `meta robots "${page.metaRobots?.trim()}" does nothing`);

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
