import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { buildHandlers } from './handlers';

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

		await handlers.startRun({ client: 'example.com', competitors: [], enabledAnalyzers: [] });
		expect(await handlers.listRuns()).toHaveLength(1);
	});
});
