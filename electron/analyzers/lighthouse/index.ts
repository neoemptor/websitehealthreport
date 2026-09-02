import type { Analyzer } from '../types';
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

	async analyze(domain, settings) {
		const { launch } = await import('chrome-launcher');
		const lighthouse = (await import('lighthouse')).default;

		const chrome = await launch({ chromeFlags: ['--headless'] });
		try {
			const result = await lighthouse(domain, {
				port: chrome.port,
				output: 'json',
				formFactor: settings.formFactor,
				screenEmulation: { disabled: settings.formFactor === 'desktop' }
			});

			if (!result?.lhr) {
				throw new Error('Lighthouse returned no result.');
			}
			return parseLighthouse(result.lhr);
		} finally {
			await chrome.kill();
		}
	}
};
