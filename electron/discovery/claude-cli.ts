import { spawn as nodeSpawn } from 'child_process';
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
export type SpawnFn = (command: string, args: string[], options: { cwd?: string }) => Spawned;
export type CliDeps = { spawn?: SpawnFn; platform?: NodeJS.Platform };

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
	});
}

/** Spawn, feed stdin, wait for close; kill on abort or timeout. */
function exec(
	command: string,
	args: string[],
	opts: { cwd?: string; stdin?: string; timeoutMs: number; signal?: AbortSignal },
	spawn: SpawnFn
): Promise<Exit> {
	return new Promise<Exit>((resolve, reject) => {
		if (opts.signal?.aborted) {
			reject(new Error('Aborted: the request was cancelled.'));
			return;
		}
		const child = spawn(command, args, { cwd: opts.cwd });
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
		if (opts.stdin !== undefined) child.stdin.end(opts.stdin);
		else child.stdin.end();
	});
}

async function locateBinary(deps: Required<CliDeps>): Promise<string | null> {
	const finder = deps.platform === 'win32' ? 'where' : 'which';
	try {
		const exit = await exec(finder, ['claude'], { timeoutMs: 10_000 }, deps.spawn);
		if (exit.code !== 0) return null;
		const first = exit.stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
		return first ? first.trim() : null;
	} catch {
		return null;
	}
}

function resolveDeps(deps?: CliDeps): Required<CliDeps> {
	return {
		spawn: deps?.spawn ?? (nodeSpawn as unknown as SpawnFn),
		platform: deps?.platform ?? process.platform
	};
}

/** Locates the binary and checks its version. Reused by runClaude so the path is found once. */
async function locateAndCheck(
	deps: Required<CliDeps>
): Promise<{ preflight: DiscoveryPreflight; binary: string | null }> {
	const binary = await locateBinary(deps);
	if (!binary) return { preflight: { available: false, reason: NOT_INSTALLED }, binary: null };
	try {
		const exit = await exec(binary, ['--version'], { timeoutMs: 10_000 }, deps.spawn);
		if (exit.code !== 0)
			return { preflight: { available: false, reason: NOT_INSTALLED }, binary: null };
		return { preflight: { available: true, version: exit.stdout.trim() }, binary };
	} catch {
		return { preflight: { available: false, reason: NOT_INSTALLED }, binary: null };
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
	const { preflight, binary } = await locateAndCheck(d);
	if (!preflight.available || !binary)
		throw new ClaudeUnavailableError(preflight.available ? NOT_INSTALLED : preflight.reason);

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

	const exit = await exec(
		binary,
		args,
		{ cwd: opts.cwd, stdin: opts.prompt, timeoutMs: opts.timeoutMs, signal: opts.signal },
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
