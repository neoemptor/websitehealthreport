import type { AnalyzerId } from '../../src/lib/shared/types';

export type Concurrency = 'parallel' | 'limited' | 'serial' | 'exclusive';

export type Preflight = { available: true } | { available: false; reason: string };

export interface Analyzer<TSettings = unknown> {
	id: AnalyzerId;
	label: string;
	/**
	 * parallel: capped by the run's parallel cap. limited: semaphore of 2.
	 * serial: one at a time, but alongside analyzers of other kinds.
	 * exclusive: alone — nothing else in the run runs while it does. For
	 * analyzers that measure the machine rather than the site, where a busy
	 * CPU changes the answer.
	 */
	concurrency: Concurrency;
	timeoutMs: number;
	defaultSettings: TSettings;
	preflight(settings: TSettings): Promise<Preflight>;
	analyze(domain: string, settings: TSettings, signal: AbortSignal): Promise<unknown>;
}
