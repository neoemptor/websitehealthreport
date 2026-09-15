/**
 * Loads Puppeteer at runtime instead of at module load.
 *
 * Puppeteer 25 is ESM-only ("type": "module", with its `require` export
 * condition pointing at the same ES module). The Electron main process is
 * compiled to CommonJS and Electron 33 runs Node 20, which cannot `require()`
 * an ES module — a static `import puppeteer from 'puppeteer'` becomes a
 * `require` in the emitted JavaScript and kills the app at load with
 * ERR_REQUIRE_ESM, on every platform.
 *
 * A dynamic `import()` is the supported way out, but tsc with
 * `module: CommonJS` rewrites a literal `import()` into that same `require()`.
 * Building the call through `new Function` puts a real dynamic import in the
 * emitted JavaScript, which CommonJS is allowed to use.
 */
export type PuppeteerApi = typeof import('puppeteer').default;

// The body is a fixed literal with no parameter and nothing interpolated into
// it — the specifier is spelled out here — so this cannot execute anything but
// the import below.
// eslint-disable-next-line @typescript-eslint/no-implied-eval -- see above: this is the one construct tsc will not rewrite into require().
const importViaFunction = new Function('return import("puppeteer");') as () => Promise<{
	default: PuppeteerApi;
}>;

/**
 * A function body compiled with `new Function` has no host dynamic-import
 * callback inside a vm context, which is how Vitest runs modules: the import
 * above throws "A dynamic import callback was not specified" there, while
 * working normally in Electron. The test runner's Node is new enough to
 * `require()` an ES module, so it can take the plain path.
 */
async function importPuppeteer(): Promise<{ default: PuppeteerApi }> {
	try {
		return await importViaFunction();
	} catch (error) {
		if (!(error instanceof TypeError)) throw error;
		// eslint-disable-next-line @typescript-eslint/no-var-requires -- deliberate: the vm fallback above needs the CommonJS loader, not an import.
		return require('puppeteer') as { default: PuppeteerApi };
	}
}

/** Resolved once and reused; loading the module twice would cost a second parse of a large package. */
let loading: Promise<PuppeteerApi> | null = null;

export function loadPuppeteer(): Promise<PuppeteerApi> {
	loading ??= importPuppeteer().then((module) => module.default);
	return loading;
}
