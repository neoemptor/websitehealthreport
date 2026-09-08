import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import {
	findClaude,
	runClaude,
	ClaudeUnavailableError,
	ClaudeFailedError,
	type SpawnFn,
	type Spawned
} from './claude-cli';

type Script = {
	/** Called with the args; return what the fake process prints and its exit code. */
	run: (
		command: string,
		args: string[]
	) => { stdout?: string; stderr?: string; code: number | null; hang?: boolean };
};

function fakeSpawn(
	script: Script,
	calls: Array<{ command: string; args: string[] }> = []
): {
	spawn: SpawnFn;
	calls: typeof calls;
	killed: number[];
} {
	const killed: number[] = [];
	const spawn: SpawnFn = (command, args) => {
		calls.push({ command, args });
		const stdout = new PassThrough();
		const stderr = new PassThrough();
		const stdin = new PassThrough();
		const emitter = new EventEmitter();
		const index = calls.length - 1;
		const out = script.run(command, args);
		const child: Spawned = {
			stdout,
			stderr,
			stdin,
			kill: () => {
				killed.push(index);
				setImmediate(() => emitter.emit('close', null));
			},
			on: (event, listener) => emitter.on(event, listener as (...a: unknown[]) => void)
		};
		setImmediate(() => {
			if (out.stdout) stdout.end(out.stdout);
			else stdout.end();
			if (out.stderr) stderr.end(out.stderr);
			else stderr.end();
			if (!out.hang) emitter.emit('close', out.code);
		});
		return child;
	};
	return { spawn, calls, killed };
}

const envelope = (structured: unknown) =>
	JSON.stringify({
		type: 'result',
		subtype: 'success',
		is_error: false,
		structured_output: structured,
		result: ''
	});

