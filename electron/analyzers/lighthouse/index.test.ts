import { describe, it, expect, beforeEach, vi } from 'vitest';

const DESKTOP_CONFIG = { extends: 'lighthouse:default', settings: { formFactor: 'desktop' } };

const state = vi.hoisted(() => ({
	kills: 0,
	launches: 0,
	args: [] as unknown[],
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
		if (specifier === 'lighthouse')
			return {
				default: (...args: unknown[]) => {
					state.args = args;
					return state.runLighthouse();
				}
			};
		if (specifier === 'lighthouse/core/config/desktop-config.js')
			return { default: DESKTOP_CONFIG };
		throw new Error('unexpected import ' + specifier);
	}
}));

const { lighthouseAnalyzer } = await import('./index');

beforeEach(() => {
	state.kills = 0;
	state.launches = 0;
	state.args = [];
	// Never resolves: only an abort can end this task.
	state.runLighthouse = () => new Promise(() => {});
});

describe('lighthouse analyze', () => {
	// A desktop run configured with formFactor alone keeps Lighthouse's default
	// mobile throttling (4x CPU slowdown, slow 4G), which scores a desktop page
	// tens of points below PageSpeed Insights. The desktop config carries the
	// throttling, screen emulation and user agent that PSI's desktop strategy
	// uses, so it has to reach Lighthouse.
	it('runs the desktop form factor with the desktop config', async () => {
		state.runLighthouse = async () => ({ lhr: { categories: {}, audits: {} } });

		await expect(
			lighthouseAnalyzer.analyze(
				'https://example.com/',
				{ formFactor: 'desktop' },
				new AbortController().signal
			)
		).rejects.toThrow();

		expect(state.args[1]).toMatchObject({ formFactor: 'desktop' });
		expect(state.args[1]).not.toHaveProperty('screenEmulation');
		expect(state.args[2]).toBe(DESKTOP_CONFIG);
	});

	it('runs the mobile form factor on the default config', async () => {
		state.runLighthouse = async () => ({ lhr: { categories: {}, audits: {} } });

		await expect(
			lighthouseAnalyzer.analyze(
				'https://example.com/',
				{ formFactor: 'mobile' },
				new AbortController().signal
			)
		).rejects.toThrow();

		expect(state.args[1]).toMatchObject({ formFactor: 'mobile' });
		expect(state.args[2]).toBeUndefined();
	});

	it('kills Chrome and rejects when its signal aborts', async () => {
		// Without this the scheduler's timeout releases the concurrency slot
		// while Chrome is still running, so a capped-at-two analyzer ends up
		// with four instances alive.
		const controller = new AbortController();
		const promise = lighthouseAnalyzer.analyze(
			'https://example.com/',
			{ formFactor: 'mobile' },
			controller.signal
		);
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
			lighthouseAnalyzer.analyze(
				'https://example.com/',
				{ formFactor: 'mobile' },
				controller.signal
			)
		).rejects.toThrow(/Cancelled/);
		expect(state.kills).toBe(0);
	});

	it('kills Chrome exactly once when the work returns', async () => {
		// The lhr here is not parseable, which is fine: what matters is that
		// the teardown runs once on the non-abort path too.
		state.runLighthouse = async () => ({ lhr: { categories: {}, audits: {} } });

		await expect(
			lighthouseAnalyzer.analyze(
				'https://example.com/',
				{ formFactor: 'mobile' },
				new AbortController().signal
			)
		).rejects.toThrow();

		expect(state.kills).toBe(1);
	});
});
