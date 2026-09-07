import type { Analyzer } from '../types';
import { once, rejectOnAbort } from '../abort';
import { importEsm } from '../../esm';
import { parseLighthouse, type LighthouseData, type LighthouseResult } from './parse';

// Both packages are ESM-only; see electron/esm.ts for why a plain
// `await import()` cannot be used from this CommonJS build.
type ChromeLauncher = typeof import('chrome-launcher');
type Lighthouse = typeof import('lighthouse');
type DesktopConfig = { default: Parameters<Lighthouse['default']>[2] };

// Lighthouse's own desktop preset: desktop screen emulation, the desktopDense4G
// throttling profile and a desktop user agent. Without it a "desktop" run is
// still throttled like a phone (4x CPU, slow 4G), which scores far below what
// PageSpeed Insights reports for the same page and misleads the client.
const DESKTOP_CONFIG = 'lighthouse/core/config/desktop-config.js';

export type LighthouseSettings = Record<string, never>;

const FORM_FACTORS = ['mobile', 'desktop'] as const;
type FormFactor = (typeof FORM_FACTORS)[number];

export const lighthouseAnalyzer: Analyzer<LighthouseSettings> = {
	id: 'lighthouse',
	label: 'Lighthouse',
	// Two Lighthouse instances launched together trip over each other's
	// performance marks ("start lh:driver:navigate" / "lh:gather:getBenchmarkIndex"
	// not set), failing intermittently. One at a time is reliable and still
	// the slowest-but-bounded check. The mobile and desktop passes below are
	// sequential for the same reason.
	concurrency: 'serial',
	// Two passes, so twice the budget of the single-pass version.
	timeoutMs: 240_000,
	defaultSettings: {},

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

	async analyze(domain, _settings, signal) {
		const { launch } = await importEsm<ChromeLauncher>('chrome-launcher');
		const lighthouse = (await importEsm<Lighthouse>('lighthouse')).default;
		const desktopConfig = (await importEsm<DesktopConfig>(DESKTOP_CONFIG)).default;

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
			// One Chrome, both form factors: a client cares how the site behaves
			// on a phone as much as on a desktop, and the two scores routinely
			// differ by enough that reporting one of them alone is misleading.
			const passes = {} as Record<FormFactor, LighthouseData>;
			for (const formFactor of FORM_FACTORS) {
				// Mobile is Lighthouse's default config, so only desktop needs one.
				// Screen emulation, throttling and user agent all come from the
				// preset; setting any of them as a flag here would override it.
				const result = await Promise.race([
					lighthouse(
						domain,
						{ port: chrome.port, output: 'json' },
						formFactor === 'desktop' ? desktopConfig : undefined
					),
					aborted.promise
				]);

				if (!result?.lhr) {
					throw new Error(`Lighthouse returned no ${formFactor} result.`);
				}
				passes[formFactor] = parseLighthouse(result.lhr);
			}
			return passes satisfies LighthouseResult;
		} finally {
			aborted.dispose();
			signal.removeEventListener('abort', onAbort);
			await kill();
		}
	}
};
