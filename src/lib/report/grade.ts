import type { AnalyzerId, DomainResult } from '$lib/shared/types';
import { severityOf } from './severity';

/**
 * One letter per site, derived from the check verdicts the report already
 * prints, so the summary and the sections beneath it can never disagree.
 *
 * Each measured check scores 2 for Good, 1 for Needs work, 0 for Poor. A
 * check that was not measured, failed, was not run, or had nothing to judge
 * (tone "na") is left out of the ratio entirely: an absent reading is not a
 * bad reading. Any Poor check caps the grade at D — a site with a serious
 * fault is not a B, however good the rest is.
 */
export type Letter = 'A' | 'B' | 'C' | 'D' | 'E' | '—';

export type Grade = { letter: Letter; measured: number; total: number; ratio: number };

const A_FLOOR = 0.95;
const B_FLOOR = 0.75;
const C_FLOOR = 0.5;
const D_FLOOR = 0.25;

export const GRADE_LEGEND: Array<{ letter: Letter; meaning: string }> = [
	{ letter: 'A', meaning: 'every check good' },
	{ letter: 'B', meaning: 'mostly good' },
	{ letter: 'C', meaning: 'mixed' },
	{ letter: 'D', meaning: 'mostly needing work, or any check poor' },
	{ letter: 'E', meaning: 'poor overall' }
];

export function letterFor(ratio: number, anyPoor: boolean): Letter {
	let letter: Letter;
	if (ratio >= A_FLOOR) letter = 'A';
	else if (ratio >= B_FLOOR) letter = 'B';
	else if (ratio >= C_FLOOR) letter = 'C';
	else if (ratio >= D_FLOOR) letter = 'D';
	else letter = 'E';
	if (anyPoor && (letter === 'A' || letter === 'B' || letter === 'C')) letter = 'D';
	return letter;
}

export function gradeOf(domain: DomainResult, enabled: AnalyzerId[]): Grade {
	let points = 0;
	let measured = 0;
	let anyPoor = false;
	for (const id of enabled) {
		const result = domain.analyzers[id];
		// Only a check that actually measured the site can grade it.
		if (!result || result.status !== 'ok') continue;
		const sev = severityOf(id, result);
		if (sev.tone === 'na') continue;
		measured++;
		if (sev.tone === 'ok') points += 2;
		else if (sev.tone === 'warn') points += 1;
		else anyPoor = true;
	}
	if (measured === 0) return { letter: '—', measured: 0, total: enabled.length, ratio: 0 };
	const ratio = points / (2 * measured);
	return { letter: letterFor(ratio, anyPoor), measured, total: enabled.length, ratio };
}
