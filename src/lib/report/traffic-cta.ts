/**
 * The closing traffic note: what the report says when it reaches the end with
 * no traffic numbers on the client's page.
 *
 * A reader sees one blank where there are really two different silences, and
 * they are not the same thing:
 *
 * - Estimated traffic coming back empty is a finding about the site. Semrush
 *   can see the domain and has nothing to report for it, which means the site
 *   is not ranking for anything its index tracks. That is arguably the most
 *   useful line in the report, so it is stated, not withheld.
 * - Measured traffic coming back empty is not a finding about the site at all.
 *   Those figures live in the owner's own Google account, and nobody has
 *   granted access yet. The gap is an access gap.
 *
 * So the note states what is actually true first and makes the offer second,
 * and it never implies a figure is being held back for payment — when this
 * note renders, the operator does not have the figure either. Product
 * principle 1: a gap explains itself, in words a client understands.
 *
 * Only the client domain is considered. Measured traffic is client-only by
 * design (PRODUCT.md), and a competitor's missing estimate is not something
 * the reader can act on. Only *enabled* analyzers are considered too: a check
 * the run never claimed to make has no gap to explain, and inventing one puts
 * a sales paragraph under a heading that does not appear above it.
 */

import type { AnalyzerResult, Run } from '$lib/shared/types';
import { estimatedView, ownedView } from './traffic-view';

export type TrafficGap =
	| { section: 'estimated'; reason: 'no-footprint' | 'not-retrieved' }
	| { section: 'measured'; reason: 'not-connected' | 'not-retrieved' };

export type TrafficCtaView = {
	heading: string;
	/** Plain statements of what is true, in reading order. Never an offer. */
	findings: string[];
	/** What can be done about it, and by whom. One paragraph per offer. */
	offer: string[];
};

const HEADING = 'About the traffic figures';

/**
 * Said last, whichever gap brought us here. Without it a reader can read a
 * blank section followed by contact details as a paywall, which would be a
 * false impression: the numbers are absent from this report, not from the
 * reader's copy of it.
 */
const NOT_WITHHELD =
	'Where a figure is missing above, it is missing because this report does not have it — not because it was left out.';

const FINDINGS = {
	'estimated:no-footprint':
		'Semrush has no organic estimate for this site. That is a reading in itself: the site is not ranking for the search terms its index tracks, so there is no estimated traffic for it to report.',
	'estimated:not-retrieved':
		'The estimated traffic check did not run on the computer that produced this report, so no estimate appears above.',
	'measured:not-connected':
		"Measured traffic was not read. Those figures sit inside this site's own Google Search Console and Analytics, and only the site's owner can grant access to them.",
	'measured:not-retrieved':
		'The measured traffic check did not complete on the computer that produced this report, so no measured figures appear above.'
} as const;

function findingFor(gap: TrafficGap): string {
	return FINDINGS[`${gap.section}:${gap.reason}` as keyof typeof FINDINGS];
}

/**
 * Semrush returning nothing and Semrush never being asked look identical in
 * the report, so they are separated here. `unavailable` means no API key on
 * this machine and `failed` means it threw — both are our gap, not the site's,
 * and neither licenses the "this site is not ranking" sentence.
 */
function estimatedGap(result: AnalyzerResult | undefined): TrafficGap | null {
	if (!result || result.status !== 'ok') return { section: 'estimated', reason: 'not-retrieved' };
	return estimatedView(result.data).nothing
		? { section: 'estimated', reason: 'no-footprint' }
		: null;
}

/**
 * `unavailable` on traffic-owned is the no-Google-account case, which is the
 * access gap the offer addresses. `failed` is ours. A payload where either
 * source answered is not a gap: a half-connected account still put numbers on
 * the page, and the note would be talking past them.
 */
function measuredGap(result: AnalyzerResult | undefined): TrafficGap | null {
	if (!result) return { section: 'measured', reason: 'not-retrieved' };
	if (result.status === 'unavailable') return { section: 'measured', reason: 'not-connected' };
	if (result.status === 'failed') return { section: 'measured', reason: 'not-retrieved' };

	const view = ownedView(result.data);
	const bothSilent = view.searchConsole.kind !== 'ok' && view.ga4.kind !== 'ok';
	return bothSilent ? { section: 'measured', reason: 'not-connected' } : null;
}

/**
 * One paragraph per offer, not one block. Two gaps produce two unrelated
 * propositions — grant access, and rank the site — and welded into a single
 * paragraph they read as a six-line wall on the page that is meant to be the
 * easiest thing in the document to act on.
 */
function buildOffer(gaps: TrafficGap[]): string[] {
	const estimated = gaps.find((g) => g.section === 'estimated');
	const measured = gaps.find((g) => g.section === 'measured');
	const parts: string[] = [];

	if (measured?.reason === 'not-connected') {
		parts.push(
			"Search Console and Analytics take about ten minutes to connect. The access is read-only, it costs nothing, the account stays the owner's, and a re-run of this report then carries the site's real search numbers."
		);
	}

	if (estimated?.reason === 'no-footprint') {
		parts.push(
			'An estimate only appears once a site ranks for terms Semrush tracks. Getting a site there is the work itself, and that is work I do.'
		);
	}

	if (estimated?.reason === 'not-retrieved' || measured?.reason === 'not-retrieved') {
		parts.push(
			'The checks that did not run here can be run again and their results added to a fresh report.'
		);
	}

	parts.push(
		'Either way, it is worth a short conversation before anything is decided from the numbers in this report.'
	);

	return parts;
}

/**
 * Builds the closing note, or null when the client's traffic sections already
 * carry figures and there is nothing to explain.
 */
export function trafficCtaView(run: Run): TrafficCtaView | null {
	const client = run.domains.find((d) => d.role === 'client');
	if (!client) return null;

	const enabled = new Set(run.enabledAnalyzers);
	const gaps: TrafficGap[] = [];

	// Estimated first: it is the one that says something about the site, and a
	// finding leads better than an access note.
	if (enabled.has('traffic-estimated')) {
		const gap = estimatedGap(client.analyzers['traffic-estimated']);
		if (gap) gaps.push(gap);
	}
	if (enabled.has('traffic-owned')) {
		const gap = measuredGap(client.analyzers['traffic-owned']);
		if (gap) gaps.push(gap);
	}

	if (gaps.length === 0) return null;

	return {
		heading: HEADING,
		findings: [...gaps.map(findingFor), NOT_WITHHELD],
		offer: buildOffer(gaps)
	};
}
