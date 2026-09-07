import { describe, it, expect } from 'vitest';
import { createGeoAnalyzer, type GeoDeps } from './index';
import { ClaudeUnavailableError, ClaudeFailedError } from '../../discovery/claude-cli';
import { FACTOR_IDS } from './prompt';

const okResponse = () => ({
	pages: ['https://www.example.com/'],
	factors: FACTOR_IDS.map((id) => ({ id, rating: 'good', evidence: `Seen for ${id}.` })),
	fixes: ['Add prices.']
});

type RunArgs = Parameters<GeoDeps['runClaude']>[0];

function deps(overrides: Partial<GeoDeps> = {}, calls: RunArgs[] = []): GeoDeps {
	return {
		findClaude: async () => ({ available: true, version: '2.1.0' }),
		runClaude: async (opts) => {
			calls.push(opts);
			return okResponse();
		},
		cwd: 'C:/userdata',
		...overrides
	};
}

describe('geo analyzer', () => {
	it('is unavailable when Claude Code is not installed or not logged in', async () => {
		const analyzer = createGeoAnalyzer(
			deps({
				findClaude: async () => ({
					available: false,
					reason: 'Claude Code is not installed on this machine.'
				})
			})
		);
		expect(await analyzer.preflight({})).toEqual({
			available: false,
			reason: 'Claude Code is not installed on this machine.'
		});
	});

	it('is available when Claude Code answers', async () => {
		expect(await createGeoAnalyzer(deps()).preflight({})).toEqual({ available: true });
	});

	it('asks Claude with WebFetch only, the rubric, the schema and the userData cwd', async () => {
		const calls: RunArgs[] = [];
		const analyzer = createGeoAnalyzer(deps({}, calls));
		const data = await analyzer.analyze(
			'https://www.example.com/',
			{},
			new AbortController().signal
		);

		expect(calls).toHaveLength(1);
		expect(calls[0].allowedTools).toEqual(['WebFetch']);
		expect(calls[0].cwd).toBe('C:/userdata');
		expect(calls[0].timeoutMs).toBe(300_000);
		expect(calls[0].prompt).toContain('Site to audit: https://www.example.com/');
		expect(calls[0].systemAppend).toMatch(/never search/);
		expect(calls[0].schema).toMatchObject({ required: ['pages', 'factors', 'fixes'] });
		expect(data).toMatchObject({ pages: ['https://www.example.com/'], fixes: ['Add prices.'] });
		expect((data as { factors: unknown[] }).factors).toHaveLength(7);
	});

	it('turns a login lost after preflight into an UNAVAILABLE failure', async () => {
		const analyzer = createGeoAnalyzer(
			deps({
				runClaude: async () => {
					throw new ClaudeUnavailableError('Claude Code is not logged in.');
				}
			})
		);
		await expect(
			analyzer.analyze('https://www.example.com/', {}, new AbortController().signal)
		).rejects.toThrow(/^UNAVAILABLE: Claude Code is not logged in\./);
	});

	it('fails with the plain message when Claude Code breaks', async () => {
		const analyzer = createGeoAnalyzer(
			deps({
				runClaude: async () => {
					throw new ClaudeFailedError('Claude Code stopped before it could answer.', 'raw tail');
				}
			})
		);
		await expect(
			analyzer.analyze('https://www.example.com/', {}, new AbortController().signal)
		).rejects.toThrow('Claude Code stopped before it could answer.');
	});

	it('fails when the answer does not validate', async () => {
		const analyzer = createGeoAnalyzer(
			deps({ runClaude: async () => ({ pages: [], factors: [], fixes: [] }) })
		);
		await expect(
			analyzer.analyze('https://www.example.com/', {}, new AbortController().signal)
		).rejects.toThrow(/no page/i);
	});

	it('does not call Claude when the signal is already aborted', async () => {
		const calls: RunArgs[] = [];
		const controller = new AbortController();
		controller.abort();
		await expect(
			createGeoAnalyzer(deps({}, calls)).analyze('https://www.example.com/', {}, controller.signal)
		).rejects.toThrow(/Cancelled/);
		expect(calls).toHaveLength(0);
	});
});
