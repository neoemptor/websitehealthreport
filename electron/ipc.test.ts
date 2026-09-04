import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { buildHandlers } from './handlers';
import { CredentialStore, type CryptoBackend } from './credentials';
import { ClaudeUnavailableError, ClaudeFailedError } from './discovery/claude-cli';

let dir: string;

// The real safeStorage is unavailable outside Electron; a reversible stand-in
// keeps the store's read/write path honest without pretending to encrypt.
const fakeCrypto: CryptoBackend = {
	isEncryptionAvailable: () => true,
	encryptString: (value) => Buffer.from(`enc:${value}`, 'utf-8'),
	decryptString: (value) => value.toString('utf-8').replace(/^enc:/, '')
};

const credentials = (): CredentialStore => new CredentialStore(dir, fakeCrypto);

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
			logger: { info: () => {}, error: () => {} },
			credentials: credentials()
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
			logger: { info: () => {}, error: () => {} },
			credentials: credentials()
		});

		await expect(
			handlers.startRun({ client: 'ftp://example.com', competitors: [], enabledAnalyzers: [] })
		).rejects.toThrow(/http/);
	});

	it('lists a run after it has been started', async () => {
		const handlers = buildHandlers({
			userDataDir: dir,
			emitProgress: () => {},
			logger: { info: () => {}, error: () => {} },
			credentials: credentials()
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
			logger: { info: () => {}, error: () => {} },
			credentials: credentials()
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
			logger: { info: () => {}, error: () => {} },
			credentials: credentials()
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
			logger: { info: () => {}, error: () => {} },
			credentials: credentials()
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
		logger: { info: () => {}, error: () => {} },
		credentials: credentials()
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

	it('reports a non-Error throw by its own text', async () => {
		const handlers = buildHandlers({
			...base(),
			discovery: {
				runClaude: async () => {
					// eslint-disable-next-line @typescript-eslint/no-throw-literal
					throw 'boom';
				}
			}
		});
		expect(await handlers.suggestCompetitors(input)).toEqual({ status: 'failed', error: 'boom' });
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

describe('credential handlers', () => {
	const base = () => ({
		userDataDir: dir,
		emitProgress: () => {},
		logger: { info: () => {}, error: () => {} },
		credentials: credentials()
	});

	it('saves, reports and removes an allowed credential without ever returning it', async () => {
		const handlers = buildHandlers(base());

		expect(await handlers.hasCredential('semrush.apiKey')).toBe(false);
		await handlers.setCredential('semrush.apiKey', 'secret-key');
		expect(await handlers.hasCredential('semrush.apiKey')).toBe(true);

		// There is deliberately no getter: the renderer learns only that a
		// credential exists.
		expect('getCredential' in handlers).toBe(false);

		await handlers.removeCredential('semrush.apiKey');
		expect(await handlers.hasCredential('semrush.apiKey')).toBe(false);
	});

	it('accepts the Google client id and secret', async () => {
		const handlers = buildHandlers(base());
		await handlers.setCredential('google.clientId', 'id');
		await handlers.setCredential('google.clientSecret', 'secret');
		expect(await handlers.hasCredential('google.clientId')).toBe(true);
		expect(await handlers.hasCredential('google.clientSecret')).toBe(true);
	});

	it('rejects any key outside the allowed list', async () => {
		const handlers = buildHandlers(base());

		// A refresh token is written only by the consent flow, never by the
		// renderer, so its key is not settable here either.
		for (const key of ['google.refresh.example.com', 'semrush', '__proto__', '']) {
			await expect(handlers.setCredential(key, 'x')).rejects.toThrow('Unknown credential.');
			await expect(handlers.hasCredential(key)).rejects.toThrow('Unknown credential.');
			await expect(handlers.removeCredential(key)).rejects.toThrow('Unknown credential.');
		}
	});
});

describe('client identity during a run', () => {
	const base = () => ({
		userDataDir: dir,
		emitProgress: () => {},
		logger: { info: () => {}, error: () => {} },
		credentials: credentials()
	});

	it('treats the run client as the client and a competitor as not, then forgets it', async () => {
		const handlers = buildHandlers(base());

		const run = await handlers.startRun({
			client: 'example.com',
			competitors: ['rival.com'],
			enabledAnalyzers: []
		});

		expect(handlers.isClient('https://example.com/')).toBe(true);
		expect(handlers.isClient('https://rival.com/')).toBe(false);

		await handlers.settled(run.id);
		// The removal is fired and forgotten after settled, so give it a turn.
		await new Promise((r) => setTimeout(r, 5));
		expect(handlers.isClient('https://example.com/')).toBe(false);
	});

	it('re-registers the client when a run is resumed', async () => {
		const handlers = buildHandlers(base());
		const run = await handlers.startRun({
			client: 'example.com',
			competitors: [],
			enabledAnalyzers: []
		});
		await handlers.settled(run.id);
		await new Promise((r) => setTimeout(r, 5));

		await handlers.resumeRun(run.id);
		expect(handlers.isClient('https://example.com/')).toBe(true);
	});
});
