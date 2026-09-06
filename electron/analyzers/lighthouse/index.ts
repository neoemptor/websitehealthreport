import type { Analyzer } from '../types';
import { once, rejectOnAbort } from '../abort';
import { importEsm } from '../../esm';
import { parseLighthouse } from './parse';

// Both packages are ESM-only; see electron/esm.ts for why a plain
// `await import()` cannot be used from this CommonJS build.
type ChromeLauncher = typeof import('chrome-launcher');
type Lighthouse = typeof import('lighthouse');
type LighthouseConfig = NonNullable<Parameters<Lighthouse['default']>[2]>;

export type LighthouseSettings = { formFactor: 'mobile' | 'desktop' };

export const lighthouseAnalyzer: Analyzer<LighthouseSettings> = {
	id: 'lighthouse',
	label: 'Lighthouse',
	// Two Lighthouse instances launched together trip over each other's
	// performance marks ("start lh:driver:navigate" / "lh:gather:getBenchmarkIndex"
	// not set), failing intermittently. One at a time is reliable and still
	// the slowest-but-bounded check.
	concurrency: 'serial',
	timeoutMs: 120_000,
	defaultSettings: { formFactor: 'mobile' },

	async preflight() {
		try {
			const { Launcher } = await importEsm<ChromeLauncher>('chrome-launcher');
			const installs = Launcher.getInstallations();
			return installs.length > 0
				? { available: true }
				: { available: false, reason: 'No Chrome installation found.' };
		} catch (error) {
			return { available: false, reason: (error as Error).message };
		}
	},

	async analyze(domain, settings, signal) {
		const { launch } = await importEsm<ChromeLauncher>('chrome-launcher');
		const lighthouse = (await importEsm<Lighthouse>('lighthouse')).default;

		// Desktop is a whole config, not a flag. Setting formFactor alone leaves
		// Lighthouse's default mobile throttling in place (150ms RTT, 1.6Mbps,
		// 4x CPU slowdown), so a desktop run was scored against a slow phone and
		// came out tens of points below PageSpeed Insights. This is the same
		// config PSI uses for its desktop strategy: desktopDense4G throttling,
		// desktop screen emulation and a desktop user agent.
		const config =
			settings.formFactor === 'desktop'
				? (
						await importEsm<{ default: LighthouseConfig }>(
							'lighthouse/core/config/desktop-config.js'
						)
				  ).default
				: undefined;

		if (signal.aborted) throw new Error('Cancelled before Chrome was launched.');

		const chrome = await launch({ chromeFlags: ['--headless'] });
		const kill = once(() => chrome.kill());

		// Killed on abort, not only in the finally below. On a timeout the
		// scheduler stops waiting for this promise and releases the slot, so a
		// teardown that waits for Lighthouse to return may never run at all and
		// the analyzer ends up with more Chrome instances alive than its
		// concurrency cap allows.
		const onAbort = () => void kill();
		signal.addEventListener('abort', onAbort, { once: true });
		const aborted = rejectOnAbort(signal);

		try {
			const result = await Promise.race([
				lighthouse(
					domain,
					{ port: chrome.port, output: 'json', formFactor: settings.formFactor },
					config
				),
				aborted.promise
			]);

			if (!result?.lhr) {
				throw new Error('Lighthouse returned no result.');
			}
			return parseLighthouse(result.lhr);
		} finally {
			aborted.dispose();
			signal.removeEventListener('abort', onAbort);
			await kill();
		}
	}
};
