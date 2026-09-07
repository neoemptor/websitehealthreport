import { FACTOR_IDS, RATINGS, type FactorId } from './prompt';

export type Rating = (typeof RATINGS)[number];
export type GeoFactor = { id: FactorId; rating: Rating; evidence: string };
export type GeoData = { pages: string[]; factors: GeoFactor[]; fixes: string[] };

const TEXT_CAP = 300;
const MAX_FIXES = 3;

const isFactorId = (v: unknown): v is FactorId =>
	typeof v === 'string' && (FACTOR_IDS as readonly string[]).includes(v);
const isRating = (v: unknown): v is Rating =>
	typeof v === 'string' && (RATINGS as readonly string[]).includes(v);

const clip = (v: unknown): string => (typeof v === 'string' ? v.trim().slice(0, TEXT_CAP) : '');

/** The audited host and its subdomains, so a page on blog.example.com counts. */
function onSite(url: string, host: string): boolean {
	try {
		const u = new URL(url);
		if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
		const h = u.hostname.toLowerCase();
		return h === host || h.endsWith(`.${host}`);
	} catch {
		return false;
	}
}

/**
 * The schema constrains the CLI, but its output is still an untrusted
 * subprocess result: every field is checked, and a rating of pages Claude
 * did not read on this site is not a result.
 */
export function parseGeoResponse(input: unknown, domain: string): GeoData {
	const r = input as { pages?: unknown; factors?: unknown; fixes?: unknown } | null;
	if (!r || typeof r !== 'object' || !Array.isArray(r.factors) || !Array.isArray(r.pages)) {
		throw new Error('Not a GEO response: no factors or pages present.');
	}

	const host = new URL(domain).hostname.toLowerCase().replace(/^www\./, '');
	const pages = (r.pages as unknown[]).filter(
		(p): p is string => typeof p === 'string' && onSite(p, host)
	);
	if (pages.length === 0) throw new Error('Claude rated the site but listed no page on it.');

	const byId = new Map<FactorId, GeoFactor>();
	for (const entry of r.factors as unknown[]) {
		const f = entry as { id?: unknown; rating?: unknown; evidence?: unknown } | null;
		if (!f || typeof f !== 'object') continue;
		if (!isFactorId(f.id)) throw new Error(`Claude rated an unknown GEO factor: ${String(f.id)}.`);
		if (!isRating(f.rating))
			throw new Error(`Claude gave ${f.id} an unknown rating: ${String(f.rating)}.`);
		if (byId.has(f.id)) throw new Error(`Claude rated the ${f.id} GEO factor twice.`);
		byId.set(f.id, { id: f.id, rating: f.rating, evidence: clip(f.evidence) });
	}
	if (byId.size !== FACTOR_IDS.length) {
		throw new Error(`Claude rated ${byId.size} of the seven GEO factors.`);
	}

	const fixes = (Array.isArray(r.fixes) ? r.fixes : [])
		.map(clip)
		.filter((s) => s.length > 0)
		.slice(0, MAX_FIXES);

	return { pages, factors: FACTOR_IDS.map((id) => byId.get(id) as GeoFactor), fixes };
}
