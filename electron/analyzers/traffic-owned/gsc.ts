import { GoogleApiError, postGoogleJson, type DateRange } from './google-http';

export type GscTotals = {
	clicks: number;
	impressions: number;
	ctr: number;
	position: number;
};

export type GscData = {
	totals: GscTotals;
	topQueries: Array<{ query: string; clicks: number; impressions: number }>;
};

type Row = {
	keys?: string[];
	clicks?: number;
	impressions?: number;
	ctr?: number;
	position?: number;
};

function totalsFromRows(rows: Row[]): GscTotals {
	const clicks = rows.reduce((sum, row) => sum + (row.clicks ?? 0), 0);
	const impressions = rows.reduce((sum, row) => sum + (row.impressions ?? 0), 0);

	return {
		clicks,
		impressions,
		ctr: impressions === 0 ? 0 : clicks / impressions,
		// Position is averaged per row by the API; weight by impressions.
		position:
			impressions === 0
				? 0
				: rows.reduce((sum, row) => sum + (row.position ?? 0) * (row.impressions ?? 0), 0) /
				  impressions
	};
}

export function parseSearchAnalyticsTotals(payload: unknown): GscTotals {
	const rows = ((payload ?? {}) as { rows?: Row[] }).rows ?? [];
	return totalsFromRows(rows.filter(Boolean));
}

export function parseSearchAnalytics(payload: unknown): GscData {
	const rows = ((payload ?? {}) as { rows?: Row[] }).rows?.filter(Boolean) ?? [];

	return {
		totals: totalsFromRows(rows),
		topQueries: [...rows]
			.sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0))
			.slice(0, 10)
			.map((row) => ({
				query: row.keys?.[0] ?? '',
				clicks: row.clicks ?? 0,
				impressions: row.impressions ?? 0
			}))
	};
}

const BASE_URL = 'https://searchconsole.googleapis.com/webmasters/v3';

/**
 * Fetches Search Console totals and top queries for `host` (e.g.
 * "example.com", no protocol). Tries the `sc-domain:` domain property first,
 * then the URL-prefix property, since either may be the one the account has
 * verified; whichever answers 200 wins, and both the totals query and the
 * top-queries query then use that same property.
 */
export async function fetchSearchAnalytics(
	host: string,
	accessToken: string,
	range: DateRange,
	signal?: AbortSignal
): Promise<GscData> {
	const siteUrls = [`sc-domain:${host}`, `https://${host}/`];

	for (const siteUrl of siteUrls) {
		const endpoint = `${BASE_URL}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
		try {
			const topQueriesPayload = await postGoogleJson(
				endpoint,
				accessToken,
				{ ...range, dimensions: ['query'], rowLimit: 100 },
				signal
			);
			// This property answered 200, so the dimensionless totals query for
			// site-wide clicks/impressions/ctr/position uses the same property.
			const totalsPayload = await postGoogleJson(endpoint, accessToken, { ...range }, signal);
			return {
				totals: parseSearchAnalyticsTotals(totalsPayload),
				topQueries: parseSearchAnalytics(topQueriesPayload).topQueries
			};
		} catch (err) {
			if (err instanceof GoogleApiError) {
				if (err.httpStatus === 429) {
					throw new Error("UNAVAILABLE: Google's quota for this account is exhausted for now.");
				}
				if (err.httpStatus === 403 || err.httpStatus === 404) {
					continue;
				}
			}
			throw err;
		}
	}

	throw new Error(
		'UNAVAILABLE: The connected Google account does not have access to this site in Search Console.'
	);
}
