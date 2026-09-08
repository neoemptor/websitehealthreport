import { spawn as nodeSpawn } from 'child_process';
import { readdir, stat } from 'fs/promises';
import { homedir as osHomedir } from 'os';
import { delimiter, join } from 'path';
import type { DiscoveryPreflight } from '../../src/lib/shared/discovery';

/**
 * Runs the operator's own Claude Code CLI in print mode. Auth is whatever
 * `claude` already holds from the operator's login — the app never sees a
 * credential. The child is spawned without a shell, so a domain or hint can
 * never become a command.
 */
export type Spawned = {
	stdout: NodeJS.ReadableStream;
	stderr: NodeJS.ReadableStream;
	stdin: NodeJS.WritableStream;
	kill(): void;
	on(event: 'close', listener: (code: number | null) => void): unknown;
	on(event: 'error', listener: (error: Error) => void): unknown;
};
export type SpawnFn = (
	command: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv }
) => Spawned;
export type CliDeps = {
	spawn?: SpawnFn;
	platform?: NodeJS.Platform;
	/** Environment the children inherit; PATH is widened on macOS/Linux. Defaults to process.env. */
	env?: NodeJS.ProcessEnv;
	/** Defaults to os.homedir(). */
	homedir?: string;
	/** Reports whether a path is an existing file. Defaults to fs.stat. */
	isFile?: (path: string) => Promise<boolean>;
	/** Lists a directory's entries, or [] when it cannot be read. Defaults to fs.readdir. */
	listDir?: (path: string) => Promise<string[]>;
};

/** Claude Code is not installed or not logged in — the same fact as an analyzer's "unavailable". */
export class ClaudeUnavailableError extends Error {}
/** Claude Code ran and broke. The message is safe to show; the raw text stays in the log. */
export class ClaudeFailedError extends Error {
	constructor(message: string, public readonly detail: string) {
		super(message);
	}
}

const NOT_INSTALLED = 'Claude Code is not installed on this machine.';
const NOT_LOGGED_IN = 'Claude Code is not logged in. Run claude in a terminal and sign in.';

type Exit = { code: number | null; stdout: string; stderr: string };

function collect(stream: NodeJS.ReadableStream): Promise<string> {
	return new Promise((resolve) => {
		let text = '';
		stream.on('data', (chunk: Buffer | string) => (text += chunk.toString()));
		stream.on('end', () => resolve(text));
		stream.on('error', () => resolve(text));
	});
}

/** Spawn, feed stdin, wait for close; kill on abort or timeout. */
function exec(
	command: string,
	args: string[],
	opts: {
		cwd?: string;
		env?: NodeJS.ProcessEnv;
		stdin?: string;
		timeoutMs: number;
		signal?: AbortSignal;
	},
	spawn: SpawnFn
): Promise<Exit> {
	return new Promise<Exit>((resolve, reject) => {
		if (opts.signal?.aborted) {
			reject(new Error('Aborted: the request was cancelled.'));
			return;
		}
		const child = spawn(command, args, { cwd: opts.cwd, env: opts.env });
		const stdout = collect(child.stdout);
		const stderr = collect(child.stderr);
		let settled = false;

		const finish = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			opts.signal?.removeEventListener('abort', onAbort);
			fn();
		};
		const stop = (why: string) =>
			finish(() => {
				child.kill();
				reject(new Error(`Aborted: ${why}`));
			});
		const onAbort = () => stop('the request was cancelled.');
		const timer = setTimeout(() => stop('the request timed out.'), opts.timeoutMs);
		opts.signal?.addEventListener('abort', onAbort, { once: true });

		child.on('error', (error) => finish(() => reject(error)));
		child.on(
			'close',
			(code) =>
				void Promise.all([stdout, stderr]).then(([out, err]) =>
					finish(() => resolve({ code, stdout: out, stderr: err }))
				)
		);
		child.stdin.on('error', () => {});
		if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
		else child.stdin.end();
	});
}

function isWindowsShim(path: string): boolean {
	return /\.(cmd|bat)$/i.test(path);
}

