import type { AnalyzerId, AnalyzerResult } from '$lib/shared/types';
import type { OldSeoData, OldSeoCheck } from '$lib/shared/oldseo';

type WaybackData = {
	firstSeen: string | null;
	lastSeen: string | null;
	snapshotsByYear: Array<{ year: string; count: number }>;
};

type SecurityHeaderFinding = {
	header: string;
	present: boolean;
	value: string | null;
	severity: 'high' | 'medium' | 'low';
	note: string;
};

type SecurityCookieFinding = {
	name: string;
	secure: boolean;
	httpOnly: boolean;
	sameSite: string | null;
};

type SecurityTls =
	| {
			protocol: string | null;
			validTo: string | null;
			daysRemaining: number | null;
			issuer: string | null;
			authorized: boolean;
			authorizationError: string | null;
	  }
	| { error: string };

type SecurityData = {
	headers: SecurityHeaderFinding[];
	cookies: SecurityCookieFinding[];
	tls: SecurityTls;
	servedOverHttps: boolean;
};

type AeoData = {
	llmsTxt: boolean;
	sitemap: boolean;
	crawlers: Array<{ agent: string; allowed: boolean }>;
	structuredData: { blocks: number; valid: number; types: string[] };
	headings: { h1Count: number; hierarchyOk: boolean };
	jsDependencyRatio: number;
};

