export type SeoQuakeData = {
	semrushRank: number | null;
	backlinks: number | null;
	linkingDomains: number | null;
	pinterest: number | null;
	raw: Record<string, string>;
};

const SUFFIX_MULTIPLIERS: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

function toNumber(cell: string | undefined): number | null {
	if (cell === undefined) return null;
	const trimmed = cell.trim();
	if (trimmed === '') return null;
	if (/^(n\/a|-|—)$/i.test(trimmed)) return null;

	// Decimal with a K/M/B abbreviation suffix, e.g. "1.2K", "3.4M", "2B".
	const abbreviated = trimmed.match(/(\d+(?:\.\d+)?)\s*([kmb])$/i);
	if (abbreviated) {
		const value = parseFloat(abbreviated[1]);
		const multiplier = SUFFIX_MULTIPLIERS[abbreviated[2].toLowerCase()];
		return Math.round(value * multiplier);
	}

	// Any other letter suffix directly after a number is an unknown unit, not a count.
	if (/\d\s*[a-zA-Z]+\s*$/.test(trimmed)) return null;

	// Plain integer, possibly with ",", " " or "." used as a thousands separator.
	let working = trimmed.replace(/[, ]/g, '');
	working = working.replace(/\.(?=\d{3}(?!\d))/g, '');

	const digits = working.replace(/[^\d]/g, '');
	return digits.length > 0 ? Number(digits) : null;
}

/**
 * SEO Quake 4 renders its toolbar as label/value span pairs inside a shadow
 * root rather than as positional cells, so metrics are matched by label
 * (case-insensitively) instead of by index. The raw label -> value map is
 * retained alongside the mapped values since the extension's labels are the
 * most likely thing to change next.
 */
export function parseToolbar(pairs: Array<{ label: string; value: string }>): SeoQuakeData {
	const raw: Record<string, string> = {};
	for (const { label, value } of pairs) {
		raw[label] = value;
	}

	const find = (label: string): string | undefined => {
		const match = pairs.find((pair) => pair.label.trim().toLowerCase() === label);
		return match?.value;
	};

	return {
		semrushRank: toNumber(find('rank')),
		backlinks: toNumber(find('l')),
		linkingDomains: toNumber(find('ld')),
		pinterest: toNumber(find('pin')),
		raw
	};
}