/** A .cmd/.bat shim rejects a shell-less spawn with EINVAL on Node >= 20.12; run it through cmd.exe instead. */
function toSpawnCommand(command: string, args: string[]): { command: string; args: string[] } {
	if (!isWindowsShim(command)) return { command, args };
	return { command: 'cmd.exe', args: ['/d', '/s', '/c', command, ...args] };
}

/**
 * Where Claude Code's installers put the `claude` command on macOS and Linux.
 * A packaged app opened from Finder or the Dock inherits a bare PATH
 * (/usr/bin:/bin:/usr/sbin:/sbin), so these are searched explicitly rather
 * than trusting whatever PATH the app was born with. Windows GUI apps inherit
 * the user's PATH, so `where` is enough there.
 */
async function unixSearchDirs(deps: Required<CliDeps>): Promise<string[]> {
	const home = deps.homedir;
	const dirs = [
		join(home, '.local', 'bin'), // native installer (curl | bash)
		join(home, '.claude', 'local'), // `claude migrate-installer`
		'/opt/homebrew/bin', // Homebrew on Apple silicon
		'/usr/local/bin', // Homebrew on Intel, global npm on system node
		join(home, '.npm-global', 'bin'),
		join(home, '.volta', 'bin'),
		join(home, '.bun', 'bin')
	];
	// nvm and fnm keep one bin dir per Node version; newest first.
	for (const root of [
		join(home, '.nvm', 'versions', 'node'),
		join(home, '.local', 'share', 'fnm', 'node-versions')
	]) {
		const versions = (await deps.listDir(root)).sort().reverse();
		for (const v of versions) {
			dirs.push(join(root, v, 'bin'));
			dirs.push(join(root, v, 'installation', 'bin'));
		}
	}
	return dirs;
}

/** The env children run with: the app's env, plus the well-known install dirs on PATH (macOS/Linux). */
async function childEnv(deps: Required<CliDeps>): Promise<NodeJS.ProcessEnv> {
	if (deps.platform === 'win32') return deps.env;
	const current = (deps.env.PATH ?? '').split(delimiter).filter((p) => p.length > 0);
	const extra = (await unixSearchDirs(deps)).filter((dir) => !current.includes(dir));
	return { ...deps.env, PATH: [...current, ...extra].join(delimiter) };
}

async function firstOutputLine(
	command: string,
	args: string[],
	env: NodeJS.ProcessEnv,
	deps: Required<CliDeps>,
	signal?: AbortSignal
): Promise<string | null> {
	try {
		const exit = await exec(command, args, { env, timeoutMs: 10_000, signal }, deps.spawn);
		if (exit.code !== 0) return null;
		const first = exit.stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
		return first ? first.trim() : null;
	} catch (error) {
		if (signal?.aborted) throw error;
		return null;
	}
}

async function locateBinary(
	deps: Required<CliDeps>,
	env: NodeJS.ProcessEnv,
	signal?: AbortSignal
): Promise<string | null> {
	if (deps.platform === 'win32') return firstOutputLine('where', ['claude'], env, deps, signal);

	// 1. The well-known install locations, no process needed.
	for (const dir of await unixSearchDirs(deps)) {
		const candidate = join(dir, 'claude');
		if (await deps.isFile(candidate)) return candidate;
	}
	// 2. `which` with the widened PATH.
	const onPath = await firstOutputLine('which', ['claude'], env, deps, signal);
	if (onPath) return onPath;
	// 3. Ask the login shell, which loads the operator's own profile (custom
	// install dirs, version managers). Args are fixed, so nothing user-supplied
	// reaches the shell.
	const shell = deps.env.SHELL && deps.env.SHELL.length > 0 ? deps.env.SHELL : '/bin/zsh';
	const fromShell = await firstOutputLine(shell, ['-lc', 'command -v claude'], env, deps, signal);
	return fromShell && fromShell.startsWith('/') ? fromShell : null;
}

