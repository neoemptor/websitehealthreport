import type { Analyzer } from '../types';
import { once, rejectOnAbort } from '../abort';
import { parseLighthouse } from './parse';

export type LighthouseSettings = { formFactor: 'mobile' | 'desktop' };

export const lighthouseAnalyzer: Analyzer<LighthouseSettings> = {
	id: 'lighthouse',
	label: 'Lighthouse',
	// CPU-bound: two at a time keeps the machine usable during a run.
	concurrency: 'limited',
	timeoutMs: 120_000,
	defaultSettings: { formFactor: 'mobile' },

	async preflight() {
		try {
			const { Launcher } = await import('chrome-launcher');
			const installs = Launcher.getInstallations();
			return installs.length > 0
				? { available: true }
				: { available: false, reason: 'No Chrome installation found.' };
		} catch (error) {
			return { available: false, reason: (error as Error).message };
		}
	},

	async analyze(domain, settings, signal) {
		const { launch } = await import('chrome-launcher');
		const lighthouse = (await import('lighthouse')).default;

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
				lighthouse(domain, {
					port: chrome.port,
					output: 'json',
					formFactor: settings.formFactor,
					screenEmulation: { disabled: settings.formFactor === 'desktop' }
				}),
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
