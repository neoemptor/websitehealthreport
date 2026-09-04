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
