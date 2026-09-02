import type { AnalyzerId } from '../../src/lib/shared/types';

export type Concurrency = 'parallel' | 'limited' | 'serial';

export type Preflight = { available: true } | { available: false; reason: string };

export interface Analyzer<TSettings = unknown> {
  id: AnalyzerId;
  label: string;
  /** parallel: unbounded. limited: semaphore of 2. serial: global lock. */
  concurrency: Concurrency;
  timeoutMs: number;
  defaultSettings: TSettings;
  preflight(settings: TSettings): Promise<Preflight>;
  analyze(domain: string, settings: TSettings, signal: AbortSignal): Promise<unknown>;
}
