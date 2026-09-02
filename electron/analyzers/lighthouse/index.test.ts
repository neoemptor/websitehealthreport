import { describe, it, expect, beforeEach, vi } from 'vitest';

const state = vi.hoisted(() => ({
	kills: 0,
	launches: 0,
	runLighthouse: async (): Promise<unknown> => ({ lhr: {} })
}));

vi.mock('chrome-launcher', () => ({
	launch: async () => ({
		port: (state.launches++, 9222),
		kill: async () => {
			state.kills++;
		}
	}),
	Launcher: { getInstallations: () => ['/usr/bin/chrome'] }
}));

vi.mock('lighthouse', () => ({ default: () => state.runLighthouse() }));

const { lighthouseAnalyzer } = await import('./index');

beforeEach(() => {
	state.kills = 0;
	state.launches = 0;
	// Never resolves: only an abort can end this task.
	state.runLighthouse = () => new Promise(() => {});
});

describe('lighthouse analyze', () => {
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
