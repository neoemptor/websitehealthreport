import { GoogleApiError, postGoogleJson, type DateRange } from './google-http';

export type Ga4Data = { sessions: number; users: number; engagementRate: number };

export function parseGa4(payload: unknown): Ga4Data {
	const row = (((payload ?? {}) as { rows?: Array<{ metricValues?: Array<{ value: string }> }> })
		.rows ?? [])[0];
	const values = row?.metricValues ?? [];

	const at = (i: number): number => Number(values[i]?.value ?? 0) || 0;
	return { sessions: at(0), users: at(1), engagementRate: at(2) };
}

function normalisePropertyId(propertyId: string): string {
	return propertyId.replace(/^properties\//, '');
}

/** Fetches GA4 session/user/engagement totals for a GA4 property id. */
export async function fetchGa4(
	propertyId: string,
	accessToken: string,
	range: DateRange,
	signal?: AbortSignal
): Promise<Ga4Data> {
	const id = normalisePropertyId(propertyId);
	try {
		const payload = await postGoogleJson(
			`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(id)}:runReport`,
			accessToken,
			{
				dateRanges: [range],
				metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagementRate' }]
			},
			signal
		);
		return parseGa4(payload);
	} catch (err) {
		if (err instanceof GoogleApiError) {
			if (err.httpStatus === 429) {
				throw new Error("UNAVAILABLE: Google's quota for this account is exhausted for now.");
			}
			if (err.httpStatus === 403 || err.httpStatus === 404) {
				throw new Error(
					`UNAVAILABLE: The connected Google account does not have access to the GA4 property ${propertyId}.`
				);
			}
		}
		throw err;
	}
}