/** "1 day" / "2 days" — never a bare count in front of a noun. */
function plural(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Header name in Title-Case, for display in a finding sentence. */
function headerTitle(header: string): string {
	return header
		.split('-')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join('-');
}

const SECURITY_MIN_CERT_DAYS = 30;
const AEO_POOR_JS_RATIO = 0.5;
const AEO_NEEDS_WORK_JS_RATIO = 0.8;
const CONTENT_POOR_THRESHOLD = 10;

/**
 * The Building Inspection's defining device: every check opens with a
 * severity word and a plain-English finding, before any number. A reader who
 * only skims the words knows the shape of the result.
 *
 * Derived from the result, never stored — it must always agree with the data
 * beneath it.
 */
export type Severity = {
	word: string;
	tone: 'ok' | 'warn' | 'fail' | 'na';
	finding: string;
};

type LighthouseData = {
	scores: { performance: number; accessibility: number; bestPractices: number; seo: number };
	metrics: { lcpMs: number; cls: number; tbtMs: number };
};

type KeywordsData = { keywords: Array<{ keyword: string; count: number }> };

type SeoQuakeData = {
	semrushRank: number | null;
	backlinks: number | null;
	linkingDomains: number | null;
	pinterest: number | null;
	raw: Record<string, string>;
};

type Misspelling = { word: string; count: number; suggestions: string[] };

type GrammarState =
	| { status: 'ok'; findings: Array<{ message: string; context: string }> }
	| { status: 'unavailable'; reason: string }
	| { status: 'failed'; error: string };

type ContentData = {
	spelling: { misspellings: Misspelling[] };
	grammar: GrammarState;
};

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isLighthouse(d: unknown): d is LighthouseData {
	const s = (d as LighthouseData | null)?.scores;
	const m = (d as LighthouseData | null)?.metrics;
	return (
		!!s &&
		!!m &&
		[s.performance, s.accessibility, s.bestPractices, s.seo, m.lcpMs, m.cls, m.tbtMs].every(
			isNumber
		)
	);
}

function isKeywords(d: unknown): d is KeywordsData {
	const k = (d as KeywordsData | null)?.keywords;
	return Array.isArray(k) && k.every((r) => typeof r?.keyword === 'string' && isNumber(r?.count));
}

/** Google's own banding, stated as words. */
function band(score: number): 'Good' | 'Needs work' | 'Poor' {
	if (score >= 90) return 'Good';
	if (score >= 50) return 'Needs work';
	return 'Poor';
}

function lighthouseSeverity(d: LighthouseData): Severity {
	const cats: Array<[string, number]> = [
		['performance', d.scores.performance],
		['accessibility', d.scores.accessibility],
		['best practices', d.scores.bestPractices],
		['SEO', d.scores.seo]
	];
	const [worstName, worstScore] = cats.reduce((a, b) => (b[1] < a[1] ? b : a));
	const word = band(worstScore);

	// Name the single most over-target vital, since that is what to act on.
	const over: string[] = [];
	if (d.metrics.lcpMs > 2500)
		over.push(
			`the main content takes ${(d.metrics.lcpMs / 1000).toFixed(1)}s to appear (target under 2.5s)`
		);
	if (d.metrics.cls > 0.1)
		over.push(`the page shifts while loading (${d.metrics.cls.toFixed(2)}, target under 0.1)`);
	if (d.metrics.tbtMs > 200)
		over.push(`the page ignores taps for ${Math.round(d.metrics.tbtMs)}ms (target under 200ms)`);

	if (word === 'Good') {
		return {
			word,
			tone: 'ok',
			finding: over.length
				? `All four scores are in the good range, though ${over[0]}.`
				: 'All four scores are in the good range and every vital is within target.'
		};
	}

	return {
		word,
		tone: word === 'Poor' ? 'fail' : 'warn',
		finding: `${
			worstName.charAt(0).toUpperCase() + worstName.slice(1)
		} scores ${worstScore} of 100${over.length ? ` — ${over[0]}` : ''}.`
	};
}

function keywordsSeverity(d: KeywordsData): Severity {
	const total = d.keywords.length;
	if (total === 0) {
		return {
			word: 'Nothing declared',
			tone: 'na',
			finding:
				'The page declares no meta keywords, so there is nothing to compare against its text.'
		};
	}
	const unused = d.keywords.filter((k) => k.count === 0).length;
	if (unused === 0) {
		return {
			word: 'Good',
			tone: 'ok',
			finding: `All ${total} declared keywords appear in the page text.`
		};
	}
	return {
		word: 'Needs work',
		tone: 'warn',
		finding: `${unused} of ${total} declared keywords never appear in the page text, so they do no work.`
	};
}

const CHECK_NAMES: Record<OldSeoCheck, string> = {
	'hidden-text': 'hidden text',
	'hidden-link': 'hidden links',
	stuffing: 'keyword stuffing',
	cloaking: 'cloaking',
	duplicate: 'duplicate pages',
	stale: 'old habits'
};

const OLD_SEO_CHECKS: OldSeoCheck[] = [
	'hidden-text',
	'hidden-link',
	'stuffing',
	'cloaking',
	'duplicate',
	'stale'
];
const OLD_SEO_SEVERITIES = ['high', 'medium', 'low'] as const;

function isOldSeo(d: unknown): d is OldSeoData {
	const o = d as OldSeoData | null;
	return (
		!!o &&
		isNumber(o.pagesRead) &&
		isNumber(o.pagesSkipped) &&
		Array.isArray(o.findings) &&
		o.findings.every(
			(f) =>
				typeof f?.page === 'string' &&
				(OLD_SEO_SEVERITIES as readonly string[]).includes(f?.severity) &&
				(OLD_SEO_CHECKS as readonly string[]).includes(f?.check)
		)
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
	const word =
		worst.severity === 'high' ? 'Poor' : worst.severity === 'medium' ? 'Needs work' : 'Good';
	const tone = worst.severity === 'high' ? 'fail' : worst.severity === 'medium' ? 'warn' : 'ok';
	const count = `${d.findings.length} finding${d.findings.length === 1 ? '' : 's'}`;
	return {
		word,
		tone,
		finding: `${count} across ${pages}; the worst is ${
			CHECK_NAMES[worst.check] ?? worst.check
		} on ${worst.page}.`
	};
}

function isWayback(d: unknown): d is WaybackData {
	const w = d as WaybackData | null;
	return (
		!!w &&
		(w.firstSeen === null || typeof w.firstSeen === 'string') &&
		(w.lastSeen === null || typeof w.lastSeen === 'string') &&
		Array.isArray(w.snapshotsByYear) &&
		w.snapshotsByYear.every(
			(row) => typeof row?.year === 'string' && /^\d{4}$/.test(row.year) && isNumber(row?.count)
		)
	);
}

function waybackSeverity(d: WaybackData): Severity {
	if (!d.firstSeen || d.snapshotsByYear.length === 0) {
		return {
			word: 'Nothing archived',
			tone: 'na',
			finding: 'The Internet Archive has no record of this site.'
		};
	}

	const firstYear = d.firstSeen.slice(0, 4);
	// The latest year is read from snapshotsByYear rather than lastSeen — the
	// analyzer derives both from the same underlying CDX rows, so they always
	// agree, but snapshotsByYear is what this function's counts come from.
	const sorted = [...d.snapshotsByYear].sort((a, b) => a.year.localeCompare(b.year));
	const latest = sorted[sorted.length - 1];
	const currentYear = new Date().getFullYear();
	const latestYear = Number(latest.year);

	if (latestYear >= currentYear - 1) {
		return {
			word: 'Good',
			tone: 'ok',
			finding: `Archived since ${firstYear}, captured on ${plural(latest.count, 'day')} in ${
				latest.year
			}.`
		};
	}

	return {
		word: 'Needs work',
		tone: 'warn',
		finding: `Last archived in ${latest.year}; the archive has nothing more recent.`
	};
}

function isSecurity(d: unknown): d is SecurityData {
	const s = d as SecurityData | null;
	return (
		!!s &&
		Array.isArray(s.headers) &&
		s.headers.every(
			(h) =>
				typeof h?.header === 'string' &&
				typeof h?.present === 'boolean' &&
				typeof h?.severity === 'string'
		) &&
		Array.isArray(s.cookies) &&
		s.cookies.every((c) => typeof c?.name === 'string') &&
		typeof s.tls === 'object' &&
		s.tls !== null &&
		typeof s.servedOverHttps === 'boolean'
	);
}

function securitySeverity(d: SecurityData): Severity {
	const tlsError = 'error' in d.tls ? d.tls.error : null;
	const tls = 'error' in d.tls ? null : d.tls;

	if (!d.servedOverHttps) {
		return { word: 'Poor', tone: 'fail', finding: 'The site is not served over HTTPS.' };
	}
	if (tls && tls.authorized === false) {
		return {
			word: 'Poor',
			tone: 'fail',
			finding: `The certificate is invalid: ${tls.authorizationError ?? 'not trusted'}.`
		};
	}
	if (tls && tls.daysRemaining !== null && tls.daysRemaining <= 0) {
		const finding =
			tls.daysRemaining === 0
				? 'The certificate expired today.'
				: `The certificate expired ${plural(-tls.daysRemaining, 'day')} ago.`;
		return { word: 'Poor', tone: 'fail', finding };
	}

	const missingHigh = d.headers.filter((h) => !h.present && h.severity === 'high');
	if (missingHigh.length > 0) {
		return {
			word: 'Poor',
			tone: 'fail',
			finding: `${missingHigh.length} important security header${
				missingHigh.length === 1 ? ' is' : 's are'
			} missing, starting with ${headerTitle(missingHigh[0].header)}.`
		};
	}

	const missingMedium = d.headers.filter((h) => !h.present && h.severity === 'medium');
	if (missingMedium.length > 0) {
		return {
			word: 'Needs work',
			tone: 'warn',
			finding: `${missingMedium.length} security header${
				missingMedium.length === 1 ? ' is' : 's are'
			} missing, starting with ${headerTitle(missingMedium[0].header)}.`
		};
	}

	const weakCookie = d.cookies.find((c) => !c.secure || !c.httpOnly);
	if (weakCookie) {
		return {
			word: 'Needs work',
			tone: 'warn',
			finding: `The cookie "${weakCookie.name}" is missing ${
				!weakCookie.secure && !weakCookie.httpOnly
					? 'the Secure and HttpOnly flags'
					: !weakCookie.secure
					? 'the Secure flag'
					: 'the HttpOnly flag'
			}.`
		};
	}

	if (tls && tls.daysRemaining !== null && tls.daysRemaining < SECURITY_MIN_CERT_DAYS) {
		return {
			word: 'Needs work',
			tone: 'warn',
			finding: `The certificate expires in ${plural(tls.daysRemaining, 'day')}.`
		};
	}

	if (tlsError) {
		return {
			word: 'Good',
			tone: 'ok',
			finding: `The certificate could not be inspected — ${tlsError}. Everything else checked out.`
		};
	}

	return {
		word: 'Good',
		tone: 'ok',
		finding: 'All security headers are present and the certificate is valid.'
	};
}

function isAeo(d: unknown): d is AeoData {
	const a = d as AeoData | null;
	return (
		!!a &&
		typeof a.llmsTxt === 'boolean' &&
		typeof a.sitemap === 'boolean' &&
		Array.isArray(a.crawlers) &&
		isNumber(a.structuredData?.valid) &&
		isNumber(a.structuredData?.blocks) &&
		isNumber(a.headings?.h1Count) &&
		typeof a.headings?.hierarchyOk === 'boolean' &&
		isNumber(a.jsDependencyRatio)
	);
}

/** A ratio under 1 must never round up to display as 100%. */
function jsRatioPercent(ratio: number): number {
	if (ratio >= 1) return 100;
	return Math.min(99, Math.round(ratio * 100));
}

function aeoSeverity(d: AeoData): Severity {
	const percent = jsRatioPercent(d.jsDependencyRatio);
	const lead = `${percent}% of the page text is available without JavaScript`;

	const issues: string[] = [];
	if (!d.sitemap) issues.push('no sitemap was found');
	if (d.structuredData.valid === 0) issues.push('no valid structured data was found');
	if (d.headings.h1Count !== 1)
		issues.push(
			d.headings.h1Count === 0
				? 'the page has no H1 heading'
				: 'the page has more than one H1 heading'
		);
	if (!d.headings.hierarchyOk) issues.push('the heading hierarchy skips levels');
	const blockedCrawler = d.crawlers.find((c) => !c.allowed);
	if (blockedCrawler) issues.push(`${blockedCrawler.agent} is blocked by robots.txt`);

	const finding = issues.length > 0 ? `${lead}; ${issues[0]}.` : `${lead}.`;

	if (d.jsDependencyRatio < AEO_POOR_JS_RATIO) {
		return { word: 'Poor', tone: 'fail', finding };
	}
	if (d.jsDependencyRatio < AEO_NEEDS_WORK_JS_RATIO || issues.length > 0) {
		return { word: 'Needs work', tone: 'warn', finding };
	}

	return { word: 'Good', tone: 'ok', finding };
}

function isSeoQuake(d: unknown): d is SeoQuakeData {
	const s = d as SeoQuakeData | null;
	return (
		!!s &&
		(s.semrushRank === null || isNumber(s.semrushRank)) &&
		(s.backlinks === null || isNumber(s.backlinks)) &&
		(s.linkingDomains === null || isNumber(s.linkingDomains)) &&
		(s.pinterest === null || isNumber(s.pinterest)) &&
		typeof s.raw === 'object' &&
		s.raw !== null
	);
}

function seoQuakeSeverity(d: SeoQuakeData): Severity {
	if (
		d.semrushRank === null &&
		d.backlinks === null &&
		d.linkingDomains === null &&
		d.pinterest === null
	) {
		return {
			word: 'No data',
			tone: 'na',
			finding: 'SEO Quake showed no figures for this site.'
		};
	}

	const rankPart =
		d.semrushRank === null ? null : `Semrush rank ${d.semrushRank.toLocaleString('en-AU')}`;
	const backlinksPart =
		d.backlinks === null || d.linkingDomains === null
			? 'backlinks not reported'
			: `${d.backlinks.toLocaleString('en-AU')} backlinks from ${d.linkingDomains.toLocaleString(
					'en-AU'
			  )} domains`;

	const finding = [rankPart, backlinksPart].filter((p): p is string => p !== null).join('; ');

	return {
		word: 'Measured',
		tone: 'ok',
		finding: `${finding}.`
	};
}

function isContent(d: unknown): d is ContentData {
	const c = d as ContentData | null;
	const misspellings = c?.spelling?.misspellings;
	const grammar = c?.grammar;
	return (
		!!c &&
		Array.isArray(misspellings) &&
		misspellings.every(
			(m) => typeof m?.word === 'string' && isNumber(m?.count) && Array.isArray(m?.suggestions)
		) &&
		!!grammar &&
		((grammar.status === 'ok' && Array.isArray(grammar.findings)) ||
			grammar.status === 'unavailable' ||
			grammar.status === 'failed')
	);
}

function contentSeverity(d: ContentData): Severity {
	const misspellingCount = d.spelling.misspellings.length;
	const grammarFindings =
		d.grammar.status === 'ok' && Array.isArray(d.grammar.findings) ? d.grammar.findings.length : 0;
	const grammarUnavailable = d.grammar.status === 'unavailable';

	const parts: string[] = [];
	if (misspellingCount > 0) parts.push(plural(misspellingCount, 'misspelling'));
	if (grammarFindings > 0) parts.push(plural(grammarFindings, 'grammar issue'));

	let finding =
		parts.length > 0 ? `${parts.join(' and ')} found.` : 'No misspellings or grammar issues found.';
	if (grammarUnavailable) finding += ' Grammar was not checked.';

	if (misspellingCount >= CONTENT_POOR_THRESHOLD || grammarFindings >= CONTENT_POOR_THRESHOLD) {
		return { word: 'Poor', tone: 'fail', finding };
	}
	if (misspellingCount > 0 || grammarFindings > 0) {
		return { word: 'Needs work', tone: 'warn', finding };
	}
	return { word: 'Good', tone: 'ok', finding };
}

export function severityOf(id: AnalyzerId, result: AnalyzerResult | undefined): Severity {
	if (!result) return { word: 'Not run', tone: 'na', finding: 'This check was not run.' };

	// A reason or error is written for the operator — a module path, a Chrome
	// install hint, a network code — and the run screen shows it to them. The
	// client's document says only what a client can act on: whether the site
	// was measured, and that the gap is ours, not theirs.
	if (result.status === 'unavailable')
		return {
			word: 'Not measured',
			tone: 'na',
			finding:
				'This check could not run on the computer that produced the report, so the site was not measured for it.'
		};
	if (result.status === 'failed')
		return {
			word: 'Check failed',
			tone: 'fail',
			finding:
				'The check started but could not complete for this site. It is worth running again before drawing a conclusion.'
		};

	if (id === 'lighthouse' && isLighthouse(result.data)) return lighthouseSeverity(result.data);
	if (id === 'keywords' && isKeywords(result.data)) return keywordsSeverity(result.data);
	if (id === 'oldseo' && isOldSeo(result.data)) return oldSeoSeverity(result.data);
	if (id === 'wayback' && isWayback(result.data)) return waybackSeverity(result.data);
	if (id === 'security' && isSecurity(result.data)) return securitySeverity(result.data);
	if (id === 'aeo' && isAeo(result.data)) return aeoSeverity(result.data);
	if (id === 'seoquake' && isSeoQuake(result.data)) return seoQuakeSeverity(result.data);
	if (id === 'content' && isContent(result.data)) return contentSeverity(result.data);

	// A check with no component yet, or data in an unexpected shape: say it
	// measured, and let the raw values below carry the detail.
	return { word: 'Measured', tone: 'na', finding: 'See the readings below.' };
}
