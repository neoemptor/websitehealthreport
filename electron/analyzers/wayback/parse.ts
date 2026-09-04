export type WaybackData = {
	firstSeen: string | null;
	lastSeen: string | null;
	snapshotsByYear: Array<{ year: string; count: number }>;
};

/** CDX timestamps are YYYYMMDDhhmmss. */
function toIsoDate(timestamp: string): string {
	return `${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}`;
}

export function parseCdx(input: unknown): WaybackData {
	if (!Array.isArray(input)) {
		throw new Error('Wayback CDX response was not an array.');
	}

	// First row is the column header when any rows are present.
	const dataRows = (input as string[][]).slice(1).filter((row) => Array.isArray(row) && row[1]);
	if (dataRows.length === 0) {
		return { firstSeen: null, lastSeen: null, snapshotsByYear: [] };
	}

	const timestamps = dataRows.map((row) => row[1]).sort();
	const counts = new Map<string, number>();
	for (const timestamp of timestamps) {
		const year = timestamp.slice(0, 4);
		counts.set(year, (counts.get(year) ?? 0) + 1);
	}

	return {
		firstSeen: toIsoDate(timestamps[0]),
		lastSeen: toIsoDate(timestamps[timestamps.length - 1]),
		snapshotsByYear: [...counts.entries()]
			.map(([year, count]) => ({ year, count }))
			.sort((a, b) => a.year.localeCompare(b.year))
	};
}
