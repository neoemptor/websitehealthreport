/**
 * The main process is compiled to CommonJS, and tsc rewrites every
 * `await import(x)` in CommonJS output to `require(x)`. That works for our
 * own modules and for CommonJS packages, and breaks the moment a dependency
 * is ESM-only — chrome-launcher and lighthouse both are — with
 * "require() of ES Module ... not supported", which is exactly what the
 * Lighthouse analyzer reported on every run.
 *
 * Building the import through Function keeps it out of tsc's reach, so at
 * runtime it is a real dynamic import, which CommonJS modules may use.
 */
const dynamicImport = new Function('specifier', 'return import(specifier)') as (
	specifier: string
) => Promise<unknown>;

export function importEsm<T>(specifier: string): Promise<T> {
	return dynamicImport(specifier) as Promise<T>;
}
