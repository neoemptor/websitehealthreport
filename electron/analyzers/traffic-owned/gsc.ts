export type GscData = {
	clicks: number;
	impressions: number;
	ctr: number;
	position: number;
	topQueries: Array<{ query: string; clicks: number }>;
};

type Row = {
	keys?: string[];
	clicks?: number;
	impressions?: number;
	ctr?: number;
	position?: number;
};

export function parseSearchAnalytics(payload: unknown): GscData {
	const rows = ((payload as { rows?: Row[] }).rows ?? []).filter(Boolean);

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
				  impressions,
		topQueries: [...rows]
			.sort((a, b) => (b.clicks ?? 0) - (a.clicks ?? 0))
			.slice(0, 10)
			.map((row) => ({ query: row.keys?.[0] ?? '', clicks: row.clicks ?? 0 }))
	};
}

export type DateRange = { startDate: string; endDate: string };

/**
 * The last 28 full days ending yesterday (UTC). Pure and exported so tests can
 * pin `now` rather than depending on the clock.
 */
export function dateRange(now: Date): DateRange {
	const toIso = (d: Date): string => d.toISOString().slice(0, 10);
	const endOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const yesterday = new Date(endOfToday - 24 * 60 * 60 * 1000);
	const start = new Date(yesterday.getTime() - 27 * 24 * 60 * 60 * 1000);
	return { startDate: toIso(start), endDate: toIso(yesterday) };
}

const TIMEOUT_MS = 20_000;
const BASE_URL = 'https://www.googleapis.com/webmasters/v3';

type GoogleErrorBody = { error?: { status?: string; message?: string } };

class GoogleApiError extends Error {
	httpStatus: number;
	googleStatus: string | null;
	constructor(httpStatus: number, googleStatus: string | null, message: string) {
		super(message);
		this.name = 'GoogleApiError';
		this.httpStatus = httpStatus;
		this.googleStatus = googleStatus;
	}
}

/**
 * POSTs JSON to a Google API with a timeout and abort support. The access
 * token is only ever placed in the Authorization header — it is never
 * included in a thrown message, and a non-JSON error body never escapes as a
 * raw SyntaxError.
 */
export async function postGoogleJson(
	url: string,
	accessToken: string,
	body: unknown,
	signal?: AbortSignal
): Promise<unknown> {
	if (signal?.aborted) {
		throw new Error('Aborted: the task timed out or the run was cancelled.');
	}

	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, TIMEOUT_MS);
	const onAbort = (): void => controller.abort();
	signal?.addEventListener('abort', onAbort);

	try {
		const response = await fetch(url, {
			method: 'POST',
			signal: controller.signal,
			headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});

		if (!response.ok) {
			const parsed = (await response.json().catch(() => ({}))) as GoogleErrorBody;
			const status = parsed.error?.status ?? null;
			const message = parsed.error?.message;
			const detail = [status, message].filter(Boolean).join(': ');
			throw new GoogleApiError(
				response.status,
				status,
				`Google API request failed with HTTP ${response.status}${detail ? ` (${detail})` : ''}.`
			);
		}

		return await response.json().catch(() => ({}));
	} catch (err) {
		if (timedOut) {
			throw new Error('Aborted: the task timed out or the run was cancelled.');
		}
		throw err;
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener('abort', onAbort);
	}
}

/**
 * Fetches Search Console totals for `host` (e.g. "example.com", no
 * protocol). Tries the `sc-domain:` domain property first, then the
 * URL-prefix property, since either may be the one the account has verified;
 * whichever answers 200 wins.
 */
export async function fetchSearchAnalytics(
	host: string,
	accessToken: string,
	range: DateRange,
	signal?: AbortSignal
): Promise<GscData> {
	const siteUrls = [`sc-domain:${host}`, `https://${host}/`];

	for (const siteUrl of siteUrls) {
		try {
			const payload = await postGoogleJson(
				`${BASE_URL}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
				accessToken,
				{ ...range, dimensions: ['query'], rowLimit: 100 },
				signal
			);
			return parseSearchAnalytics(payload);
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
