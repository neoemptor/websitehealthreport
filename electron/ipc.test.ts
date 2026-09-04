import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { buildHandlers } from './handlers';
import { ClaudeUnavailableError, ClaudeFailedError } from './discovery/claude-cli';

let dir: string;

beforeEach(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), 'whr-ipc-'));
});

afterEach(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe('buildHandlers', () => {
	it('normalises bare domains before starting a run', async () => {
		const handlers = buildHandlers({
			userDataDir: dir,
			emitProgress: () => {},
			logger: { info: () => {}, error: () => {} }
		});

		const run = await handlers.startRun({
			client: 'example.com',
			competitors: ['rival.com'],
			enabledAnalyzers: []
		});

		await handlers.settled(run.id);
		expect(run.client).toBe('https://example.com/');
		expect(run.competitors).toEqual(['https://rival.com/']);
	});

	it('rejects an invalid domain with a clear message', async () => {
		const handlers = buildHandlers({
			userDataDir: dir,
			emitProgress: () => {},
			logger: { info: () => {}, error: () => {} }
		});

		await expect(
			handlers.startRun({ client: 'ftp://example.com', competitors: [], enabledAnalyzers: [] })
		).rejects.toThrow(/http/);
	});

	it('lists a run after it has been started', async () => {
		const handlers = buildHandlers({
			userDataDir: dir,
			emitProgress: () => {},
			logger: { info: () => {}, error: () => {} }
		});

		const run = await handlers.startRun({
			client: 'example.com',
			competitors: [],
			enabledAnalyzers: []
		});
		await handlers.settled(run.id);
		expect(await handlers.listRuns()).toHaveLength(1);
	});

	it('drops a competitor that is another spelling of the client', async () => {
		const handlers = buildHandlers({
			userDataDir: dir,
			emitProgress: () => {},
			logger: { info: () => {}, error: () => {} }
		});

		const run = await handlers.startRun({
			client: 'cjsgaragedoors.com.au',
			competitors: ['https://cjsgaragedoors.com.au/', 'rival.com'],
			enabledAnalyzers: []
		});

		await handlers.settled(run.id);

		// Two rows for one domain would collide: the client row wins.
		expect(run.competitors).toEqual(['https://rival.com/']);
		expect(run.domains.map((d) => d.domain)).toEqual([
			'https://cjsgaragedoors.com.au/',
			'https://rival.com/'
		]);
	});

	it('collapses a competitor listed twice', async () => {
		const handlers = buildHandlers({
			userDataDir: dir,
			emitProgress: () => {},
			logger: { info: () => {}, error: () => {} }
		});

		const run = await handlers.startRun({
			client: 'example.com',
			competitors: ['rival.com', 'https://rival.com/', 'RIVAL.com'],
			enabledAnalyzers: []
		});

		await handlers.settled(run.id);
		expect(run.competitors).toEqual(['https://rival.com/']);
	});

	it('rejects a run id that is not in the expected format', async () => {
		const handlers = buildHandlers({
			userDataDir: dir,
			emitProgress: () => {},
			logger: { info: () => {}, error: () => {} }
		});

		for (const id of ['../../etc/passwd', 'run', '']) {
			await expect(handlers.loadRun(id)).rejects.toThrow(/Invalid run id/);
			await expect(handlers.resumeRun(id)).rejects.toThrow(/Invalid run id/);
			await expect(handlers.cancelRun(id)).rejects.toThrow(/Invalid run id/);
		}
	});
});

describe('discovery handlers', () => {
	const input = { client: 'cjs.com.au', readSite: false, webSearch: false, hint: '' };
	const base = () => ({
		userDataDir: dir,
		emitProgress: () => {},
		logger: { info: () => {}, error: () => {} }
	});

	it('maps a good answer to ok', async () => {
		const handlers = buildHandlers({
			...base(),
			discovery: {
				runClaude: async () => ({ suggestions: [{ domain: 'a.com.au', name: 'A', reason: 'r' }] })
			}
		});
		const result = await handlers.suggestCompetitors(input);
		expect(result).toEqual({
			status: 'ok',
			suggestions: [{ domain: 'a.com.au', name: 'A', reason: 'r' }]
		});
	});

	it('maps unavailable, failed and empty client without throwing', async () => {
		const unavailable = buildHandlers({
			...base(),
			discovery: {
				runClaude: async () => {
					throw new ClaudeUnavailableError('Claude Code is not installed on this machine.');
				}
			}
		});
		expect(await unavailable.suggestCompetitors(input)).toEqual({
			status: 'unavailable',
			reason: 'Claude Code is not installed on this machine.'
		});

		const failed = buildHandlers({
			...base(),
			discovery: {
				runClaude: async () => {
					throw new ClaudeFailedError('Claude Code stopped before it could answer.', 'raw');
				}
			}
		});
		expect(await failed.suggestCompetitors(input)).toEqual({
			status: 'failed',
			error: 'Claude Code stopped before it could answer.'
		});

		expect(await failed.suggestCompetitors({ ...input, client: '' })).toEqual({
			status: 'failed',
			error: 'Domain is empty.'
		});
	});

	it('cancels the in-flight request, and a new request replaces the old one', async () => {
		const seen: AbortSignal[] = [];
		const handlers = buildHandlers({
			...base(),
			discovery: {
				runClaude: (opts) =>
					new Promise((_, reject) => {
						seen.push(opts.signal);
						opts.signal.addEventListener('abort', () => reject(new Error('Aborted: cancelled')));
					})
			}
		});
		const first = handlers.suggestCompetitors(input);
		await new Promise((r) => setTimeout(r, 5));
		const second = handlers.suggestCompetitors(input);
		await new Promise((r) => setTimeout(r, 5));
		expect(seen[0].aborted).toBe(true);
		expect(await first).toEqual({ status: 'cancelled' });
		await handlers.cancelSuggest();
		expect(await second).toEqual({ status: 'cancelled' });
	});

	it('preflight passes through the CLI probe', async () => {
		const handlers = buildHandlers({
			...base(),
			discovery: { findClaude: async () => ({ available: true, version: '2.1.237' }) }
		});
		expect(await handlers.discoveryPreflight()).toEqual({ available: true, version: '2.1.237' });
	});
});
