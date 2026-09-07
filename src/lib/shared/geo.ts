/**
 * The rubric Claude rates against, the system text that pins it, and the
 * schema that makes the answer machine-readable. The seven factors come from
 * the Princeton GEO study (Aggarwal et al., KDD 2024) — citations, quotations
 * and statistics were the strongest levers on visibility in generated
 * answers — plus the answer-first, entity and structure guidance that
 * practitioners have converged on since.
 */
export const FACTORS = [
	{
		id: 'direct-answers',
		question: "Does a page answer a customer's likely question outright, early, in plain terms?"
	},
	{ id: 'citations', question: 'Does the content name and link the sources behind its claims?' },
	{
		id: 'statistics',
		question: 'Are there hard figures — prices, timings, measurements, counts, dates?'
	},
	{
		id: 'quotations',
		question: 'Are there attributed quotes from named people (owner, customers, experts)?'
	},
	{ id: 'clarity', question: 'Is the writing plain, specific and free of filler and jargon?' },
	{
		id: 'entity',
		question: 'Is it unambiguous who the business is, where it operates and what it does?'
	},
	{
		id: 'structure',
		question: 'Are headings question-shaped and sections short enough to lift out whole?'
	}
] as const;

export type FactorId = (typeof FACTORS)[number]['id'];
export const FACTOR_IDS: readonly FactorId[] = FACTORS.map((f) => f.id);
export const RATINGS = ['good', 'needs-work', 'poor'] as const;
export type Rating = (typeof RATINGS)[number];
