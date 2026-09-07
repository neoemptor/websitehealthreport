import { describe, it, expect, beforeEach, vi } from 'vitest';

const state = vi.hoisted(() => ({
	kills: 0,
	launches: 0,
	formFactors: [] as unknown[],
	runLighthouse: async (): Promise<unknown> => ({ lhr: {} })
}));

// The analyzer loads both ESM-only packages through importEsm (see
// electron/esm.ts), which vitest's module mocking cannot intercept, so the
// loader itself is mocked instead of the packages.
vi.mock('../../esm', () => ({
	importEsm: async (specifier: string) => {
		if (specifier === 'chrome-launcher')
			return {
				launch: async () => ({
					port: (state.launches++, 9222),
					kill: async () => {
						state.kills++;
					}
				}),
				Launcher: { getInstallations: () => ['/usr/bin/chrome'] }
			};
		// The real preset is a plain object; only its settings are asserted on.
		if (specifier === 'lighthouse/core/config/desktop-config.js')
			return { default: { extends: 'lighthouse:default', settings: { formFactor: 'desktop' } } };
		if (specifier === 'lighthouse')
			return {
				default: (_url: string, _flags: unknown, config?: { settings: { formFactor: string } }) => {
					// No config means Lighthouse's default, which is mobile.
					state.formFactors.push(config?.settings.formFactor ?? 'mobile');
					return state.runLighthouse();
				}
			};
		throw new Error('unexpected import ' + specifier);
	}
}));

const { lighthouseAnalyzer } = await import('./index');

beforeEach(() => {
	state.kills = 0;
	state.launches = 0;
	state.formFactors = [];
	// Never resolves: only an abort can end this task.
	state.runLighthouse = () => new Promise(() => {});
});

describe('lighthouse analyze', () => {
	it('kills Chrome and rejects when its signal aborts', async () => {
		// Without this the scheduler's timeout releases the concurrency slot
		// while Chrome is still running, so a capped-at-two analyzer ends up
		// with four instances alive.
		const controller = new AbortController();
		const promise = lighthouseAnalyzer.analyze('https://example.com/', {}, controller.signal);
		// Waiting on the launch rather than a fixed sleep: a sleep that loses a
		// race under load aborts before Chrome exists and tests nothing.
		await vi.waitFor(() => expect(state.launches).toBe(1));

		controller.abort();

		await expect(promise).rejects.toThrow(/Aborted/);
		expect(state.kills).toBe(1);
	});

	it('does not launch Chrome when the signal is already aborted', async () => {
		const controller = new AbortController();
		controller.abort();

		await expect(
			lighthouseAnalyzer.analyze('https://example.com/', {}, controller.signal)
		).rejects.toThrow(/Cancelled/);
		expect(state.kills).toBe(0);
	});

	it('kills Chrome exactly once when the work returns', async () => {
		// The lhr here is not parseable, which is fine: what matters is that
		// the teardown runs once on the non-abort path too.
		state.runLighthouse = async () => ({ lhr: { categories: {}, audits: {} } });

		await expect(
			lighthouseAnalyzer.analyze('https://example.com/', {}, new AbortController().signal)
		).rejects.toThrow();

		expect(state.kills).toBe(1);
	});

	it('reports both form factors from a single Chrome', async () => {
		// A client cares how the site behaves on a phone as much as on a
		// desktop, and one launch is enough for both passes.
		state.runLighthouse = async () => ({
			lhr: {
				categories: {
					performance: { score: 0.5 },
					accessibility: { score: 0.9 },
					'best-practices': { score: 0.8 },
					seo: { score: 1 }
				},
				audits: {
					'largest-contentful-paint': { numericValue: 3000 },
					'cumulative-layout-shift': { numericValue: 0.02 },
					'total-blocking-time': { numericValue: 150 }
				}
			}
		});

		const data = await lighthouseAnalyzer.analyze(
			'https://example.com/',
			{},
			new AbortController().signal
		);

		// Desktop comes from Lighthouse's own preset, so the pass is throttled
		// and emulated the way PageSpeed Insights reports desktop.
		expect(state.formFactors).toEqual(['mobile', 'desktop']);
		expect(state.launches).toBe(1);
		expect(state.kills).toBe(1);
		expect(data).toMatchObject({
			mobile: { scores: { performance: 50 } },
			desktop: { scores: { performance: 50 } }
		});
	});

	it('does not start the desktop pass once the signal aborts', async () => {
		const controller = new AbortController();
		const promise = lighthouseAnalyzer.analyze('https://example.com/', {}, controller.signal);
		await vi.waitFor(() => expect(state.formFactors).toEqual(['mobile']));

		controller.abort();

		await expect(promise).rejects.toThrow(/Aborted/);
		expect(state.formFactors).toEqual(['mobile']);
	});
});
