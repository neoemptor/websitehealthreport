export type SeoQuakeData = {
	googleIndex: number | null;
	backlinks: number | null;
	subdomainBacklinks: number | null;
	bingIndex: number | null;
	semrushRank: number | null;
	raw: string[];
};

function toNumber(cell: string | undefined): number | null {
	if (cell === undefined) return null;
	const digits = cell.replace(/[^\d]/g, '');
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
