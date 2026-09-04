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
			evidence: `browser ${browserWords} words, Googlebot ${botWords} words, similarity ${similarity.toFixed(
				2
			)}`
		});
	}
	return findings;
}
