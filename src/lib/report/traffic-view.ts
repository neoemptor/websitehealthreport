/**
 * Pure view-model builders for the traffic report sections.
 *
 * Both TrafficOwned.svelte and TrafficEstimated.svelte render only from the
 * shapes returned here — never from `data.x` directly — so a malformed
 * payload (missing fields, wrong types, an empty object) can never throw
 * while the component renders. Anything that doesn't validate becomes an
 * "unavailable" reading with a client-safe reason, never a crash.
 */

const UNAVAILABLE_REASON = 'This reading could not be shown.';

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isString = (v: unknown): v is string => typeof v === 'string';

function isRecord(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === 'object';
}

export type TrafficRange = { start: string; end: string; days: number };

export type SearchConsoleView =
	| {
			kind: 'ok';
			clicks: number;
			impressions: number;
			ctrPct: string;
			position: string;
			topQueries: Array<{ query: string; clicks: number; impressions: number }>;
	  }
	| { kind: 'unavailable'; reason: string };

export type Ga4View =
	| { kind: 'ok'; sessions: number; users: number; engagementPct: string }
	| { kind: 'unavailable'; reason: string };

export type OwnedView = {
	range: TrafficRange | null;
	searchConsole: SearchConsoleView;
	ga4: Ga4View;
};

export type EstimatedRow = { label: string; value: string };

export type EstimatedView = {
	rows: EstimatedRow[];
	nothing: boolean;
};

function buildRange(v: unknown): TrafficRange | null {
	if (!isRecord(v)) return null;
	const start = v.start;
	const end = v.end;
	if (!isString(start) || !isString(end)) return null;
	const startMs = Date.parse(start);
	const endMs = Date.parse(end);
	if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
	const days = Math.max(0, Math.round((endMs - startMs) / 86_400_000));
	return { start, end, days };
}

function isValidTopQuery(v: unknown): v is { query: string; clicks: number; impressions: number } {
	if (!isRecord(v)) return false;
	return isString(v.query) && isNumber(v.clicks) && isNumber(v.impressions);
}

function buildSearchConsole(v: unknown): SearchConsoleView {
	if (!isRecord(v)) return { kind: 'unavailable', reason: UNAVAILABLE_REASON };
	if (v.status === 'unavailable') {
		return { kind: 'unavailable', reason: isString(v.reason) ? v.reason : UNAVAILABLE_REASON };
	}
	if (v.status !== 'ok') return { kind: 'unavailable', reason: UNAVAILABLE_REASON };

	const data = v.data;
	if (!isRecord(data)) return { kind: 'unavailable', reason: UNAVAILABLE_REASON };
	const totals = data.totals;
	if (!isRecord(totals)) return { kind: 'unavailable', reason: UNAVAILABLE_REASON };
	const { clicks, impressions, ctr, position } = totals;
	if (!isNumber(clicks) || !isNumber(impressions) || !isNumber(ctr) || !isNumber(position)) {
		return { kind: 'unavailable', reason: UNAVAILABLE_REASON };
	}

	const rawTopQueries = Array.isArray(data.topQueries) ? data.topQueries : [];
	const topQueries = rawTopQueries.filter(isValidTopQuery).slice(0, 10);

	return {
		kind: 'ok',
		clicks,
		impressions,
		ctrPct: `${(ctr * 100).toFixed(2)}%`,
		position: position.toFixed(1),
		topQueries
	};
}

function buildGa4(v: unknown): Ga4View {
	if (!isRecord(v)) return { kind: 'unavailable', reason: UNAVAILABLE_REASON };
	if (v.status === 'unavailable') {
		return { kind: 'unavailable', reason: isString(v.reason) ? v.reason : UNAVAILABLE_REASON };
	}
	if (v.status !== 'ok') return { kind: 'unavailable', reason: UNAVAILABLE_REASON };

	const data = v.data;
	if (!isRecord(data)) return { kind: 'unavailable', reason: UNAVAILABLE_REASON };
	const { sessions, users, engagementRate } = data;
	if (!isNumber(sessions) || !isNumber(users) || !isNumber(engagementRate)) {
		return { kind: 'unavailable', reason: UNAVAILABLE_REASON };
	}

	return {
		kind: 'ok',
		sessions,
		users,
		engagementPct: `${(engagementRate * 100).toFixed(1)}%`
	};
}

/** Builds the view model for TrafficOwned.svelte from an unknown payload. */
export function ownedView(data: unknown): OwnedView {
	const d = isRecord(data) ? data : {};
	return {
		range: buildRange(d.range),
		searchConsole: buildSearchConsole(d.searchConsole),
		ga4: buildGa4(d.ga4)
	};
}

function numberOrNull(v: unknown): number | null {
	return isNumber(v) ? v : null;
}

/** Builds the view model for TrafficEstimated.svelte from an unknown payload. */
export function estimatedView(data: unknown): EstimatedView {
	const d = isRecord(data) ? data : {};

	const organicTraffic = numberOrNull(d.organicTraffic);
	const organicKeywords = numberOrNull(d.organicKeywords);
	const adwordsKeywords = numberOrNull(d.adwordsKeywords);
	const organicCost = numberOrNull(d.organicCost);
	const nothingFound = d.nothingFound === true;

	const allNull =
		organicTraffic === null &&
		organicKeywords === null &&
		adwordsKeywords === null &&
		organicCost === null;

	if (nothingFound || allNull) {
		return { rows: [], nothing: true };
	}

	const rows: EstimatedRow[] = [];
	if (organicTraffic !== null) {
		rows.push({
			label: 'Monthly visits (estimate)',
			value: organicTraffic.toLocaleString('en-AU')
		});
	}
	if (organicKeywords !== null) {
		rows.push({
			label: 'Organic keywords (estimate)',
			value: organicKeywords.toLocaleString('en-AU')
		});
	}
	if (adwordsKeywords !== null) {
		rows.push({
			label: 'Advertised keywords (estimate)',
			value: adwordsKeywords.toLocaleString('en-AU')
		});
	}
	if (organicCost !== null) {
		rows.push({
			// Semrush's "organic cost" is what this traffic would cost to buy as
			// ads, not what the site spends — and Semrush reports it in USD.
			label: 'Value of that traffic if bought as ads (estimate)',
			value: `US$${organicCost.toLocaleString('en-AU')}`
		});
	}

	return { rows, nothing: false };
}
