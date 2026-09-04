import { postGoogleJson, type DateRange } from './gsc';

export type Ga4Data = { sessions: number; users: number; engagementRate: number };

export function parseGa4(payload: unknown): Ga4Data {
	const row = ((payload as { rows?: Array<{ metricValues?: Array<{ value: string }> }> }).rows ??
		[])[0];
	const values = row?.metricValues ?? [];

	const at = (i: number): number => Number(values[i]?.value ?? 0) || 0;
	return { sessions: at(0), users: at(1), engagementRate: at(2) };
}

type GoogleApiErrorLike = { httpStatus?: number };

/** Fetches GA4 session/user/engagement totals for a GA4 property id. */
export async function fetchGa4(
	propertyId: string,
	accessToken: string,
	range: DateRange,
	signal?: AbortSignal
): Promise<Ga4Data> {
	try {
		const payload = await postGoogleJson(
			`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(
				propertyId
			)}:runReport`,
			accessToken,
			{
				dateRanges: [range],
				metrics: [{ name: 'sessions' }, { name: 'totalUsers' }, { name: 'engagementRate' }]
			},
			signal
		);
		return parseGa4(payload);
	} catch (err) {
		const status = (err as GoogleApiErrorLike).httpStatus;
		if (status === 429) {
			throw new Error("UNAVAILABLE: Google's quota for this account is exhausted for now.");
		}
		if (status === 403 || status === 404) {
			throw new Error(
				`UNAVAILABLE: The connected Google account does not have access to the GA4 property ${propertyId}.`
			);
		}
		throw err;
	}
}
