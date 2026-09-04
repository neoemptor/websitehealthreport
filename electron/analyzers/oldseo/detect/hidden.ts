import type { Finding } from '../../../../src/lib/shared/oldseo';
import { cleanEvidence, topPhrases, words, type PageSnapshot } from '../snapshot';

/** Hidden text this long is concealment, whatever it says. */
const LONG_HIDDEN_WORDS = 30;
/** Shorter hidden text counts when it leans on the page's own keywords. */
const SHORT_HIDDEN_WORDS = 8;
const KEYWORD_HITS = 3;
const TOP_PHRASES = 5;

/**
 * Whole-word phrase match. A substring test counts "art" inside "cart" and
 * "sale" inside "wholesale", which is what turned ordinary hidden copy into a
 * keyword hit.
 */
export function mentionsPhrase(text: string, phrase: string): boolean {
	const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(text);
}

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
			const hits = top.filter((p) => mentionsPhrase(lower, p)).length;
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
