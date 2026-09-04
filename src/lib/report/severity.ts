import type { AnalyzerId, AnalyzerResult } from '$lib/shared/types';
import type { OldSeoData, OldSeoCheck } from '$lib/shared/oldseo';

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

	// A check with no component yet, or data in an unexpected shape: say it
	// measured, and let the raw values below carry the detail.
	return { word: 'Measured', tone: 'ok', finding: 'See the readings below.' };
}