describe('findClaude', () => {
	it('reports unavailable when the binary is not on PATH', async () => {
		const { spawn } = fakeSpawn({ run: () => ({ stdout: '', code: 1 }) });
		const result = await findClaude({ spawn, platform: 'win32' });
		expect(result).toEqual({
			available: false,
			reason: 'Claude Code is not installed on this machine.'
		});
	});

	it('reports the version when found', async () => {
		const { spawn, calls } = fakeSpawn({
			run: (command) =>
				command === 'where'
					? { stdout: 'C:\\Users\\me\\.local\\bin\\claude.exe\r\n', code: 0 }
					: { stdout: '2.1.237 (Claude Code)\n', code: 0 }
		});
		const result = await findClaude({ spawn, platform: 'win32' });
		expect(result).toEqual({ available: true, version: '2.1.237 (Claude Code)' });
		expect(calls[0]).toEqual({ command: 'where', args: ['claude'] });
		expect(calls[1].command).toBe('C:\\Users\\me\\.local\\bin\\claude.exe');
		expect(calls[1].args).toEqual(['--version']);
	});

	// macOS/Linux: nothing in the well-known dirs, no version manager, no login shell needed.
	const noFiles = {
		homedir: '/Users/me',
		isFile: async () => false,
		listDir: async () => [] as string[],
		env: { PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' }
	};

	it('uses which on non-Windows platforms when nothing is in a known install dir', async () => {
		const { spawn, calls } = fakeSpawn({
			run: (command) =>
				command === 'which'
					? { stdout: '/usr/local/bin/claude\n', code: 0 }
					: { stdout: '2.1.0\n', code: 0 }
		});
		const result = await findClaude({ spawn, platform: 'linux', ...noFiles });
		expect(result).toEqual({ available: true, version: '2.1.0' });
		expect(calls[0]).toEqual({ command: 'which', args: ['claude'] });
		expect(calls[1].command).toBe('/usr/local/bin/claude');
	});

	it('finds the macOS native install in ~/.local/bin without relying on PATH', async () => {
		const { spawn, calls } = fakeSpawn({
			run: () => ({ stdout: '2.1.263 (Claude Code)\n', code: 0 })
		});
		const result = await findClaude({
			spawn,
			platform: 'darwin',
			...noFiles,
			isFile: async (path) => path === '/Users/me/.local/bin/claude'
		});
		expect(result).toEqual({ available: true, version: '2.1.263 (Claude Code)' });
		// No which/where: the binary was found directly, then version-checked.
		expect(calls).toHaveLength(1);
		expect(calls[0].command).toBe('/Users/me/.local/bin/claude');
		expect(calls[0].args).toEqual(['--version']);
	});

	it('finds an nvm-installed claude on Apple silicon, newest Node first', async () => {
		const { spawn, calls } = fakeSpawn({ run: () => ({ stdout: '2.1.0\n', code: 0 }) });
		await findClaude({
			spawn,
			platform: 'darwin',
			...noFiles,
			listDir: async (path) => (path.endsWith('/.nvm/versions/node') ? ['v20.1.0', 'v26.8.1'] : []),
			isFile: async (path) => path.includes('/.nvm/') && path.endsWith('/claude')
		});
		expect(calls[0].command).toBe('/Users/me/.nvm/versions/node/v26.8.1/bin/claude');
	});

	it('falls back to the login shell on macOS when which finds nothing', async () => {
		const { spawn, calls } = fakeSpawn({
			run: (command, args) => {
				if (command === 'which') return { stdout: '', code: 1 };
				if (args[0] === '-lc') return { stdout: '/Users/me/custom/claude\n', code: 0 };
				return { stdout: '2.1.0\n', code: 0 };
			}
		});
		const result = await findClaude({ spawn, platform: 'darwin', ...noFiles });
		expect(result).toEqual({ available: true, version: '2.1.0' });
		expect(calls[1]).toEqual({ command: '/bin/zsh', args: ['-lc', 'command -v claude'] });
		expect(calls[2].command).toBe('/Users/me/custom/claude');
	});

	it('reports unavailable on macOS when every lookup misses', async () => {
		const { spawn } = fakeSpawn({ run: () => ({ stdout: '', code: 1 }) });
		const result = await findClaude({ spawn, platform: 'darwin', ...noFiles });
		expect(result).toEqual({
			available: false,
			reason: 'Claude Code is not installed on this machine.'
		});
	});

	it('hands the widened PATH to which and to claude itself on macOS', async () => {
		const envs: Array<NodeJS.ProcessEnv | undefined> = [];
		const inner = fakeSpawn({
			run: (command) =>
				command === 'which'
					? { stdout: '/opt/homebrew/bin/claude\n', code: 0 }
					: { stdout: '2.1.0\n', code: 0 }
		});
		const spawn: SpawnFn = (c, a, o) => {
			envs.push(o.env);
			return inner.spawn(c, a, o);
		};
		await findClaude({ spawn, platform: 'darwin', ...noFiles });
		for (const env of envs) {
			const path = env?.PATH ?? '';
			expect(path.startsWith('/usr/bin:/bin')).toBe(true);
			expect(path).toContain('/Users/me/.local/bin');
			expect(path).toContain('/opt/homebrew/bin');
			expect(path).toContain('/Users/me/.claude/local');
		}
	});

	it('leaves the environment alone on Windows', async () => {
		const envs: Array<NodeJS.ProcessEnv | undefined> = [];
		const inner = fakeSpawn({
			run: (command) =>
				command === 'where'
					? { stdout: 'C:\\bin\\claude.exe\r\n', code: 0 }
					: { stdout: '2.1.0\n', code: 0 }
		});
		const spawn: SpawnFn = (c, a, o) => {
			envs.push(o.env);
			return inner.spawn(c, a, o);
		};
		const env = { PATH: 'C:\\Windows' };
		await findClaude({ spawn, platform: 'win32', env });
		expect(envs.every((e) => e === env)).toBe(true);
	});
});

// locate ('where'/'which'), --version, then the print run: tests below index the print spawn as calls[2].
const baseOpts = {
	prompt: 'hello',
	systemAppend: 'sys',
	schema: { type: 'object' },
	allowedTools: [] as string[],
	timeoutMs: 5_000,
	cwd: 'C:\\data'
};

function locate(command: string, args: string[]) {
	if (command === 'where' || command === 'which')
		return { stdout: 'C:\\bin\\claude.exe\n', code: 0 };
	if (args[0] === '--version') return { stdout: '2.1.237\n', code: 0 };
	return null;
}

describe('runClaude', () => {
	it('passes the print flags, schema and tools, and returns structured_output', async () => {
		const { spawn, calls } = fakeSpawn({
			run: (c, a) => locate(c, a) ?? { stdout: envelope({ ok: true }), code: 0 }
		});
		const result = await runClaude(
			{ ...baseOpts, allowedTools: ['WebSearch'], signal: new AbortController().signal },
			{ spawn, platform: 'win32' }
		);
		expect(result).toEqual({ ok: true });
		const args = calls[2].args;
		expect(args).toContain('-p');
		expect(args).toContain('--no-session-persistence');
		expect(args[args.indexOf('--output-format') + 1]).toBe('json');
		expect(args[args.indexOf('--json-schema') + 1]).toBe(JSON.stringify(baseOpts.schema));
		expect(args[args.indexOf('--allowedTools') + 1]).toBe('WebSearch');
		expect(args[args.indexOf('--append-system-prompt') + 1]).toBe('sys');
		expect(args).not.toContain('--bare');
		expect(args).not.toContain('--dangerously-skip-permissions');
	});

	it('omits --allowedTools when no tools are allowed', async () => {
		const { spawn, calls } = fakeSpawn({
			run: (c, a) => locate(c, a) ?? { stdout: envelope({}), code: 0 }
		});
		await runClaude(
			{ ...baseOpts, signal: new AbortController().signal },
			{ spawn, platform: 'win32' }
		);
		expect(calls[2].args).not.toContain('--allowedTools');
	});

	it('maps a login failure to unavailable', async () => {
		const { spawn } = fakeSpawn({
			run: (c, a) => locate(c, a) ?? { stderr: 'Not logged in. Please run /login', code: 1 }
		});
		await expect(
			runClaude({ ...baseOpts, signal: new AbortController().signal }, { spawn, platform: 'win32' })
		).rejects.toThrow(ClaudeUnavailableError);
	});

	it('maps any other non-zero exit to failed, without the raw text', async () => {
		const { spawn } = fakeSpawn({
			run: (c, a) => locate(c, a) ?? { stderr: 'TypeError: boom at internal/x.js:12', code: 1 }
		});
		const err = await runClaude(
			{ ...baseOpts, signal: new AbortController().signal },
			{ spawn, platform: 'win32' }
		).catch((e) => e);
		expect(err).toBeInstanceOf(ClaudeFailedError);
		expect(err.message).not.toContain('TypeError');
	});

	it('maps an is_error envelope to failed', async () => {
		const { spawn } = fakeSpawn({
			run: (c, a) =>
				locate(c, a) ?? {
					stdout: JSON.stringify({ type: 'result', is_error: true, result: 'rate limited' }),
					code: 0
				}
		});
		await expect(
			runClaude({ ...baseOpts, signal: new AbortController().signal }, { spawn, platform: 'win32' })
		).rejects.toThrow(ClaudeFailedError);
	});

	it('treats malformed stdout as failed', async () => {
		const { spawn } = fakeSpawn({ run: (c, a) => locate(c, a) ?? { stdout: 'not json', code: 0 } });
		await expect(
			runClaude({ ...baseOpts, signal: new AbortController().signal }, { spawn, platform: 'win32' })
		).rejects.toThrow(ClaudeFailedError);
	});

	it('kills the child and rejects when aborted', async () => {
		const { spawn, killed } = fakeSpawn({
			run: (c, a) => locate(c, a) ?? { hang: true, code: null }
		});
		const controller = new AbortController();
		const promise = runClaude(
			{ ...baseOpts, signal: controller.signal },
			{ spawn, platform: 'win32' }
		);
		setTimeout(() => controller.abort(), 20);
		await expect(promise).rejects.toThrow(/Aborted/);
		expect(killed).toEqual([2]);
	});

	it('does not crash when stdin emits an error after ending (EPIPE-style)', async () => {
		const calls: Array<{ command: string; args: string[] }> = [];
		const spawn: SpawnFn = (command, args) => {
			calls.push({ command, args });
			const stdout = new PassThrough();
			const stderr = new PassThrough();
			const stdin = new PassThrough();
			const emitter = new EventEmitter();
			const out = locate(command, args) ?? { stdout: envelope({ ok: true }), code: 0 };
			const child: Spawned = {
				stdout,
				stderr,
				stdin,
				kill: () => setImmediate(() => emitter.emit('close', null)),
				on: (event, listener) => emitter.on(event, listener as (...a: unknown[]) => void)
			};
			setImmediate(() => {
				if (out.stdout) stdout.end(out.stdout);
				else stdout.end();
				if (out.stderr) stderr.end(out.stderr);
				else stderr.end();
				stdin.emit('error', new Error('EPIPE'));
				if (!out.hang) emitter.emit('close', out.code);
			});
			return child;
		};
		const result = await runClaude(
			{ ...baseOpts, signal: new AbortController().signal },
			{ spawn, platform: 'win32' }
		);
		expect(result).toEqual({ ok: true });
	});

	it('keeps what a stream printed before it errored, instead of hanging on it', async () => {
		const spawn: SpawnFn = (command, args) => {
			const stdout = new PassThrough();
			const stderr = new PassThrough();
			const stdin = new PassThrough();
			const emitter = new EventEmitter();
			const out = locate(command, args) ?? { stdout: envelope({ ok: true }), code: 0 };
			const child: Spawned = {
				stdout,
				stderr,
				stdin,
				kill: () => setImmediate(() => emitter.emit('close', null)),
				on: (event, listener) => emitter.on(event, listener as (...a: unknown[]) => void)
			};
			setImmediate(() => {
				// Data, then a read error and no 'end': collect() must still settle
				// with the text it already has, or the run never finishes.
				if (out.stdout) stdout.write(out.stdout);
				stdout.emit('error', new Error('EIO'));
				stderr.emit('error', new Error('EIO'));
				emitter.emit('close', out.code);
			});
			return child;
		};
		const result = await runClaude(
			{ ...baseOpts, signal: new AbortController().signal },
			{ spawn, platform: 'win32' }
		);
		expect(result).toEqual({ ok: true });
	});

	it('rejects immediately when aborted before the locate step runs, without spawning the print run', async () => {
		const { spawn, calls } = fakeSpawn({
			run: (c, a) => locate(c, a) ?? { stdout: envelope({ ok: true }), code: 0 }
		});
		const controller = new AbortController();
		controller.abort();
		await expect(
			runClaude({ ...baseOpts, signal: controller.signal }, { spawn, platform: 'win32' })
		).rejects.toThrow(/Aborted/);
		expect(calls.length).toBe(0);
	});

	it('spawns a .cmd binary through cmd.exe without a shell', async () => {
		const { spawn, calls } = fakeSpawn({
			run: (c, a) => {
				if (c === 'where') return { stdout: 'C:\\x\\claude.cmd\n', code: 0 };
				if (a[0] === '--version' || (a.includes('--version') && c === 'cmd.exe'))
					return { stdout: '2.1.237\n', code: 0 };
				return { stdout: envelope({ ok: true }), code: 0 };
			}
		});
		await runClaude(
			{ ...baseOpts, signal: new AbortController().signal },
			{ spawn, platform: 'win32' }
		);
		const printCall = calls[2];
		expect(printCall.command).toBe('cmd.exe');
		expect(printCall.args.slice(0, 4)).toEqual(['/d', '/s', '/c', 'C:\\x\\claude.cmd']);
	});

	it('kills the child and rejects on timeout', async () => {
		const { spawn, killed } = fakeSpawn({
			run: (c, a) => locate(c, a) ?? { hang: true, code: null }
		});
		await expect(
			runClaude(
				{ ...baseOpts, timeoutMs: 30, signal: new AbortController().signal },
				{ spawn, platform: 'win32' }
			)
		).rejects.toThrow(/Aborted/);
		expect(killed).toEqual([2]);
	});
});