function resolveDeps(deps?: CliDeps): Required<CliDeps> {
	return {
		spawn: deps?.spawn ?? (nodeSpawn as unknown as SpawnFn),
		platform: deps?.platform ?? process.platform,
		env: deps?.env ?? process.env,
		homedir: deps?.homedir ?? osHomedir(),
		isFile:
			deps?.isFile ??
			(async (path) => {
				try {
					return (await stat(path)).isFile();
				} catch {
					return false;
				}
			}),
		listDir:
			deps?.listDir ??
			(async (path) => {
				try {
					return await readdir(path);
				} catch {
					return [];
				}
			})
	};
}

/** Locates the binary and checks its version. Reused by runClaude so the path is found once. */
async function locateAndCheck(
	deps: Required<CliDeps>,
	signal?: AbortSignal
): Promise<{ preflight: DiscoveryPreflight; binary: string | null; env: NodeJS.ProcessEnv }> {
	const env = await childEnv(deps);
	const binary = await locateBinary(deps, env, signal);
	if (!binary) return { preflight: { available: false, reason: NOT_INSTALLED }, binary: null, env };
	try {
		const { command, args } = toSpawnCommand(binary, ['--version']);
		const exit = await exec(command, args, { env, timeoutMs: 10_000, signal }, deps.spawn);
		if (exit.code !== 0)
			return { preflight: { available: false, reason: NOT_INSTALLED }, binary: null, env };
		return { preflight: { available: true, version: exit.stdout.trim() }, binary, env };
	} catch (error) {
		if (signal?.aborted) throw error;
		return { preflight: { available: false, reason: NOT_INSTALLED }, binary: null, env };
	}
}

export async function findClaude(deps?: CliDeps): Promise<DiscoveryPreflight> {
	const d = resolveDeps(deps);
	const { preflight } = await locateAndCheck(d);
	return preflight;
}

const LOGIN_PATTERN = /log ?in|logged in|authenticat|oauth|api key|credential/i;

export async function runClaude(
	opts: {
		prompt: string;
		systemAppend: string;
		schema: object;
		allowedTools: string[];
		signal: AbortSignal;
		timeoutMs: number;
		cwd: string;
	},
	deps?: CliDeps
): Promise<unknown> {
	const d = resolveDeps(deps);
	const { preflight, binary, env } = await locateAndCheck(d, opts.signal);
	if (!preflight.available) throw new ClaudeUnavailableError(preflight.reason);
	if (!binary) throw new ClaudeUnavailableError(NOT_INSTALLED);

	const args = [
		'-p',
		'--output-format',
		'json',
		'--json-schema',
		JSON.stringify(opts.schema),
		'--no-session-persistence',
		'--model',
		'sonnet',
		'--append-system-prompt',
		opts.systemAppend
	];
	if (opts.allowedTools.length > 0) args.push('--allowedTools', opts.allowedTools.join(','));

	const { command, args: spawnArgs } = toSpawnCommand(binary, args);
	const exit = await exec(
		command,
		spawnArgs,
		{ cwd: opts.cwd, env, stdin: opts.prompt, timeoutMs: opts.timeoutMs, signal: opts.signal },
		d.spawn
	);

	const detail = `${exit.stderr}\n${exit.stdout}`.slice(-2000);
	if (exit.code !== 0) {
		if (LOGIN_PATTERN.test(exit.stderr) || LOGIN_PATTERN.test(exit.stdout))
			throw new ClaudeUnavailableError(NOT_LOGGED_IN);
		throw new ClaudeFailedError('Claude Code stopped before it could answer.', detail);
	}

	let envelope: { is_error?: boolean; result?: string; structured_output?: unknown };
	try {
		envelope = JSON.parse(exit.stdout);
	} catch {
		throw new ClaudeFailedError('Claude Code returned something that could not be read.', detail);
	}
	if (envelope.is_error) {
		if (LOGIN_PATTERN.test(envelope.result ?? '')) throw new ClaudeUnavailableError(NOT_LOGGED_IN);
		throw new ClaudeFailedError('Claude Code reported an error instead of an answer.', detail);
	}
	if (envelope.structured_output === undefined)
		throw new ClaudeFailedError('Claude Code answered without the expected structure.', detail);
	return envelope.structured_output;
}
