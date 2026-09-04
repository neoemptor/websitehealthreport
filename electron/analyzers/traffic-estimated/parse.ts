export type EstimatedTrafficData = {
	organicKeywords: number | null;
	organicTraffic: number | null;
	organicCost: number | null;
	adwordsKeywords: number | null;
};

export function parseSemrushCsv(body: string): Record<string, string>[] {
	const lines = body
		.trim()
		.split(/\r?\n/)
		.filter((line) => line.length > 0);
	if (lines.length < 2) return [];

	const headers = lines[0].split(';');
	return lines.slice(1).map((line) => {
		const cells = line.split(';');
		return Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? '']));
	});
}

function num(value: string | undefined): number | null {
	if (value === undefined || value.trim() === '') return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}

export function toEstimatedTraffic(rows: Record<string, string>[]): EstimatedTrafficData {
	const row = rows[0] ?? {};
	return {
		organicKeywords: num(row['Organic Keywords']),
		organicTraffic: num(row['Organic Traffic']),
		organicCost: num(row['Organic Cost']),
		adwordsKeywords: num(row['Adwords Keywords'])
	};
}

/**
 * Semrush error codes 120/121/130/131/132/133/134/135 all indicate a key, unit-balance,
 * or access problem (a billing/auth state, not a crash) so the analyzer should report
 * "unavailable" rather than "failed" for these. Everything else is a genuine failure.
 */
export function classifyError(code: number): 'unavailable' | 'failed' {
	return [120, 121, 130, 131, 132, 133, 134, 135].includes(code) ? 'unavailable' : 'failed';
}

/** Quota exhaustion is a billing state, not a crash, so it maps to unavailable. */
export function isQuotaError(body: string): boolean {
	const match = body.match(/ERROR\s+(\d+)/i);
	if (!match) return false;
	return classifyError(Number(match[1])) === 'unavailable';
}
