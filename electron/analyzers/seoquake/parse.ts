export type SeoQuakeData = {
	googleIndex: number | null;
	backlinks: number | null;
	subdomainBacklinks: number | null;
	bingIndex: number | null;
	semrushRank: number | null;
	raw: string[];
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
 * The toolbar is positional: Google index, backlinks, subdomain backlinks,
 * Bing index, WhoIs, source, SEMrush rank. This ordering belongs to a
 * third-party extension and is the most likely thing to change, which is why
 * the raw cells are retained alongside the mapped values.
 */
export function parseToolbar(cells: string[]): SeoQuakeData {
	return {
		googleIndex: toNumber(cells[0]),
		backlinks: toNumber(cells[1]),
		subdomainBacklinks: toNumber(cells[2]),
		bingIndex: toNumber(cells[3]),
		semrushRank: toNumber(cells[6]),
		raw: cells
	};
}
